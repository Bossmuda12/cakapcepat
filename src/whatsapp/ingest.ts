import { pool } from "../db/pool";
import { generateAiReplyDetailed } from "../ai/chatbot";
import { broadcastToOrg } from "../realtime";
import { sendHumanized } from "./outbox";

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

/** F-30/F-31/F-33: info media (foto/voice note/video/dokumen/stiker) yang sudah disimpan lewat media.ts. */
export interface IngestMediaInfo {
  /** image | audio | video | document | sticker — dipakai juga sbg content_type di tabel messages. */
  type: string;
  mime: string;
  /** Path relatif hasil saveIncomingMedia, mis. "/uploads/media/<org>/<uuid>.ext". */
  url: string;
  size?: number | null;
  transcript?: string | null;
  transcribedAt?: Date | null;
}

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
  /** F-30: diisi kalau pesan ini media (foto/voice note/dst) — null/absen berarti pesan teks biasa. */
  media?: IngestMediaInfo | null;
}

export async function ingestInboundMessage(
  input: IngestInboundMessageInput
): Promise<{ conversationId: string; duplicate: boolean }> {
  const { channelId, organizationId, waNumber, contactName, waMessageId, textBody, ctwaClid, adSourceUrl, media } =
    input;

  const { rows: contactRows } = await pool.query(
    `INSERT INTO contacts (organization_id, wa_number, name)
     VALUES ($1, $2, $3)
     ON CONFLICT (organization_id, wa_number) DO UPDATE SET name = COALESCE(contacts.name, EXCLUDED.name)
     RETURNING id`,
    [organizationId, waNumber, contactName ?? null]
  );
  const contactId = contactRows[0].id;

  // --- Atribusi iklan CTWA (Click-to-WhatsApp), lihat Bab 8 dokumen rencana ---
  // Dulu HANYA pernah terisi lewat jalur Cloud API resmi (objek "referral" yang
  // dikirim Meta di webhook). Sejak S-11/P-27, jalur QR/pairing JUGA bisa
  // mengisi ini — Baileys menaruh info iklan (kalau chat berasal dari klik
  // iklan CTWA) di contextInfo.externalAdReply pesan pertama, lihat
  // qrSessionManager.ts. Jadi ctwaClid/adSourceUrl bisa terisi dari KEDUA jalur.
  //
  // P-1: dulu pakai "ON CONFLICT DO NOTHING" padahal (contact_id, channel_id)
  // TIDAK punya unique constraint, jadi tiap pesan masuk selalu bikin
  // percakapan baru. Sekarang upsert beneran ke UNIQUE INDEX
  // idx_conversations_contact_channel (lihat schema.sql) — percakapan yang
  // sudah ada dipakai ulang, cuma last_message_at yang diperbarui, dan
  // ctwa_clid/ad_source_url diisi kalau belum ada (tidak menimpa yang sudah
  // tercatat dari pesan pertama).
  const { rows: convoRows } = await pool.query(
    `INSERT INTO conversations (organization_id, contact_id, channel_id, ctwa_clid, ad_source_url, last_message_at)
     VALUES ($5, $1, $2, $3, $4, now())
     ON CONFLICT (contact_id, channel_id) DO UPDATE SET
       last_message_at = now(),
       ctwa_clid = COALESCE(conversations.ctwa_clid, EXCLUDED.ctwa_clid),
       ad_source_url = COALESCE(conversations.ad_source_url, EXCLUDED.ad_source_url)
     RETURNING id`,
    [contactId, channelId, ctwaClid ?? null, adSourceUrl ?? null, organizationId]
  );

  const conversationId: string = convoRows[0].id;

  // F-30/F-31/F-33: pesan media (foto/voice note/video/dokumen/stiker) dicatat
  // dengan content_type = jenis medianya (bukan selalu 'text' seperti dulu) +
  // kolom media_type/media_mime/media_url/media_size/transcript/transcribed_at
  // terisi. content JSONB tetap diisi { body: textBody } (caption atau hasil
  // transkrip kalau ada, string kosong kalau tidak) — dipertahankan tetap
  // berbentuk sama seperti pesan teks supaya kode lama yang membaca
  // content.body tidak ikut rusak.
  //
  // P-3: wa_message_id sekarang UNIQUE (partial index, lihat schema.sql) —
  // kalau pesan ini sudah pernah dicatat sebelumnya (mis. webhook Meta yang
  // dikirim ulang, atau event Baileys yang diproses dua kali), INSERT ini
  // tidak menghasilkan baris apa pun. Pemanggil WAJIB melewati auto-reply
  // saat duplicate=true supaya balasan tidak ikut terkirim dobel.
  const { rows: messageRows } = await pool.query(
    `INSERT INTO messages (
       organization_id, conversation_id, direction, wa_message_id, content_type, content, status,
       media_type, media_mime, media_url, media_size, transcript, transcribed_at
     )
     VALUES ($11, $1, 'inbound', $2, $3, $4, 'received', $5, $6, $7, $8, $9, $10)
     ON CONFLICT (wa_message_id) WHERE wa_message_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [
      conversationId,
      waMessageId ?? null,
      media?.type ?? "text",
      JSON.stringify({ body: textBody }),
      media?.type ?? null,
      media?.mime ?? null,
      media?.url ?? null,
      media?.size ?? null,
      media?.transcript ?? null,
      media?.transcribedAt ?? null,
      organizationId,
    ]
  );
  const duplicate = messageRows.length === 0;

  if (!duplicate) {
    broadcastToOrg(organizationId, { type: "message", conversationId });
  }

  return { conversationId, duplicate };
}

export interface MaybeAutoReplyInput {
  organizationId: string;
  conversationId: string;
  channelId: string;
  incomingText: string;
  /**
   * Nomor/JID tujuan balasan — dipakai sbg parameter `jid` saat balasan AI
   * dikirim lewat sendHumanized (lihat outbox.ts). Untuk jalur Cloud API isi
   * dengan nomor telepon (msg.from); untuk jalur QR isi dengan JID Baileys.
   */
  waNumber: string;
  /** Abstraksi kirim pesan — beda implementasi per jenis koneksi (Cloud API HTTP vs socket Baileys). */
  send: (text: string) => Promise<void>;
  /**
   * F-4: opsional — update status "sedang mengetik" ke pelanggan. Jalur QR
   * bisa mengisi ini lewat sock.sendPresenceUpdate; Cloud API resmi tidak
   * punya API presence yang setara untuk MVP ini jadi cukup dilewati
   * (undefined) — sendHumanized tetap jalan (jeda & pemecahan gelembung
   * tetap terjadi), cuma tanpa indikator "sedang mengetik" di sisi pelanggan.
   */
  presence?: (state: "composing" | "paused") => Promise<void>;
}

/**
 * Urutan auto-reply (lihat halaman "Otomatisasi" di dashboard):
 *   1. Aturan keyword yang cocok — balas langsung, berhenti di sini.
 *   2. Aturan office_hours — kalau di luar jam kerja, kirim balasan itu, berhenti.
 *   3. Fallback ke AI chatbot — hanya kalau ada automation aktif bertipe
 *      'fallback_to_ai' UNTUK channel ini, ATAU channel belum punya automation
 *      sama sekali (supaya perilaku lama tetap jalan kalau belum diatur manual).
 *
 * Aturan keyword & jam kerja TETAP dikirim langsung (tanpa jeda manusiawi) —
 * itu balasan template pendek yang memang dimaksud instan. Balasan AI-lah
 * yang lewat jalur manusiawi (sendHumanized, lihat outbox.ts) supaya tidak
 * terasa seperti bot yang membalas dalam hitungan milidetik.
 */
export async function maybeAutoReply(params: MaybeAutoReplyInput) {
  const { organizationId, conversationId, channelId, incomingText, waNumber, send, presence } = params;

  const { rows: automations } = await pool.query(
    "SELECT trigger_type, config, is_active FROM automations WHERE channel_id = $1",
    [channelId]
  );

  const sendAndLog = async (replyText: string, senderType: "human" | "ai" = "human", status = "sent") => {
    if (status === "sent") await send(replyText);
    await pool.query(
      `INSERT INTO messages (organization_id, conversation_id, direction, sender_type, content_type, content, status)
       VALUES ($5, $1, 'outbound', $2, 'text', $3, $4)`,
      [conversationId, senderType, JSON.stringify({ body: replyText }), status, organizationId]
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
  if (!hasFallbackToAiRule && !noAutomationsConfigured) return;

  // F-3: AI dimatikan manual dari dashboard untuk nomor ini — jangan panggil
  // AI sama sekali (bukan cuma "jangan kirim balasannya").
  const { rows: channelRows } = await pool.query(
    "SELECT ai_enabled, ai_approval_mode FROM whatsapp_channels WHERE id = $1",
    [channelId]
  );
  const channelCfg = channelRows[0];
  if (!channelCfg?.ai_enabled) return;

  const aiResult = await generateAiReplyDetailed({ organizationId, conversationId, channelId, incomingText });
  if (!aiResult) return;

  if (channelCfg.ai_approval_mode) {
    // Mode persetujuan (F-3, default menyala): AI menyusun balasan tapi TIDAK
    // dikirim otomatis — disimpan sbg draft (status='draft') supaya muncul
    // di dashboard utk disetujui/diedit manusia dulu. send() SENGAJA TIDAK
    // dipanggil.
    await sendAndLog(aiResult.text, "ai", "draft");
    console.log(
      `[ingest] Balasan AI utk conversation ${conversationId} disimpan sbg draft (ai_approval_mode menyala) — menunggu persetujuan manusia.`
    );
    return;
  }

  // F-4: balasan AI (bukan template keyword/jam kerja) lewat jalur manusiawi —
  // dipecah jadi beberapa gelembung dengan jeda alami, bukan langsung
  // ditembak sekaligus. sendHumanized yang menghitung ulang pemecahan
  // gelembung & jeda (bukan pakai aiResult.bubbles/delayMs) supaya perilaku
  // "manusiawi" konsisten dipakai SEMUA balasan AI, bukan cuma yang lewat
  // chatbot.ts — lihat outbox.ts.
  await sendHumanized({
    channelId,
    conversationId,
    organizationId,
    jid: waNumber,
    text: aiResult.text,
    send: async (bubbleText) => {
      await send(bubbleText);
      await pool.query(
        `INSERT INTO messages (organization_id, conversation_id, direction, sender_type, content_type, content, status)
         VALUES ($3, $1, 'outbound', 'ai', 'text', $2, 'sent')`,
        [conversationId, JSON.stringify({ body: bubbleText }), organizationId]
      );
      broadcastToOrg(organizationId, { type: "message", conversationId });
    },
    presence,
  });
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
