/**
 * Pembangunan aplikasi Express — DIPISAH dari proses menyalakan server.
 *
 * Alasannya praktis: uji end-to-end (scripts/uji-panel-platform.ts) perlu
 * menjalankan aplikasi ini di port acak untuk menguji lapisan HTTP yang
 * sesungguhnya — middleware, audience token, izin per peran. Kalau berkas ini
 * juga memanggil server.listen(), penjadwal, dan resume sesi WhatsApp seperti
 * dulu, sekadar meng-import-nya di dalam uji akan menyalakan server produksi
 * betulan. Jadi berkas ini HANYA membangun app; src/server.ts yang
 * menyalakannya.
 */
import "express-async-errors";

// --- Jaring pengaman supaya SATU error internal (paling sering dari Baileys,
// library koneksi WA QR/pairing) tidak mematikan SELURUH server CakapCepat ---
// Baileys kadang melempar promise rejection dari operasi internalnya sendiri
// (retry-request, transaksi sesi, dst) yang tidak bisa ditangkap lewat try/catch
// biasa di kode kita, karena terjadi di dalam event emitter Baileys. Tanpa
// handler ini, satu error semacam itu (mis. saat sesi WA tim logout/konflik
// device) bisa membuat SELURUH proses Node crash & restart — termasuk fitur
// yang sama sekali tidak berhubungan (order tracking, broadcast, CAPI, dll).
// Dicatat ke log supaya tetap kelihatan & bisa didiagnosis, tapi proses TIDAK
// dimatikan. HARUS didaftarkan di baris paling atas, sebelum import lain jalan.
process.on("unhandledRejection", (reason) => {
  console.error("[server] Unhandled promise rejection (server tetap jalan):", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[server] Uncaught exception (server tetap jalan):", err);
});

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
import { departmentsRouter } from "./routes/departments";
import { productsRouter } from "./routes/products";
import { channelsRouter } from "./routes/channels";
import { qrChannelsRouter } from "./routes/qrChannels";
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
import { categoriesRouter } from "./routes/categories";
import { variantsRouter } from "./routes/variants";
import { courierRouter } from "./routes/courier";
import { platformRouter } from "./platform/routes";
import { groupsRouter } from "./routes/groups";
import { followupsRouter } from "./routes/followups";
import { auditRouter } from "./routes/audit";

const app = express();

/* --------------------------------------------------------------------------
   Pengerasan HTTP (keamanan + SEO)

   Sebelumnya server membocorkan `X-Powered-By: Express`, mengizinkan CORS dari
   SEMUA origin (`cors()` tanpa argumen), tidak mengirim satu pun header
   keamanan, dan membalas HTML aplikasi dengan status 200 untuk SETIAP path yang
   tidak dikenal — termasuk /favicon.png dan /apa-saja.xml. Akibatnya Google
   melihat "soft 404" di mana-mana dan ikon situs tidak pernah muncul.
   -------------------------------------------------------------------------- */
app.disable("x-powered-by");

const isProd = process.env.NODE_ENV === "production";

// Origin yang boleh memanggil API ini dari browser. Dashboard disajikan dari
// server yang sama (same-origin), jadi daftar ini sengaja pendek.
const allowedOrigins = new Set<string>(
  [
    process.env.APP_URL,
    process.env.MARKETING_ORIGIN,
    "https://www.cakapcepat.com",
    "https://cakapcepat.com",
    "https://cakapcepat.up.railway.app",
    ...(isProd ? [] : ["http://localhost:5173", "http://localhost:3000"]),
  ]
    .filter((v): v is string => Boolean(v))
    .map((v) => v.replace(/\/+$/, ""))
);

app.use(
  cors({
    origin(origin, callback) {
      // Tanpa header Origin = bukan permintaan lintas situs dari browser
      // (curl, webhook Meta, health check) — tidak perlu diblokir di sini.
      if (!origin) return callback(null, true);
      return callback(null, allowedOrigins.has(origin.replace(/\/+$/, "")));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key", "If-Match"],
  })
);

// Content-Security-Policy dibuat seketat yang masih bisa dijalankan aplikasi
// ini: skrip HANYA dari domain sendiri (tanpa 'unsafe-inline'), gaya inline
// diizinkan karena React menulis atribut style, gambar boleh data:/blob: karena
// avatar & media pelanggan memakainya.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' ws: wss:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

app.use((req, res, next) => {
  res.setHeader("Content-Security-Policy", CSP);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Permissions-Policy",
    "geolocation=(), microphone=(), camera=(), payment=(), usb=(), interest-cohort=()"
  );
  if (isProd) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  // Data pribadi organisasi tidak boleh nyangkut di cache proxy/browser.
  if (req.path.startsWith("/api")) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Robots-Tag", "noindex");
  }
  next();
});

// express.json({ verify }) menyimpan raw body ke req.rawBody, dipakai webhook.ts
// untuk verifikasi signature (X-Hub-Signature-256) dari Meta.
app.use(
  express.json({
    // limit dinaikkan dari default 100kb supaya upload foto profil (avatar
    // disimpan sebagai data URL base64) tidak ditolak body-parser.
    limit: "3mb",
    verify: (req: Request & { rawBody?: Buffer }, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

app.get("/health", (_req, res) => res.json({ ok: true, service: "cakapcepat" }));

app.use(webhookRouter);
// Control plane. Dipasang PALING AWAL dan di prefix-nya sendiri supaya
// jelas terpisah dari API penjual — audience tokennya juga berbeda, lihat
// src/platform/auth.ts.
app.use("/api", platformRouter);

app.use("/api", authRouter);
app.use("/api", usersRouter);
app.use("/api", meRouter);
app.use("/api", departmentsRouter);
app.use("/api", productsRouter);
app.use("/api", channelsRouter);
app.use("/api", qrChannelsRouter);
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
app.use("/api", categoriesRouter);
app.use("/api", variantsRouter);
app.use("/api", courierRouter);
app.use("/api", groupsRouter);
app.use("/api", followupsRouter);
app.use("/api", auditRouter);

// F-33: berkas media dari pelanggan (foto alamat, bukti transfer, voice note)
// disimpan di uploads/media/<organizationId>/ dan disajikan lewat /uploads
// supaya bisa dibuka & didengarkan langsung dari halaman Percakapan.
// Catatan: di Railway, folder ini ikut hilang saat redeploy kecuali dipasang
// volume — untuk sekarang media lama bisa hilang, tapi catatan pesannya tetap
// ada di database. Pasang Railway Volume ke /app/uploads kalau media harus awet.
const uploadsDir = path.join(process.cwd(), "uploads");
app.use(
  "/uploads",
  express.static(uploadsDir, {
    // Berkas media harus tetap bisa diunduh Meta dari internet saat kita
    // mengirim lampiran lewat Cloud API — itu sebabnya folder ini publik dan
    // nama berkasnya UUID acak. Yang bisa dikencangkan tanpa merusak itu:
    index: false,
    dotfiles: "deny",
    setHeaders(res) {
      // Jangan sampai bukti transfer dan foto alamat pelanggan masuk hasil
      // pencarian Google.
      res.setHeader("X-Robots-Tag", "noindex, nofollow, noimageindex");
      // Jangan disimpan proxy/CDN perantara.
      res.setHeader("Cache-Control", "private, max-age=300");
      res.setHeader("X-Content-Type-Options", "nosniff");
      // Berkas dari pelanggan tidak boleh dijalankan sebagai halaman di
      // origin kita (mis. HTML/SVG yang disisipi skrip).
      res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    },
  })
);

// Dashboard web (React, di-build ke folder public/) — disajikan langsung
// dari service backend yang sama, supaya nggak perlu deploy terpisah.
const publicDir = path.join(__dirname, "../public");
if (fs.existsSync(publicDir)) {
  app.use(
    express.static(publicDir, {
      // Berkas di /assets/ namanya mengandung hash isi (index-a1b2c3.js) — aman
      // di-cache setahun. index.html TIDAK boleh di-cache, kalau tidak pengguna
      // tetap memuat versi lama setelah deploy.
      setHeaders(res, filePath) {
        if (/[\\/]assets[\\/]/.test(filePath)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        } else if (filePath.endsWith("index.html")) {
          res.setHeader("Cache-Control", "no-cache");
        } else {
          res.setHeader("Cache-Control", "public, max-age=3600");
        }
      },
    })
  );

  // Path yang TERLIHAT seperti berkas (punya ekstensi) tapi tidak ada di folder
  // public harus 404 sungguhan. Sebelumnya semuanya dibalas index.html dengan
  // status 200, sehingga /favicon.png, /sitemap.xml palsu, dan salah ketik
  // apa pun terlihat "ada" di mata mesin pencari.
  app.get(/^(?!\/api|\/webhook|\/health|\/ws|\/uploads).*/, (req, res) => {
    if (/\.[a-z0-9]{2,5}$/i.test(req.path)) {
      res.status(404).type("text/plain").send("404 Not Found");
      return;
    }
    // Rute aplikasi (SPA). Halaman privat tidak boleh diindeks Google.
    //
    // Tiga halaman publik punya berkas HTML sendiri yang sudah berisi teks
    // lengkap hasil prerender saat build (scripts/prerender.mjs). Itu yang
    // dibaca Googlebot dan pratinjau tautan WhatsApp/Facebook tanpa perlu
    // menjalankan JavaScript. Rute lain tetap dapat cangkang kosong
    // (app.html) — isi halaman di balik login tidak boleh ada di berkas
    // statis yang bisa diambil siapa pun.
    const HALAMAN_PRERENDER: Record<string, string> = {
      "/": "index.html",
      "/privacy-policy": "privacy-policy.html",
      "/data-deletion": "data-deletion.html",
    };
    const berkasPrerender = HALAMAN_PRERENDER[req.path];
    if (berkasPrerender) {
      const penuh = path.join(publicDir, berkasPrerender);
      if (fs.existsSync(penuh)) {
        res.setHeader("Cache-Control", "no-cache");
        return res.sendFile(penuh);
      }
    } else {
      res.setHeader("X-Robots-Tag", "noindex");
    }
    res.setHeader("Cache-Control", "no-cache");
    // app.html = cangkang tanpa prerender. Kalau belum ada (build lama),
    // jatuh ke index.html supaya aplikasi tetap jalan.
    const cangkang = path.join(publicDir, "app.html");
    res.sendFile(fs.existsSync(cangkang) ? cangkang : path.join(publicDir, "index.html"));
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
    // Detail lengkap (termasuk pesan asli Postgres — bisa membocorkan nama
    // tabel/kolom/kendala internal) HANYA dicatat di log server. Klien selalu
    // dapat pesan generik berbahasa Indonesia (P-29) — jangan pernah kirim
    // pgErr.message atau err.message mentah ke response.
    console.error("[server] Unhandled error:", err);
    const pgErr = err as { code?: string; message?: string };
    if (pgErr?.code && POSTGRES_INPUT_ERROR_CODES.has(pgErr.code)) {
      return res.status(400).json({ error: "Input tidak valid. Periksa kembali data yang dikirim." });
    }
    res.status(500).json({ error: "Terjadi kesalahan pada server. Silakan coba lagi." });
  }
);

export { app };
