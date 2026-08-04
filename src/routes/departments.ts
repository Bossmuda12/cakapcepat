import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool";
import { requireAuth, type AuthedRequest } from "../middleware/auth";

export const departmentsRouter = Router();

departmentsRouter.get("/departments", requireAuth, async (req: AuthedRequest, res) => {
  const { rows } = await pool.query(
    `SELECT d.id, d.name,
       (SELECT count(*) FROM whatsapp_channels wc WHERE wc.department_id = d.id) AS channel_count
     FROM departments d WHERE d.organization_id = $1 ORDER BY d.created_at`,
    [req.auth!.organizationId]
  );
  res.json(rows);
});

const createDepartmentSchema = z.object({ name: z.string().min(1) });

departmentsRouter.post("/departments", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = createDepartmentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { rows } = await pool.query(
    "INSERT INTO departments (organization_id, name) VALUES ($1, $2) RETURNING id, name",
    [req.auth!.organizationId, parsed.data.name]
  );
  res.status(201).json(rows[0]);
});
