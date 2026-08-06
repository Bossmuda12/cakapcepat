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
    "SELECT name, capi_pixel_id, capi_access_token FROM organization WHERE id = $1",
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

// Log event yang sudah dilaporkan ke Meta CAPI — buat debugging atribusi CTWA.
settingsRouter.get("/ad-events", requireAuth, async (req: AuthedRequest, res) => {
  const { rows } = await pool.query(
    `SELECT ev.id, ev.event_name, ev.ctwa_clid, ev.response_status, ev.created_at,
            c.wa_number, c.name AS contact_name
     FROM ad_conversion_events ev
     JOIN conversations conv ON conv.id = ev.conversation_id
     JOIN contacts c ON c.id = conv.contact_id
     WHERE c.organization_id = $1
     ORDER BY ev.created_at DESC
     LIMIT 100`,
    [req.auth!.organizationId]
  );
  res.json(rows);
});
