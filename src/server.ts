import http from "node:http";
import { app } from "./app";
import { config } from "./config";
import { initRealtime } from "./realtime";
import { initScheduler } from "./scheduler";
import { resumeAllQrSessions } from "./whatsapp/qrSessionManager";
import { bootstrapPlatformAdmin } from "./platform/bootstrap";
import { periksaRlsSaatStartup } from "./db/tenantTx";

const server = http.createServer(app);
initRealtime(server);
initScheduler();

server.listen(config.port, () => {
  console.log(`[server] CakapCepat berjalan di http://localhost:${config.port} (env: ${config.nodeEnv})`);
  console.log(`[server] Webhook URL untuk didaftarkan ke Meta: http://<domain-publik-kamu>/webhook/whatsapp`);
  console.log(`[server] WebSocket real-time di ws://<domain-publik-kamu>/ws`);
});

// Sambungkan ulang semua nomor tim yang pakai QR/pairing (bukan Cloud API)
// yang sesinya belum di-logout — best-effort, tidak memblokir startup server
// kalau gagal (mis. kredensial WA sudah kedaluwarsa dari sisi HP).
resumeAllQrSessions().catch((err) => console.error("[server] Gagal resume sesi QR saat startup:", err));

// Staf platform pertama dari env (lihat src/platform/bootstrap.ts). Tidak
// memblokir startup: kalau gagal, server penjual tetap harus jalan.
bootstrapPlatformAdmin().catch((err) =>
  console.error("[server] Gagal membuat staf platform pertama:", err)
);

// Laporkan status RLS apa adanya saat start. Kebijakan yang terpasang tapi
// tidak berlaku lebih berbahaya daripada tidak ada — orang mengira ada jaring
// pengaman padahal tidak. Persis itu yang hampir terjadi di sini: seluruh
// kebijakan sempat terpasang rapi tapi dilewati begitu saja karena aplikasi
// tersambung sebagai superuser.
periksaRlsSaatStartup().catch(() => {});
