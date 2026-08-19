import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import { reportConversionToMeta } from "../whatsapp/capi";
import { sendTextMessage } from "../whatsapp/client";
import { sendViaQrSession } from "../whatsapp/qrSessionManager";
import { broadcastToOrg } from "../realtime";

export const conversationsRouter = Router();

// Inbox: daftar percakapan. ?source=ctwa untuk filter yang berasal dari iklan
// CTWA saja. ?ownerUserId=<uuid> untuk filter cuma percakapan lewat nomor WA
// yang dipegang anggota tim tertentu — dipakai owner buat "klik nama tim,
// lihat cuma obrolan dia" di halaman Percakapan.
conversationsRouter.get("/conversations", requireAuth, async (req: AuthedRequest, res) => {
  const ctwaOnly = req.query.source === "ctwa";
  const ownerUserId = typeof req.query.ownerUserId === "string" ? req.query.ownerUserId : null;

  const params: unknown[] = [req.auth!.organizationId];
  const clauses = ["c.organization_id = $1"];
  if (ctwaOnly) clauses.push("conv.ctwa_clid IS NOT NULL");
  if (ownerUserId) {
    params.push(ownerUserId);
    clauses.push(`wc.owner_user_id = $${params.length}`);
  }

  const { rows } = await pool.query(
    `SELECT conv.id, conv.status, conv.assigned_to, conv.ctwa_clid, conv.ad_source_url,
            conv.conversion_reported, conv.last_message_at, conv.channel_id,
            c.wa_number, c.name AS contact_name, c.pipeline_stage,
            u.name AS assigned_name,
            wc.owner_user_id AS channel_owner_id, wc.label AS channel_label
     FROM conversations conv
     JOIN contacts c ON c.id = conv.contact_id
     JOIN whatsapp_channels wc ON wc.id = conv.channel_id
     LEFT JOIN users u ON u.id = conv.assigned_to
     WHERE ${clauses.join(" AND ")}
     ORDER BY conv.last_message_at DESC NULLS LAST
     LIMIT 200`,
    params
  );
  res.json(rows);
});

/**
 * Ringkasan performa CS untuk halaman Monitor: jumlah percakapan terbuka,
 * pesan hari ini, dan breakdown per anggota tim (chat yang di-assign ke dia,
 * berapa pesan yang dia kirim hari ini). Dipakai bersama polling ringan +
 * sinyal WebSocket supaya datanya terasa real-time tanpa nge-refresh manual.
 */
conversationsRouter.get("/conversations/stats", requireAuth, async (req: AuthedRequest, res) => {
  const orgId = req.auth!.organizationId;

  const { rows: totals } = await pool.query(
    `SELECT
       count(*) FILTER (WHERE conv.status = 'open') AS open_conversations,
       count(*) FILTER (WHERE conv.status = 'pending') AS pending_conversations
     FROM conversations conv
     JOIN contacts c ON c.id = conv.contact_id
     WHERE c.organization_id = $1`,
    [orgId]
  );

  const { rows: messagesToday } = await pool.query(
    `SELECT count(*) AS count
     FROM messages m
     JOIN conversations conv ON conv.id = m.conversation_id
     JOIN contacts c ON c.id = conv.contact_id
     WHERE c.organization_id = $1 AND m.created_at >= date_trunc('day', now())`,
    [orgId]
  );

  const { rows: closingTotal } = await pool.query(
    `SELECT count(*) AS count FROM contacts WHERE organization_id = $1 AND pipeline_stage = 'closing_won'`,
    [orgId]
  );

  // Dua subquery ter-agregasi digabung lewat LEFT JOIN (bukan JOIN langsung ke
  // conversations & messages sekaligus) supaya tidak terjadi fan-out/duplikasi
  // hitungan akibat cross product antar baris conversations dan messages.
  const { rows: perAgent } = await pool.query(
    `SELECT u.id, u.name, u.email,
            COALESCE(oc.cnt, 0) AS open_conversations,
            COALESCE(mt.cnt, 0) AS messages_today
     FROM users u
     LEFT JOIN (
       SELECT assigned_to, count(*) AS cnt
       FROM conversations
       WHERE status = 'open' AND assigned_to IS NOT NULL
       GROUP BY assigned_to
     ) oc ON oc.assigned_to = u.id
     LEFT JOIN (
       SELECT sender_user_id, count(*) AS cnt
       FROM messages
       WHERE sender_user_id IS NOT NULL AND created_at >= date_trunc('day', now())
       GROUP BY sender_user_id
     ) mt ON mt.sender_user_id = u.id
     WHERE u.organization_id = $1
     ORDER BY u.name`,
    [orgId]
  );

  res.json({
    openConversations: Number(totals[0].open_conversations),
    pendingConversations: Number(totals[0].pending_conversations),
    messagesToday: Number(messagesToday[0].count),
    closingWonTotal: Number(closingTotal[0].count),
    agents: perAgent.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      openConversations: Number(r.open_conversations),
      messagesToday: Number(r.messages_today),
    })),
  });
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

// Kirim balasan manual dari inbox. Untuk channel Cloud API resmi, jalan kalau
// nomornya sudah beneran terhubung ke Meta (phone_number_id + access_token
// valid). Untuk channel QR/pairing, dikirim lewat sesi WA aktif (Baileys) —
// gagal kalau sesinya sedang tidak tersambung.
conversationsRouter.post("/conversations/:id/messages", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = sendMessageSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { rows } = await pool.query(
    `SELECT conv.id, conv.channel_id, c.wa_number, wc.phone_number_id, wc.access_token, wc.connection_type
     FROM conversations conv
     JOIN contacts c ON c.id = conv.contact_id
     JOIN whatsapp_channels wc ON wc.id = conv.channel_id
     WHERE conv.id = $1 AND c.organization_id = $2`,
    [req.params.id, req.auth!.organizationId]
  );
  const convo = rows[0];
  if (!convo) return res.status(404).json({ error: "Percakapan tidak ditemukan" });

  try {
    let waMessageId: string | null = null;
    if (convo.connection_type === "qr_session") {
      await sendViaQrSession(convo.channel_id, convo.wa_number, parsed.data.body);
    } else {
      const waRes = await sendTextMessage({
        to: convo.wa_number,
        body: parsed.data.body,
        phoneNumberId: convo.phone_number_id,
        accessToken: convo.access_token,
      });
      waMessageId = waRes?.messages?.[0]?.id ?? null;
    }

    const { rows: msgRows } = await pool.query(
      `INSERT INTO messages (conversation_id, direction, sender_type, sender_user_id, wa_message_id, content_type, content, status)
       VALUES ($1, 'outbound', 'human', $2, $3, 'text', $4, 'sent')
       RETURNING id, direction, sender_type, content_type, content, status, created_at`,
      [req.params.id, req.auth!.userId, waMessageId, JSON.stringify({ body: parsed.data.body })]
    );
    await pool.query("UPDATE conversations SET last_message_at = now() WHERE id = $1", [req.params.id]);
    broadcastToOrg(req.auth!.organizationId, { type: "message", conversationId: req.params.id });
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
  broadcastToOrg(req.auth!.organizationId, { type: "assign", conversationId: req.params.id });
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

  broadcastToOrg(req.auth!.organizationId, { type: "pipeline", conversationId });
  res.json({ ok: true, capiReported: Boolean(capiResult) });
});
