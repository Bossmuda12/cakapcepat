import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool";
import { requireAuth, type AuthedRequest } from "../middleware/auth";

export const contactsRouter = Router();

const createContactSchema = z.object({
  waNumber: z.string().min(8, "Nomor WhatsApp tidak valid"),
  name: z.string().optional(),
  labels: z.array(z.string()).optional(),
});

contactsRouter.get("/contacts", requireAuth, async (req: AuthedRequest, res) => {
  const { rows } = await pool.query(
    `SELECT id, wa_number, name, labels, pipeline_stage, created_at
     FROM contacts WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 100`,
    [req.auth!.organizationId]
  );
  res.json(rows);
});

contactsRouter.post("/contacts", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = createContactSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { waNumber, name, labels } = parsed.data;
  const { rows } = await pool.query(
    `INSERT INTO contacts (organization_id, wa_number, name, labels)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (organization_id, wa_number) DO UPDATE SET name = EXCLUDED.name
     RETURNING id, wa_number, name, labels, pipeline_stage, created_at`,
    [req.auth!.organizationId, waNumber, name ?? null, labels ?? []]
  );
  res.status(201).json(rows[0]);
});
