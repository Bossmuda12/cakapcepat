import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool";
import { requireAuth, type AuthedRequest } from "../middleware/auth";

export const knowledgeBaseRouter = Router();

knowledgeBaseRouter.get("/knowledge-base", requireAuth, async (req: AuthedRequest, res) => {
  const { rows } = await pool.query(
    `SELECT kb.id, kb.title, kb.content, kb.product_id, p.name AS product_name, kb.created_at
     FROM knowledge_base_entries kb
     LEFT JOIN products p ON p.id = kb.product_id
     WHERE kb.organization_id = $1
     ORDER BY kb.created_at DESC`,
    [req.auth!.organizationId]
  );
  res.json(rows);
});

const createEntrySchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
  productId: z.string().uuid().optional(),
});

knowledgeBaseRouter.post("/knowledge-base", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = createEntrySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { title, content, productId } = parsed.data;

  const { rows } = await pool.query(
    `INSERT INTO knowledge_base_entries (organization_id, product_id, title, content)
     VALUES ($1, $2, $3, $4)
     RETURNING id, title, content, product_id, created_at`,
    [req.auth!.organizationId, productId ?? null, title, content]
  );
  res.status(201).json(rows[0]);
});

knowledgeBaseRouter.delete("/knowledge-base/:id", requireAuth, async (req: AuthedRequest, res) => {
  const { rowCount } = await pool.query(
    "DELETE FROM knowledge_base_entries WHERE id = $1 AND organization_id = $2",
    [req.params.id, req.auth!.organizationId]
  );
  if (!rowCount) return res.status(404).json({ error: "Entri tidak ditemukan" });
  res.json({ ok: true });
});
