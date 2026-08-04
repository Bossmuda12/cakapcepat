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
  },

  broadcastRatePerMinute: Number(process.env.BROADCAST_RATE_PER_MINUTE ?? 60),
};
