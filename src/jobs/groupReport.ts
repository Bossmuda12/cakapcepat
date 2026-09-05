import { pool } from "../db/pool";
import { sendViaQrSession } from "../whatsapp/qrSessionManager";

/**
 * F-19/F-20/F-21: rekap tiap closing ke grup WhatsApp internal (real-time,
 * per pesanan) + F-20/F-21 ringkasan harian ke grup yang sama. Dipanggil
 * berkala lintas organisasi oleh src/scheduler.ts — pola yang sama dengan
 * pollCourierMailbox()/autoClassifyConversations() (tidak di-scope ke 1
 * organizationId, karena scheduler tidak punya konteks user login).
 *
 * closing_group_jid dikirim APA ADANYA ke sendViaQrSession — JID grup
 * ("1203xxxx@g.us") sudah mengandung "@" jadi fungsi itu langsung
 * memakainya, tidak perlu mengubahnya jadi format nomor perorangan dulu.
 */

const CLOSING_BATCH_LIMIT = 100;
const UTC_OFFSET_HOURS_WIB = 7;

interface ClosingReportRow {
  id: string;
  customer_name: string | null;
  customer_phone: string | null;
  address_line: string | null;
  postcode: string | null;
  city: string | null;
  state: string | null;
  created_at: string;
  product_name: string | null;
  ad_source_url: string | null;
  closing_group_jid: string;
  closing_group_channel_id: string;
  channel_label: string | null;
  channel_phone: string | null;
}

/**
 * F-19: cari pesanan closing yang BELUM pernah direkap ke grup
 * (group_reported_at IS NULL) untuk organisasi yang sudah mengaktifkan
 * group_report_enabled DAN sudah memilih grupnya (closing_group_jid +
 * closing_group_channel_id). group_reported_at diisi SEGERA setelah
 * terkirim — pengaman anti-dobel WAJIB (satu closing jangan sampai
 * direkap ke grup 2x kalau job ini kepanggil lagi sebelum sempat update
 * baris sebelumnya selesai, atau sesudah restart server).
 */
export async function reportClosingsToGroup(): Promise<number> {
  const { rows } = await pool.query<ClosingReportRow>(
    `SELECT o.id, o.customer_name, o.customer_phone, o.address_line, o.postcode, o.city, o.state,
            o.created_at, p.name AS product_name, conv.ad_source_url,
            org.closing_group_jid, org.closing_group_channel_id,
            wc.label AS channel_label, wc.display_phone_number AS channel_phone
     FROM orders o
     JOIN organization org ON org.id = o.organization_id
     LEFT JOIN products p ON p.id = o.product_id
     LEFT JOIN conversations conv ON conv.id = o.conversation_id
     LEFT JOIN whatsapp_channels wc ON wc.id = o.channel_id
     WHERE o.sales_status = 'closing'
       AND o.group_reported_at IS NULL
       AND org.group_report_enabled = true
       AND org.closing_group_jid IS NOT NULL
       AND org.closing_group_channel_id IS NOT NULL
     ORDER BY o.created_at ASC
     LIMIT $1`,
    [CLOSING_BATCH_LIMIT]
  );

  let sent = 0;

  for (const row of rows) {
    try {
      const text = formatClosingMessage(row);
      await sendViaQrSession(row.closing_group_channel_id, row.closing_group_jid, text);
      await pool.query("UPDATE orders SET group_reported_at = now() WHERE id = $1", [row.id]);
      sent++;
    } catch (err) {
      console.error(`[jobs/groupReport] Gagal rekap closing order ${row.id} ke grup:`, err);
    }
  }

  return sent;
}

function formatClosingMessage(row: ClosingReportRow): string {
  const jamWib = new Date(row.created_at).toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  });

  const alamatParts = [row.address_line, row.postcode, row.city, row.state].filter(Boolean);
  const alamatRingkas = alamatParts.length > 0 ? alamatParts.join(", ") : "-";
  const csLabel = row.channel_label || row.channel_phone || "-";

  const lines: string[] = [];
  lines.push(`🟢 *CLOSING* — ${jamWib} WIB`);
  lines.push(`Nama: ${row.customer_name || "-"}`);
  lines.push(`No: ${row.customer_phone || "-"}`);
  lines.push(`Produk: ${row.product_name || "-"}`);
  lines.push(`Alamat: ${alamatRingkas}`);
  lines.push(`CS: ${csLabel}`);
  if (row.ad_source_url) {
    lines.push(`Sumber iklan: ${row.ad_source_url}`);
  }
  return lines.join("\n");
}

interface GroupSummaryOrgRow {
  id: string;
  closing_group_jid: string;
  closing_group_channel_id: string;
  closing_group_name: string | null;
}

/**
 * F-20/F-21: sekali sehari (jam sama dengan daily_report_hour, dihitung
 * eksplisit dari UTC — BUKAN now.getHours(), sama pola dengan
 * src/scheduler.ts) kirim ringkasan performa hari itu ke grup closing:
 * total chat masuk, qualified, closing, cancel, tingkat closing (%), dan
 * (kalau ada datanya) jumlah paket bermasalah/retur.
 * last_group_summary_at dipakai sbg pengaman anti-dobel (1x per hari).
 */
export async function sendDailyGroupSummary(): Promise<number> {
  const now = new Date();
  const currentHourWib = (now.getUTCHours() + UTC_OFFSET_HOURS_WIB) % 24;

  const { rows: orgs } = await pool.query<GroupSummaryOrgRow>(
    `SELECT id, closing_group_jid, closing_group_channel_id, closing_group_name
     FROM organization
     WHERE group_daily_summary_enabled = true
       AND closing_group_jid IS NOT NULL
       AND closing_group_channel_id IS NOT NULL
       AND daily_report_hour <= $1
       AND (last_group_summary_at IS NULL OR last_group_summary_at::date < CURRENT_DATE)`,
    [currentHourWib]
  );

  // Batas hari WIB "hari ini" dihitung eksplisit (bukan CURRENT_DATE Postgres
  // yang bisa saja bukan zona WIB tergantung setting server) — dipakai
  // menyaring data pesanan/pesan yang termasuk "hari ini" WIB.
  const wibNow = new Date(now.getTime() + UTC_OFFSET_HOURS_WIB * 60 * 60 * 1000);
  const wibDateStr = wibNow.toISOString().slice(0, 10);
  const dayStartUtc = new Date(`${wibDateStr}T00:00:00.000Z`).getTime() - UTC_OFFSET_HOURS_WIB * 60 * 60 * 1000;
  const dayStart = new Date(dayStartUtc);
  const dayEnd = new Date(dayStartUtc + 24 * 60 * 60 * 1000);

  let sent = 0;

  for (const org of orgs) {
    try {
      const text = await buildDailySummaryMessage(org.id, dayStart, dayEnd);
      await sendViaQrSession(org.closing_group_channel_id, org.closing_group_jid, text);
      await pool.query("UPDATE organization SET last_group_summary_at = now() WHERE id = $1", [org.id]);
      sent++;
    } catch (err) {
      console.error(`[jobs/groupReport] Gagal kirim ringkasan harian grup utk org ${org.id}:`, err);
    }
  }

  return sent;
}

async function buildDailySummaryMessage(organizationId: string, dayStart: Date, dayEnd: Date): Promise<string> {
  const { rows: chatRows } = await pool.query(
    `SELECT count(*) FROM messages m
     JOIN conversations conv ON conv.id = m.conversation_id
     JOIN contacts ct ON ct.id = conv.contact_id
     WHERE ct.organization_id = $1 AND m.direction = 'inbound'
       AND m.created_at >= $2 AND m.created_at < $3`,
    [organizationId, dayStart, dayEnd]
  );
  const chatMasuk = Number(chatRows[0]?.count ?? 0);

  const { rows: statusRows } = await pool.query(
    `SELECT sales_status, count(*) AS cnt FROM orders
     WHERE organization_id = $1 AND created_at >= $2 AND created_at < $3
     GROUP BY sales_status`,
    [organizationId, dayStart, dayEnd]
  );
  const countByStatus = new Map<string, number>();
  for (const r of statusRows) countByStatus.set(r.sales_status, Number(r.cnt));

  const qualified = countByStatus.get("qualified_cod") ?? 0;
  const closing = countByStatus.get("closing") ?? 0;
  const cancel = countByStatus.get("cancelled") ?? 0;
  const denom = qualified + closing + cancel;
  const closingRate = denom > 0 ? Math.round((closing / denom) * 1000) / 10 : null;

  const { rows: problemRows } = await pool.query(
    `SELECT
       count(*) FILTER (WHERE has_problem = true AND problem_at >= $2 AND problem_at < $3) AS problem_count,
       count(*) FILTER (WHERE shipping_status = 'returned' AND returned_at >= $2 AND returned_at < $3) AS returned_count
     FROM orders WHERE organization_id = $1`,
    [organizationId, dayStart, dayEnd]
  );
  const problemCount = Number(problemRows[0]?.problem_count ?? 0);
  const returnedCount = Number(problemRows[0]?.returned_count ?? 0);

  const tanggal = dayStart.toLocaleDateString("id-ID", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Asia/Jakarta",
  });

  const lines: string[] = [];
  lines.push(`📊 *Ringkasan Hari Ini* — ${tanggal}`);
  lines.push(`Chat masuk: ${chatMasuk}`);
  lines.push(`Qualified: ${qualified}`);
  lines.push(`Closing: ${closing}`);
  lines.push(`Cancel: ${cancel}`);
  lines.push(`Tingkat closing: ${closingRate !== null ? `${closingRate}%` : "-"}`);
  if (problemCount > 0 || returnedCount > 0) {
    lines.push(`⚠️ Paket bermasalah: ${problemCount} • Retur: ${returnedCount}`);
  }
  return lines.join("\n");
}
