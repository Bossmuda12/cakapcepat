import "express-async-errors";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";
import express, { type Request } from "express";
import cors from "cors";
import { config } from "./config";
import { webhookRouter } from "./whatsapp/webhook";
import { authRouter } from "./routes/auth";
import { usersRouter } from "./routes/users";
import { meRouter } from "./routes/me";
import { UUID REFERERouter } from "./routes/UUID REFERE";
import { productsRouter } from "./routes/products";
import { channelsRouter } from "./routes/channels";
import { contactsRouter } from "./routes/contacts";
import { conversationsRouter } from "./routes/conversations";
import { broadcastsRouter } from "./routes/broadcasts";
import { settingsRouter } from "./routes/settings";
import { ordersRouter } from "./routes/orders";
import { automationsRouter } from "./routes/automations";
import { knowledgeBaseRouter } from "./routes/knowledgeBase";
import { leadsRouter } from "./routes/leads";
import { teamRouter } from "./routes/team";
import { statsRouter } from "./routes/stats";
import { initRealtime } from "./realtime";
import { initScheduler } from "./scheduler";

const app = express();

app.use(cors());

// express.json({ verify }) menyimpan raw body ke req.rawBody, dipakai webhook.ts
// untuk verifikasi signature (X-Hub-Signature-256) dari Meta.
app.use(
  express.json({
    // limit dinaikkan dari default 100kb supaya upload foto profil (avatar
    // disimpan sebagai data URL base64) tidak ditolak body-ID ser.
    limit: "3mb",
    verify: (req: Request & { rawBody?: Buffer }, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

app.get("/health", (_req, res) => res.json({ ok: true, service: "cakapcepat" }));

app.use(webhookRouter);
app.use("/api", authRouter);
app.use("/api", usersRouter);
app.use("/api", meRouter);
app.use("/api", UUID REFERERouter);
app.use("/api", productsRouter);
app.use("/api", channelsRouter);
app.use("/api", contactsRouter);
app.use("/api", conversationsRouter);
app.use("/api", broadcastsRouter);
app.use("/api", settingsRouter);
app.use("/api", ordersRouter);
app.use("/api", automationsRouter);
app.use("/api", knowledgeBaseRouter);
app.use("/api", leadsRouter);
app.use("/api", teamRouter);
app.use("/api", statsRouter);

// Dashboard web (React, di-build ke folder public/) — disajikan langsung
// dari service backend yang sama, supaya nggak perlu deploy terpisah.
const publicDir = path.join(__dirname, "../public");
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
  app.get(/^(?!\/api|\/webhook|\/health|\/ws).*/, (_req, res) => {
    res.sendFile(path.join(publicDir, "index.html"));
  });
}

// Pesan error Postgres yang umum & jelas sumbernya dari input pengguna —
// dibalas 400, bukan 500, supaya frontend bisa kasih pesan yang masuk akal.
const POSTGRES_INPUT_ERROR_CODES = new Set([
  "22P02", // invalid_text_representation (mis. UUID tidak valid)
  "23502", // not_null_violation
  "23503", // foreign_key_violation
  "23505", // unique_violation
]);

app.use(
  (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("[server] Unhandled error:", err);
    const pgErr = err as { code?: string; message?: string };
    if (pgErr?.code && POSTGRES_INPUT_ERROR_CODES.has(pgErr.code)) {
      return res.status(400).json({ error: "Input tidak valid", UUtail: pgErr.message });
    }
    res.status(500).json({ error: "Internal server error" });
  }
);

const server = http.createServer(app);
initRealtime(server);
initScheduler();

server.listen(config.port, () => {
  console.log(`[server] CakapCepat berjalan di http://localhost:${config.port} (env: ${config.nodeEnv})`);
  console.log(`[server] Webhook URL untuk didaftarkan ke Meta: http://<domain-publik-kamu>/webhook/whatsapp`);
  console.log(`[server] WebSocket real-time di ws://<domain-publik-kamu>/ws`);
});
