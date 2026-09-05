import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool";
import { requireAuth, type AuthedRequest } from "../middleware/auth";

export const followupsRouter = Router();

const FOLLOWUP_STATUSES = ["scheduled", "sent", "cancelled", "failed"] as const;

const listQuerySchema = z.object({
  status: z.enum(FOLLOWUP_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * F-25 s/d F-28: daftar follow-up berjadwal utk dashboard (halaman
 * "Follow-up") — join secukupnya biar frontend tidak perlu request
 * terpisah per baris utk nama pelanggan/produk.
 */
followupsRouter.get("/followups", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { status, limit, offset } = parsed.data;

  const params: unknown[] = [req.auth!.organizationId];
  const clauses: string[] = ["f.organization_id = $1"];
  if (status) {
    params.push(status);
    clauses.push(`f.status = $${params.length}`);
  }
  const where = clauses.join(" AND ");

  const { rows: countRows } = await pool.query(`SELECT count(*) FROM follow_ups f WHERE ${where}`, params);
  const total = Number(countRows[0].count);

  const listParams = [...params, limit, offset];
  const { rows } = await pool.query(
    `SELECT f.id, f.conversation_id, f.channel_id, f.attempt, f.scheduled_at, f.status,
            f.sent_at, f.message_text, f.cancel_reason, f.created_at,
            ct.name AS contact_name, ct.wa_number AS contact_wa_number,
            p.name AS product_name, wc.label AS channel_label
     FROM follow_ups f
     JOIN conversations conv ON conv.id = f.conversation_id
     JOIN contacts ct ON ct.id = conv.contact_id
     LEFT JOIN products p ON p.id = conv.product_id
     LEFT JOIN whatsapp_channels wc ON wc.id = f.channel_id
     WHERE ${where}
     ORDER BY f.scheduled_at DESC
     LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams
  );

  res.json({ items: rows, total, limit, offset });
});

/**
 * Batalkan satu follow-up yang masih terjadwal (mis. CS sudah menghubungi
 * pelanggan secara manual, jadi follow-up otomatis tidak perlu lagi dikirim).
 * Cuma bisa membatalkan baris yang statusnya masih 'scheduled' — baris yang
 * sudah 'sent'/'cancelled'/'failed' dibiarkan apa adanya (riwayat).
 */
followupsRouter.post("/followups/:id/cancel", requireAuth, async (req: AuthedRequest, res) => {
  const { rows } = await pool.query(
    `UPDATE follow_ups
     SET status = 'cancelled', cancel_reason = 'dibatalkan_manual_dari_dashboard'
     WHERE id = $1 AND organization_id = $2 AND status = 'scheduled'
     RETURNING id, conversation_id, channel_id, attempt, scheduled_at, status, cancel_reason`,
    [req.params.id, req.auth!.organizationId]
  );

  if (!rows[0]) {
    return res.status(404).json({
      error: "Follow-up tidak ditemukan, atau sudah tidak berstatus 'scheduled' (sudah terkirim/dibatalkan).",
    });
  }
  res.json(rows[0]);
});
