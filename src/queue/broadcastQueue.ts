import { Queue } from "bullmq";
import IORedis from "ioredis";
import { config } from "../config";

export const connection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });

export interface BroadcastJobData {
  broadcastId: string;
}

export const broadcastQueue = new Queue<BroadcastJobData>("broadcast", { connection });

export async function enqueueBroadcast(broadcastId: string) {
  // P-10: jobId DETERMINISTIK dari broadcastId (bukan id acak default BullMQ)
  // supaya kalau enqueueBroadcast dipanggil dua kali untuk broadcast yang sama
  // (mis. double-click tombol "Kirim" di dashboard, atau retry request yang
  // timeout padahal sebenarnya sudah masuk antrian), BullMQ MENOLAK job kedua
  // sebagai duplikat alih-alih memprosesnya dua kali (pesan terkirim dobel).
  await broadcastQueue.add(
    "send-broadcast",
    { broadcastId },
    { jobId: `broadcast:${broadcastId}` }
  );
}
