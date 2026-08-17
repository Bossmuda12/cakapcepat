import "dotenv/config";

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) {
    throw new Error(`Env var ${name} wajib diisi — cek file .env (contoh di .env.example)`);
  }
  return v;
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
};
