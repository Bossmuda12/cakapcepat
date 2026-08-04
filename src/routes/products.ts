import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool";
import { requireAuth, type AuthedRequest } from "../middleware/auth";

export const productsRouter = Router();

productsRouter.get("/products", requireAuth, async (req: AuthedRequest, res) => {
  const { rows } = await pool.query(
    `SELECT p.id, p.name, p.is_active,
       (SELECT count(*) FROM whatsapp_channels wc WHERE wc.product_id = p.id) AS channel_count
     FROM products p WHERE p.organization_id = $1 ORDER BY p.created_at DESC`,
    [req.auth!.organizationId]
  );
  res.json(rows);
});

const createProductSchema = z.object({ name: z.string().min(1) });

productsRouter.post("/products", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = createProductSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { rows } = await pool.query(
    "INSERT INTO products (organization_id, name) VALUES ($1, $2) RETURNING id, name, is_active",
    [req.auth!.organizationId, parsed.data.name]
  );
  res.status(201).json(rows[0]);
});
