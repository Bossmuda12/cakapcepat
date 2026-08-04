import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import { reportConversionToMeta } from "../whatsapp/capi";

export const conversationsRouter = Router();

// Inbox: daftar percakapan, bisa difilter per departemen/channel di FE nanti.
conversationsRouter.get("/conversations", requireAuth, async (req: AuthedRequest, res) => {
  const { rows } = await pool.query(
    `SELECT conv.id, conv.status, conv.assigned_to, conv.ctwa_clid, conv.last_message_at,
            c.wa_number, c.name AS contact_name, c.pipeline_stage
     FROM conversations conv
     JOIN contacts c ON c.id = conv.contact_id
     WHERE c.organization_id = $1
     ORDER BY conv.last_message_at DESC NULLS LAST
     LIMIT 100`,
    [req.auth!.organizationId]
  );
  res.json(rows);
});

const assignSchema = z.object({ userId: z.string().uuid() });

conversationsRouter.post("/conversations/:id/assign", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = assignSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  await pool.query("UPDATE conversations SET assigned_to = $1 WHERE id = $2", [
    parsed.data.userId,
    req.params.id,
  ]);
  res.json({ ok: true });
});

const pipelineSchema = z.object({
  stage: z.enum(["new", "contacted", "qualified", "closing_won", "closing_lost"]),
  dealValue: z.number().optional(), // dipakai untuk laporan CAPI kalau stage = closing_won
});

/**
 * Update tahap pipeline lead. Kalau ditandai closing_won, otomatis laporkan
 * konversi ke Meta lewat CAPI (kalau chat ini berasal dari iklan CTWA) —
 * inilah yang menutup loop atribusi iklan yang dijelaskan di Bab 8.
 */
conversationsRouter.post("/conversations/:id/pipeline", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = pipelineSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { stage, dealValue } = parsed.data;
  const conversationId = req.params.id;

  const { rows } = await pool.query(
    "SELECT contact_id FROM conversations WHERE id = $1",
    [conversationId]
  );
  if (!rows[0]) return res.status(404).json({ error: "Conversation tidak ditemukan" });

  await pool.query("UPDATE contacts SET pipeline_stage = $1 WHERE id = $2", [stage, rows[0].contact_id]);

  let capiResult = null;
  if (stage === "closing_won") {
    try {
      capiResult = await reportConversionToMeta({
        conversationId,
        eventName: "Purchase",
        value: dealValue,
        currency: "IDR",
      });
    } catch (err) {
      console.error("[conversations] Gagal lapor CAPI:", err);
    }
  }

  res.json({ ok: true, capiReported: Boolean(capiResult) });
});
