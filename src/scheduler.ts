import { pool } from "./db/pool";
import { sendTextMessage } from "./whatsapp/client";
import { sendViaQrSession } from "./whatsapp/qrSessionManager";
import { analyzeLeads, type LeadItem, type LeadFlag } from "./ai/leadsAnalyzer";
import { pollCourierMailbox } from "./courier/emailReader";
import { reportClosingsToGroup, sendDailyGroupSummary } from "./jobs/groupReport";
import { notifyAttentionNeeded } from "./jobs/attentionAlerts";
import { scheduleFollowUps, sendDueFollowUps } from "./jobs/followUps";
import { autoClassifyConversations, notifyProblemOrders } from "./jobs/orderAutomation";

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // cek tiap 5 menit — cukup untuk granularitas per jam

// F-19/F-17: pekerjaan "real-time" (dampak makin lama makin terasa kalau
// telat) — rekap closing ke grup & tanya kabar pesanan bermasalah.
const GROUP_AND_PROBLEM_INTERVAL_MS = 2 * 60 * 1000;
// F-27: kirim follow-up yang sudah jatuh tempo.
const FOLLOWUP_SEND_INTERVAL_MS = 5 * 60 * 1000;
// F-8/F-25/F-15/F-16: pekerjaan yang lebih berat (panggil AI/baca IMAP per
// organisasi) — cukup tiap 15 menit, tidak butuh granularitas lebih ketat.
const HEAVY_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Scheduler semua pekerjaan berkala CakapCepat. Berjalan in-process
 * (setInterval) di server yang sama, bukan job worker terpisah — lihat
 * catatan di src/queue/broadcastWorker.ts soal kenapa BullMQ worker belum
 * tentu jalan sebagai service Railway sendiri.
 *
 * Tiap kelompok pekerjaan dibungkus try/catch SENDIRI-SENDIRI (baik di sini
 * maupun di dalam masing-masing job) supaya satu organisasi/fitur yang gagal
 * (mis. AI error, sesi WA terputus) tidak pernah menjatuhkan/menunda
 * pekerjaan lain yang tidak berhubungan.
 *
 * Laporan AI harian (runCheck, tiap 5 menit) — cari organization yang:
 *  - daily_report_enabled = true
 *  - jam sekarang (dihitung WIB dari UTC, LIHAT catatan P-9 di runCheck)
 *    sudah >= daily_report_hour, dan
 *  - belum dikirim hari ini (last_daily_report_at bukan hari ini)
 * lalu jalankan analyzeLeads() dan kirim ringkasannya ke daily_report_wa_number.
 * F-20/F-21 ringkasan harian ke grup closing (sendDailyGroupSummary) dipanggil
 * di tick yang sama — fungsi itu sendiri yang mengecek jam & anti-dobelnya.
 */
export function initScheduler() {
  console.log("[scheduler] Semua pekerjaan berkala CakapCepat aktif");

  runCheck().catch((err) => console.error("[scheduler] Gagal cek awal (laporan AI harian):", err));
  setInterval(() => {
    runCheck().catch((err) => console.error("[scheduler] Gagal cek berkala (laporan AI harian):", err));
  }, CHECK_INTERVAL_MS);

  const runGroupAndProblemTick = () => {
    reportClosingsToGroup().catch((err) =>
      console.error("[scheduler] Gagal jalankan reportClosingsToGroup():", err)
    );
    notifyProblemOrders().catch((err) => console.error("[scheduler] Gagal jalankan notifyProblemOrders():", err));
    // F-39: beri tahu owner lewat WA kalau ada chat yang ditandai butuh perhatian.
    notifyAttentionNeeded().catch((err) =>
      console.error("[scheduler] Gagal jalankan notifyAttentionNeeded():", err)
    );
  };
  runGroupAndProblemTick();
  setInterval(runGroupAndProblemTick, GROUP_AND_PROBLEM_INTERVAL_MS);

  const runFollowupSendTick = () => {
    sendDueFollowUps().catch((err) => console.error("[scheduler] Gagal jalankan sendDueFollowUps():", err));
  };
  runFollowupSendTick();
  setInterval(runFollowupSendTick, FOLLOWUP_SEND_INTERVAL_MS);

  const runHeavyTick = () => {
    scheduleFollowUps().catch((err) => console.error("[scheduler] Gagal jalankan scheduleFollowUps():", err));
    autoClassifyConversations().catch((err) =>
      console.error("[scheduler] Gagal jalankan autoClassifyConversations():", err)
    );
    pollCourierMailbox().catch((err) => console.error("[scheduler] Gagal jalankan pollCourierMailbox():", err));
  };
  runHeavyTick();
  setInterval(runHeavyTick, HEAVY_INTERVAL_MS);
}

async function runCheck() {
  // P-9: SEBELUMNYA pakai now.getHours() — itu jam LOKAL SERVER (Railway
  // biasanya UTC), bukan jam WIB, jadi daily_report_hour dibandingkan dengan
  // jam yang salah zona (laporan bisa terkirim jam yang salah / tidak pernah
  // terkirim). Dihitung eksplisit dari UTC, sama pola dengan
  // isOutsideOfficeHours() di src/whatsapp/ingest.ts. Belum ada kolom offset
  // per organization di skema, jadi pakai konstanta WIB (+7) untuk semua
  // organization — cukup untuk kebutuhan tim internal yang semuanya di Indonesia.
  const UTC_OFFSET_HOURS_WIB = 7;
  const now = new Date();
  const currentHour = (now.getUTCHours() + UTC_OFFSET_HOURS_WIB) % 24;

  const { rows: orgs } = await pool.query(
    `SELECT id, name, daily_report_wa_number, daily_report_hour, last_daily_report_at, daily_report_channel_id
     FROM organization
     WHERE daily_report_enabled = true
       AND daily_report_wa_number IS NOT NULL
       AND daily_report_hour <= $1
       AND (last_daily_report_at IS NULL OR last_daily_report_at::date < CURRENT_DATE)`,
    [currentHour]
  );

  for (const org of orgs) {
    try {
      await sendDailyReport(org.id, org.daily_report_wa_number, org.name, org.daily_report_channel_id);
    } catch (err) {
      console.error(`[scheduler] Gagal kirim laporan harian untuk org ${org.id}:`, err);
    }
  }

  // F-20/F-21: ringkasan harian ke grup closing — dicek/dikirim sekali per
  // organisasi yang sudah memenuhi syarat (jam + belum dikirim hari ini),
  // fungsinya sendiri yang menghitung jam WIB & pengaman anti-dobelnya.
  try {
    await sendDailyGroupSummary();
  } catch (err) {
    console.error("[scheduler] Gagal jalankan sendDailyGroupSummary():", err);
  }
}

async function sendDailyReport(
  organizationId: string,
  waNumber: string,
  orgName: string,
  dailyReportChannelId: string | null
) {
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

  // F-22: pakai nomor pengirim yang dipilih eksplisit lewat dashboard kalau
  // ada (daily_report_channel_id) — baru jatuh ke perilaku LAMA (asal ambil
  // channel Cloud API pertama yang connected) kalau organisasi belum memilih
  // apa-apa. Perilaku lama sengaja dipertahankan APA ADANYA sebagai fallback
  // supaya organisasi yang belum sempat mengisi pengaturan baru ini tidak
  // tiba-tiba berhenti dapat laporan harian.
  const channel = await getSendingChannel(organizationId, dailyReportChannelId);
  if (!channel) {
    console.warn(`[scheduler] Org ${organizationId} tidak punya WA channel terhubung, laporan tidak dikirim`);
    return;
  }

  const message = formatReportMessage(orgName, result);

  if (channel.connection_type === "qr_session") {
    await sendViaQrSession(channel.id, waNumber, message);
  } else {
    if (!channel.phone_number_id || !channel.access_token) {
      console.warn(
        `[scheduler] Channel Cloud API ${channel.id} (org ${organizationId}) tidak punya phone_number_id/access_token — laporan tidak dikirim`
      );
      return;
    }
    await sendTextMessage({
      to: waNumber,
      body: message,
      phoneNumberId: channel.phone_number_id,
      accessToken: channel.access_token,
    });
  }

  await pool.query(`UPDATE organization SET last_daily_report_at = now() WHERE id = $1`, [organizationId]);
  console.log(`[scheduler] Laporan AI harian terkirim ke ${waNumber} (org ${organizationId}, channel ${channel.id})`);
}

interface SendingChannel {
  id: string;
  connection_type: string;
  phone_number_id: string | null;
  access_token: string | null;
}

async function getSendingChannel(
  organizationId: string,
  dailyReportChannelId: string | null
): Promise<SendingChannel | null> {
  // F-22: channel yang dipilih eksplisit lewat dashboard (kalau ada & masih
  // connected) SELALU diutamakan dibanding "asal ambil channel pertama".
  if (dailyReportChannelId) {
    const { rows } = await pool.query(
      `SELECT id, connection_type, phone_number_id, access_token FROM whatsapp_channels
       WHERE id = $1 AND organization_id = $2 AND status = 'connected'`,
      [dailyReportChannelId, organizationId]
    );
    if (rows[0]) return rows[0];
    console.warn(
      `[scheduler] daily_report_channel_id ${dailyReportChannelId} (org ${organizationId}) sudah tidak connected — jatuh ke perilaku lama.`
    );
  }

  // Perilaku LAMA: channel Cloud API pertama yang connected (fallback kalau
  // organisasi belum memilih daily_report_channel_id sama sekali).
  const { rows } = await pool.query(
    `SELECT id, connection_type, phone_number_id, access_token FROM whatsapp_channels
     WHERE organization_id = $1 AND status = 'connected' AND connection_type = 'cloud_api'
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
