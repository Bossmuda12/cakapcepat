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
  const { rows } = await pool.query(
    `INSERT INTO users (organization_id, email, name, password_hash, role)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, email, role, created_at`,
    [req.auth!.organizationId, email.toLowerCase(), name, passwordHash, role]
  );
  res.status(201).json(rows[0]);
});
