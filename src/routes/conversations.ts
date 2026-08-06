import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import { reportConversionToMeta } from "../whatsapp/capi";
import { sendTextMessage } from "../whatsapp/client";

export const conversationsRouter = Router();

// Inbox: daftar percakapan. ?source=ctwa untuk filter yang berasal dari iklan CTWA saja.
conversationsRouter.get("/conversations", requireAuth, async (req: AuthedRequest, res) => {
  const ctwaOnly = req.query.source === "ctwa";
  const { rows } = await pool.query(
    `SELECT conv.id, conv.status, conv.assigned_to, conv.ctwa_clid, conv.ad_source_url,
            conv.conversion_reported, conv.last_message_at, conv.channel_id,
            c.wa_number, c.name AS contact_name, c.pipeline_stage
     FROM conversations conv
     JOIN contacts c ON c.id = conv.contact_id
     WHERE c.organization_id = $1 ${ctwaOnly ? "AND conv.ctwa_clid IS NOT NULL" : ""}
     ORDER BY conv.last_message_at DESC NULLS LAST
     LIMIT 200`,
    [req.auth!.organizationId]
  );
  res.json(rows);
});

conversationsRouter.get("/conversations/:id/messages", requireAuth, async (req: AuthedRequest, res) => {
  const { rows: convoRows } = await pool.query(
    `SELECT conv.id FROM conversations conv
     JOIN contacts c ON c.id = conv.contact_id
     WHERE conv.id = $1 AND c.organization_id = $2`,
    [req.params.id, req.auth!.organizationId]
  );
  if (!convoRows[0]) return res.status(404).json({ error: "Percakapan tidak ditemukan" });

  const { rows } = await pool.query(
    `SELECT id, direction, sender_type, content_type, content, status, created_at
     FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC LIMIT 500`,
    [req.params.id]
  );
  res.json(rows);
});

const sendMessageSchema = z.object({ body: z.string().min(1) });

// Kirim balasan manual dari inbox. Hanya jalan kalau nomor WA channel-nya
// sudah beneran terhubung ke Meta (phone_number_id + access_token valid).
conversationsRouter.post("/conversations/:id/messages", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = sendMessageSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { rows } = await pool.query(
    `SELECT conv.id, c.wa_number, wc.phone_number_id, wc.access_token
     FROM conversations conv
     JOIN contacts c ON c.id = conv.contact_id
     JOIN whatsapp_channels wc ON wc.id = conv.channel_id
     WHERE conv.id = $1 AND c.organization_id = $2`,
    [req.params.id, req.auth!.organizationId]
  );
  const convo = rows[0];
  if (!convo) return res.status(404).json({ error: "Percakapan tidak ditemukan" });

  try {
    const waRes = await sendTextMessage({
      to: convo.wa_number,
      body: parsed.data.body,
      phoneNumberId: convo.phone_number_id,
      accessToken: convo.access_token,
    });
    const waMessageId = waRes?.messages?.[0]?.id ?? null;

    const { rows: msgRows } = await pool.query(
      `INSERT INTO messages (conversation_id, direction, sender_type, wa_message_id, content_type, content, status)
       VALUES ($1, 'outbound', 'human', $2, 'text', $3, 'sent')
       RETURNING id, direction, sender_type, content_type, content, status, created_at`,
      [req.params.id, waMessageId, JSON.stringify({ body: parsed.data.body })]
    );
    await pool.query("UPDATE conversations SET last_message_at = now() WHERE id = $1", [req.params.id]);
    res.status(201).json(msgRows[0]);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Gagal mengirim pesan";
    res.status(502).json({ error: message });
  }
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
