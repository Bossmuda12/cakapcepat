import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool";
import { requireAuth, requireOwnerOrAdmin, type AuthedRequest } from "../middleware/auth";
import { reportConversionToMeta } from "../whatsapp/capi";
import { sendTextMessage } from "../whatsapp/client";
import { sendViaQrSession } from "../whatsapp/qrSessionManager";
import { broadcastToOrg } from "../realtime";

export const conversationsRouter = Router();

// P-15: daftar percakapan sekarang dukung paginasi (limit/offset), pencarian
// (q, cari di nama kontak atau nomor WA) & filter status/produk — sebelumnya
// dipotong LIMIT 200 tanpa cara melihat sisanya atau mencari kontak tertentu.
const listConversationsQuerySchema = z.object({
  source: z.string().optional(), // "ctwa" untuk filter yang berasal dari iklan CTWA saja
  ownerUserId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  q: z.string().trim().min(1).optional(),
  status: z.enum(["open", "pending", "closed", "archived"]).optional(),
  productId: z.string().uuid().optional(),
});

// Inbox: daftar percakapan.
//
// PERUBAHAN BENTUK RESPONS (breaking change, frontend perlu diperbarui):
// endpoint ini SEKARANG SELALU mengembalikan
//   { items: [...], total, limit, offset }
// bukan array polos seperti sebelumnya.
//
// Query param:
//  - ?source=ctwa       filter yang berasal dari iklan CTWA saja
//  - ?ownerUserId=<uuid> filter cuma percakapan lewat nomor WA yang dipegang
//                        anggota tim tertentu (dipakai owner buat "klik nama
//                        tim, lihat cuma obrolan dia")
//  - ?limit, ?offset    paginasi (default limit 50, maks 200)
//  - ?q                 cari di nama kontak atau nomor WA (ILIKE)
//  - ?status            open|pending|closed|archived — default: semua KECUALI
//                        archived (percakapan yang diarsipkan disembunyikan
//                        dari inbox utama secara default)
//  - ?productId         filter lewat conversations.product_id
conversationsRouter.get("/conversations", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = listConversationsQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { source, ownerUserId, limit, offset, q, status, productId } = parsed.data;
  const ctwaOnly = source === "ctwa";

  const params: unknown[] = [req.auth!.organizationId];
  const clauses = ["c.organization_id = $1"];
  if (ctwaOnly) clauses.push("conv.ctwa_clid IS NOT NULL");
  if (ownerUserId) {
    params.push(ownerUserId);
    clauses.push(`wc.owner_user_id = $${params.length}`);
  }
  if (status) {
    params.push(status);
    clauses.push(`conv.status = $${params.length}`);
  } else {
    clauses.push("conv.status <> 'archived'");
  }
  if (q) {
    params.push(`%${q}%`);
    clauses.push(`(c.name ILIKE $${params.length} OR c.wa_number ILIKE $${params.length})`);
  }
  if (productId) {
    params.push(productId);
    clauses.push(`conv.product_id = $${params.length}`);
  }
  const whereSql = clauses.join(" AND ");

  const { rows: countRows } = await pool.query(
    `SELECT count(*) FROM conversations conv
     JOIN contacts c ON c.id = conv.contact_id
     JOIN whatsapp_channels wc ON wc.id = conv.channel_id
     WHERE ${whereSql}`,
    params
  );
  const total = Number(countRows[0].count);

  const listParams = [...params, limit, offset];
  const { rows } = await pool.query(
    `SELECT conv.id, conv.status, conv.assigned_to, conv.ctwa_clid, conv.ad_source_url,
            conv.conversion_reported, conv.last_message_at, conv.channel_id, conv.product_id,
            conv.needs_attention, conv.attention_reason, conv.attention_at,
            conv.ai_paused, conv.ai_summary, conv.ai_summary_at, conv.order_status,
            c.wa_number, c.name AS contact_name, c.pipeline_stage,
            u.name AS assigned_name,
            wc.owner_user_id AS channel_owner_id, wc.label AS channel_label
     FROM conversations conv
     JOIN contacts c ON c.id = conv.contact_id
     JOIN whatsapp_channels wc ON wc.id = conv.channel_id
     LEFT JOIN users u ON u.id = conv.assigned_to
     WHERE ${whereSql}
     ORDER BY conv.last_message_at DESC NULLS LAST
     LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams
  );

  res.json({ items: rows, total, limit, offset });
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
    `SELECT id, direction, sender_type, content_type, content, status, created_at,
            media_type, media_mime, media_url, media_size, transcript, transcribed_at
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

/**
 * F-7: AMBIL ALIH MANUAL. Owner menekan tombol "Ambil Alih" di satu percakapan
 * dan AI langsung berhenti membalas percakapan itu saja — tanpa mematikan AI
 * untuk pelanggan lain. Kolom yang sama juga diset otomatis oleh pagar
 * pengaman (src/ai/guardrails.ts) saat pelanggan menyebut refund/komplain/dll.
 */
conversationsRouter.post("/conversations/:id/ai-pause", requireAuth, async (req: AuthedRequest, res) => {
  const { rows } = await pool.query(
    `UPDATE conversations conv SET ai_paused = true, ai_paused_by = $3,
            needs_attention = true,
            attention_reason = COALESCE(conv.attention_reason, 'Diambil alih manual'),
            attention_at = COALESCE(conv.attention_at, now())
     FROM contacts c
     WHERE conv.contact_id = c.id AND conv.id = $1 AND c.organization_id = $2
     RETURNING conv.id, conv.ai_paused, conv.needs_attention, conv.attention_reason`,
    [req.params.id, req.auth!.organizationId, req.auth!.userId]
  );
  if (!rows[0]) return res.status(404).json({ error: "Percakapan tidak ditemukan" });
  res.json(rows[0]);
});

/** F-7: kembalikan percakapan ke AI, sekaligus bersihkan tanda "butuh perhatian". */
conversationsRouter.post("/conversations/:id/ai-resume", requireAuth, async (req: AuthedRequest, res) => {
  const { rows } = await pool.query(
    `UPDATE conversations conv SET ai_paused = false, ai_paused_by = NULL,
            needs_attention = false, attention_reason = NULL, attention_at = NULL
     FROM contacts c
     WHERE conv.contact_id = c.id AND conv.id = $1 AND c.organization_id = $2
     RETURNING conv.id, conv.ai_paused, conv.needs_attention`,
    [req.params.id, req.auth!.organizationId]
  );
  if (!rows[0]) return res.status(404).json({ error: "Percakapan tidak ditemukan" });
  res.json(rows[0]);
});

/**
 * MODE PERSETUJUAN (whatsapp_channels.ai_approval_mode): balasan AI disimpan
 * sebagai pesan berstatus 'draft' dan TIDAK terkirim sampai manusia menyetujui
 * di sini. Sangat disarankan menyala 1-2 minggu pertama — di situlah AI paling
 * sering meleset dan paling butuh dikoreksi.
 *
 * Body opsional { body } untuk menyunting teksnya dulu sebelum dikirim.
 */
const approveDraftSchema = z.object({ body: z.string().min(1).optional() });

conversationsRouter.post(
  "/conversations/:id/messages/:messageId/approve",
  requireAuth,
  async (req: AuthedRequest, res) => {
    const parsed = approveDraftSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const { rows } = await pool.query(
      `SELECT m.id, m.content, conv.channel_id, c.wa_number,
              wc.phone_number_id, wc.access_token, wc.connection_type
       FROM messages m
       JOIN conversations conv ON conv.id = m.conversation_id
       JOIN contacts c ON c.id = conv.contact_id
       JOIN whatsapp_channels wc ON wc.id = conv.channel_id
       WHERE m.id = $1 AND m.conversation_id = $2 AND c.organization_id = $3 AND m.status = 'draft'`,
      [req.params.messageId, req.params.id, req.auth!.organizationId]
    );
    const draft = rows[0];
    if (!draft) return res.status(404).json({ error: "Draf balasan tidak ditemukan atau sudah diproses" });

    const body = parsed.data.body ?? draft.content?.body ?? "";
    if (!body) return res.status(400).json({ error: "Isi balasan kosong" });

    try {
      let waMessageId: string | null = null;
      if (draft.connection_type === "qr_session") {
        await sendViaQrSession(draft.channel_id, draft.wa_number, body);
      } else {
        const waRes = await sendTextMessage({
          to: draft.wa_number,
          body,
          phoneNumberId: draft.phone_number_id,
          accessToken: draft.access_token,
        });
        waMessageId = waRes?.messages?.[0]?.id ?? null;
      }

      const { rows: updated } = await pool.query(
        `UPDATE messages SET status = 'sent', content = $2, wa_message_id = COALESCE(wa_message_id, $3),
                sender_user_id = $4
         WHERE id = $1
         RETURNING id, direction, sender_type, content_type, content, status, created_at`,
        [req.params.messageId, JSON.stringify({ body }), waMessageId, req.auth!.userId]
      );
      await pool.query("UPDATE conversations SET last_message_at = now() WHERE id = $1", [req.params.id]);
      broadcastToOrg(req.auth!.organizationId, { type: "message", conversationId: req.params.id });
      res.json(updated[0]);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Gagal mengirim balasan";
      res.status(502).json({ error: message });
    }
  }
);

/** Tolak draf balasan AI — pesannya ditandai 'rejected', tidak pernah terkirim. */
conversationsRouter.post(
  "/conversations/:id/messages/:messageId/reject",
  requireAuth,
  async (req: AuthedRequest, res) => {
    const { rows } = await pool.query(
      `UPDATE messages m SET status = 'rejected'
       FROM conversations conv, contacts c
       WHERE m.conversation_id = conv.id AND conv.contact_id = c.id
         AND m.id = $1 AND m.conversation_id = $2 AND c.organization_id = $3 AND m.status = 'draft'
       RETURNING m.id, m.status`,
      [req.params.messageId, req.params.id, req.auth!.organizationId]
    );
    if (!rows[0]) return res.status(404).json({ error: "Draf balasan tidak ditemukan atau sudah diproses" });
    res.json(rows[0]);
  }
);

const assignSchema = z.object({ userId: z.string().uuid() });

// P-5: sebelumnya endpoint ini UPDATE langsung pakai req.params.id tanpa
// pernah memverifikasi percakapan itu milik organization pemanggil, DAN
// tanpa memverifikasi userId yang di-assign benar anggota organization yang
// sama — jadi siapa pun yang login bisa meng-assign percakapan ORGANIZATION
// LAIN ke user mana pun (termasuk user organization lain) cukup dengan
// menebak UUID-nya.
conversationsRouter.post("/conversations/:id/assign", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = assignSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const organizationId = req.auth!.organizationId;

  const { rows: convoRows } = await pool.query(
    `SELECT conv.id FROM conversations conv
     JOIN contacts c ON c.id = conv.contact_id
     WHERE conv.id = $1 AND c.organization_id = $2`,
    [req.params.id, organizationId]
  );
  if (!convoRows[0]) return res.status(404).json({ error: "Percakapan tidak ditemukan" });

  const { rows: userRows } = await pool.query(
    "SELECT id FROM users WHERE id = $1 AND organization_id = $2",
    [parsed.data.userId, organizationId]
  );
  if (!userRows[0]) {
    return res.status(400).json({ error: "Anggota tim (userId) tidak ditemukan di organization ini" });
  }

  await pool.query("UPDATE conversations SET assigned_to = $1 WHERE id = $2", [
    parsed.data.userId,
    req.params.id,
  ]);
  broadcastToOrg(organizationId, { type: "assign", conversationId: req.params.id });
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
 *
 * P-5: sebelumnya SELECT contact_id FROM conversations WHERE id = $1 saja,
 * TANPA verifikasi organisasi sama sekali — siapa pun yang login bisa
 * mengubah tahap pipeline (dan memicu laporan CAPI) untuk percakapan
 * ORGANIZATION LAIN cukup dengan menebak UUID conversation-nya.
 */
conversationsRouter.post("/conversations/:id/pipeline", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = pipelineSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { stage, dealValue } = parsed.data;
  const conversationId = req.params.id;

  const { rows } = await pool.query(
    `SELECT conv.contact_id FROM conversations conv
     JOIN contacts c ON c.id = conv.contact_id
     WHERE conv.id = $1 AND c.organization_id = $2`,
    [conversationId, req.auth!.organizationId]
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

// ============================================================================
// P-18/T-6: sebelumnya tidak ada cara sama sekali menghapus/mengarsipkan
// percakapan, pesan, atau kontak dari dashboard. Semua endpoint di bawah ini
// memfilter organisasi pemanggil DAN hanya boleh dipakai owner/admin (aksi
// merusak/tidak bisa dibatalkan).
// ============================================================================

/** Hapus percakapan beserta seluruh pesannya (ON DELETE CASCADE di schema.sql). */
conversationsRouter.delete(
  "/conversations/:id",
  requireAuth,
  requireOwnerOrAdmin,
  async (req: AuthedRequest, res) => {
    const { rowCount } = await pool.query(
      `DELETE FROM conversations conv
       USING contacts c
       WHERE conv.id = $1 AND conv.contact_id = c.id AND c.organization_id = $2`,
      [req.params.id, req.auth!.organizationId]
    );
    if (!rowCount) return res.status(404).json({ error: "Percakapan tidak ditemukan" });
    res.json({ ok: true });
  }
);

/** Hapus satu pesan dari sebuah percakapan. */
conversationsRouter.delete(
  "/conversations/:id/messages/:messageId",
  requireAuth,
  requireOwnerOrAdmin,
  async (req: AuthedRequest, res) => {
    const { rowCount } = await pool.query(
      `DELETE FROM messages m
       USING conversations conv, contacts c
       WHERE m.id = $1
         AND m.conversation_id = $2
         AND conv.id = m.conversation_id
         AND conv.contact_id = c.id
         AND c.organization_id = $3`,
      [req.params.messageId, req.params.id, req.auth!.organizationId]
    );
    if (!rowCount) return res.status(404).json({ error: "Pesan tidak ditemukan" });
    res.json({ ok: true });
  }
);

/** Arsipkan percakapan (status -> 'archived') — disembunyikan dari inbox default (lihat GET /conversations). */
conversationsRouter.post(
  "/conversations/:id/archive",
  requireAuth,
  requireOwnerOrAdmin,
  async (req: AuthedRequest, res) => {
    const { rows } = await pool.query(
      `UPDATE conversations conv SET status = 'archived'
       FROM contacts c
       WHERE conv.id = $1 AND conv.contact_id = c.id AND c.organization_id = $2
       RETURNING conv.id`,
      [req.params.id, req.auth!.organizationId]
    );
    if (!rows[0]) return res.status(404).json({ error: "Percakapan tidak ditemukan" });
    res.json({ ok: true, status: "archived" });
  }
);

/** Kembalikan percakapan yang diarsipkan (status -> 'open'). */
conversationsRouter.post(
  "/conversations/:id/unarchive",
  requireAuth,
  requireOwnerOrAdmin,
  async (req: AuthedRequest, res) => {
    const { rows } = await pool.query(
      `UPDATE conversations conv SET status = 'open'
       FROM contacts c
       WHERE conv.id = $1 AND conv.contact_id = c.id AND c.organization_id = $2
       RETURNING conv.id`,
      [req.params.id, req.auth!.organizationId]
    );
    if (!rows[0]) return res.status(404).json({ error: "Percakapan tidak ditemukan" });
    res.json({ ok: true, status: "open" });
  }
);
