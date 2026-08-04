import express, { type Request } from "express";
import cors from "cors";
import { config } from "./config";
import { webhookRouter } from "./whatsapp/webhook";
import { departmentsRouter } from "./routes/departments";
import { productsRouter } from "./routes/products";
import { channelsRouter } from "./routes/channels";
import { contactsRouter } from "./routes/contacts";
import { conversationsRouter } from "./routes/conversations";
import { broadcastsRouter } from "./routes/broadcasts";

const app = express();

app.use(cors());

// express.json({ verify }) menyimpan raw body ke req.rawBody, dipakai webhook.ts
// untuk verifikasi signature (X-Hub-Signature-256) dari Meta.
app.use(
  express.json({
    verify: (req: Request & { rawBody?: Buffer }, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

app.get("/health", (_req, res) => res.json({ ok: true, service: "cakapcepat" }));

app.use(webhookRouter);
app.use("/api", departmentsRouter);
app.use("/api", productsRouter);
app.use("/api", channelsRouter);
app.use("/api", contactsRouter);
app.use("/api", conversationsRouter);
app.use("/api", broadcastsRouter);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[server] Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(config.port, () => {
  console.log(`[server] CakapCepat berjalan di http://localhost:${config.port} (env: ${config.nodeEnv})`);
  console.log(`[server] Webhook URL untuk didaftarkan ke Meta: http://<domain-publik-kamu>/webhook/whatsapp`);
});
