import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool";
import { requireAuth, type AuthedRequest } from "../middleware/auth";

export const statsRouter = Router();

const rangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/**
 * Ringkasan buat dashboard Overview, dengan filter tanggal (Hari ini,
 * Kemarin, Minggu ini, Bulan ini, Custom — dihitung di frontend, endpoint
 * ini cuma terima from/to). Kalau from/to nggak dikirim, defaultnya hari ini.
 */
statsRouter.get("/stats/overview", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = rangeSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const today = new Date().toISOString().slice(0, 10);
  const from = parsed.data.from ?? today;
  const to = parsed.data.to ?? today;
  const organizationId = req.auth!.organizationId;

  const [
    channelsResult,
    productsResult,
    departmentsResult,
    contactsResult,
    conversationsResult,
    openConversationsResult,
    messagesResult,
  ] = await Promise.all([
    pool.query(
      "SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'connected')::int AS connected FROM whatsapp_channels WHERE organization_id = $1",
      [organizationId]
    ),
    pool.query("SELECT COUNT(*)::int AS total FROM products WHERE organization_id = $1", [organizationId]),
    pool.query("SELECT COUNT(*)::int AS total FROM departments WHERE organization_id = $1", [organizationId]),
    pool.query(
      `SELECT COUNT(*)::int AS total FROM contacts
       WHERE organization_id = $1 AND created_at::date BETWEEN $2 AND $3`,
      [organizationId, from, to]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total FROM conversations c
       JOIN whatsapp_channels wc ON wc.id = c.channel_id
       WHERE wc.organization_id = $1 AND c.created_at::date BETWEEN $2 AND $3`,
      [organizationId, from, to]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total FROM conversations c
       JOIN whatsapp_channels wc ON wc.id = c.channel_id
       WHERE wc.organization_id = $1 AND c.status = 'open' AND c.created_at::date BETWEEN $2 AND $3`,
      [organizationId, from, to]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       JOIN whatsapp_channels wc ON wc.id = c.channel_id
       WHERE wc.organization_id = $1 AND m.direction = 'outbound' AND m.created_at::date BETWEEN $2 AND $3`,
      [organizationId, from, to]
    ),
  ]);

  res.json({
    range: { from, to },
    channels: channelsResult.rows[0].total,
    channelsConnected: channelsResult.rows[0].connected,
    products: productsResult.rows[0].total,
    departments: departmentsResult.rows[0].total,
    contacts: contactsResult.rows[0].total,
    conversations: conversationsResult.rows[0].total,
    openConversations: openConversationsResult.rows[0].total,
    messagesSent: messagesResult.rows[0].total,
  });
});
