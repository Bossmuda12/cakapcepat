import { pool } from "../db/pool";
import { maybeGenerateAiReply } from "../ai/chatbot";
import { broadcastToOrg } from "../realtime";

/**
 * Logika inti "pesan WhatsApp masuk -> tersimpan di dashboard" yang DIPAKAI
 * BERSAMA oleh dua jalur koneksi WhatsApp yang beda total secara teknis:
 *   1. Cloud API resmi (webhook Meta)         -> lihat src/whatsapp/webhook.ts
 *   2. QR / kode pairing (ala WhatsApp Web)   -> lihat src/whatsapp/qrSessionManager.ts
 *
 * Tujuannya: berapa pun jenis koneksi nomornya, semua pesan berakhir di
 * tabel contacts/conversations/messages yang SAMA, jadi halaman Monitor,
 * Percakapan, dan Laporan Order bekerja seragam tanpa peduli itu nomor
 * resmi atau nomor tim yang disambungkan lewat QR.
 */

export interface IngestInboundMessageInput {
  channelId: string;
  organizationId: string;
  /** Nomor pengirim, format internasional tanpa "+" (mis. 62812xxxxxxx). */
  waNumber: string;
  contactName?: string | null;
  waMessageId?: string | null;
  textBody: string;
  ctwaClid?: string | null;
  adSourceUrl?: string | null;
}

export async function ingestInboundMessage(
  input: IngestInboundMessageInput
): Promise<{ conversationId: string }> {
  const { channelId, organizationId, waNumber, contactName, waMessageId, textBody, ctwaClid, adSourceUrl } =
    input;

  const { rows: contactRows } = await pool.query(
    `INSERT INTO contacts (organization_id, wa_number, name)
     VALUES ($1, $2, $3)
     ON CONFLICT (organization_id, wa_number) DO UPDATE SET name = COALESCE(contacts.name, EXCLUDED.name)
     RETURNING id`,
    [organizationId, waNumber, contactName ?? null]
  );
  const contactId = contactRows[0].id;

  // --- Atribusi iklan CTWA (Click-to-WhatsApp) — hanya pernah terisi lewat
  // jalur Cloud API resmi (objek "referral" cuma dikirim Meta di webhook).
  // Nomor QR/pairing TIDAK PERNAH punya ctwaClid — ini konsekuensi arsitektur
  // yang disadari & diterima saat memilih pendekatan hybrid.
  const { rows: convoRows } = await pool.query(
    `INSERT INTO conversations (contact_id, channel_id, ctwa_clid, ad_source_url, last_message_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [contactId, channelId, ctwaClid ?? null, adSourceUrl ?? null]
  );

  let conversationId: string | undefined = convoRows[0]?.id;
  if (!conversationId) {
    const { rows } = await pool.query(
      "SELECT id FROM conversations WHERE contact_id = $1 AND channel_id = $2 ORDER BY created_at DESC LIMIT 1",
      [contactId, channelId]
    );
    conversationId = rows[0]?.id;
    await pool.query("UPDATE conversations SET last_message_at = now() WHERE id = $1", [conversationId]);
  }

  await pool.query(
    `INSERT INTO messages (conversation_id, direction, wa_message_id, content_type, content, status)
     VALUES ($1, 'inbound', $2, 'text', $3, 'received')`,
    [conversationId, waMessageId ?? null, JSON.stringify({ body: textBody })]
  );

  broadcastToOrg(organizationId, { type: "message", conversationId });

  return { conversationId: conversationId as string };
}

export interface MaybeAutoReplyInput {
  organizationId: string;
  conversationId: string;
  channelId: string;
  incomingText: string;
  /** Abstraksi kirim pesan — beda implementasi per jenis koneksi (Cloud API HTTP vs socket Baileys). */
  send: (text: string) => Promise<void>;
}

/**
 * Urutan auto-reply (lihat halaman "Otomatisasi" di dashboard):
 *   1. Aturan keyword yang cocok — balas langsung, berhenti di sini.
 *   2. Aturan office_hours — kalau di luar jam kerja, kirim balasan itu, berhenti.
 *   3. Fallback ke AI chatbot — hanya kalau ada automation aktif bertipe
 *      'fallback_to_ai' UNTUK channel ini, ATAU channel belum punya automation
 *      sama sekali (supaya perilaku lama tetap jalan kalau belum diatur manual).
 */
export async function maybeAutoReply(params: MaybeAutoReplyInput) {
  const { organizationId, conversationId, channelId, incomingText, send } = params;

  const { rows: automations } = await pool.query(
    "SELECT trigger_type, config, is_active FROM automations WHERE channel_id = $1",
    [channelId]
  );

  const sendAndLog = async (replyText: string, senderType: "human" | "ai" = "human") => {
    await send(replyText);
    await pool.query(
      `INSERT INTO messages (conversation_id, direction, sender_type, content_type, content, status)
       VALUES ($1, 'outbound', $2, 'text', $3, 'sent')`,
      [conversationId, senderType, JSON.stringify({ body: replyText })]
    );
    broadcastToOrg(organizationId, { type: "message", conversationId });
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
