import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool } from "../db/pool";
import { config } from "../config";
import { requireAuth, type AuthedRequest } from "../middleware/auth";

export const authRouter = Router();

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
      `INSERT INTO users (organization_id, email, name, password_hash, role)
       VALUES ($1, $2, $3, $4, 'owner') RETURNING id, email, name, role`,
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

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

authRouter.post("/auth/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { email, password } = parsed.data;

  const { rows } = await pool.query(
    "SELECT id, organization_id, name, email, password_hash, role FROM users WHERE email = $1",
    [email.toLowerCase()]
  );
  const user = rows[0];
  if (!user) return res.status(401).json({ error: "Email atau password salah" });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: "Email atau password salah" });

  const token = jwt.sign(
    { userId: user.id, organizationId: user.organization_id, role: user.role },
    config.jwtSecret,
    { expiresIn: "30d" }
  );
  res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  });
});

authRouter.get("/auth/me", requireAuth, async (req: AuthedRequest, res) => {
  const { rows } = await pool.query(
    "SELECT id, name, email, role FROM users WHERE id = $1",
    [req.auth!.userId]
  );
  if (!rows[0]) return res.status(404).json({ error: "User tidak ditemukan" });
  res.json(rows[0]);
});
