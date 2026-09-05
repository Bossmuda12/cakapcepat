import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool";
import { requireAuth, requireOwnerOrAdmin, type AuthedRequest } from "../middleware/auth";
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

// P-31: from/to sebelumnya z.string().optional() polos (tidak divalidasi
// formatnya) — diselaraskan dengan pola yang sudah dipakai di
// routes/stats.ts (regex YYYY-MM-DD), supaya tanggal yang salah format
// dibalas 400 yang jelas, bukan error Postgres mentah kalau lolos ke query.
const listQuerySchema = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  // Filter tambahan: saring lewat conversations.product_id (produk yang
  // dijual lewat nomor WA percakapan ini).
  productId: z.string().uuid().optional(),
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
  if (query.productId) {
    params.push(query.productId);
    clauses.push(`conv.product_id = $${params.length}`);
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

// ============================================================================
// F-11/F-13/F-14/F-18: CRUD Pesanan sungguhan (tabel `orders`), TERPISAH dari
// order_status di atas yang menempel ke `conversations` (endpoint lama biar
// dashboard lama tidak rusak). Tabel `orders` punya data pembeli, alamat,
// produk/varian, kurir & resi — inilah yang bisa dicocokkan ke email kurir.
// ============================================================================

// Label A: hasil CHAT (apakah closing/spam/dst). SENGAJA tidak ada "returned"
// di sini lagi (versi lama order_status di atas masih punya, demi kompatibel
// endpoint lama) — retur sekarang murni status PENGIRIMAN, lihat di bawah.
export const SALES_STATUSES = [
  "qualified_cod",
  "closing",
  "cancelled",
  "spam",
  "no_response",
  "cs_blocked",
] as const;
export type SalesStatus = (typeof SALES_STATUSES)[number];

// Label B: hasil PENGIRIMAN paket (dipantau lewat email/webhook kurir).
export const SHIPPING_STATUSES = [
  "pending",
  "packed",
  "handed_to_courier",
  "in_transit",
  "problem",
  "rescheduled",
  "delivered",
  "returned",
] as const;
export type ShippingStatus = (typeof SHIPPING_STATUSES)[number];

// KENAPA sales_status & shipping_status dipisah jadi DUA kolom/enum sendiri
// (bukan satu status gabungan): satu pesanan bisa "closing" (chat CS sudah
// tuntas, uang closing) SEKALIGUS "returned" (paket balik di jalan karena
// customer tidak ada di rumah / COD ditolak kurir). Kalau digabung jadi satu
// status, angka "closing" akan turun tiap kali ada retur — padahal buat
// laporan bisnis COD, closing tetap closing (CS-nya berhasil), retur adalah
// masalah LOGISTIK yang terpisah. Memisahkannya juga yang membuat "tingkat
// retur" (returned / closing, lihat GET /orders/stats) bisa dihitung dengan
// benar: pembilang & penyebutnya dua hal yang berbeda.

function productBelongsToOrg(productId: string, organizationId: string) {
  return pool
    .query("SELECT 1 FROM products WHERE id = $1 AND organization_id = $2", [productId, organizationId])
    .then((r) => Boolean(r.rows[0]));
}

function variantBelongsToProduct(variantId: string, productId: string, organizationId: string) {
  return pool
    .query(
      `SELECT 1 FROM product_variants v
       JOIN products p ON p.id = v.product_id
       WHERE v.id = $1 AND v.product_id = $2 AND p.organization_id = $3`,
      [variantId, productId, organizationId]
    )
    .then((r) => Boolean(r.rows[0]));
}

// Bangun klausa SET dinamis dari sebuah objek {kolom: nilai} — kolom yang
// nilainya `undefined` (field tidak dikirim di body) DILEWATI (tidak diubah),
// tapi kolom yang nilainya `null` eksplisit TETAP ditulis (mis. mengosongkan
// product_id/variant_id/notes). Ini beda dengan pola COALESCE($x, kolom) yang
// dipakai di endpoint lama (products.ts/departments.ts) — COALESCE tidak bisa
// dipakai untuk "sengaja mengosongkan" sebuah kolom.
function buildDynamicSet(colMap: Record<string, unknown>, paramsSoFar: unknown[] = []) {
  const setParts: string[] = [];
  const params = [...paramsSoFar];
  for (const [col, val] of Object.entries(colMap)) {
    if (val === undefined) continue;
    params.push(val);
    setParts.push(`${col} = $${params.length}`);
  }
  return { setSql: setParts.join(", "), params };
}

// Kolom yang dikembalikan untuk daftar/detail pesanan, plus nama produk & varian
// (dipakai frontend biar tidak perlu request terpisah per baris).
const ORDER_LIST_SELECT = `
  SELECT o.*, p.name AS product_name, v.name AS variant_name
  FROM orders o
  LEFT JOIN products p ON p.id = o.product_id
  LEFT JOIN product_variants v ON v.id = o.variant_id
`;

const ordersListQuerySchema = z.object({
  salesStatus: z.enum(SALES_STATUSES).optional(),
  shippingStatus: z.enum(SHIPPING_STATUSES).optional(),
  hasProblem: z.enum(["true", "false"]).optional(),
  productId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  courier: z.string().trim().min(1).optional(),
  // Cari nama pembeli, nomor HP, atau nomor resi sekaligus.
  q: z.string().trim().min(1).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

function buildOrdersListFilter(organizationId: string, f: z.infer<typeof ordersListQuerySchema>) {
  const params: unknown[] = [organizationId];
  const clauses: string[] = ["o.organization_id = $1"];

  if (f.salesStatus) {
    params.push(f.salesStatus);
    clauses.push(`o.sales_status = $${params.length}`);
  }
  if (f.shippingStatus) {
    params.push(f.shippingStatus);
    clauses.push(`o.shipping_status = $${params.length}`);
  }
  if (f.hasProblem !== undefined) {
    params.push(f.hasProblem === "true");
    clauses.push(`o.has_problem = $${params.length}`);
  }
  if (f.productId) {
    params.push(f.productId);
    clauses.push(`o.product_id = $${params.length}`);
  }
  if (f.categoryId) {
    params.push(f.categoryId);
    clauses.push(`p.category_id = $${params.length}`);
  }
  if (f.courier) {
    params.push(`%${f.courier}%`);
    clauses.push(`o.courier ILIKE $${params.length}`);
  }
  if (f.q) {
    params.push(`%${f.q}%`);
    clauses.push(
      `(o.customer_name ILIKE $${params.length} OR o.customer_phone ILIKE $${params.length} OR o.tracking_no ILIKE $${params.length})`
    );
  }
  if (f.from && f.to) {
    params.push(f.from, f.to);
    clauses.push(`o.created_at::date BETWEEN $${params.length - 1} AND $${params.length}`);
  }

  return { where: clauses.join(" AND "), params };
}

// Daftar pesanan sungguhan (tabel `orders`) — dipakai halaman "Pesanan" yang
// baru. Beda dengan GET /orders lama di atas (itu daftar dari conversations).
ordersRouter.get("/orders/list", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = ordersListQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { limit, offset } = parsed.data;

  const { where, params } = buildOrdersListFilter(req.auth!.organizationId, parsed.data);

  const { rows: countRows } = await pool.query(
    `SELECT count(*) FROM orders o LEFT JOIN products p ON p.id = o.product_id WHERE ${where}`,
    params
  );
  const total = Number(countRows[0].count);

  const listParams = [...params, limit, offset];
  const { rows } = await pool.query(
    `${ORDER_LIST_SELECT} WHERE ${where}
     ORDER BY o.created_at DESC
     LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams
  );

  res.json({ items: rows, total, limit, offset });
});

// Buat pesanan manual (mis. dicatat langsung oleh CS tanpa lewat alur AI closing).
const createOrderSchema = z.object({
  conversationId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  channelId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
  variantId: z.string().uuid().optional(),
  customerName: z.string().trim().min(1).optional(),
  customerPhone: z.string().trim().min(1).optional(),
  addressLine: z.string().optional(),
  postcode: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  quantity: z.number().int().min(1).default(1),
  unitPriceCents: z.number().int().nonnegative().optional(),
  totalCents: z.number().int().nonnegative().optional(),
  currency: z.string().trim().min(1).optional(),
  salesStatus: z.enum(SALES_STATUSES).optional(),
  shippingStatus: z.enum(SHIPPING_STATUSES).optional(),
  notes: z.string().optional(),
});

ordersRouter.post("/orders", requireAuth, requireOwnerOrAdmin, async (req: AuthedRequest, res) => {
  const parsed = createOrderSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const d = parsed.data;
  const organizationId = req.auth!.organizationId;

  if (d.productId && !(await productBelongsToOrg(d.productId, organizationId))) {
    return res.status(400).json({ error: "productId tidak ditemukan di organisasi ini" });
  }
  if (d.variantId) {
    if (!d.productId) return res.status(400).json({ error: "variantId perlu disertai productId" });
    if (!(await variantBelongsToProduct(d.variantId, d.productId, organizationId))) {
      return res.status(400).json({ error: "variantId tidak cocok dengan productId di organisasi ini" });
    }
  }

  const { rows } = await pool.query(
    `INSERT INTO orders
       (organization_id, conversation_id, contact_id, channel_id, product_id, variant_id,
        customer_name, customer_phone, address_line, postcode, city, state, country,
        quantity, unit_price_cents, total_cents, currency, sales_status, shipping_status,
        notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
     RETURNING *`,
    [
      organizationId,
      d.conversationId ?? null,
      d.contactId ?? null,
      d.channelId ?? null,
      d.productId ?? null,
      d.variantId ?? null,
      d.customerName ?? null,
      d.customerPhone ?? null,
      d.addressLine ?? null,
      d.postcode ?? null,
      d.city ?? null,
      d.state ?? null,
      d.country ?? "MY",
      d.quantity ?? 1,
      d.unitPriceCents ?? null,
      d.totalCents ?? null,
      d.currency ?? "MYR",
      d.salesStatus ?? "closing",
      d.shippingStatus ?? "pending",
      d.notes ?? null,
      req.auth!.userId,
    ]
  );
  res.status(201).json(rows[0]);
});

// Sunting data pembeli/alamat/produk/jumlah/harga — BUKAN status (status
// pengiriman/COD punya endpoint sendiri di bawah, supaya perubahannya selalu
// tercatat ke order_events).
const updateOrderSchema = z.object({
  customerName: z.string().trim().min(1).optional(),
  customerPhone: z.string().trim().min(1).optional(),
  addressLine: z.string().nullable().optional(),
  postcode: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  country: z.string().optional(),
  productId: z.string().uuid().nullable().optional(),
  variantId: z.string().uuid().nullable().optional(),
  quantity: z.number().int().min(1).optional(),
  unitPriceCents: z.number().int().nonnegative().nullable().optional(),
  totalCents: z.number().int().nonnegative().nullable().optional(),
  currency: z.string().trim().min(1).optional(),
  notes: z.string().nullable().optional(),
});

ordersRouter.patch("/orders/:id", requireAuth, requireOwnerOrAdmin, async (req: AuthedRequest, res) => {
  const parsed = updateOrderSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const d = parsed.data;
  const organizationId = req.auth!.organizationId;

  const { rows: existingRows } = await pool.query(
    "SELECT id, product_id FROM orders WHERE id = $1 AND organization_id = $2",
    [req.params.id, organizationId]
  );
  if (!existingRows[0]) return res.status(404).json({ error: "Pesanan tidak ditemukan" });

  // "productId" in d membedakan "field tidak dikirim" vs "sengaja dikirim null"
  // (lihat komentar buildDynamicSet) — dipakai untuk tahu produk mana yang
  // berlaku SETELAH update ini, buat validasi variantId di bawah.
  const effectiveProductId = "productId" in d ? d.productId : existingRows[0].product_id;

  if (d.productId && !(await productBelongsToOrg(d.productId, organizationId))) {
    return res.status(400).json({ error: "productId tidak ditemukan di organisasi ini" });
  }
  if (d.variantId) {
    if (!effectiveProductId) return res.status(400).json({ error: "variantId perlu disertai productId" });
    if (!(await variantBelongsToProduct(d.variantId, effectiveProductId, organizationId))) {
      return res.status(400).json({ error: "variantId tidak cocok dengan productId di organisasi ini" });
    }
  }

  const { setSql, params } = buildDynamicSet({
    customer_name: d.customerName,
    customer_phone: d.customerPhone,
    address_line: d.addressLine,
    postcode: d.postcode,
    city: d.city,
    state: d.state,
    country: d.country,
    product_id: d.productId,
    variant_id: d.variantId,
    quantity: d.quantity,
    unit_price_cents: d.unitPriceCents,
    total_cents: d.totalCents,
    currency: d.currency,
    notes: d.notes,
  });
  if (!setSql) return res.status(400).json({ error: "Tidak ada field yang diubah" });

  params.push(req.params.id, organizationId);
  const { rows } = await pool.query(
    `UPDATE orders SET ${setSql}, updated_at = now()
     WHERE id = $${params.length - 1} AND organization_id = $${params.length}
     RETURNING *`,
    params
  );
  res.json(rows[0]);
});

// Ubah status PENGIRIMAN (+kurir/resi/bendera bermasalah). Setiap field yang
// benar-benar berubah dicatat ke order_events (field, old_value, new_value,
// source='manual', actor_user_id) — ini yang membuat riwayat status pesanan
// bisa diaudit/dilaporkan, sama seperti order_status_events versi lama.
const updateShippingSchema = z.object({
  shippingStatus: z.enum(SHIPPING_STATUSES).optional(),
  courier: z.string().trim().min(1).nullable().optional(),
  trackingNo: z.string().trim().min(1).nullable().optional(),
  hasProblem: z.boolean().optional(),
  problemReason: z.string().nullable().optional(),
});

ordersRouter.patch("/orders/:id/shipping", requireAuth, requireOwnerOrAdmin, async (req: AuthedRequest, res) => {
  const parsed = updateShippingSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const d = parsed.data;
  const organizationId = req.auth!.organizationId;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: existingRows } = await client.query(
      "SELECT * FROM orders WHERE id = $1 AND organization_id = $2 FOR UPDATE",
      [req.params.id, organizationId]
    );
    const existing = existingRows[0];
    if (!existing) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Pesanan tidak ditemukan" });
    }

    const next = {
      shippingStatus: d.shippingStatus ?? existing.shipping_status,
      courier: "courier" in d ? d.courier : existing.courier,
      trackingNo: "trackingNo" in d ? d.trackingNo : existing.tracking_no,
      hasProblem: d.hasProblem ?? existing.has_problem,
      problemReason: "problemReason" in d ? d.problemReason : existing.problem_reason,
    };

    // idx_orders_tracking: satu resi cuma boleh dipakai satu pesanan per organisasi.
    if (next.trackingNo && next.trackingNo !== existing.tracking_no) {
      const { rows: dupRows } = await client.query(
        "SELECT id FROM orders WHERE organization_id = $1 AND tracking_no = $2 AND id <> $3",
        [organizationId, next.trackingNo, req.params.id]
      );
      if (dupRows[0]) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "Nomor resi ini sudah dipakai pesanan lain" });
      }
    }

    const { rows: updatedRows } = await client.query(
      `UPDATE orders SET
         shipping_status = $1,
         courier = $2,
         tracking_no = $3,
         has_problem = $4,
         problem_reason = $5,
         problem_at = CASE WHEN $4 AND problem_at IS NULL THEN now() ELSE problem_at END,
         shipped_at = CASE WHEN $1 IN ('handed_to_courier','in_transit','delivered') AND shipped_at IS NULL
                        THEN now() ELSE shipped_at END,
         delivered_at = CASE WHEN $1 = 'delivered' AND delivered_at IS NULL THEN now() ELSE delivered_at END,
         returned_at = CASE WHEN $1 = 'returned' AND returned_at IS NULL THEN now() ELSE returned_at END,
         updated_at = now()
       WHERE id = $6 AND organization_id = $7
       RETURNING *`,
      [next.shippingStatus, next.courier, next.trackingNo, next.hasProblem, next.problemReason, req.params.id, organizationId]
    );

    const actorUserId = req.auth!.userId;
    const eventsToLog: Array<{ field: string; oldValue: string | null; newValue: string | null }> = [];
    if (next.shippingStatus !== existing.shipping_status) {
      eventsToLog.push({ field: "shipping_status", oldValue: existing.shipping_status, newValue: next.shippingStatus });
    }
    if (next.courier !== existing.courier) {
      eventsToLog.push({ field: "courier", oldValue: existing.courier, newValue: next.courier });
    }
    if (next.trackingNo !== existing.tracking_no) {
      eventsToLog.push({ field: "tracking_no", oldValue: existing.tracking_no, newValue: next.trackingNo });
    }
    if (next.hasProblem !== existing.has_problem) {
      eventsToLog.push({ field: "has_problem", oldValue: String(existing.has_problem), newValue: String(next.hasProblem) });
    }
    for (const ev of eventsToLog) {
      await client.query(
        `INSERT INTO order_events (order_id, field, old_value, new_value, source, actor_user_id, note)
         VALUES ($1, $2, $3, $4, 'manual', $5, $6)`,
        [req.params.id, ev.field, ev.oldValue, ev.newValue, actorUserId, next.problemReason ?? null]
      );
    }

    await client.query("COMMIT");
    broadcastToOrg(organizationId, { type: "order_shipping", orderId: req.params.id });
    res.json(updatedRows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
});

// F-18: tandai penerimaan uang COD (rekonsiliasi kurir vs kas masuk).
const updateCodSchema = z.object({
  codReceived: z.boolean(),
  codAmountCents: z.number().int().nonnegative().nullable().optional(),
  codReceivedAt: z.string().datetime().nullable().optional(),
});

ordersRouter.patch("/orders/:id/cod", requireAuth, requireOwnerOrAdmin, async (req: AuthedRequest, res) => {
  const parsed = updateCodSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { codReceived, codAmountCents, codReceivedAt } = parsed.data;
  const organizationId = req.auth!.organizationId;

  const { rows: existingRows } = await pool.query(
    "SELECT id, cod_received FROM orders WHERE id = $1 AND organization_id = $2",
    [req.params.id, organizationId]
  );
  if (!existingRows[0]) return res.status(404).json({ error: "Pesanan tidak ditemukan" });

  const { rows } = await pool.query(
    `UPDATE orders SET
       cod_received = $1,
       cod_amount_cents = COALESCE($2, cod_amount_cents),
       cod_received_at = CASE
         WHEN $1 = false THEN NULL
         WHEN $3::timestamptz IS NOT NULL THEN $3::timestamptz
         WHEN cod_received_at IS NULL THEN now()
         ELSE cod_received_at
       END,
       updated_at = now()
     WHERE id = $4 AND organization_id = $5
     RETURNING *`,
    [codReceived, codAmountCents ?? null, codReceivedAt ?? null, req.params.id, organizationId]
  );

  await pool.query(
    `INSERT INTO order_events (order_id, field, old_value, new_value, source, actor_user_id)
     VALUES ($1, 'cod_received', $2, $3, 'manual', $4)`,
    [req.params.id, String(existingRows[0].cod_received), String(codReceived), req.auth!.userId]
  );

  res.json(rows[0]);
});

ordersRouter.delete("/orders/:id", requireAuth, requireOwnerOrAdmin, async (req: AuthedRequest, res) => {
  const { rowCount } = await pool.query("DELETE FROM orders WHERE id = $1 AND organization_id = $2", [
    req.params.id,
    req.auth!.organizationId,
  ]);
  if (!rowCount) return res.status(404).json({ error: "Pesanan tidak ditemukan" });
  res.json({ ok: true });
});

// Impor massal resi dari CSV (mis. hasil export dari sistem kurir/marketplace).
// Dicocokkan ke pesanan lewat order_id (paling akurat) atau customer_phone
// (fallback — ambil pesanan TERBARU milik nomor itu yang BELUM punya resi).
// Baris yang gagal dicocokkan dilaporkan balik, tidak membuat request gagal.
const importTrackingItemSchema = z.object({
  trackingNo: z.string().trim().min(1),
  orderId: z.string().uuid().optional(),
  customerPhone: z.string().trim().min(1).optional(),
  courier: z.string().trim().min(1).optional(),
});
const importTrackingSchema = z.array(importTrackingItemSchema).min(1).max(1000);

ordersRouter.post("/orders/import-tracking", requireAuth, requireOwnerOrAdmin, async (req: AuthedRequest, res) => {
  const parsed = importTrackingSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const organizationId = req.auth!.organizationId;

  const updated: Array<{ orderId: string; trackingNo: string }> = [];
  const failed: Array<{ row: z.infer<typeof importTrackingItemSchema>; reason: string }> = [];

  for (const item of parsed.data) {
    if (!item.orderId && !item.customerPhone) {
      failed.push({ row: item, reason: "Perlu orderId atau customerPhone untuk mencocokkan" });
      continue;
    }

    let orderRow: { id: string } | undefined;
    if (item.orderId) {
      const { rows } = await pool.query("SELECT id FROM orders WHERE id = $1 AND organization_id = $2", [
        item.orderId,
        organizationId,
      ]);
      orderRow = rows[0];
      if (!orderRow) {
        failed.push({ row: item, reason: "orderId tidak ditemukan" });
        continue;
      }
    } else {
      const { rows } = await pool.query(
        `SELECT id FROM orders
         WHERE organization_id = $1 AND customer_phone = $2 AND tracking_no IS NULL
         ORDER BY created_at DESC LIMIT 1`,
        [organizationId, item.customerPhone]
      );
      orderRow = rows[0];
      if (!orderRow) {
        failed.push({ row: item, reason: "Tidak ada pesanan tanpa resi yang cocok dengan customerPhone ini" });
        continue;
      }
    }

    const { rows: dupRows } = await pool.query(
      "SELECT id FROM orders WHERE organization_id = $1 AND tracking_no = $2 AND id <> $3",
      [organizationId, item.trackingNo, orderRow.id]
    );
    if (dupRows[0]) {
      failed.push({ row: item, reason: "Nomor resi ini sudah dipakai pesanan lain" });
      continue;
    }

    const { rows: updatedRows } = await pool.query(
      `UPDATE orders SET
         tracking_no = $1,
         courier = COALESCE($2, courier),
         shipped_at = COALESCE(shipped_at, now()),
         shipping_status = CASE WHEN shipping_status IN ('pending', 'packed') THEN 'handed_to_courier' ELSE shipping_status END,
         updated_at = now()
       WHERE id = $3 AND organization_id = $4
       RETURNING id, tracking_no`,
      [item.trackingNo, item.courier ?? null, orderRow.id, organizationId]
    );

    await pool.query(
      `INSERT INTO order_events (order_id, field, old_value, new_value, source, actor_user_id, note)
       VALUES ($1, 'tracking_no', NULL, $2, 'manual', $3, 'Impor massal resi CSV')`,
      [orderRow.id, item.trackingNo, req.auth!.userId]
    );

    updated.push({ orderId: updatedRows[0].id, trackingNo: updatedRows[0].tracking_no });
  }

  res.json({ updated, failed, totalRows: parsed.data.length });
});

// F-24: ringkasan per produk — closing/delivered/returned + tingkat retur.
// Angka ini penting buat bisnis COD: produk dengan tingkat retur tinggi
// biasanya berarti target iklannya kurang tepat atau harga COD kemahalan.
const ordersStatsQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  categoryId: z.string().uuid().optional(),
});

ordersRouter.get("/orders/stats", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = ordersStatsQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { from, to, categoryId } = parsed.data;
  const organizationId = req.auth!.organizationId;

  const params: unknown[] = [organizationId];
  const clauses = ["o.organization_id = $1"];
  if (from && to) {
    params.push(from, to);
    clauses.push(`o.created_at::date BETWEEN $${params.length - 1} AND $${params.length}`);
  }
  if (categoryId) {
    params.push(categoryId);
    clauses.push(`p.category_id = $${params.length}`);
  }
  const where = clauses.join(" AND ");

  const { rows } = await pool.query(
    `SELECT o.product_id, p.name AS product_name,
       count(*) AS total_orders,
       count(*) FILTER (WHERE o.sales_status = 'closing') AS closing_count,
       count(*) FILTER (WHERE o.shipping_status = 'delivered') AS delivered_count,
       count(*) FILTER (WHERE o.shipping_status = 'returned') AS returned_count
     FROM orders o
     LEFT JOIN products p ON p.id = o.product_id
     WHERE ${where}
     GROUP BY o.product_id, p.name
     ORDER BY p.name NULLS LAST`,
    params
  );

  const byProduct = rows.map((r) => {
    const closing = Number(r.closing_count);
    const delivered = Number(r.delivered_count);
    const returned = Number(r.returned_count);
    return {
      productId: r.product_id,
      productName: r.product_name ?? "(Tanpa produk)",
      totalOrders: Number(r.total_orders),
      closingCount: closing,
      deliveredCount: delivered,
      returnedCount: returned,
      // Tingkat retur = returned / closing (BUKAN returned / total_orders) —
      // yang relevan buat bisnis COD adalah "dari order yang closing, berapa
      // persen balik retur", bukan dibandingkan ke order yang memang belum
      // pernah closing (spam/cancelled/no_response).
      returnRate: closing > 0 ? Number((returned / closing).toFixed(4)) : null,
    };
  });

  const overall = byProduct.reduce(
    (acc, r) => {
      acc.totalOrders += r.totalOrders;
      acc.closingCount += r.closingCount;
      acc.deliveredCount += r.deliveredCount;
      acc.returnedCount += r.returnedCount;
      return acc;
    },
    { totalOrders: 0, closingCount: 0, deliveredCount: 0, returnedCount: 0 }
  );

  res.json({
    byProduct,
    overall: {
      ...overall,
      returnRate: overall.closingCount > 0 ? Number((overall.returnedCount / overall.closingCount).toFixed(4)) : null,
    },
  });
});
