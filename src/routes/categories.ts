import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool";
import { requireAuth, requireOwnerOrAdmin, type AuthedRequest } from "../middleware/auth";

// ============================================================================
// F-KATEGORI: Produk tiga lapis — Kategori > Produk > Varian (lihat schema.sql
// tabel product_categories). CRUD kategori ada di sini; CRUD varian ada di
// routes/variants.ts; CRUD produk ada di routes/products.ts (produk.category_id
// menghubungkan ke sini).
// ============================================================================

export const categoriesRouter = Router();

categoriesRouter.get("/categories", requireAuth, async (req: AuthedRequest, res) => {
  const { rows } = await pool.query(
    `SELECT c.id, c.name, c.description, c.sort_order, c.is_active, c.created_at,
       (SELECT count(*) FROM products p WHERE p.category_id = c.id) AS product_count
     FROM product_categories c
     WHERE c.organization_id = $1
     ORDER BY c.sort_order, c.name`,
    [req.auth!.organizationId]
  );
  res.json(rows);
});

const createCategorySchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

categoriesRouter.post("/categories", requireAuth, requireOwnerOrAdmin, async (req: AuthedRequest, res) => {
  const parsed = createCategorySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const d = parsed.data;

  const { rows } = await pool.query(
    `INSERT INTO product_categories (organization_id, name, description, sort_order, is_active)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, description, sort_order, is_active, created_at`,
    [req.auth!.organizationId, d.name, d.description ?? null, d.sortOrder ?? 0, d.isActive ?? true]
  );
  res.status(201).json(rows[0]);
});

const updateCategorySchema = z.object({
  name: z.string().trim().min(1).optional(),
  description: z.string().optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

categoriesRouter.patch("/categories/:id", requireAuth, requireOwnerOrAdmin, async (req: AuthedRequest, res) => {
  const parsed = updateCategorySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const d = parsed.data;

  const { rows } = await pool.query(
    `UPDATE product_categories SET
       name = COALESCE($3, name),
       description = COALESCE($4, description),
       sort_order = COALESCE($5, sort_order),
       is_active = COALESCE($6, is_active)
     WHERE id = $1 AND organization_id = $2
     RETURNING id, name, description, sort_order, is_active, created_at`,
    [req.params.id, req.auth!.organizationId, d.name ?? null, d.description ?? null, d.sortOrder ?? null, d.isActive ?? null]
  );
  if (!rows[0]) return res.status(404).json({ error: "Kategori tidak ditemukan" });
  res.json(rows[0]);
});

// Produk yang menempel ke kategori ini TIDAK ikut terhapus — category_id
// cuma di-set NULL (ON DELETE SET NULL, lihat schema.sql), produknya sendiri
// tetap ada, cuma jadi tidak berkategori.
categoriesRouter.delete("/categories/:id", requireAuth, requireOwnerOrAdmin, async (req: AuthedRequest, res) => {
  const { rowCount } = await pool.query(
    "DELETE FROM product_categories WHERE id = $1 AND organization_id = $2",
    [req.params.id, req.auth!.organizationId]
  );
  if (!rowCount) return res.status(404).json({ error: "Kategori tidak ditemukan" });
  res.json({ ok: true });
});
