import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { pool } from "../db/pool";
import { requireAuth, type AuthedRequest } from "../middleware/auth";

export const meRouter = Router();

const USERNAME_RE = /^[a-zA-Z0-9_.]{3,30}$/;
// Batas ukuran data URL avatar: ~1.4MB base64 (~1MB gambar asli setelah
// di-resize di sisi frontend). Cukup untuk foto profil, tidak membebani DB.
const MAX_AVATAR_DATA_URL_LENGTH = 1_400_000;

const updateProfileSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  username: z
    .string()
    .regex(USERNAME_RE, "Username 3-30 karakter, hanya huruf/angka/underscore/titik")
    .optional()
    .or(z.literal("")),
  avatarDataUrl: z
    .string()
    .startsWith("data:image/", "Format gambar tidak valid")
    .max(MAX_AVATAR_DATA_URL_LENGTH, "Ukuran foto terlalu besar, maksimal ~1MB")
    .optional()
    .or(z.literal("")),
});

/**
 * Halaman Settings dashboard: ubah nama, email, username, dan foto profil
 * akun sendiri. Email tetap dipakai untuk LOGIN dan harus unik (constraint
 * UNIQUE di tabel users) — tapi username sekarang kolom terpisah, murni
 * identitas tampilan, juga unik tapi independen dari email. avatarDataUrl
 * disimpan langsung sebagai data URL base64 di kolom avatar_url, sehingga
 * otomatis sinkron di semua perangkat/browser (datanya dari server, bukan
 * localStorage lokal).
 */
meRouter.patch("/me", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = updateProfileSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { name, email, username, avatarDataUrl } = parsed.data;
  if (!name && !email && username === undefined && avatarDataUrl === undefined) {
    return res.status(400).json({ error: "Tidak ada perubahan dikirim" });
  }

  if (email) {
    const { rows: existing } = await pool.query(
      "SELECT id FROM users WHERE email = $1 AND id <> $2",
      [email.toLowerCase(), req.auth!.userId]
    );
    if (existing[0]) return res.status(409).json({ error: "Email sudah dipakai akun lain" });
  }

  if (username) {
    const { rows: existing } = await pool.query(
      "SELECT id FROM users WHERE username = $1 AND id <> $2",
      [username, req.auth!.userId]
    );
    if (existing[0]) return res.status(409).json({ error: "Username sudah dipakai akun lain" });
  }

  const { rows } = await pool.query(
    `UPDATE users SET
       name = COALESCE($1, name),
       email = COALESCE($2, email),
       username = CASE WHEN $3::text IS NULL THEN username WHEN $3 = '' THEN NULL ELSE $3 END,
       avatar_url = CASE WHEN $4::text IS NULL THEN avatar_url WHEN $4 = '' THEN NULL ELSE $4 END
     WHERE id = $5
     RETURNING id, name, email, username, avatar_url, role`,
    [
      name ?? null,
      email ? email.toLowerCase() : null,
      username === undefined ? null : username,
      avatarDataUrl === undefined ? null : avatarDataUrl,
      req.auth!.userId,
    ]
  );
  res.json(rows[0]);
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, "Password baru minimal 8 karakter"),
});

meRouter.post("/me/password", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { currentPassword, newPassword } = parsed.data;

  const { rows } = await pool.query("SELECT password_hash FROM users WHERE id = $1", [req.auth!.userId]);
  const user = rows[0];
  if (!user) return res.status(404).json({ error: "User tidak ditemukan" });

  const valid = await bcrypt.compare(currentPassword, user.password_hash);
  if (!valid) return res.status(401).json({ error: "Password saat ini salah" });

  const newHash = await bcrypt.hash(newPassword, 10);
  await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [newHash, req.auth!.userId]);
  res.json({ ok: true });
});
