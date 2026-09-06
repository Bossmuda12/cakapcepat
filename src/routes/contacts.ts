import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool";
import { requireAuth, requireOwnerOrAdmin, type AuthedRequest } from "../middleware/auth";

export const contactsRouter = Router();

const createContactSchema = z.object({
  waNumber: z.string().min(8, "Nomor WhatsApp tidak valid"),
  name: z.string().optional(),
  labels: z.array(z.string()).optional(),
});

// P-15: sebelumnya dipotong LIMIT 200 tanpa paginasi/pencarian. Sekarang
// dukung ?limit (default 50, maks 200), ?offset, dan ?q (cari nama/nomor WA).
//
// PERUBAHAN BENTUK RESPONS (breaking change, frontend perlu diperbarui):
// endpoint ini SEKARANG SELALU mengembalikan
//   { items: [...], total, limit, offset }
// bukan array polos seperti sebelumnya.
const listContactsQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  q: z.string().trim().min(1).optional(),
});

contactsRouter.get("/contacts", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = listContactsQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { from, to, limit, offset, q } = parsed.data;

  const params: unknown[] = [req.auth!.organizationId];
  const clauses = ["organization_id = $1"];
  if (from && to) {
    params.push(from, to);
    clauses.push(`created_at::date BETWEEN $${params.length - 1} AND $${params.length}`);
  }
  if (q) {
    params.push(`%${q}%`);
    clauses.push(`(name ILIKE $${params.length} OR wa_number ILIKE $${params.length})`);
  }
  // F-29: segmentasi kontak — saring berdasarkan label (mis. "pernah closing",
  // "minat parfum") supaya follow-up & broadcast bisa ditujukan ke kelompok
  // yang tepat, bukan disebar ke semua orang.
  const label = typeof req.query.label === "string" && req.query.label ? req.query.label : null;
  if (label) {
    params.push(label);
    clauses.push(`$${params.length} = ANY(labels)`);
  }
  const whereSql = clauses.join(" AND ");

  const { rows: countRows } = await pool.query(`SELECT count(*) FROM contacts WHERE ${whereSql}`, params);
  const total = Number(countRows[0].count);

  const listParams = [...params, limit, offset];
  const { rows } = await pool.query(
    `SELECT id, wa_number, name, labels, pipeline_stage, created_at
     FROM contacts WHERE ${whereSql} ORDER BY created_at DESC
     LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams
  );

  res.json({ items: rows, total, limit, offset });
});

contactsRouter.post("/contacts", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = createContactSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { waNumber, name, labels } = parsed.data;
  const { rows } = await pool.query(
    `INSERT INTO contacts (organization_id, wa_number, name, labels)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (organization_id, wa_number) DO UPDATE SET name = EXCLUDED.name
     RETURNING id, wa_number, name, labels, pipeline_stage, created_at`,
    [req.auth!.organizationId, waNumber, name ?? null, labels ?? []]
  );
  res.status(201).json(rows[0]);
});

// P-18/T-6: hapus kontak beserta percakapan & pesannya. Foreign key sudah
// ON DELETE CASCADE (contacts -> conversations -> messages, lihat
// schema.sql), jadi cukup hapus baris contacts-nya saja. Hanya owner/admin
// (aksi merusak/tidak bisa dibatalkan).
contactsRouter.delete("/contacts/:id", requireAuth, requireOwnerOrAdmin, async (req: AuthedRequest, res) => {
  const { rowCount } = await pool.query("DELETE FROM contacts WHERE id = $1 AND organization_id = $2", [
    req.params.id,
    req.auth!.organizationId,
  ]);
  if (!rowCount) return res.status(404).json({ error: "Kontak tidak ditemukan" });
  res.json({ ok: true });
});

const labelsSchema = z.object({ labels: z.array(z.string().min(1).max(40)).max(20) });

/** F-29: ganti seluruh label sebuah kontak (dipakai untuk segmentasi). */
contactsRouter.patch("/contacts/:id/labels", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = labelsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { rows } = await pool.query(
    `UPDATE contacts SET labels = $1 WHERE id = $2 AND organization_id = $3
     RETURNING id, wa_number, name, labels, pipeline_stage, created_at`,
    [parsed.data.labels, req.params.id, req.auth!.organizationId]
  );
  if (!rows[0]) return res.status(404).json({ error: "Kontak tidak ditemukan" });
  res.json(rows[0]);
});

/** F-29: daftar semua label yang dipakai, untuk mengisi dropdown penyaring. */
contactsRouter.get("/contacts/labels", requireAuth, async (req: AuthedRequest, res) => {
  const { rows } = await pool.query(
    `SELECT DISTINCT unnest(labels) AS label FROM contacts
     WHERE organization_id = $1 AND labels IS NOT NULL
     ORDER BY 1`,
    [req.auth!.organizationId]
  );
  res.json({ items: rows.map((r) => r.label) });
});

/** F-40: ekspor kontak ke CSV (Laporan Order sudah punya, kontak belum). */
contactsRouter.get("/contacts/export.csv", requireAuth, async (req: AuthedRequest, res) => {
  const { rows } = await pool.query(
    `SELECT wa_number, name, array_to_string(labels, '|') AS labels, pipeline_stage,
            to_char(created_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD HH24:MI') AS created_at
     FROM contacts WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 20000`,
    [req.auth!.organizationId]
  );

  const escape = (v: unknown) => {
    const t = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  };
  const header = ["nomor_wa", "nama", "label", "tahap", "dibuat"].join(",");
  const body = rows
    .map((r) => [r.wa_number, r.name, r.labels, r.pipeline_stage, r.created_at].map(escape).join(","))
    .join("\n");

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="kontak.csv"');
  res.send("\uFEFF" + header + "\n" + body);
});
