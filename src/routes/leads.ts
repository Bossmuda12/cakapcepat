import { Router } from "express";
import { pool } from "../db/pool";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import { analyzeLeads } from "../ai/leadsAnalyzer";

export const leadsRouter = Router();

// Jalankan analisis Hot Leads AI on-demand dan simpan hasilnya sebagai snapshot baru.
leadsRouter.post("/leads/analyze", requireAuth, async (req: AuthedRequest, res) => {
  const result = await analyzeLeads(req.auth!.organizationId);

  const { rows } = await pool.query(
    `INSERT INTO lead_reports
       (organization_id, summary, hot_leads, warm_leads, drop_leads, flags, estimated_value)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, summary, hot_leads, warm_leads, drop_leads, flags, estimated_value, created_at`,
    [
      req.auth!.organizationId,
      result.summary,
      JSON.stringify(result.hotLeads),
      JSON.stringify(result.warmLeads),
      JSON.stringify(result.dropLeads),
      JSON.stringify(result.flags),
      result.estimatedValue,
    ]
  );
  res.json(rows[0]);
});

// Ambil laporan Hot Leads terbaru (dashboard memuat ini saat halaman /leads dibuka).
leadsRouter.get("/leads/latest", requireAuth, async (req: AuthedRequest, res) => {
  const { rows } = await pool.query(
    `SELECT id, summary, hot_leads, warm_leads, drop_leads, flags, estimated_value, created_at
     FROM lead_reports
     WHERE organization_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [req.auth!.organizationId]
  );
  res.json(rows[0] ?? null);
});

// Riwayat laporan (untuk lihat tren dari waktu ke waktu).
leadsRouter.get("/leads/history", requireAuth, async (req: AuthedRequest, res) => {
  const { rows } = await pool.query(
    `SELECT id, summary, hot_leads, warm_leads, drop_leads, flags, estimated_value, created_at
     FROM lead_reports
     WHERE organization_id = $1
     ORDER BY created_at DESC
     LIMIT 20`,
    [req.auth!.organizationId]
  );
  res.json(rows);
});
