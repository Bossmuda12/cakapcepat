import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool } from "../db/pool";
import { config } from "../config";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import { sendVerificationEmail, sendResetPasswordEmail } from "../email";

export const authRouter = Router();

function makeToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Dipakai frontend buat cek: apakah CakapCepat ini sudah pernah di-setup
 * (ada organization + owner) atau masih kosong dan perlu wizard setup awal.
 */
authRouter.get("/auth/status", async (_req, res) => {
  const { rows } = await pool.query("SELECT id FROM organization LIMIT 1");
  res.json({ needsBootstrap: rows.length === 0 });
});

const bootstrapSchema = z.object({
  organizationName: z.string().min(1),
  ownerName: z.string().min(1),
  ownerEmail: z.string().email(),
  password: z.string().min(8, "Password minimal 8 karakter"),
});

/**
 * Setup PERTAMA KALI: buat organization + user owner. Hanya bisa dipanggil
 * sekali — kalau organization sudah ada, endpoint ini akan menolak (409)
 * supaya orang luar nggak bisa bikin organization baru sembarangan.
 * Owner dari bootstrap otomatis email_verified (nggak perlu email, ini
 * setup awal yang dilakukan langsung oleh pemilik server).
 */
authRouter.post("/auth/bootstrap", async (req, res) => {
  const { rows: existing } = await pool.query("SELECT id FROM organization LIMIT 1");
  if (existing.length > 0) {
    return res.status(409).json({ error: "Setup awal sudah pernah dilakukan. Silakan login." });
  }

  const parsed = bootstrapSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { organizationName, ownerName, ownerEmail, password } = parsed.data;

  const passwordHash = await bcrypt.hash(password, 10);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: orgRows } = await client.query(
      "INSERT INTO organization (name) VALUES ($1) RETURNING id",
      [organizationName]
    );
    const organizationId = orgRows[0].id;
    const { rows: userRows } = await client.query(
      `INSERT INTO users (organization_id, email, name, password_hash, role, email_verified)
       VALUES ($1, $2, $3, $4, 'owner', true) RETURNING id, email, name, role`,
      [organizationId, ownerEmail.toLowerCase(), ownerName, passwordHash]
    );
    await client.query("COMMIT");

    const token = jwt.sign(
      { userId: userRows[0].id, organizationId, role: "owner" },
      config.jwtSecret,
      { expiresIn: "30d" }
    );
    res.status(201).json({ token, user: userRows[0] });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
});

const registerSchema = z
  .object({
    name: z.string().min(1, "Nama wajib diisi"),
    phone: z.string().min(6, "No HP tidak valid"),
    email: z.string().email("Email tidak valid"),
    password: z.string().min(8, "Password minimal 8 karakter"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Konfirmasi password tidak cocok",
    path: ["confirmPassword"],
  });

/**
 * Registrasi mandiri — dipakai siapa pun yang mau pakai CakapCepat, bukan
 * cuma TahaGroup (produk ini didesain supaya bisa dipakai/dijual ke bisnis
 * lain). Setiap registrasi baru bikin organization sendiri, jadi data
 * antar pelanggan terpisah total. Akun baru email_verified=false sampai
 * link verifikasi di email-nya diklik.
 */
authRouter.post("/auth/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { name, phone, email, password } = parsed.data;
  const normalizedEmail = email.toLowerCase();

  const { rows: existingUser } = await pool.query("SELECT id FROM users WHERE email = $1", [
    normalizedEmail,
  ]);
  if (existingUser.length > 0) {
    return res.status(409).json({ error: "Email ini sudah terdaftar. Coba masuk atau reset password." });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const verificationToken = makeToken();
  const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 jam

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: orgRows } = await client.query(
      "INSERT INTO organization (name) VALUES ($1) RETURNING id",
      [`Organisasi ${name}`]
    );
    const organizationId = orgRows[0].id;
    await client.query(
      `INSERT INTO users
         (organization_id, email, name, phone, password_hash, role, email_verified, verification_token, verification_token_expires)
       VALUES ($1, $2, $3, $4, $5, 'owner', false, $6, $7)`,
      [organizationId, normalizedEmail, name, phone, passwordHash, verificationToken, verificationExpires]
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  const emailSent = await sendVerificationEmail(normalizedEmail, name, verificationToken);
  res.status(201).json({
    ok: true,
    emailSent,
    message: emailSent
      ? "Akun berhasil dibuat. Cek email kamu untuk link verifikasi."
      : "Akun berhasil dibuat, tapi email verifikasi belum bisa dikirim (server belum dikonfigurasi). Hubungi admin.",
  });
});

/**
 * Klik link dari email verifikasi. Dipanggil dari halaman /verify-email
 * di frontend (yang baca ?token= dari URL lalu manggil endpoint ini).
 */
authRouter.post("/auth/verify-email", async (req, res) => {
  const token = String(req.body?.token || "");
  if (!token) return res.status(400).json({ error: "Token tidak ada" });

  const { rows } = await pool.query(
    `SELECT id FROM users
     WHERE verification_token = $1 AND verification_token_expires > now() AND email_verified = false`,
    [token]
  );
  if (!rows[0]) {
    return res.status(400).json({ error: "Link verifikasi tidak valid atau sudah kedaluwarsa." });
  }

  await pool.query(
    `UPDATE users SET email_verified = true, verification_token = NULL, verification_token_expires = NULL
     WHERE id = $1`,
    [rows[0].id]
  );
  res.json({ ok: true, message: "Email berhasil diverifikasi. Silakan masuk." });
});

const emailOnlySchema = z.object({ email: z.string().email() });

/**
 * Kirim ulang email verifikasi (kalau yang pertama hilang / kedaluwarsa).
 */
authRouter.post("/auth/resend-verification", async (req, res) => {
  const parsed = emailOnlySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const normalizedEmail = parsed.data.email.toLowerCase();

  const { rows } = await pool.query(
    "SELECT id, name, email_verified FROM users WHERE email = $1",
    [normalizedEmail]
  );
  const generic = {
    ok: true,
    message: "Kalau email itu terdaftar dan belum diverifikasi, kami sudah kirim ulang link verifikasinya.",
  };
  if (!rows[0] || rows[0].email_verified) return res.json(generic);

  const verificationToken = makeToken();
  const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await pool.query(
    "UPDATE users SET verification_token = $1, verification_token_expires = $2 WHERE id = $3",
    [verificationToken, verificationExpires, rows[0].id]
  );
  await sendVerificationEmail(normalizedEmail, rows[0].name || "", verificationToken);
  res.json(generic);
});

/**
 * Lupa password — selalu balas pesan generik (nggak bocorin apakah email
 * terdaftar atau tidak), tapi cuma benar-benar kirim email kalau usernya ada.
 */
authRouter.post("/auth/forgot-password", async (req, res) => {
  const parsed = emailOnlySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const normalizedEmail = parsed.data.email.toLowerCase();

  const generic = {
    ok: true,
    message: "Kalau email itu terdaftar, kami sudah kirim link reset password ke sana.",
  };

  const { rows } = await pool.query("SELECT id, name FROM users WHERE email = $1", [normalizedEmail]);
  if (!rows[0]) return res.json(generic);

  const resetToken = makeToken();
  const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 jam
  await pool.query("UPDATE users SET reset_token = $1, reset_token_expires = $2 WHERE id = $3", [
    resetToken,
    resetExpires,
    rows[0].id,
  ]);
  await sendResetPasswordEmail(normalizedEmail, rows[0].name || "", resetToken);
  res.json(generic);
});

const resetPasswordSchema = z
  .object({
    token: z.string().min(1),
    password: z.string().min(8, "Password minimal 8 karakter"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Konfirmasi password tidak cocok",
    path: ["confirmPassword"],
  });

authRouter.post("/auth/reset-password", async (req, res) => {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { token, password } = parsed.data;

  const { rows } = await pool.query(
    "SELECT id FROM users WHERE reset_token = $1 AND reset_token_expires > now()",
    [token]
  );
  if (!rows[0]) {
    return res.status(400).json({ error: "Link reset password tidak valid atau sudah kedaluwarsa." });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await pool.query(
    `UPDATE users SET password_hash = $1, reset_token = NULL, reset_token_expires = NULL WHERE id = $2`,
    [passwordHash, rows[0].id]
  );
  res.json({ ok: true, message: "Password berhasil direset. Silakan masuk dengan password baru." });
});

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

authRouter.post("/auth/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { email, password } = parsed.data;

  const { rows } = await pool.query(
    "SELECT id, organization_id, name, email, username, avatar_url, password_hash, role, email_verified FROM users WHERE email = $1",
    [email.toLowerCase()]
  );
  const user = rows[0];
  if (!user) return res.status(401).json({ error: "Email atau password salah" });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: "Email atau password salah" });

  if (!user.email_verified) {
    return res.status(403).json({
      error: "Email kamu belum diverifikasi. Cek inbox kamu atau kirim ulang link verifikasi.",
      needsVerification: true,
    });
  }

  const token = jwt.sign(
    { userId: user.id, organizationId: user.organization_id, role: user.role },
    config.jwtSecret,
    { expiresIn: "30d" }
  );
  res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, username: user.username, avatar_url: user.avatar_url, role: user.role },
  });
});

authRouter.get("/auth/me", requireAuth, async (req: AuthedRequest, res) => {
  const { rows } = await pool.query(
    "SELECT id, name, email, username, avatar_url, role, email_verified FROM users WHERE id = $1",
    [req.auth!.userId]
  );
  if (!rows[0]) return res.status(404).json({ error: "User tidak ditemukan" });
  res.json(rows[0]);
});

/**
 * Dipakai frontend (Login/Register) buat tahu tombol Google/Facebook harus
 * aktif atau tetap "Segera" — tergantung apakah kredensial OAuth sudah
 * diisi di server. Tidak butuh login.
 */
authRouter.get("/auth/oauth-config", async (_req, res) => {
  res.json({
    google: Boolean(config.oauth.google.clientId && config.oauth.google.clientSecret),
    facebook: Boolean(config.oauth.facebook.clientId && config.oauth.facebook.clientSecret),
  });
});

const GOOGLE_REDIRECT_URI = () => `${config.appUrl}/api/auth/google/callback`;

/**
 * Klik "Google" di halaman login/register -> redirect ke sini -> redirect
 * lagi ke halaman consent Google. `state` di-signed pakai JWT_SECRET (bukan
 * disimpan di session/cookie — server ini stateless) supaya callback bisa
 * memverifikasi request ini memang berasal dari server kita sendiri (anti
 * CSRF), tanpa perlu tabel/session tambahan.
 */
authRouter.get("/auth/google", (_req, res) => {
  if (!config.oauth.google.clientId) {
    return res.status(503).send("Login dengan Google belum dikonfigurasi di server ini.");
  }
  const state = jwt.sign({ purpose: "google-oauth" }, config.jwtSecret, { expiresIn: "10m" });
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", config.oauth.google.clientId);
  url.searchParams.set("redirect_uri", GOOGLE_REDIRECT_URI());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "select_account");
  res.redirect(url.toString());
});

/**
 * Callback dari Google setelah user setuju/menolak consent. Tukar `code`
 * jadi access token, ambil profil (email, nama), lalu:
 *   - kalau email sudah ada di DB  -> login akun itu, dan link google_id
 *     kalau belum ter-link (misal user awalnya daftar manual)
 *   - kalau belum ada              -> bikin organization + user baru
 *     (multi-tenant, sama seperti /auth/register), email_verified=true
 *     langsung karena Google sudah memverifikasi kepemilikan email itu.
 * Hasil akhir: redirect ke frontend /oauth-callback?token=... supaya
 * frontend yang simpan token ke localStorage (backend tidak pegang cookie
 * session di app ini).
 */
authRouter.get("/auth/google/callback", async (req, res) => {
  const code = String(req.query.code || "");
  const state = String(req.query.state || "");
  const oauthError = String(req.query.error || "");

  const failRedirect = (message: string) =>
    res.redirect(`${config.appUrl}/?oauthError=${encodeURIComponent(message)}`);

  if (oauthError) return failRedirect("Login dengan Google dibatalkan.");
  if (!code) return failRedirect("Kode otorisasi dari Google tidak ada.");

  try {
    jwt.verify(state, config.jwtSecret);
  } catch {
    return failRedirect("Sesi login Google tidak valid atau sudah kedaluwarsa. Coba lagi.");
  }

  if (!config.oauth.google.clientId || !config.oauth.google.clientSecret) {
    return failRedirect("Login dengan Google belum dikonfigurasi di server ini.");
  }

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: config.oauth.google.clientId,
        client_secret: config.oauth.google.clientSecret,
        redirect_uri: GOOGLE_REDIRECT_URI(),
        grant_type: "authorization_code",
      }),
    });
    if (!tokenRes.ok) {
      const body = await tokenRes.text().catch(() => "");
      console.error(`[oauth] Google token exchange gagal: HTTP ${tokenRes.status} — ${body}`);
      return failRedirect("Gagal masuk dengan Google. Coba lagi.");
    }
    const tokenData = (await tokenRes.json()) as { access_token: string };

    const profileRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (!profileRes.ok) return failRedirect("Gagal mengambil profil Google kamu.");
    const profile = (await profileRes.json()) as {
      sub: string;
      email?: string;
      email_verified?: boolean;
      name?: string;
    };

    if (!profile.email) return failRedirect("Akun Google kamu tidak punya email publik.");
    const normalizedEmail = profile.email.toLowerCase();
    const name = profile.name || normalizedEmail.split("@")[0];

    const { rows: existing } = await pool.query(
      "SELECT id, organization_id, role, google_id FROM users WHERE email = $1",
      [normalizedEmail]
    );

    let userId: string;
    let organizationId: string;
    let role: string;

    if (existing[0]) {
      userId = existing[0].id;
      organizationId = existing[0].organization_id;
      role = existing[0].role;
      if (!existing[0].google_id) {
        await pool.query(
          "UPDATE users SET google_id = $1, email_verified = true WHERE id = $2",
          [profile.sub, userId]
        );
      }
    } else {
      const randomPassword = crypto.randomBytes(24).toString("hex");
      const passwordHash = await bcrypt.hash(randomPassword, 10);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const { rows: orgRows } = await client.query(
          "INSERT INTO organization (name) VALUES ($1) RETURNING id",
          [`Organisasi ${name}`]
        );
        organizationId = orgRows[0].id;
        const { rows: userRows } = await client.query(
          `INSERT INTO users
             (organization_id, email, name, password_hash, role, email_verified, google_id)
           VALUES ($1, $2, $3, $4, 'owner', true, $5) RETURNING id`,
          [organizationId, normalizedEmail, name, passwordHash, profile.sub]
        );
        await client.query("COMMIT");
        userId = userRows[0].id;
        role = "owner";
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    }

    const token = jwt.sign({ userId, organizationId, role }, config.jwtSecret, {
      expiresIn: "30d",
    });
    res.redirect(`${config.appUrl}/oauth-callback?token=${token}`);
  } catch (err) {
    console.error("[oauth] Google login gagal:", err);
    return failRedirect("Terjadi kesalahan saat masuk dengan Google.");
  }
});

const FACEBOOK_REDIRECT_URI = () => `${config.appUrl}/api/auth/facebook/callback`;
const FACEBOOK_API_VERSION = "v21.0";

/**
 * Sama persis pola-nya dengan /auth/google di atas: redirect ke consent
 * screen Facebook, state di-signed JWT (stateless CSRF protection).
 */
authRouter.get("/auth/facebook", (_req, res) => {
  if (!config.oauth.facebook.clientId) {
    return res.status(503).send("Login dengan Facebook belum dikonfigurasi di server ini.");
  }
  const state = jwt.sign({ purpose: "facebook-oauth" }, config.jwtSecret, { expiresIn: "10m" });
  const url = new URL(`https://www.facebook.com/${FACEBOOK_API_VERSION}/dialog/oauth`);
  url.searchParams.set("client_id", config.oauth.facebook.clientId);
  url.searchParams.set("redirect_uri", FACEBOOK_REDIRECT_URI());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "email,public_profile");
  url.searchParams.set("state", state);
  res.redirect(url.toString());
});

/**
 * Callback dari Facebook. Sama alurnya dengan Google: tukar code -> access
 * token -> profil (id, name, email) -> link/buat akun -> redirect ke
 * /oauth-callback?token=... . Bedanya: Facebook TIDAK selalu mengembalikan
 * email (akun tanpa email terverifikasi, atau login lewat nomor HP) —
 * kasus itu ditolak dengan pesan jelas karena skema DB kita mewajibkan
 * email unik sebagai identitas login.
 */
authRouter.get("/auth/facebook/callback", async (req, res) => {
  const code = String(req.query.code || "");
  const state = String(req.query.state || "");
  const oauthError = String(req.query.error || "");

  const failRedirect = (message: string) =>
    res.redirect(`${config.appUrl}/?oauthError=${encodeURIComponent(message)}`);

  if (oauthError) return failRedirect("Login dengan Facebook dibatalkan.");
  if (!code) return failRedirect("Kode otorisasi dari Facebook tidak ada.");

  try {
    jwt.verify(state, config.jwtSecret);
  } catch {
    return failRedirect("Sesi login Facebook tidak valid atau sudah kedaluwarsa. Coba lagi.");
  }

  if (!config.oauth.facebook.clientId || !config.oauth.facebook.clientSecret) {
    return failRedirect("Login dengan Facebook belum dikonfigurasi di server ini.");
  }

  try {
    const tokenUrl = new URL(`https://graph.facebook.com/${FACEBOOK_API_VERSION}/oauth/access_token`);
    tokenUrl.searchParams.set("client_id", config.oauth.facebook.clientId);
    tokenUrl.searchParams.set("client_secret", config.oauth.facebook.clientSecret);
    tokenUrl.searchParams.set("redirect_uri", FACEBOOK_REDIRECT_URI());
    tokenUrl.searchParams.set("code", code);

    const tokenRes = await fetch(tokenUrl.toString());
    if (!tokenRes.ok) {
      const body = await tokenRes.text().catch(() => "");
      console.error(`[oauth] Facebook token exchange gagal: HTTP ${tokenRes.status} — ${body}`);
      return failRedirect("Gagal masuk dengan Facebook. Coba lagi.");
    }
    const tokenData = (await tokenRes.json()) as { access_token: string };

    const profileUrl = new URL(`https://graph.facebook.com/me`);
    profileUrl.searchParams.set("fields", "id,name,email");
    profileUrl.searchParams.set("access_token", tokenData.access_token);
    const profileRes = await fetch(profileUrl.toString());
    if (!profileRes.ok) return failRedirect("Gagal mengambil profil Facebook kamu.");
    const profile = (await profileRes.json()) as { id: string; name?: string; email?: string };

    if (!profile.email) {
      return failRedirect(
        "Akun Facebook kamu tidak punya email terverifikasi. Gunakan email/password atau Google untuk daftar/masuk."
      );
    }
    const normalizedEmail = profile.email.toLowerCase();
    const name = profile.name || normalizedEmail.split("@")[0];

    const { rows: existing } = await pool.query(
      "SELECT id, organization_id, role, facebook_id FROM users WHERE email = $1",
      [normalizedEmail]
    );

    let userId: string;
    let organizationId: string;
    let role: string;

    if (existing[0]) {
      userId = existing[0].id;
      organizationId = existing[0].organization_id;
      role = existing[0].role;
      if (!existing[0].facebook_id) {
        await pool.query(
          "UPDATE users SET facebook_id = $1, email_verified = true WHERE id = $2",
          [profile.id, userId]
        );
      }
    } else {
      const randomPassword = crypto.randomBytes(24).toString("hex");
      const passwordHash = await bcrypt.hash(randomPassword, 10);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const { rows: orgRows } = await client.query(
          "INSERT INTO organization (name) VALUES ($1) RETURNING id",
          [`Organisasi ${name}`]
        );
        organizationId = orgRows[0].id;
        const { rows: userRows } = await client.query(
          `INSERT INTO users
             (organization_id, email, name, password_hash, role, email_verified, facebook_id)
           VALUES ($1, $2, $3, $4, 'owner', true, $5) RETURNING id`,
          [organizationId, normalizedEmail, name, passwordHash, profile.id]
        );
        await client.query("COMMIT");
        userId = userRows[0].id;
        role = "owner";
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    }

    const token = jwt.sign({ userId, organizationId, role }, config.jwtSecret, {
      expiresIn: "30d",
    });
    res.redirect(`${config.appUrl}/oauth-callback?token=${token}`);
  } catch (err) {
    console.error("[oauth] Facebook login gagal:", err);
    return failRedirect("Terjadi kesalahan saat masuk dengan Facebook.");
  }
});
