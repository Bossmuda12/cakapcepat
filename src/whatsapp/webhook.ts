import { Router, type Request, type Response } from "express";
import crypto from "node:crypto";
import { config } from "../config";
import { pool } from "../db/pool";
import { maybeGenerateAiReply } from "../ai/chatbot";
import { sendTextMessage } from "./client";

export const webhookRouter = Router();

/**
 * GET /webhook/whatsapp — verifikasi URL webhook, dipanggil sekali oleh Meta
 * saat kamu mendaftarkan URL ini di Meta App Dashboard.
 */
webhookRouter.get("/webhook/whatsapp", (req: Request, res: Response) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === config.whatsapp.webhookVerifyToken) {
    console.log("[webhook] Verifikasi berhasil.");
    res.status(200).send(challenge);
  } else {
    console.warn("[webhook] Verifikasi GAGAL — cek WHATSAPP_WEBHOOK_VERIFY_TOKEN di .env.");
    res.sendStatus(403);
  }
});

/**
 * POST /webhook/whatsapp — event pesan masuk & update status pesan keluar.
 * Butuh raw body untuk verifikasi signature (lihat server.ts).
 */
webhookRouter.post("/webhook/whatsapp", async (req: Request, res: Response) => {
  if (!isValidSignature(req)) {
    console.warn("[webhook] Signature tidak valid — request ditolak.");
    return res.sendStatus(401);
  }

  // Balas cepat ke Meta dulu, proses berat dilakukan setelahnya.
  res.sendStatus(200);

  try {
    await handleIncomingPayload(req.body);
  } catch (err) {
    console.error("[webhook] Gagal memproses payload:", err);
  }
});

function isValidSignature(req: Request): boolean {
  const signatureHeader = req.get("x-hub-signature-256");
  if (!signatureHeader || !config.whatsapp.appSecret) return config.nodeEnv !== "production";

  const expected =
    "sha256=" +
    crypto
      .createHmac("sha256", config.whatsapp.appSecret)
      // @ts-expect-error rawBody ditempel di server.ts lewat express.json({ verify })
      .update(req.rawBody ?? "")
      .digest("hex");

  try {
    return crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected));
  } catch {
    return false;
  }
}

async function handleIncomingPayload(body: any) {
  const entries = body?.entry ?? [];

  for (const entry of entries) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      const phoneNumberId = value.metadata?.phone_number_id;

      for (const msg of value.messages ?? []) {
        await handleIncomingMessage(phoneNumberId, msg, value.contacts?.[0]);
      }

      for (const status of value.statuses ?? []) {
        await pool.query(
          "UPDATE messages SET status = $1 WHERE wa_message_id = $2",
          [status.status, status.id]
        );
      }
    }
  }
}

async function handleIncomingMessage(phoneNumberId: string, msg: any, waContact: any) {
  const { rows: channelRows } = await pool.query(
    "SELECT id, organization_id, access_token FROM whatsapp_channels WHERE phone_number_id = $1",
    [phoneNumberId]
  );
  const channel = channelRows[0];
  if (!channel) {
    console.warn(`[webhook] Pesan masuk dari channel yang belum terdaftar: ${phoneNumberId}`);
    return;
  }

  // organization_id sekarang langsung di whatsapp_channels — channel bisa dimiliki
  // 1 CS untuk 1 produk tanpa harus terikat departemen (lihat Bab 4 dokumen rencana v2).
  const organizationId = channel.organization_id;

  const { rows: contactRows } = await pool.query(
    `INSERT INTO contacts (organization_id, wa_number, name)
     VALUES ($1, $2, $3)
     ON CONFLICT (organization_id, wa_number) DO UPDATE SET name = COALESCE(contacts.name, EXCLUDED.name)
     RETURNING id`,
    [organizationId, msg.from, waContact?.profile?.name ?? null]
  );
  const contactId = contactRows[0].id;

  // --- Tangkap data atribusi iklan CTWA (Click-to-WhatsApp), lihat Bab 8 dokumen rencana ---
  // Meta menyisipkan objek "referral" di pesan PERTAMA yang datang dari klik iklan CTWA.
  const referral = msg.referral; // { source_url, ctwa_clid, headline, ... } kalau berasal dari iklan
  const ctwaClid: string | null = referral?.ctwa_clid ?? null;

  const { rows: convoRows } = await pool.query(
    `INSERT INTO conversations (contact_id, channel_id, ctwa_clid, ad_source_url, last_message_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [contactId, channel.id, ctwaClid, referral?.source_url ?? null]
  );

  // Kalau conversation sudah ada sebelumnya (kontak chat lagi), ambil id-nya.
  let conversationId = convoRows[0]?.id;
  if (!conversationId) {
    const { rows } = await pool.query(
      "SELECT id FROM conversations WHERE contact_id = $1 AND channel_id = $2 ORDER BY created_at DESC LIMIT 1",
      [contactId, channel.id]
    );
    conversationId = rows[0]?.id;
    await pool.query("UPDATE conversations SET last_message_at = now() WHERE id = $1", [conversationId]);
  }

  if (ctwaClid) {
    console.log(`[webhook] Chat ini berasal dari iklan CTWA, ctwa_clid=${ctwaClid}`);
  }

  const textBody = msg.text?.body ?? "";
  await pool.query(
    `INSERT INTO messages (conversation_id, direction, wa_message_id, content_type, content, status)
     VALUES ($1, 'inbound', $2, 'text', $3, 'received')`,
    [conversationId, msg.id, JSON.stringify({ body: textBody })]
  );

  await maybeAutoReply({
    organizationId,
    conversationId,
    channelId: channel.id,
    to: msg.from,
    phoneNumberId,
    accessToken: channel.access_token,
    incomingText: textBody,
  });
}

interface AutoReplyParams {
  organizationId: string;
  conversationId: string;
  channelId: string;
  to: string;
  phoneNumberId: string;
  accessToken: string;
  incomingText: string;
}

/**
 * Urutan auto-reply (lihat halaman "Otomatisasi" di dashboard):
 *   1. Aturan keyword yang cocok — balas langsung, berhenti di sini.
 *   2. Aturan office_hours — kalau di luar jam kerja, kirim balasan itu, berhenti.
 *   3. Fallback ke AI chatbot — hanya kalau ada automation aktif bertipe
 *      'fallback_to_ai' UNTUK channel ini, ATAU channel belum punya automation
 *      sama sekali (supaya perilaku lama tetap jalan kalau belum diatur manual).
 */
async function maybeAutoReply(params: AutoReplyParams) {
  const { organizationId, conversationId, channelId, to, phoneNumberId, accessToken, incomingText } = params;

  const { rows: automations } = await pool.query(
    "SELECT trigger_type, config, is_active FROM automations WHERE channel_id = $1",
    [channelId]
  );

  const sendAndLog = async (replyText: string, senderType: "human" | "ai" = "human") => {
    await sendTextMessage({ to, body: replyText, phoneNumberId, accessToken });
    await pool.query(
      `INSERT INTO messages (conversation_id, direction, sender_type, content_type, content, status)
       VALUES ($1, 'outbound', $2, 'text', $3, 'sent')`,
      [conversationId, senderType, JSON.stringify({ body: replyText })]
    );
  };

  const activeKeywordRules = automations.filter((a) => a.trigger_type === "keyword" && a.is_active);
  for (const rule of activeKeywordRules) {
    const keyword: string | undefined = rule.config?.keyword;
    const reply: string | undefined = rule.config?.reply;
    if (keyword && reply && incomingText.toLowerCase().includes(keyword.toLowerCase())) {
      await sendAndLog(reply);
      return;
    }
  }

  const officeHoursRule = automations.find((a) => a.trigger_type === "office_hours" && a.is_active);
  if (officeHoursRule && isOutsideOfficeHours(officeHoursRule.config)) {
    const reply: string | undefined = officeHoursRule.config?.outsideReply;
    if (reply) {
      await sendAndLog(reply);
      return;
    }
  }

  const hasFallbackToAiRule = automations.some((a) => a.trigger_type === "fallback_to_ai" && a.is_active);
  const noAutomationsConfigured = automations.length === 0;
  if (hasFallbackToAiRule || noAutomationsConfigured) {
    const aiReply = await maybeGenerateAiReply({ organizationId, conversationId, incomingText });
    if (aiReply) {
      await sendAndLog(aiReply, "ai");
    }
  }
}

// Zona waktu Indonesia Barat (WIB, UTC+7) dipakai sebagai default kalau
// config.timezone tidak diisi — cukup untuk kebanyakan tim internal di Indonesia.
function isOutsideOfficeHours(cfg: { start?: string; end?: string; utcOffsetHours?: number }): boolean {
  const start = cfg?.start ?? "09:00";
  const end = cfg?.end ?? "17:00";
  const offset = cfg?.utcOffsetHours ?? 7;

  const now = new Date();
  const localMinutes = ((now.getUTCHours() + offset) * 60 + now.getUTCMinutes()) % (24 * 60);

  const [startH, startM] = start.split(":").map(Number);
  const [endH, endM] = end.split(":").map(Number);
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  return localMinutes < startMinutes || localMinutes >= endMinutes;
}
