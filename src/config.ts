import "dotenv/config";

const isProduction = process.env.NODE_ENV === "production";

// P-4: sebelumnya fungsi ini TIDAK PERNAH melempar karena selalu diberi
// fallback — akibatnya di production pun JWT_SECRET (atau env var wajib
// lain) bisa diam-diam jatuh ke nilai cadangan yang sudah publik di riwayat
// git ini. Sekarang: di production, env var yang tidak diisi WAJIB melempar
// error saat startup (jangan sampai server jalan dengan kredensial cadangan
// yang semua orang bisa lihat di source code). Di luar production (dev
// lokal), fallback masih boleh dipakai demi kemudahan, tapi selalu dengan
// console.warn yang jelas supaya tidak kebablasan sampai ke production.
function required(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v !== undefined && v !== "") return v;

  if (isProduction) {
    throw new Error(
      `Env var ${name} wajib diisi di production — set variable ini di Railway/deploy config. ` +
        `JANGAN pernah mengandalkan nilai cadangan di kode untuk production.`
    );
  }

  if (fallback !== undefined) {
    console.warn(
      `[config] PERINGATAN: Env var ${name} belum diisi — memakai nilai cadangan bawaan HANYA untuk pengembangan lokal. ` +
        `Set ${name} di file .env kamu, dan JANGAN pernah deploy ke production tanpa mengisi env var ini.`
    );
    return fallback;
  }

  throw new Error(`Env var ${name} wajib diisi — cek file .env (contoh di .env.example)`);
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  nodeEnv: process.env.NODE_ENV ?? "development",
  jwtSecret: required("JWT_SECRET", "dev-secret-jangan-dipakai-di-production"),

  databaseUrl: required("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/cakapcepat"),
  redisUrl: required("REDIS_URL", "redis://localhost:6379"),

  whatsapp: {
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? "",
    businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID ?? "",
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN ?? "",
    appSecret: process.env.WHATSAPP_APP_SECRET ?? "",
    webhookVerifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? "",
    graphApiVersion: "v20.0",
  },

  capi: {
    pixelId: process.env.META_PIXEL_ID ?? "",
    accessToken: process.env.META_CAPI_ACCESS_TOKEN ?? "",
  },

  // Transkrip voice note (F-31). Kalau kosong, voice note tetap TERSIMPAN dan
  // bisa didengarkan di dashboard, cuma tidak otomatis jadi teks untuk AI.
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",

  // Rahasia untuk endpoint webhook kurir (F-16). Kalau kosong, webhook selalu
  // ditolak — aman secara default.
  courierWebhookSecret: process.env.COURIER_WEBHOOK_SECRET ?? "",

  ai: {
    apiKey: process.env.AI_PROVIDER_API_KEY ?? "",
    model: process.env.AI_MODEL ?? "claude-haiku-4-5-20251001",
  },

  broadcastRatePerMinute: Number(process.env.BROADCAST_RATE_PER_MINUTE ?? 60),

  // URL publik dashboard — dipakai untuk bikin link verifikasi email &
  // reset password di dalam isi email. Set APP_URL di Railway ke domain asli.
  appUrl: process.env.APP_URL ?? "http://localhost:5173",

  // Pengiriman email (verifikasi akun & lupa password) lewat Resend HTTP API
  // (bukan SMTP — banyak host cloud termasuk Railway plan Free/Hobby
  // memblokir outbound SMTP sepenuhnya, jadi Gmail App Password tidak akan
  // pernah jalan di plan itu). Resend API jalan lewat HTTPS biasa (port 443)
  // sehingga tidak diblokir. Kalau kosong, email tidak akan terkirim —
  // dicatat di log server saja (supaya dev/testing nggak nge-block tanpa
  // kredensial ini).
  email: {
    resendApiKey: process.env.RESEND_API_KEY ?? "",
    // onboarding@resend.dev jalan tanpa verifikasi domain — cocok untuk
    // mulai cepat. Kalau domain sendiri (mis. tahagroup.id) sudah
    // diverifikasi di Resend, set EMAIL_FROM_ADDRESS ke alamat domain itu.
    fromAddress: process.env.EMAIL_FROM_ADDRESS ?? "onboarding@resend.dev",
    fromName: process.env.EMAIL_FROM_NAME ?? "CakapCepat",
  },

  // Login sosial. Dibuat di console.cloud.google.com (Google Auth Platform)
  // / developers.facebook.com. Kalau kosong, tombol di halaman login akan
  // tetap tampil "Segera" (nonaktif) — tidak crash.
  oauth: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    },
    facebook: {
      clientId: process.env.FACEBOOK_CLIENT_ID ?? "",
      clientSecret: process.env.FACEBOOK_CLIENT_SECRET ?? "",
    },
  },
};
