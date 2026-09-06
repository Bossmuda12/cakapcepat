import { Router } from "express";
import { pool } from "../db/pool";
import { requireAuth, requireOwnerOrAdmin, type AuthedRequest } from "../middleware/auth";

export const auditRouter = Router();

/**
 * F-41: Catatan aktivitas. Hanya owner/admin yang boleh melihat — isinya
 * memuat siapa mengubah apa, termasuk perubahan yang menyangkut uang.
 */
auditRouter.get("/audit-log", requireAuth, requireOwnerOrAdmin, async (req: AuthedRequest, res) => {
  const limit = Math.min(Number(req.query.limit ?? 100) || 100, 500);
  const offset = Number(req.query.offset ?? 0) || 0;
  const action = typeof req.query.action === "string" && req.query.action ? req.query.action : null;

  const { rows: countRows } = await pool.query(
    `SELECT count(*)::int AS c FROM audit_log
     WHERE organization_id = $1 AND ($2::text IS NULL OR action = $2)`,
    [req.auth!.organizationId, action]
  );

  const { rows } = await pool.query(
    `SELECT a.id, a.action, a.entity, a.entity_id, a.detail, a.created_at,
            u.name AS actor_name, u.email AS actor_email
     FROM audit_log a
     LEFT JOIN users u ON u.id = a.actor_user_id
     WHERE a.organization_id = $1 AND ($2::text IS NULL OR a.action = $2)
     ORDER BY a.created_at DESC
     LIMIT $3 OFFSET $4`,
    [req.auth!.organizationId, action, limit, offset]
  );

  res.json({ items: rows, total: countRows[0].c, limit, offset });
});
