import { Worker, type Job } from "bullmq";
import { connection, type BroadcastJobData } from "./broadcastQueue";
import { pool } from "../db/pool";
import { sendTemplateMessage } from "../whatsapp/client";
import { config } from "../config";

// Jeda antar pesan (ms) supaya kecepatan kirim sesuai BROADCAST_RATE_PER_MINUTE
// — inti dari broadcast "anti-banned".
const delayMs = Math.max(1000, Math.floor(60_000 / config.broadcastRatePerMinute));

async function processBroadcast(job: Job<BroadcastJobData>) {
  const { broadcastId, organizationId } = job.data;
  console.log(`[worker] Mulai memproses broadcast ${broadcastId}`);

  // Pekerjaan lama dari sebelum amplopnya membawa organisasi akan kosong di
  // sini. Ditolak, bukan dijalankan "seadanya" — menjalankannya berarti
  // kembali ke perilaku lama yang bisa memakai nomor penjual lain.
  if (!organizationId) {
    throw new Error(
      `Broadcast ${broadcastId} dikirim tanpa organizationId di amplop pekerjaan — ditolak.`
    );
  }

  const { rows: broadcastRows } = await pool.query(
    `SELECT b.*, wc.phone_number_id, wc.access_token
     FROM broadcasts b
     JOIN whatsapp_channels wc
       ON wc.id = b.channel_id AND wc.organization_id = b.organization_id
     WHERE b.id = $1 AND b.organization_id = $2`,
    [broadcastId, organizationId]
  );
  const broadcast = broadcastRows[0];
  if (!broadcast) {
    throw new Error(
      `Broadcast ${broadcastId} tidak ditemukan untuk organisasi ${organizationId} — mungkin id keliru atau lintas organisasi.`
    );
  }

  await pool.query("UPDATE broadcasts SET status = 'sending' WHERE id = $1 AND organization_id = $2", [
    broadcastId,
    organizationId,
  ]);

  const { rows: recipients } = await pool.query(
    `SELECT br.id AS recipient_row_id, c.wa_number
     FROM broadcast_recipients br
     JOIN contacts c ON c.id = br.contact_id AND c.organization_id = br.organization_id
     WHERE br.broadcast_id = $1 AND br.organization_id = $2 AND br.status = 'pending'`,
    [broadcastId, organizationId]
  );

  let sent = 0;
  let failed = 0;

  for (const recipient of recipients) {
    try {
      await sendTemplateMessage({
        to: recipient.wa_number,
        templateName: broadcast.template_name,
        parameters: broadcast.template_params ?? [],
        phoneNumberId: broadcast.phone_number_id,
        accessToken: broadcast.access_token,
      });
      await pool.query(
        "UPDATE broadcast_recipients SET status = 'sent', sent_at = now() WHERE id = $1 AND organization_id = $2",
        [recipient.recipient_row_id, organizationId]
      );
      sent++;
    } catch (err: any) {
      await pool.query(
        "UPDATE broadcast_recipients SET status = 'failed', error = $2 WHERE id = $1 AND organization_id = $3",
        [recipient.recipient_row_id, String(err?.message ?? err), organizationId]
      );
      failed++;
    }
    // P-11: jeda antar pesan diberi jitter acak ±40% dari delay dasar supaya
    // pola kirimnya tidak "rata sempurna" per detik (ciri khas bot) — variasi
    // ini yang bikin ritme kirim lebih mirip CS manusia yang chat satu-satu.
    await sleep(jitteredDelay(delayMs));
  }

  await pool.query("UPDATE broadcasts SET status = 'done' WHERE id = $1 AND organization_id = $2", [
    broadcastId,
    organizationId,
  ]);
  console.log(`[worker] Selesai broadcast ${broadcastId}: ${sent} terkirim, ${failed} gagal`);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// P-11: kembalikan delay dasar +/- hingga 40% secara acak (mis. delay dasar
// 1000ms bisa jadi antara 600ms-1400ms), dibulatkan & tidak pernah negatif.
function jitteredDelay(baseMs: number): number {
  const jitterFactor = 1 + (Math.random() * 2 - 1) * 0.4; // rentang 0.6 .. 1.4
  return Math.max(0, Math.round(baseMs * jitterFactor));
}

export const broadcastWorker = new Worker<BroadcastJobData>("broadcast", processBroadcast, {
  connection,
  concurrency: 1,
});

broadcastWorker.on("failed", (job, err) => {
  console.error(`[worker] Job ${job?.id} gagal:`, err);

  // P-11: sebelumnya broadcast yang jobnya gagal total (mis. exception di luar
  // loop pengiriman — broadcast tidak ditemukan, koneksi DB putus, dst) cuma
  // dicatat ke console, status di kolom broadcasts.status tetap 'sending'
  // SELAMANYA (macet, tidak pernah tampil sebagai gagal di dashboard). Tandai
  // eksplisit di database supaya user tahu & bisa coba kirim ulang.
  const broadcastId = job?.data?.broadcastId;
  if (broadcastId) {
    pool
      .query("UPDATE broadcasts SET status = 'failed' WHERE id = $1 AND status <> 'done'", [broadcastId])
      .catch((updateErr) => console.error(`[worker] Gagal menandai broadcast ${broadcastId} sebagai failed:`, updateErr));
  }
});

console.log("[worker] Broadcast worker berjalan, menunggu job...");
