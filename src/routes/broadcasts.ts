import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import { enqueueBroadcast } from "../queue/broadcastQueue";

export const broadcastsRouter = Router();

const createBroadcastSchema = z.object({
  channelId: z.string().uuid(),
  name: z.string().min(1),
  templateName: z.string().min(1),
  templateParams: z.array(z.string()).optional(),
  targetLabel: z.string().optional(),
});

broadcastsRouter.post("/broadcasts", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = createBroadcastSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { channelId, name, templateName, templateParams, targetLabel } = parsed.data;
  const organizationId = req.auth!.organizationId;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: broadcastRows } = await client.query(
      `INSERT INTO broadcasts (channel_id, name, template_name, template_params, target_label, status)
       VALUES ($1, $2, $3, $4, $5, 'queued')
       RETURNING id`,
      [channelId, name, templateName, JSON.stringify(templateParams ?? []), targetLabel ?? null]
    );
    const broadcastId = broadcastRows[0].id;

    const targetFilter = targetLabel ? "AND $3 = ANY(labels)" : "";
    const params: unknown[] = [broadcastId, organizationId];
    if (targetLabel) params.push(targetLabel);

    await client.query(
      `INSERT INTO broadcast_recipients (broadcast_id, contact_id)
       SELECT $1, id FROM contacts WHERE organization_id = $2 ${targetFilter}`,
      params
    );

    await client.query("COMMIT");
    await enqueueBroadcast(broadcastId);

    res.status(201).json({ id: broadcastId, status: "queued" });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
});

broadcastsRouter.get("/broadcasts/:id", requireAuth, async (req: AuthedRequest, res) => {
  const { rows } = await pool.query(
    `SELECT b.*,
       (SELECT count(*) FROM broadcast_recipients WHERE broadcast_id = b.id AND status = 'sent') AS sent_count,
       (SELECT count(*) FROM broadcast_recipients WHERE broadcast_id = b.id AND status = 'failed') AS failed_count,
       (SELECT count(*) FROM broadcast_recipients WHERE broadcast_id = b.id) AS total_count
     FROM broadcasts b WHERE b.id = $1`,
    [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "Broadcast tidak ditemukan" });
  res.json(rows[0]);
});
