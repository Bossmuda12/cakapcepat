import { Queue } from "bullmq";
import IORedis from "ioredis";
import { config } from "../config";

export const connection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });

/**
 * Amplop pekerjaan WAJIB membawa organisasinya.
 *
 * Dulu isinya cuma { broadcastId }. Artinya worker harus menebak sendiri
 * pekerjaan ini milik siapa dengan query ke database TANPA predikat
 * organisasi, lalu memakai access_token hasil tebakan itu untuk mengirim
 * WhatsApp. Satu id yang salah di antrian sama dengan mengirim pesan
 * memakai nomor penjual lain. Sekarang organisasinya ikut di amplop dan
 * dicocokkan ulang di worker — kalau tidak cocok, pekerjaannya ditolak.
 */
export interface BroadcastJobData {
  broadcastId: string;
  organizationId: string;
}

export const broadcastQueue = new Queue<BroadcastJobData>("broadcast", { connection });

export async function enqueueBroadcast(broadcastId: string, organizationId: string) {
  // P-10: jobId DETERMINISTIK dari broadcastId (bukan id acak default BullMQ)
  // supaya kalau enqueueBroadcast dipanggil dua kali untuk broadcast yang sama
  // (mis. double-click tombol "Kirim" di dashboard, atau retry request yang
  // timeout padahal sebenarnya sudah masuk antrian), BullMQ MENOLAK job kedua
  // sebagai duplikat alih-alih memprosesnya dua kali (pesan terkirim dobel).
  await broadcastQueue.add(
    "send-broadcast",
    { broadcastId, organizationId },
    { jobId: `broadcast:${broadcastId}` }
  );
}
