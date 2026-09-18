import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool";
import { requireAuth, requireOwnerOrAdmin, type AuthedRequest } from "../middleware/auth";
import { enqueueBroadcast } from "../queue/broadcastQueue";

export const broadcastsRouter = Router();

const createBroadcastSchema = z.object({
  channelId: z.string().uuid(),
  name: z.string().min(1),
  templateName: z.string().min(1),
  templateParams: z.array(z.string()).optional(),
  targetLabel: z.string().optional(),
});

broadcastsRouter.post("/broadcasts", requireAuth, requireOwnerOrAdmin, async (req: AuthedRequest, res) => {
  const parsed = createBroadcastSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { channelId, name, templateName, templateParams, targetLabel } = parsed.data;
  const organizationId = req.auth!.organizationId;

  // P-5: pastikan channelId benar-benar milik organization pemanggil SEBELUM
  // insert broadcast — tanpa ini, siapa pun yang login bisa mengirim
  // broadcast lewat nomor WA milik organization LAIN cukup dengan menebak/
  // memakai UUID channel yang bocor (pola sama seperti automations.ts).
  const { rows: channelRows } = await pool.query(
    "SELECT id FROM whatsapp_channels WHERE id = $1 AND organization_id = $2",
    [channelId, organizationId]
  );
  if (!channelRows[0]) return res.status(404).json({ error: "Nomor WhatsApp tidak ditemukan" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: broadcastRows } = await client.query(
      `INSERT INTO broadcasts (organization_id, channel_id, name, template_name, template_params, target_label, status)
       VALUES ($6, $1, $2, $3, $4, $5, 'queued')
       RETURNING id`,
      [channelId, name, templateName, JSON.stringify(templateParams ?? []), targetLabel ?? null, organizationId]
    );
    const broadcastId = broadcastRows[0].id;

    const targetFilter = targetLabel ? "AND $3 = ANY(labels)" : "";
    const params: unknown[] = [broadcastId, organizationId];
    if (targetLabel) params.push(targetLabel);

    await client.query(
      `INSERT INTO broadcast_recipients (organization_id, broadcast_id, contact_id)
       SELECT $2, $1, id FROM contacts WHERE organization_id = $2 ${targetFilter}`,
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

// Riwayat broadcast — dukung filter tanggal ?from=&to= (dipakai
// DateRangeFilter di halaman Broadcast).
broadcastsRouter.get("/broadcasts", requireAuth, async (req: AuthedRequest, res) => {
  const { from, to } = req.query as { from?: string; to?: string };
  const params: unknown[] = [req.auth!.organizationId];
  let dateClause = "";
  if (from && to) {
    params.push(from, to);
    dateClause = "AND b.created_at::date BETWEEN $2 AND $3";
  }
  const { rows } = await pool.query(
    `SELECT b.id, b.name, b.template_name, b.target_label, b.status, b.created_at,
       wc.label AS channel_label, wc.display_phone_number,
       (SELECT count(*) FROM broadcast_recipients WHERE broadcast_id = b.id AND status = 'sent') AS sent_count,
       (SELECT count(*) FROM broadcast_recipients WHERE broadcast_id = b.id AND status = 'failed') AS failed_count,
       (SELECT count(*) FROM broadcast_recipients WHERE broadcast_id = b.id) AS total_count
     FROM broadcasts b
     JOIN whatsapp_channels wc ON wc.id = b.channel_id
     WHERE wc.organization_id = $1 ${dateClause}
     ORDER BY b.created_at DESC
     LIMIT 50`,
    params
  );
  res.json(rows);
});

// P-5: sebelumnya endpoint ini WHERE b.id = $1 saja, tanpa filter organisasi
// sama sekali — siapa pun yang login bisa lihat detail broadcast organization
// LAIN cukup dengan menebak UUID-nya. Ditambahkan JOIN + filter organisasi
// sama seperti GET /broadcasts (list) di atas.
broadcastsRouter.get("/broadcasts/:id", requireAuth, async (req: AuthedRequest, res) => {
  const { rows } = await pool.query(
    `SELECT b.*,
       (SELECT count(*) FROM broadcast_recipients WHERE broadcast_id = b.id AND status = 'sent') AS sent_count,
       (SELECT count(*) FROM broadcast_recipients WHERE broadcast_id = b.id AND status = 'failed') AS failed_count,
       (SELECT count(*) FROM broadcast_recipients WHERE broadcast_id = b.id) AS total_count
     FROM broadcasts b
     JOIN whatsapp_channels wc ON wc.id = b.channel_id
     WHERE b.id = $1 AND wc.organization_id = $2`,
    [req.params.id, req.auth!.organizationId]
  );
  if (!rows[0]) return res.status(404).json({ error: "Broadcast tidak ditemukan" });
  res.json(rows[0]);
});
