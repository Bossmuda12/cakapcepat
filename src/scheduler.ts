import { pool } from "./db/pool";
import { sendTextMessage } from "./whatsapp/client";
import { analyzeLeads, type LeadItem, type LeadFlag } from "./ai/leadsAnalyzer";

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // cek tiap 5 menit — cukup untuk granularitas per jam

/**
 * Scheduler laporan AI harian via WhatsApp. Berjalan in-process (setInterval)
 * di server yang sama, bukan job worker terpisah — lihat catatan di
 * src/queue/broadcastWorker.ts soal kenapa BullMQ worker belum tentu jalan
 * sebagai service Railway sendiri.
 *
 * Tiap tick, cari organization yang:
 *  - daily_report_enabled = true
 *  - jam sekarang (server time) >= daily_report_hour, dan
 *  - belum dikirim hari ini (last_daily_report_at bukan hari ini)
 * lalu jalankan analyzeLeads() dan kirim ringkasannya ke daily_report_wa_number.
 */
export function initScheduler() {
  console.log("[scheduler] Laporan AI harian aktif — cek tiap 5 menit");
  runCheck().catch((err) => console.error("[scheduler] Gagal cek awal:", err));
  setInterval(() => {
    runCheck().catch((err) => console.error("[scheduler] Gagal cek berkala:", err));
  }, CHECK_INTERVAL_MS);
}

async function runCheck() {
  const now = new Date();
  const currentHour = now.getHours();

  const { rows: orgs } = await pool.query(
    `SELECT id, name, daily_report_wa_number, daily_report_hour, last_daily_report_at
     FROM organization
     WHERE daily_report_enabled = true
       AND daily_report_wa_number IS NOT NULL
       AND daily_report_hour <= $1
       AND (last_daily_report_at IS NULL OR last_daily_report_at::date < CURRENT_DATE)`,
    [currentHour]
  );

  for (const org of orgs) {
    try {
      await sendDailyReport(org.id, org.daily_report_wa_number, org.name);
    } catch (err) {
      console.error(`[scheduler] Gagal kirim laporan harian untuk org ${org.id}:`, err);
    }
  }
}

async function sendDailyReport(organizationId: string, waNumber: string, orgName: string) {
  const result = await analyzeLeads(organizationId);

  await pool.query(
    `INSERT INTO lead_reports
       (organization_id, summary, hot_leads, warm_leads, drop_leads, flags, estimated_value)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      organizationId,
      result.summary,
      JSON.stringify(result.hotLeads),
      JSON.stringify(result.warmLeads),
      JSON.stringify(result.dropLeads),
      JSON.stringify(result.flags),
      result.estimatedValue,
    ]
  );

  const channel = await getSendingChannel(organizationId);
  if (!channel) {
    console.warn(`[scheduler] Org ${organizationId} tidak punya WA channel terhubung, laporan tidak dikirim`);
    return;
  }

  const message = formatReportMessage(orgName, result);
  await sendTextMessage({
    to: waNumber,
    body: message,
    phoneNumberId: channel.phone_number_id,
    accessToken: channel.access_token,
  });

  await pool.query(`UPDATE organization SET last_daily_report_at = now() WHERE id = $1`, [organizationId]);
  console.log(`[scheduler] Laporan AI harian terkirim ke ${waNumber} (org ${organizationId})`);
}

async function getSendingChannel(
  organizationId: string
): Promise<{ phone_number_id: string; access_token: string } | null> {
  const { rows } = await pool.query(
    `SELECT phone_number_id, access_token FROM whatsapp_channels
     WHERE organization_id = $1 AND status = 'connected'
     ORDER BY created_at ASC
     LIMIT 1`,
    [organizationId]
  );
  return rows[0] ?? null;
}

function formatReportMessage(
  orgName: string,
  result: { summary: string; hotLeads: LeadItem[]; warmLeads: LeadItem[]; dropLeads: LeadItem[]; flags: LeadFlag[]; estimatedValue: number | null }
): string {
  const lines: string[] = [];
  lines.push(`*Laporan AI Harian — ${orgName}*`);
  lines.push(new Date().toLocaleDateString("id-ID", { weekday: "long", year: "numeric", month: "long", day: "numeric" }));
  lines.push("");
  lines.push(result.summary);
  lines.push("");

  if (result.hotLeads.length > 0) {
    lines.push(`🔥 *Hot Leads (${result.hotLeads.length})*`);
    result.hotLeads.slice(0, 5).forEach((l) => {
      lines.push(`- ${l.contactName} (${l.waNumber}) — ${l.reason}`);
    });
    lines.push("");
  }

  if (result.estimatedValue) {
    lines.push(`💰 Estimasi potensi konversi: *Rp${result.estimatedValue.toLocaleString("id-ID")}*`);
    lines.push("");
  }

  if (result.flags.length > 0) {
    lines.push(`⚠️ *Perlu perhatian (${result.flags.length})*`);
    result.flags.slice(0, 5).forEach((f) => {
      lines.push(`- ${f.contactName}: ${f.issue} (${f.severity})`);
    });
    lines.push("");
  }

  lines.push(`Detail lengkap di dashboard CakapCepat, menu "Leads AI".`);
  return lines.join("\n");
}
