import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import { reportConversionToMeta } from "../whatsapp/capi";
import { broadcastToOrg } from "../realtime";

export const ordersRouter = Router();

// Status order COD yang bisa ditandai CS/owner. Lihat schema.sql (kolom
// conversations.order_status) & order_status_events untuk riwayatnya.
const ORDER_STATUSES = [
  "qualified_cod",
  "closing",
  "spam",
  "cancelled",
  "returned",
  "no_response", // customer sempat serius tapi berhenti balas (follow-up gagal)
  "cs_blocked", // customer memblokir nomor CS — chat tidak bisa dilanjut sama sekali
] as const;
type OrderStatus = (typeof ORDER_STATUSES)[number];

// Hanya status ini yang dilaporkan ke Meta CAPI:
//  - qualified_cod -> "QualifiedOrder" (custom event, sinyal awal: CS sudah
//    konfirmasi customer serius mau COD, belum tentu closing).
//  - closing       -> "Purchase" (order tuntas/uang diterima).
// spam/cancelled/returned SENGAJA tidak dikirim ke Meta — CAPI tidak punya
// cara resmi "membatalkan" event yang sudah terkirim, jadi order yang balik
// batal/retur cukup dicatat di laporan internal (spreadsheet), bukan
// menambah training signal palsu ke Meta.
const STATUS_TO_CAPI_EVENT: Partial<Record<OrderStatus, string>> = {
  qualified_cod: "QualifiedOrder",
  closing: "Purchase",
};

const orderStatusSchema = z.object({
  status: z.enum(ORDER_STATUSES),
  value: z.number().nonnegative().optional(),
  note: z.string().max(500).optional(),
});

/**
 * Tandai status order COD untuk sebuah percakapan. Ini titik masuk utama
 * fitur "laporan order" yang diminta: closing / spam / qualified COD /
 * cancel / return, otomatis tercatat + (kalau relevan) dilaporkan ke Meta CAPI.
 */
ordersRouter.post("/conversations/:id/order-status", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = orderStatusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { status, value, note } = parsed.data;
  const conversationId = req.params.id;

  const { rows } = await pool.query(
    `SELECT conv.id FROM conversations conv
     JOIN contacts c ON c.id = conv.contact_id
     WHERE conv.id = $1 AND c.organization_id = $2`,
    [conversationId, req.auth!.organizationId]
  );
  if (!rows[0]) return res.status(404).json({ error: "Percakapan tidak ditemukan" });

  await pool.query(
    `UPDATE conversations
     SET order_status = $1, order_value = COALESCE($2, order_value), order_status_updated_at = now()
     WHERE id = $3`,
    [status, value ?? null, conversationId]
  );

  let capiEventName: string | null = null;
  let capiResponseStatus: number | null = null;
  const eventName = STATUS_TO_CAPI_EVENT[status];
  if (eventName) {
    try {
      const result = await reportConversionToMeta({
        conversationId,
        eventName,
        value: status === "closing" ? value : undefined,
        currency: "IDR",
      });
      if (result !== null) {
        capiEventName = eventName;
        // reportConversionToMeta sudah mencatat response_status di ad_conversion_events;
        // di sini kita cuma perlu tahu apakah percobaannya jalan (bukan dilewati karena
        // tidak ada ctwa_clid) supaya bisa ditandai di riwayat order_status_events juga.
        capiResponseStatus = 200;
      }
    } catch (err) {
      console.error("[orders] Gagal lapor CAPI:", err);
      capiResponseStatus = 0;
      capiEventName = eventName;
    }
  }

  await pool.query(
    `INSERT INTO order_status_events
       (conversation_id, status, value, note, changed_by, capi_event_name, capi_response_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [conversationId, status, value ?? null, note ?? null, req.auth!.userId, capiEventName, capiResponseStatus]
  );

  broadcastToOrg(req.auth!.organizationId, { type: "order_status", conversationId });
  res.json({ ok: true, capiReported: Boolean(capiEventName) });
});

const listQuerySchema = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

function buildOrdersQuery(organizationId: string, query: z.infer<typeof listQuerySchema>) {
  const params: unknown[] = [organizationId];
  const clauses: string[] = ["c.organization_id = $1", "conv.order_status IS NOT NULL"];

  if (query.status) {
    params.push(query.status);
    clauses.push(`conv.order_status = $${params.length}`);
  }
  if (query.from && query.to) {
    params.push(query.from, query.to);
    clauses.push(`conv.order_status_updated_at::date BETWEEN $${params.length - 1} AND $${params.length}`);
  }

  return { where: clauses.join(" AND "), params };
}

// Daftar order buat tabel di dashboard (halaman "CTWA & Iklan" / "Laporan Order").
ordersRouter.get("/orders", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { where, params } = buildOrdersQuery(req.auth!.organizationId, parsed.data);
  const { rows } = await pool.query(
    `SELECT conv.id AS conversation_id, conv.order_status, conv.order_value,
            conv.order_status_updated_at, conv.ctwa_clid, conv.ad_source_url,
            c.name AS contact_name, c.wa_number
     FROM conversations conv
     JOIN contacts c ON c.id = conv.contact_id
     WHERE ${where}
     ORDER BY conv.order_status_updated_at DESC NULLS LAST
     LIMIT 300`,
    params
  );
  res.json(rows);
});

// Ringkasan funnel (jumlah order per status + total nilai closing) — dipakai
// kartu ringkasan di dashboard supaya owner bisa pantau langsung tanpa buka
// Meta Ads Manager, mirip funnel "Closing/Hot/Warm/Cold" di tools sejenis.
ordersRouter.get("/orders/summary", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { where, params } = buildOrdersQuery(req.auth!.organizationId, {
    ...parsed.data,
    status: undefined, // ringkasan selalu hitung semua status sekaligus
  });
  const { rows } = await pool.query(
    `SELECT conv.order_status,
            count(*) AS total,
            COALESCE(sum(conv.order_value), 0) AS total_value
     FROM conversations conv
     JOIN contacts c ON c.id = conv.contact_id
     WHERE ${where}
     GROUP BY conv.order_status`,
    params
  );

  const summary: Record<string, { total: number; totalValue: number }> = {};
  for (const s of ORDER_STATUSES) summary[s] = { total: 0, totalValue: 0 };
  for (const r of rows) {
    summary[r.order_status as OrderStatus] = { total: Number(r.total), totalValue: Number(r.total_value) };
  }
  res.json(summary);
});

function csvEscape(value: unknown): string {
  const str = value === null || value === undefined ? "" : String(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

const STATUS_LABEL: Record<OrderStatus, string> = {
  qualified_cod: "Qualified COD",
  closing: "Closing",
  spam: "Spam",
  cancelled: "Cancelled",
  returned: "Returned",
  no_response: "Tidak Respon",
  cs_blocked: "CS Diblokir",
};

// Download laporan lengkap sebagai CSV (buka langsung di Excel/Sheets) —
// ini yang jadi "laporan yang bisa didownload" yang diminta: nama, no HP,
// status (closing/spam/qualified COD/cancel/return), nilai order, sumber
// iklan, status pelaporan ke Meta, dan waktu update terakhir.
ordersRouter.get("/orders/export.csv", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { where, params } = buildOrdersQuery(req.auth!.organizationId, parsed.data);
  const { rows } = await pool.query(
    `SELECT conv.id AS conversation_id, conv.order_status, conv.order_value,
            conv.order_status_updated_at, conv.created_at, conv.ctwa_clid,
            c.name AS contact_name, c.wa_number,
            ev.capi_event_name, ev.capi_response_status, ev.note
     FROM conversations conv
     JOIN contacts c ON c.id = conv.contact_id
     LEFT JOIN LATERAL (
       SELECT capi_event_name, capi_response_status, note
       FROM order_status_events
       WHERE conversation_id = conv.id
       ORDER BY created_at DESC
       LIMIT 1
     ) ev ON true
     WHERE ${where}
     ORDER BY conv.order_status_updated_at DESC NULLS LAST`,
    params
  );

  const header = [
    "Nama Kontak",
    "Nomor WhatsApp",
    "Status Order",
    "Nilai Order (Rp)",
    "Dari Iklan (CTWA)",
    "Dilaporkan ke Meta CAPI",
    "Catatan",
    "Update Terakhir",
    "Dibuat",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    const reported = r.capi_event_name
      ? `${r.capi_event_name} (HTTP ${r.capi_response_status ?? "-"})`
      : "Tidak dilaporkan (internal saja)";
    lines.push(
      [
        csvEscape(r.contact_name || "-"),
        csvEscape(r.wa_number),
        csvEscape(STATUS_LABEL[r.order_status as OrderStatus] ?? r.order_status),
        csvEscape(r.order_value ?? ""),
        csvEscape(r.ctwa_clid ? "Ya" : "Tidak"),
        csvEscape(reported),
        csvEscape(r.note || ""),
        csvEscape(r.order_status_updated_at ? new Date(r.order_status_updated_at).toISOString() : ""),
        csvEscape(r.created_at ? new Date(r.created_at).toISOString() : ""),
      ].join(",")
    );
  }

  const csv = "﻿" + lines.join("\n"); // BOM biar Excel baca UTF-8 dengan benar
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="laporan-order-cakapcepat-${Date.now()}.csv"`);
  res.send(csv);
});
