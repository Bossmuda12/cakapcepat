import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool";
import { requireAuth, requireOwnerOrAdmin, type AuthedRequest } from "../middleware/auth";

// ============================================================================
// F-KATEGORI: Varian produk (mis. "50ml"/"100ml", "Saiz S/M/L") — lapis
// paling bawah dari Kategori > Produk > Varian. Setiap varian menempel ke
// SATU produk (product_variants.product_id), jadi tiap endpoint di sini
// WAJIB memverifikasi produk itu benar-benar milik organisasi pemanggil
// sebelum membaca/menulis variannya — kalau tidak, user organisasi A bisa
// menyunting varian produk milik organisasi B asal tahu UUID-nya.
// ============================================================================

export const variantsRouter = Router();

const listVariantsQuerySchema = z.object({
  productId: z.string().uuid().optional(),
});

// Tanpa ?productId: daftar semua varian dari semua produk organisasi ini.
// Dengan ?productId: daftar varian produk itu saja (dan produknya divalidasi
// harus milik organisasi ini lewat JOIN, bukan cuma dipercaya dari query).
variantsRouter.get("/variants", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = listVariantsQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const params: unknown[] = [req.auth!.organizationId];
  let productClause = "";
  if (parsed.data.productId) {
    params.push(parsed.data.productId);
    productClause = `AND p.id = $${params.length}`;
  }

  const { rows } = await pool.query(
    `SELECT v.id, v.product_id, v.name, v.price_cents, v.sku, v.stock, v.is_active, v.created_at
     FROM product_variants v
     JOIN products p ON p.id = v.product_id
     WHERE p.organization_id = $1 ${productClause}
     ORDER BY v.created_at`,
    params
  );
  res.json(rows);
});

const createVariantSchema = z.object({
  productId: z.string().uuid(),
  name: z.string().trim().min(1),
  priceCents: z.number().int().nonnegative().optional(),
  sku: z.string().trim().min(1).optional(),
  stock: z.number().int().nonnegative().optional(),
  isActive: z.boolean().optional(),
});

variantsRouter.post("/variants", requireAuth, requireOwnerOrAdmin, async (req: AuthedRequest, res) => {
  const parsed = createVariantSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const d = parsed.data;

  const { rows: productRows } = await pool.query("SELECT id FROM products WHERE id = $1 AND organization_id = $2", [
    d.productId,
    req.auth!.organizationId,
  ]);
  if (!productRows[0]) return res.status(404).json({ error: "Produk tidak ditemukan di organisasi ini" });

  const { rows } = await pool.query(
    `INSERT INTO product_variants (product_id, name, price_cents, sku, stock, is_active)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, product_id, name, price_cents, sku, stock, is_active, created_at`,
    [d.productId, d.name, d.priceCents ?? null, d.sku ?? null, d.stock ?? null, d.isActive ?? true]
  );
  res.status(201).json(rows[0]);
});

const updateVariantSchema = z.object({
  name: z.string().trim().min(1).optional(),
  priceCents: z.number().int().nonnegative().optional(),
  sku: z.string().trim().min(1).optional(),
  stock: z.number().int().nonnegative().optional(),
  isActive: z.boolean().optional(),
});

variantsRouter.patch("/variants/:id", requireAuth, requireOwnerOrAdmin, async (req: AuthedRequest, res) => {
  const parsed = updateVariantSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const d = parsed.data;

  // UPDATE ... FROM products memastikan kepemilikan (v.product_id -> p.organization_id)
  // dicek DI DALAM query yang sama, bukan lewat SELECT terpisah yang bisa balapan.
  const { rows } = await pool.query(
    `UPDATE product_variants AS v SET
       name = COALESCE($3, v.name),
       price_cents = COALESCE($4, v.price_cents),
       sku = COALESCE($5, v.sku),
       stock = COALESCE($6, v.stock),
       is_active = COALESCE($7, v.is_active)
     FROM products p
     WHERE v.id = $1 AND v.product_id = p.id AND p.organization_id = $2
     RETURNING v.id, v.product_id, v.name, v.price_cents, v.sku, v.stock, v.is_active, v.created_at`,
    [
      req.params.id,
      req.auth!.organizationId,
      d.name ?? null,
      d.priceCents ?? null,
      d.sku ?? null,
      d.stock ?? null,
      d.isActive ?? null,
    ]
  );
  if (!rows[0]) return res.status(404).json({ error: "Varian tidak ditemukan di organisasi ini" });
  res.json(rows[0]);
});

variantsRouter.delete("/variants/:id", requireAuth, requireOwnerOrAdmin, async (req: AuthedRequest, res) => {
  const { rowCount } = await pool.query(
    `DELETE FROM product_variants v
     USING products p
     WHERE v.id = $1 AND v.product_id = p.id AND p.organization_id = $2`,
    [req.params.id, req.auth!.organizationId]
  );
  if (!rowCount) return res.status(404).json({ error: "Varian tidak ditemukan di organisasi ini" });
  res.json({ ok: true });
});
