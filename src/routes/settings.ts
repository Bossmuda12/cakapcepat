import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool";
import { config } from "../config";
import { requireAuth, type AuthedRequest } from "../middleware/auth";

export const settingsRouter = Router();

function maskToken(token: string | null): string | null {
  if (!token) return null;
  if (token.length <= 6) return "••••••";
  return `••••${token.slice(-4)}`;
}

settingsRouter.get("/settings", requireAuth, async (req: AuthedRequest, res) => {
  const { rows } = await pool.query(
    `SELECT name, capi_pixel_id, capi_access_token, ai_api_key, ai_model, ai_system_prompt,
            daily_report_wa_number, daily_report_enabled, daily_report_hour, last_daily_report_at
     FROM organization WHERE id = $1`,
    [req.auth!.organizationId]
  );
  const org = rows[0];
  res.json({
    organizationName: org?.name ?? null,
    capi: {
      pixelId: org?.capi_pixel_id || config.capi.pixelId || null,
      accessTokenMasked: maskToken(org?.capi_access_token || config.capi.accessToken || null),
      configured: Boolean((org?.capi_pixel_id || config.capi.pixelId) && (org?.capi_access_token || config.capi.accessToken)),
    },
    ai: {
      apiKeyMasked: maskToken(org?.ai_api_key || config.ai.apiKey || null),
      model: org?.ai_model || config.ai.model,
      systemPrompt: org?.ai_system_prompt || null,
      configured: Boolean(org?.ai_api_key || config.ai.apiKey),
    },
    dailyReport: {
      waNumber: org?.daily_report_wa_number ?? null,
      enabled: org?.daily_report_enabled ?? false,
      hour: org?.daily_report_hour ?? 8,
      lastSentAt: org?.last_daily_report_at ?? null,
    },
  });
});

const capiSchema = z.object({
  pixelId: z.string().min(1).optional(),
  accessToken: z.string().min(1).optional(),
});

settingsRouter.put("/settings/capi", requireAuth, async (req: AuthedRequest, res) => {
  if (req.auth!.role !== "owner" && req.auth!.role !== "admin") {
    return res.status(403).json({ error: "Hanya owner/admin yang bisa mengubah pengaturan ini" });
  }
  const parsed = capiSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  await pool.query(
    `UPDATE organization SET
       capi_pixel_id = COALESCE($2, capi_pixel_id),
       capi_access_token = COALESCE($3, capi_access_token)
     WHERE id = $1`,
    [req.auth!.organizationId, parsed.data.pixelId ?? null, parsed.data.accessToken ?? null]
  );
  res.json({ ok: true });
});

const aiSchema = z.object({
  apiKey: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  systemPrompt: z.string().max(4000).optional(),
});

settingsRouter.put("/settings/ai", requireAuth, async (req: AuthedRequest, res) => {
  if (req.auth!.role !== "owner" && req.auth!.role !== "admin") {
    return res.status(403).json({ error: "Hanya owner/admin yang bisa mengubah pengaturan ini" });
  }
  const parsed = aiSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  await pool.query(
    `UPDATE organization SET
       ai_api_key = COALESCE($2, ai_api_key),
       ai_model = COALESCE($3, ai_model),
       ai_system_prompt = COALESCE($4, ai_system_prompt)
     WHERE id = $1`,
    [
      req.auth!.organizationId,
      parsed.data.apiKey ?? null,
      parsed.data.model ?? null,
      parsed.data.systemPrompt ?? null,
    ]
  );
  res.json({ ok: true });
});

// Log event yang sudah dilaporkan ke Meta CAPI — buat debugging atribusi CTWA.
settingsRouter.get("/ad-events", requireAuth, async (req: AuthedRequest, res) => {
  const { from, to } = req.query as { from?: string; to?: string };
  const params: unknown[] = [req.auth!.organizationId];
  let dateClause = "";
  if (from && to) {
    params.push(from, to);
    dateClause = "AND ev.created_at::date BETWEEN $2 AND $3";
  }
  const { rows } = await pool.query(
    `SELECT ev.id, ev.event_name, ev.ctwa_clid, ev.response_status, ev.created_at,
            c.wa_number, c.name AS contact_name
     FROM ad_conversion_events ev
     JOIN conversations conv ON conv.id = ev.conversation_id
     JOIN contacts c ON c.id = conv.contact_id
     WHERE c.organization_id = $1 ${dateClause}
     ORDER BY ev.created_at DESC
     LIMIT 100`,
    params
  );
  res.json(rows);
});

const dailyReportSchema = z.object({
  waNumber: z.string().min(6).max(20).optional().nullable(),
  enabled: z.boolean().optional(),
  hour: z.number().int().min(0).max(23).optional(),
});

settingsRouter.put("/settings/daily-report", requireAuth, async (req: AuthedRequest, res) => {
  if (req.auth!.role !== "owner" && req.auth!.role !== "admin") {
    return res.status(403).json({ error: "Hanya owner/admin yang bisa mengubah pengaturan ini" });
  }
  const parsed = dailyReportSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  await pool.query(
    `UPDATE organization SET
       daily_report_wa_number = COALESCE($2, daily_report_wa_number),
       daily_report_enabled = COALESCE($3, daily_report_enabled),
       daily_report_hour = COALESCE($4, daily_report_hour)
     WHERE id = $1`,
    [
      req.auth!.organizationId,
      parsed.data.waNumber ?? null,
      parsed.data.enabled ?? null,
      parsed.data.hour ?? null,
    ]
  );
  res.json({ ok: true });
});
