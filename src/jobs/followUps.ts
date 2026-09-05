import { pool } from "../db/pool";
import { sendViaQrSession } from "../whatsapp/qrSessionManager";
import { canSendNow, recordSend } from "../whatsapp/outbox";
import { callClaude } from "../ai/anthropic";
import { getAiConfig } from "../ai/usage";

/**
 * F-25 s/d F-28: follow-up berjadwal untuk percakapan yang "hilang" (pelanggan
 * berhenti membalas setelah kita balas). Dua fungsi terpisah dipanggil
 * scheduler.ts pada interval berbeda:
 *   - scheduleFollowUps()  -> tiap ~15 menit, MEMBUAT baris follow_ups.
 *   - sendDueFollowUps()   -> tiap ~5 menit, MENGIRIM baris yang sudah jatuh tempo.
 * Dipisah sengaja: menjadwalkan itu murah (cuma tulis DB), sedangkan mengirim
 * butuh jeda acak antar pesan (anti-spam) — kalau digabung, satu tick yang
 * menjadwalkan BANYAK percakapan sekaligus bisa memicu pengiriman serentak.
 */

// Jarak follow-up dari saat pelanggan terakhir "dibiarkan menggantung" —
// H+1 (attempt 1), H+3 (attempt 2), H+7 (attempt 3). Kalau
// organization.followup_max_attempts diisi lebih kecil, attempt yang
// melebihi itu tidak pernah dijadwalkan (lihat scheduleFollowUps).
const ATTEMPT_OFFSETS_MS: Record<number, number> = {
  1: 1 * 24 * 60 * 60 * 1000,
  2: 3 * 24 * 60 * 60 * 1000,
  3: 7 * 24 * 60 * 60 * 1000,
};

const SCHEDULE_BATCH_LIMIT = 200;
const SEND_BATCH_LIMIT = 50;

// F-25: jeda antar PENGIRIMAN follow-up (bukan antar gelembung dalam 1 pesan
// — itu urusan sendHumanized/outbox.ts) — inilah yang paling menentukan nomor
// aman dari flag spam saat mengirim ke BANYAK pelanggan berbeda dalam satu
// tick scheduler.
const MIN_SEND_GAP_MS = 20_000;
const MAX_SEND_GAP_MS = 90_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomBetween(minMs: number, maxMs: number): number {
  return minMs + Math.random() * (maxMs - minMs);
}

// Status order yang membuat percakapan TIDAK PERLU (lagi) di-follow-up.
const TERMINAL_ORDER_STATUSES = new Set(["closing", "cancelled", "spam"]);

interface FollowUpCandidateRow {
  conversation_id: string;
  channel_id: string;
  organization_id: string;
  followup_max_attempts: number;
  anchor_at: string; // timestamptz dari Postgres, datang sbg string ISO
}

/**
 * F-25/F-26: cari percakapan yang pesan TERAKHIRNYA adalah balasan KITA
 * (outbound) dan sudah lebih dari 24 jam TANPA pelanggan membalas sejak itu
 * — anchor waktunya adalah waktu balasan terakhir kita itu sendiri. Untuk
 * tiap percakapan begitu, buat baris follow_ups attempt 1 (anchor + 1 hari),
 * 2 (anchor + 3 hari), 3 (anchor + 7 hari) — hanya sampai
 * organization.followup_max_attempts. Index unik (conversation_id, attempt)
 * dipakai lewat ON CONFLICT DO NOTHING supaya aman dipanggil berulang tiap
 * 15 menit tanpa menggandakan baris yang sudah ada.
 */
export async function scheduleFollowUps(): Promise<number> {
  const { rows: candidates } = await pool.query<FollowUpCandidateRow>(
    `SELECT conv.id AS conversation_id, conv.channel_id AS channel_id,
            ct.organization_id AS organization_id, org.followup_max_attempts AS followup_max_attempts,
            lastmsg.created_at AS anchor_at
     FROM conversations conv
     JOIN contacts ct ON ct.id = conv.contact_id
     JOIN organization org ON org.id = ct.organization_id
     JOIN LATERAL (
       SELECT direction, created_at
       FROM messages
       WHERE conversation_id = conv.id
       ORDER BY created_at DESC
       LIMIT 1
     ) lastmsg ON true
     WHERE org.followup_enabled = true
       AND conv.ai_paused = false
       AND (conv.order_status IS NULL OR conv.order_status NOT IN ('closing', 'cancelled', 'spam'))
       AND lastmsg.direction = 'outbound'
       AND lastmsg.created_at <= now() - interval '24 hours'
     LIMIT $1`,
    [SCHEDULE_BATCH_LIMIT]
  );

  if (candidates.length === 0) return 0;

  const values: unknown[] = [];
  const rowsSql: string[] = [];
  let paramIndex = 1;

  for (const cand of candidates) {
    const anchorMs = new Date(cand.anchor_at).getTime();
    const maxAttempts = Math.max(0, Math.min(3, cand.followup_max_attempts ?? 3));

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const scheduledAt = new Date(anchorMs + ATTEMPT_OFFSETS_MS[attempt]);
      rowsSql.push(
        `($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4})`
      );
      values.push(cand.organization_id, cand.conversation_id, cand.channel_id, attempt, scheduledAt);
      paramIndex += 5;
    }
  }

  if (rowsSql.length === 0) return 0;

  const { rowCount } = await pool.query(
    `INSERT INTO follow_ups (organization_id, conversation_id, channel_id, attempt, scheduled_at)
     VALUES ${rowsSql.join(", ")}
     ON CONFLICT (conversation_id, attempt) DO NOTHING`,
    values
  );

  return rowCount ?? 0;
}

interface DueFollowUpRow {
  id: string;
  conversation_id: string;
  channel_id: string | null;
  attempt: number;
  created_at: string;
  organization_id: string;
  followup_max_attempts: number;
  wa_number: string;
  contact_name: string | null;
  order_status: string | null;
  ai_paused: boolean;
  product_name: string | null;
}

// Kalimat cadangan kalau AI gagal/tidak dikonfigurasi — DIACAK per pengiriman
// supaya pelanggan berbeda tidak menerima kalimat identik persis (pola
// berulang yang gampang dikenali sbg pesan otomatis/spam).
const FOLLOWUP_FALLBACK_TEMPLATES: ((name: string, product: string) => string)[] = [
  (name, product) =>
    `Salam${name ? ` ${name}` : ""}, maaf mengganggu 🙏 sekadar follow up chat kita sebelum ni${
      product ? ` pasal ${product}` : ""
    }. Kalau masih berminat, boleh reply chat ni bila-bila lapang ya.`,
  (name, product) =>
    `Hai${name ? ` ${name}` : ""}, kami tak nak ganggu, cuma nak check-in balik${
      product ? ` pasal ${product} yang tuan/puan tanya sebelum ni` : ""
    }. Ada apa-apa kami boleh bantu?`,
  (name, product) =>
    `Salam sejahtera${name ? ` ${name}` : ""}. Kalau ada masa, boleh maklumkan kami sama ada masih berminat${
      product ? ` dengan ${product}` : ""
    } tak? Kami sedia bantu kalau ada soalan.`,
  (name, product) =>
    `Hi${name ? ` ${name}` : ""} 👋, follow up sekejap je${
      product ? ` untuk ${product}` : ""
    } — takpe kalau belum sempat balas, reply je bila free nanti.`,
];

/**
 * F-27/F-28: kirim follow_ups yang sudah jatuh tempo (status='scheduled' &
 * scheduled_at <= now()). Untuk tiap baris:
 *   1. DIBATALKAN (status='cancelled') kalau pelanggan sudah membalas sejak
 *      baris ini dijadwalkan, ATAU status order percakapan sudah berubah jadi
 *      closing/cancelled/spam, ATAU AI sedang di-pause manual (owner ambil alih),
 *      ATAU attempt-nya sudah melebihi followup_max_attempts terkini (organisasi
 *      bisa menurunkan batas ini SETELAH baris dijadwalkan).
 *   2. Kalau channel sudah kena batas kirim per jam (canSendNow), baris ini
 *      DILEWATI (tetap 'scheduled' — dicoba lagi tick berikutnya).
 *   3. Pesan disusun lewat AI (beda2 tiap orang) — fallback ke kalimat acak
 *      kalau AI gagal.
 *   4. Kirim -> tandai 'sent' + jeda acak 20-90 detik sebelum baris berikutnya.
 * Kegagalan TEKNIS kirim (mis. sesi WA sedang putus) SENGAJA tidak menandai
 * 'failed' permanen — baris dibiarkan 'scheduled' supaya dicoba ulang tick
 * berikutnya begitu sesi tersambung lagi.
 */
export async function sendDueFollowUps(): Promise<number> {
  const { rows: due } = await pool.query<DueFollowUpRow>(
    `SELECT f.id, f.conversation_id, f.channel_id, f.attempt, f.created_at,
            ct.organization_id, org.followup_max_attempts,
            ct.wa_number, ct.name AS contact_name,
            conv.order_status, conv.ai_paused,
            p.name AS product_name
     FROM follow_ups f
     JOIN conversations conv ON conv.id = f.conversation_id
     JOIN contacts ct ON ct.id = conv.contact_id
     JOIN organization org ON org.id = ct.organization_id
     LEFT JOIN products p ON p.id = conv.product_id
     WHERE f.status = 'scheduled' AND f.scheduled_at <= now()
     ORDER BY f.scheduled_at ASC
     LIMIT $1`,
    [SEND_BATCH_LIMIT]
  );

  let sent = 0;

  for (let i = 0; i < due.length; i++) {
    const row = due[i];
    try {
      // (b) hormati followup_max_attempts (bisa berubah setelah dijadwalkan).
      if (row.attempt > (row.followup_max_attempts ?? 3)) {
        await cancelFollowUp(row.id, "melebihi_batas_percobaan_followup_max_attempts");
        continue;
      }

      // Status order sudah final — tidak perlu (lagi) di-follow-up.
      if (row.order_status && TERMINAL_ORDER_STATUSES.has(row.order_status)) {
        await cancelFollowUp(row.id, `status_order_sudah_${row.order_status}`);
        continue;
      }

      // Owner sedang ambil alih percakapan ini secara manual.
      if (row.ai_paused) {
        await cancelFollowUp(row.id, "ai_dipause_manual_oleh_owner");
        continue;
      }

      // (a) pelanggan sudah membalas SEJAK follow-up ini dijadwalkan.
      const { rows: replyRows } = await pool.query(
        `SELECT 1 FROM messages WHERE conversation_id = $1 AND direction = 'inbound' AND created_at > $2 LIMIT 1`,
        [row.conversation_id, row.created_at]
      );
      if (replyRows[0]) {
        await cancelFollowUp(row.id, "pelanggan_sudah_membalas");
        continue;
      }

      if (!row.channel_id) {
        await cancelFollowUp(row.id, "percakapan_tidak_punya_channel");
        continue;
      }

      // (d) batas kirim per jam channel ini — LEWATI, tetap terjadwal.
      if (!(await canSendNow(row.channel_id))) {
        console.warn(
          `[jobs/followUps] Channel ${row.channel_id} kena batas kirim per jam — follow-up ${row.id} ditunda ke tick berikutnya.`
        );
        continue;
      }

      // (c) susun kalimat follow-up (AI, fallback acak kalau gagal).
      const text = await composeFollowUpMessage(row.organization_id, row.contact_name, row.product_name);

      // (e) kirim, lalu tandai sukses.
      await sendViaQrSession(row.channel_id, row.wa_number, text);
      await recordSend(row.channel_id);
      await pool.query(
        `UPDATE follow_ups SET status = 'sent', sent_at = now(), message_text = $2 WHERE id = $1`,
        [row.id, text]
      );
      sent++;

      // (e) sebar waktu kirim — jeda acak sebelum baris berikutnya (kalau masih ada).
      if (i < due.length - 1) {
        await sleep(randomBetween(MIN_SEND_GAP_MS, MAX_SEND_GAP_MS));
      }
    } catch (err) {
      console.error(`[jobs/followUps] Gagal kirim follow-up ${row.id} (dibiarkan 'scheduled', dicoba ulang):`, err);
    }
  }

  return sent;
}

async function cancelFollowUp(id: string, reason: string): Promise<void> {
  await pool.query(`UPDATE follow_ups SET status = 'cancelled', cancel_reason = $2 WHERE id = $1`, [id, reason]);
}

async function composeFollowUpMessage(
  organizationId: string,
  contactName: string | null,
  productName: string | null
): Promise<string> {
  const name = contactName || "";
  const product = productName || "";

  const aiConfig = await getAiConfig(organizationId);
  if (aiConfig.apiKey) {
    const system = [
      "Kamu menyusun SATU pesan follow-up WhatsApp pendek dalam Bahasa Melayu yang sopan untuk toko COD.",
      "Pelanggan ini pernah chat tapi sudah lama tidak membalas lagi. Tujuan pesan: check-in ramah, JANGAN mendesak/memaksa untuk beli.",
      "Sebut nama pelanggan & nama produk kalau disediakan — JANGAN mengarang nama/produk kalau tidak diberi.",
      "JANGAN mengarang harga, diskaun, atau promo apa pun yang tidak disebut di sini.",
      "Nada: santai & ramah macam kawan chat, BUKAN bahasa formal surat rasmi. Maksimal 2-3 ayat pendek.",
      "Balas HANYA teks pesannya — jangan pakai heading, list, markdown, atau tanda kutip pembungkus.",
    ].join("\n");
    const userContent = [
      name ? `Nama pelanggan: ${name}` : "Nama pelanggan: (tidak diketahui)",
      product ? `Produk yang dibahas: ${product}` : "Produk yang dibahas: (tidak diketahui)",
    ].join("\n");

    const text = await callClaude({
      organizationId,
      purpose: "followup",
      model: aiConfig.modelSmall,
      system,
      messages: [{ role: "user", content: userContent }],
      maxTokens: 200,
    });
    if (text) return text;
  }

  const template = FOLLOWUP_FALLBACK_TEMPLATES[Math.floor(Math.random() * FOLLOWUP_FALLBACK_TEMPLATES.length)];
  return template(name, product);
}
