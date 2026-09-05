import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool";
import { config } from "../config";
import { requireAuth, requireOwnerOrAdmin, type AuthedRequest } from "../middleware/auth";

export const settingsRouter = Router();

function maskToken(token: string | null): string | null {
  if (!token) return null;
  if (token.length <= 6) return "••••••";
  return `••••${token.slice(-4)}`;
}

settingsRouter.get("/settings", requireAuth, async (req: AuthedRequest, res) => {
  const { rows } = await pool.query(
    `SELECT name, capi_pixel_id, capi_access_token, ai_api_key, ai_model, ai_system_prompt,
            ai_model_small, ai_daily_budget_cents,
            daily_report_wa_number, daily_report_enabled, daily_report_hour, last_daily_report_at,
            daily_report_channel_id,
            closing_group_jid, closing_group_name, closing_group_channel_id,
            group_report_enabled, group_daily_summary_enabled, last_group_summary_at,
            followup_enabled, followup_max_attempts
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
      modelSmall: org?.ai_model_small || null,
      systemPrompt: org?.ai_system_prompt || null,
      configured: Boolean(org?.ai_api_key || config.ai.apiKey),
      dailyBudgetCents: org?.ai_daily_budget_cents ?? null,
    },
    dailyReport: {
      waNumber: org?.daily_report_wa_number ?? null,
      enabled: org?.daily_report_enabled ?? false,
      hour: org?.daily_report_hour ?? 8,
      lastSentAt: org?.last_daily_report_at ?? null,
      channelId: org?.daily_report_channel_id ?? null,
    },
    // F-19 s/d F-21: grup closingan & ringkasan harian ke grup — pemilihan
    // grup itu sendiri dikelola lewat GET/POST /groups/* (src/routes/groups.ts).
    closingGroup: {
      jid: org?.closing_group_jid ?? null,
      name: org?.closing_group_name ?? null,
      channelId: org?.closing_group_channel_id ?? null,
      reportEnabled: org?.group_report_enabled ?? false,
      dailySummaryEnabled: org?.group_daily_summary_enabled ?? false,
      lastSummaryAt: org?.last_group_summary_at ?? null,
    },
    // F-25 s/d F-28: follow-up berjadwal.
    followup: {
      enabled: org?.followup_enabled ?? false,
      maxAttempts: org?.followup_max_attempts ?? 3,
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

// ============================================================================
// F-19/F-20/F-21/F-25 s/d F-28/F-9: pengaturan grup closingan (aktif/nonaktif
// saja — pemilihan grup itu sendiri ada di POST /groups/select), nomor
// pengirim laporan harian (F-22), follow-up berjadwal, dan batas biaya/model
// kecil AI. Dipisah dari /settings/ai & /settings/daily-report di atas supaya
// tidak perlu mengubah endpoint lama yang sudah dipakai frontend.
// ============================================================================
const automationSettingsSchema = z.object({
  groupReportEnabled: z.boolean().optional(),
  groupDailySummaryEnabled: z.boolean().optional(),
  dailyReportChannelId: z.string().uuid().nullable().optional(),
  followupEnabled: z.boolean().optional(),
  followupMaxAttempts: z.number().int().min(1).max(10).optional(),
  aiDailyBudgetCents: z.number().int().nonnegative().nullable().optional(),
  aiModelSmall: z.string().min(1).nullable().optional(),
});

// Bangun klausa SET dinamis — field yang tidak dikirim (`undefined`) TIDAK
// disentuh, tapi `null` eksplisit TETAP ditulis (mis. mengosongkan
// dailyReportChannelId/aiDailyBudgetCents/aiModelSmall). Sama pola dengan
// buildDynamicSet() di src/routes/orders.ts.
function buildAutomationSet(d: z.infer<typeof automationSettingsSchema>) {
  const colMap: Record<string, unknown> = {
    group_report_enabled: d.groupReportEnabled,
    group_daily_summary_enabled: d.groupDailySummaryEnabled,
    daily_report_channel_id: d.dailyReportChannelId,
    followup_enabled: d.followupEnabled,
    followup_max_attempts: d.followupMaxAttempts,
    ai_daily_budget_cents: d.aiDailyBudgetCents,
    ai_model_small: d.aiModelSmall,
  };
  const params: unknown[] = [];
  const setParts: string[] = [];
  for (const [col, val] of Object.entries(colMap)) {
    if (val === undefined) continue;
    params.push(val);
    setParts.push(`${col} = $${params.length + 1}`); // +1 karena $1 dipakai utk organizationId
  }
  return { setSql: setParts.join(", "), params };
}

settingsRouter.patch("/settings/automation", requireAuth, requireOwnerOrAdmin, async (req: AuthedRequest, res) => {
  const parsed = automationSettingsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const d = parsed.data;

  if (d.dailyReportChannelId) {
    const { rows } = await pool.query(
      "SELECT 1 FROM whatsapp_channels WHERE id = $1 AND organization_id = $2",
      [d.dailyReportChannelId, req.auth!.organizationId]
    );
    if (!rows[0]) return res.status(400).json({ error: "dailyReportChannelId tidak ditemukan di organisasi ini" });
  }

  const { setSql, params } = buildAutomationSet(d);
  if (!setSql) return res.json({ ok: true }); // tidak ada field yang dikirim, tidak ada yang perlu diubah

  await pool.query(`UPDATE organization SET ${setSql} WHERE id = $1`, [req.auth!.organizationId, ...params]);
  res.json({ ok: true });
});
