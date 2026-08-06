import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool";
import { requireAuth, type AuthedRequest } from "../middleware/auth";

export const automationsRouter = Router();

// Semua automation dalam organization (dipakai halaman Otomatisasi di dashboard).
automationsRouter.get("/automations", requireAuth, async (req: AuthedRequest, res) => {
  const { rows } = await pool.query(
    `SELECT a.id, a.channel_id, a.trigger_type, a.config, a.is_active, a.created_at,
            wc.label AS channel_label, wc.display_phone_number
     FROM automations a
     JOIN whatsapp_channels wc ON wc.id = a.channel_id
     WHERE wc.organization_id = $1
     ORDER BY a.created_at DESC`,
    [req.auth!.organizationId]
  );
  res.json(rows);
});

const createAutomationSchema = z.object({
  channelId: z.string().uuid(),
  triggerType: z.enum(["keyword", "office_hours", "fallback_to_ai"]),
  config: z.record(z.any()).default({}),
  isActive: z.boolean().default(true),
});

automationsRouter.post("/automations", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = createAutomationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { channelId, triggerType, config, isActive } = parsed.data;

  // Pastikan channel ini benar milik organization yang login.
  const { rows: channelRows } = await pool.query(
    "SELECT id FROM whatsapp_channels WHERE id = $1 AND organization_id = $2",
    [channelId, req.auth!.organizationId]
  );
  if (!channelRows[0]) return res.status(404).json({ error: "Nomor WhatsApp tidak ditemukan" });

  const { rows } = await pool.query(
    `INSERT INTO automations (channel_id, trigger_type, config, is_active)
     VALUES ($1, $2, $3, $4)
     RETURNING id, channel_id, trigger_type, config, is_active, created_at`,
    [channelId, triggerType, JSON.stringify(config), isActive]
  );
  res.status(201).json(rows[0]);
});

const updateAutomationSchema = z.object({
  isActive: z.boolean().optional(),
  config: z.record(z.any()).optional(),
});

automationsRouter.patch("/automations/:id", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = updateAutomationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { rows } = await pool.query(
    `UPDATE automations a SET
       is_active = COALESCE($3, a.is_active),
       config = COALESCE($4, a.config)
     FROM whatsapp_channels wc
     WHERE a.id = $1 AND wc.id = a.channel_id AND wc.organization_id = $2
     RETURNING a.id, a.channel_id, a.trigger_type, a.config, a.is_active`,
    [
      req.params.id,
      req.auth!.organizationId,
      parsed.data.isActive ?? null,
      parsed.data.config ? JSON.stringify(parsed.data.config) : null,
    ]
  );
  if (!rows[0]) return res.status(404).json({ error: "Automation tidak ditemukan" });
  res.json(rows[0]);
});

automationsRouter.delete("/automations/:id", requireAuth, async (req: AuthedRequest, res) => {
  const { rowCount } = await pool.query(
    `DELETE FROM automations a
     USING whatsapp_channels wc
     WHERE a.id = $1 AND wc.id = a.channel_id AND wc.organization_id = $2`,
    [req.params.id, req.auth!.organizationId]
  );
  if (!rowCount) return res.status(404).json({ error: "Automation tidak ditemukan" });
  res.json({ ok: true });
});
