import { Router, type Request, type Response } from "express";
import crypto from "node:crypto";
import { config } from "../config";
import { pool } from "../db/pool";
import { sendTextMessage } from "./client";
import { ingestInboundMessage, maybeAutoReply } from "./ingest";

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

  // --- Tangkap data atribusi iklan CTWA (Click-to-WhatsApp), lihat Bab 8 dokumen rencana ---
  // Meta menyisipkan objek "referral" di pesan PERTAMA yang datang dari klik iklan CTWA.
  // Ini SATU-SATUNYA jalur yang pernah punya ctwaClid — nomor QR/pairing tidak pernah dapat ini.
  const referral = msg.referral; // { source_url, ctwa_clid, headline, ... } kalau berasal dari iklan
  const ctwaClid: string | null = referral?.ctwa_clid ?? null;
  if (ctwaClid) {
    console.log(`[webhook] Chat ini berasal dari iklan CTWA, ctwa_clid=${ctwaClid}`);
  }

  const textBody = msg.text?.body ?? "";

  const { conversationId } = await ingestInboundMessage({
    channelId: channel.id,
    organizationId,
    waNumber: msg.from,
    contactName: waContact?.profile?.name ?? null,
    waMessageId: msg.id,
    textBody,
    ctwaClid,
    adSourceUrl: referral?.source_url ?? null,
  });

  await maybeAutoReply({
    organizationId,
    conversationId,
    channelId: channel.id,
    incomingText: textBody,
    send: async (replyText) => {
      await sendTextMessage({ to: msg.from, body: replyText, phoneNumberId, accessToken: channel.access_token });
    },
  });
}
