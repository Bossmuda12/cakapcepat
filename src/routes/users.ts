import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { pool } from "../db/pool";
import { requireAuth, type AuthedRequest } from "../middleware/auth";

export const usersRouter = Router();

// Daftar tim (CS/admin/owner) dalam satu organization — dipakai juga buat
// dropdown "pemilik nomor WA" & "assign percakapan" di frontend.
usersRouter.get("/users", requireAuth, async (req: AuthedRequest, res) => {
  const { rows } = await pool.query(
    "SELECT id, name, email, role, created_at FROM users WHERE organization_id = $1 ORDER BY created_at",
    [req.auth!.organizationId]
  );
  res.json(rows);
});

const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8, "Password minimal 8 karakter"),
  role: z.enum(["owner", "admin", "agent"]).default("agent"),
});

// Tambah anggota tim baru (mis. CS baru). Hanya owner/admin yang boleh.
usersRouter.post("/users", requireAuth, async (req: AuthedRequest, res) => {
  if (req.auth!.role !== "owner" && req.auth!.role !== "admin") {
    return res.status(403).json({ error: "Hanya owner/admin yang bisa menambah anggota tim" });
  }
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { name, email, password, role } = parsed.data;

  const passwordHash = await bcrypt.hash(password, 10);
  // Ditambahkan langsung oleh owner/admin yang sudah login — jadi otomatis
  // email_verified (nggak perlu alur verifikasi email seperti Register mandiri).
  const { rows } = await pool.query(
    `INSERT INTO users (organization_id, email, name, password_hash, role, email_verified)
     VALUES ($1, $2, $3, $4, $5, true)
     RETURNING id, name, email, role, created_at`,
    [req.auth!.organizationId, email.toLowerCase(), name, passwordHash, role]
  );
  res.status(201).json(rows[0]);
});

const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  role: z.enum(["owner", "admin", "agent"]).optional(),
  // Kosongkan di form frontend berarti "tidak diganti" — cuma diproses kalau benar-benar dikirim.
  password: z.string().min(8, "Password minimal 8 karakter").optional(),
});

// Edit anggota tim (nama/email/peran, opsional reset password). Hanya owner/admin.
usersRouter.patch("/users/:id", requireAuth, async (req: AuthedRequest, res) => {
  if (req.auth!.role !== "owner" && req.auth!.role !== "admin") {
    return res.status(403).json({ error: "Hanya owner/admin yang bisa mengubah anggota tim" });
  }
  const parsed = updateUserSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { name, email, role, password } = parsed.data;

  const { rows: existingRows } = await pool.query(
    "SELECT id, role FROM users WHERE id = $1 AND organization_id = $2",
    [req.params.id, req.auth!.organizationId]
  );
  if (!existingRows[0]) return res.status(404).json({ error: "Anggota tim tidak ditemukan" });

  // Cegah owner terakhir "diturunkan" dari peran owner secara tidak sengaja
  // (kalau ini owner satu-satunya) — supaya organization tidak kehilangan owner sama sekali.
  if (role && role !== "owner" && existingRows[0].role === "owner") {
    const { rows: ownerCountRows } = await pool.query(
      "SELECT count(*) FROM users WHERE organization_id = $1 AND role = 'owner'",
      [req.auth!.organizationId]
    );
    if (Number(ownerCountRows[0].count) <= 1) {
      return res.status(400).json({ error: "Tidak bisa mengubah peran owner terakhir di organization ini" });
    }
  }

  const setClauses: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  if (name !== undefined) {
    idx += 1;
    setClauses.push(`name = $${idx}`);
    values.push(name);
  }
  if (email !== undefined) {
    idx += 1;
    setClauses.push(`email = $${idx}`);
    values.push(email.toLowerCase());
  }
  if (role !== undefined) {
    idx += 1;
    setClauses.push(`role = $${idx}`);
    values.push(role);
  }
  if (password) {
    idx += 1;
    setClauses.push(`password_hash = $${idx}`);
    values.push(await bcrypt.hash(password, 10));
  }
  if (setClauses.length === 0) return res.status(400).json({ error: "Tidak ada perubahan dikirim" });

  const { rows } = await pool.query(
    `UPDATE users SET ${setClauses.join(", ")} WHERE id = $1 RETURNING id, name, email, role, created_at`,
    [req.params.id, ...values]
  );
  res.json(rows[0]);
});

// Hapus anggota tim. Hanya owner/admin. Tidak bisa hapus diri sendiri atau
// owner terakhir. Nomor WA/percakapan/pesan yang terkait otomatis dilepas
// (owner_user_id/assigned_to/sender_user_id di-set NULL, bukan ikut terhapus
// — lihat ON DELETE SET NULL di schema.sql), jadi riwayat chat tetap aman.
usersRouter.delete("/users/:id", requireAuth, async (req: AuthedRequest, res) => {
  if (req.auth!.role !== "owner" && req.auth!.role !== "admin") {
    return res.status(403).json({ error: "Hanya owner/admin yang bisa menghapus anggota tim" });
  }
  if (req.params.id === req.auth!.userId) {
    return res.status(400).json({ error: "Tidak bisa menghapus akun sendiri" });
  }

  const { rows: existingRows } = await pool.query(
    "SELECT id, role FROM users WHERE id = $1 AND organization_id = $2",
    [req.params.id, req.auth!.organizationId]
  );
  if (!existingRows[0]) return res.status(404).json({ error: "Anggota tim tidak ditemukan" });

  if (existingRows[0].role === "owner") {
    const { rows: ownerCountRows } = await pool.query(
      "SELECT count(*) FROM users WHERE organization_id = $1 AND role = 'owner'",
      [req.auth!.organizationId]
    );
    if (Number(ownerCountRows[0].count) <= 1) {
      return res.status(400).json({ error: "Tidak bisa menghapus owner terakhir di organization ini" });
    }
  }

  await pool.query("DELETE FROM users WHERE id = $1 AND organization_id = $2", [
    req.params.id,
    req.auth!.organizationId,
  ]);
  res.json({ ok: true });
});
