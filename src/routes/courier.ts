import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool";
import { requireAuth, requireOwnerOrAdmin, type AuthedRequest } from "../middleware/auth";
import { pollCourierMailbox } from "../courier/emailReader";
import { mapStatusKeyword } from "../courier/parser";
import { applyCourierStatusToOrder, type OrderForCourierSync } from "../courier/orderSync";
import { SHIPPING_STATUSES } from "./orders";

export const courierRouter = Router();

// Jalankan pembacaan kotak masuk kurir satu kali on-demand (dashboard punya
// tombol "Cek Email Kurir Sekarang"). Nantinya bisa juga dipanggil scheduler
// berkala — lihat src/courier/emailReader.ts untuk detail cara kerjanya.
courierRouter.post("/courier/poll", requireAuth, requireOwnerOrAdmin, async (req: AuthedRequest, res) => {
  const result = await pollCourierMailbox(req.auth!.organizationId);
  res.json(result);
});

// Riwayat courier_events terakhir untuk organisasi ini — dipakai dashboard
// buat lihat email/webhook kurir apa saja yang sudah masuk & tercocok/belum.
const listCourierEventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

courierRouter.get("/courier/events", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = listCourierEventsQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { rows } = await pool.query(
    `SELECT ce.*, o.customer_name, o.customer_phone
     FROM courier_events ce
     LEFT JOIN orders o ON o.id = ce.order_id
     WHERE ce.organization_id = $1
     ORDER BY ce.created_at DESC
     LIMIT $2`,
    [req.auth!.organizationId, parsed.data.limit]
  );
  res.json({ items: rows });
});

// ============================================================================
// Webhook kurir (untuk masa depan — belum ada kurir yang benar-benar kita
// pasangi webhook-nya, endpoint ini disiapkan lebih dulu). TANPA JWT (kurir
// pihak ketiga tidak bisa login ke dashboard kita), jadi diamankan pakai
// token rahasia sederhana dari query (?token=) atau header (x-webhook-secret)
// yang harus cocok dengan env var COURIER_WEBHOOK_SECRET. Kalau env var itu
// belum diisi, endpoint MENOLAK SEMUA request (aman by default) daripada
// diam-diam menerima apa saja tanpa proteksi.
// ============================================================================
function verifyWebhookToken(req: AuthedRequest): boolean {
  const expected = process.env.COURIER_WEBHOOK_SECRET;
  if (!expected) return false;

  const provided = (req.query.token as string | undefined) ?? req.get("x-webhook-secret") ?? "";
  if (!provided) return false;

  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  // Panjang beda -> pasti tidak cocok, dan timingSafeEqual melempar kalau
  // panjang buffer beda, jadi harus dicek manual dulu sebelum dipanggil.
  if (expectedBuf.length !== providedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

const webhookBodySchema = z.object({
  trackingNo: z.string().trim().min(1),
  status: z.string().trim().min(1),
  courier: z.string().trim().min(1).optional(),
  eventId: z.string().trim().min(1).optional(),
});

courierRouter.post("/courier/webhook/:organizationId", async (req: AuthedRequest, res) => {
  if (!verifyWebhookToken(req)) {
    return res.status(401).json({ error: "Token webhook tidak valid" });
  }

  const organizationId = req.params.organizationId;
  if (!z.string().uuid().safeParse(organizationId).success) {
    return res.status(400).json({ error: "organizationId tidak valid" });
  }

  const parsed = webhookBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { trackingNo, status, courier, eventId } = parsed.data;

  const mappedStatus = (SHIPPING_STATUSES as readonly string[]).includes(status)
    ? (status as (typeof SHIPPING_STATUSES)[number])
    : mapStatusKeyword(status);

  const { rows: orderRows } = await pool.query<OrderForCourierSync>(
    `SELECT id, shipping_status, has_problem FROM orders WHERE organization_id = $1 AND tracking_no = $2`,
    [organizationId, trackingNo]
  );
  const order = orderRows[0] ?? null;

  const { rows: inserted } = await pool.query<{ id: string }>(
    `INSERT INTO courier_events
       (organization_id, courier, tracking_no, raw_status, mapped_status, source, source_ref, order_id)
     VALUES ($1, $2, $3, $4, $5, 'webhook', $6, $7)
     ON CONFLICT (organization_id, source, source_ref) WHERE source_ref IS NOT NULL DO NOTHING
     RETURNING id`,
    [organizationId, courier ?? null, trackingNo, status, mappedStatus, eventId ?? null, order?.id ?? null]
  );

  if (!inserted[0]) {
    // eventId ini sudah pernah diproses sebelumnya (unique index courier_events).
    return res.json({ ok: true, duplicate: true });
  }

  if (order && mappedStatus) {
    await applyCourierStatusToOrder(order, mappedStatus, status, "courier_webhook");
    await pool.query("UPDATE courier_events SET processed_at = now() WHERE id = $1", [inserted[0].id]);
  }

  res.json({ ok: true, matched: Boolean(order), mappedStatus: mappedStatus ?? null });
});
