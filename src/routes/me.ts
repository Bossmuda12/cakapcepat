import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { pool } from "../db/pool";
import { requireAuth, type AuthedRequest } from "../middleware/auth";

export const meRouter = Router();

const updateProfileSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
});

/**
 * Halaman Settings dashboard: ubah nama & email akun sendiri. Email harus
 * tetap unik dalam satu organization (constraint UNIQUE di tabel users).
 * Sistem ini belum punya kolom "username" terpisah — login memakai email,
 * jadi email berperan sebagai username.
 */
meRouter.patch("/me", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = updateProfileSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { name, email } = parsed.data;
  if (!name && !email) return res.status(400).json({ error: "Tidak ada perubahan dikirim" });

  if (email) {
    const { rows: existing } = await pool.query(
      "SELECT id FROM users WHERE email = $1 AND id <> $2",
      [email.toLowerCase(), req.auth!.userId]
    );
    if (existing[0]) return res.status(409).json({ error: "Email sudah dipakai akun lain" });
  }

  const { rows } = await pool.query(
    `UPDATE users SET name = COALESCE($1, name), email = COALESCE($2, email)
     WHERE id = $3
     RETURNING id, name, email, role`,
    [name ?? null, email ? email.toLowerCase() : null, req.auth!.userId]
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
