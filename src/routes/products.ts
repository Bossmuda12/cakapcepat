import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool";
import { requireAuth, requireOwnerOrAdmin, type AuthedRequest } from "../middleware/auth";

export const productsRouter = Router();

async function categoryBelongsToOrg(categoryId: string, organizationId: string): Promise<boolean> {
  const { rows } = await pool.query("SELECT 1 FROM product_categories WHERE id = $1 AND organization_id = $2", [
    categoryId,
    organizationId,
  ]);
  return Boolean(rows[0]);
}

// F-KATEGORI: sekarang ikut kembalikan nama kategori + daftar varian (json_agg)
// per produk, supaya halaman Produk tidak perlu request terpisah per baris.
productsRouter.get("/products", requireAuth, async (req: AuthedRequest, res) => {
  const { rows } = await pool.query(
    `SELECT p.id, p.name, p.description, p.is_active, p.category_id, pc.name AS category_name,
       p.price_cents, p.currency, p.sku, p.image_url, p.created_at,
       (SELECT count(*) FROM whatsapp_channels wc WHERE wc.product_id = p.id) AS channel_count,
       (SELECT COALESCE(json_agg(json_build_object(
          'id', v.id, 'name', v.name, 'priceCents', v.price_cents,
          'sku', v.sku, 'stock', v.stock, 'isActive', v.is_active
        ) ORDER BY v.created_at), '[]'::json)
        FROM product_variants v WHERE v.product_id = p.id) AS variants
     FROM products p
     LEFT JOIN product_categories pc ON pc.id = p.category_id
     WHERE p.organization_id = $1
     ORDER BY p.created_at DESC`,
    [req.auth!.organizationId]
  );
  res.json(rows);
});

const createProductSchema = z.object({
  name: z.string().min(1),
  categoryId: z.string().uuid().optional(),
  description: z.string().optional(),
  priceCents: z.number().int().nonnegative().optional(),
  currency: z.string().trim().min(1).optional(),
  sku: z.string().trim().min(1).optional(),
  imageUrl: z.string().optional(),
});

productsRouter.post("/products", requireAuth, requireOwnerOrAdmin, async (req: AuthedRequest, res) => {
  const parsed = createProductSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const d = parsed.data;

  if (d.categoryId && !(await categoryBelongsToOrg(d.categoryId, req.auth!.organizationId))) {
    return res.status(400).json({ error: "categoryId tidak ditemukan di organisasi ini" });
  }

  const { rows } = await pool.query(
    `INSERT INTO products (organization_id, name, category_id, description, price_cents, currency, sku, image_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, name, is_active, category_id, description, price_cents, currency, sku, image_url, created_at`,
    [
      req.auth!.organizationId,
      d.name,
      d.categoryId ?? null,
      d.description ?? null,
      d.priceCents ?? null,
      d.currency ?? "MYR",
      d.sku ?? null,
      d.imageUrl ?? null,
    ]
  );
  res.status(201).json(rows[0]);
});

const updateProductSchema = z.object({
  name: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
  categoryId: z.string().uuid().optional(),
  description: z.string().optional(),
  priceCents: z.number().int().nonnegative().optional(),
  currency: z.string().trim().min(1).optional(),
  sku: z.string().trim().min(1).optional(),
  imageUrl: z.string().optional(),
});

productsRouter.patch("/products/:id", requireAuth, requireOwnerOrAdmin, async (req: AuthedRequest, res) => {
  const parsed = updateProductSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const d = parsed.data;

  if (d.categoryId && !(await categoryBelongsToOrg(d.categoryId, req.auth!.organizationId))) {
    return res.status(400).json({ error: "categoryId tidak ditemukan di organisasi ini" });
  }

  const { rows } = await pool.query(
    `UPDATE products SET
       name = COALESCE($3, name),
       is_active = COALESCE($4, is_active),
       category_id = COALESCE($5, category_id),
       description = COALESCE($6, description),
       price_cents = COALESCE($7, price_cents),
       currency = COALESCE($8, currency),
       sku = COALESCE($9, sku),
       image_url = COALESCE($10, image_url)
     WHERE id = $1 AND organization_id = $2
     RETURNING id, name, is_active, category_id, description, price_cents, currency, sku, image_url, created_at`,
    [
      req.params.id,
      req.auth!.organizationId,
      d.name ?? null,
      d.isActive ?? null,
      d.categoryId ?? null,
      d.description ?? null,
      d.priceCents ?? null,
      d.currency ?? null,
      d.sku ?? null,
      d.imageUrl ?? null,
    ]
  );
  if (!rows[0]) return res.status(404).json({ error: "Produk tidak ditemukan" });
  res.json(rows[0]);
});

// Varian produk (ON DELETE CASCADE) ikut terhapus. Nomor WA/pesanan/entri
// knowledge base yang menempel ke produk ini TIDAK ikut terhapus — product_id
// di baris-baris itu cuma di-set NULL (ON DELETE SET NULL, lihat schema.sql).
productsRouter.delete("/products/:id", requireAuth, requireOwnerOrAdmin, async (req: AuthedRequest, res) => {
  const { rowCount } = await pool.query("DELETE FROM products WHERE id = $1 AND organization_id = $2", [
    req.params.id,
    req.auth!.organizationId,
  ]);
  if (!rowCount) return res.status(404).json({ error: "Produk tidak ditemukan" });
  res.json({ ok: true });
});
