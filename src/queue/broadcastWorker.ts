import { Worker, type Job } from "bullmq";
import { connection, type BroadcastJobData } from "./broadcastQueue";
import { pool } from "../db/pool";
import { sendTemplateMessage } from "../whatsapp/client";
import { config } from "../config";

// Jeda antar pesan (ms) supaya kecepatan kirim sesuai BROADCAST_RATE_PER_MINUTE
// — inti dari broadcast "anti-banned".
const delayMs = Math.max(1000, Math.floor(60_000 / config.broadcastRatePerMinute));

async function processBroadcast(job: Job<BroadcastJobData>) {
  const { broadcastId } = job.data;
  console.log(`[worker] Mulai memproses broadcast ${broadcastId}`);

  const { rows: broadcastRows } = await pool.query(
    `SELECT b.*, wc.phone_number_id, wc.access_token
     FROM broadcasts b
     JOIN whatsapp_channels wc ON wc.id = b.channel_id
     WHERE b.id = $1`,
    [broadcastId]
  );
  const broadcast = broadcastRows[0];
  if (!broadcast) throw new Error(`Broadcast ${broadcastId} tidak ditemukan`);

  await pool.query("UPDATE broadcasts SET status = 'sending' WHERE id = $1", [broadcastId]);

  const { rows: recipients } = await pool.query(
    `SELECT br.id AS recipient_row_id, c.wa_number
     FROM broadcast_recipients br
     JOIN contacts c ON c.id = br.contact_id
     WHERE br.broadcast_id = $1 AND br.status = 'pending'`,
    [broadcastId]
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
        "UPDATE broadcast_recipients SET status = 'sent', sent_at = now() WHERE id = $1",
        [recipient.recipient_row_id]
      );
      sent++;
    } catch (err: any) {
      await pool.query(
        "UPDATE broadcast_recipients SET status = 'failed', error = $2 WHERE id = $1",
        [recipient.recipient_row_id, String(err?.message ?? err)]
      );
      failed++;
    }
    await sleep(delayMs);
  }

  await pool.query("UPDATE broadcasts SET status = 'done' WHERE id = $1", [broadcastId]);
  console.log(`[worker] Selesai broadcast ${broadcastId}: ${sent} terkirim, ${failed} gagal`);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const broadcastWorker = new Worker<BroadcastJobData>("broadcast", processBroadcast, {
  connection,
  concurrency: 1,
});

broadcastWorker.on("failed", (job, err) => {
  console.error(`[worker] Job ${job?.id} gagal:`, err);
});

console.log("[worker] Broadcast worker berjalan, menunggu job...");
