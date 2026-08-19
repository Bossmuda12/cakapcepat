import { Router } from "express";
import { pool } from "../db/pool";
import { requireAuth, type AuthedRequest } from "../middleware/auth";

export const teamRouter = Router();

// Target pesan keluar per hari yang dipakai buat hitung persentase ring
// performa di kartu Tim. Nilai tetap dulu — bisa dipindah ke pengaturan
// per-organization kalau nanti dibutuhkan.
const DAILY_MESSAGE_TARGET = 20;

/**
 * Data buat halaman Tim (kartu performa CS): tiap anggota tim + departemen
 * yang diikuti + jumlah pesan keluar (manual, bukan AI) yang dikirim hari
 * ini + status aktif (ada aktivitas hari ini atau tidak).
 */
teamRouter.get("/team/performance", requireAuth, async (req: AuthedRequest, res) => {
  const organizationId = req.auth!.organizationId;

  const { rows: users } = await pool.query(
    `SELECT id, name, email, role, created_at FROM users
     WHERE organization_id = $1 ORDER BY created_at`,
    [organizationId]
  );

  const { rows: deptRows } = await pool.query(
    `SELECT dm.user_id, d.name FROM department_members dm
     JOIN departments d ON d.id = dm.department_id
     JOIN users u ON u.id = dm.user_id
     WHERE u.organization_id = $1`,
    [organizationId]
  );
  const deptByUser = new Map<string, string[]>();
  for (const row of deptRows) {
    const list = deptByUser.get(row.user_id) ?? [];
    list.push(row.name);
    deptByUser.set(row.user_id, list);
  }

  const { rows: statRows } = await pool.query(
    `SELECT
       m.sender_user_id AS user_id,
       COUNT(*) FILTER (WHERE m.created_at::date = CURRENT_DATE) AS messages_today,
       MAX(m.created_at) AS last_active_at
     FROM messages m
     JOIN conversations c ON c.id = m.conversation_id
     JOIN whatsapp_channels wc ON wc.id = c.channel_id
     WHERE wc.organization_id = $1 AND m.sender_user_id IS NOT NULL AND m.direction = 'outbound'
     GROUP BY m.sender_user_id`,
    [organizationId]
  );
  const statByUser = new Map<string, { messagesToday: number; lastActiveAt: string | null }>();
  for (const row of statRows) {
    statByUser.set(row.user_id, {
      messagesToday: Number(row.messages_today),
      lastActiveAt: row.last_active_at,
    });
  }

  const { rows: openRows } = await pool.query(
    `SELECT assigned_to AS user_id, COUNT(*) AS open_count
     FROM conversations
     WHERE assigned_to IS NOT NULL AND status = 'open'
       AND channel_id IN (SELECT id FROM whatsapp_channels WHERE organization_id = $1)
     GROUP BY assigned_to`,
    [organizationId]
  );
  const openByUser = new Map<string, number>();
  for (const row of openRows) {
    openByUser.set(row.user_id, Number(row.open_count));
  }

  // Status online/offline WA NYATA per anggota tim — bukan cuma "ada aktivitas
  // hari ini", tapi apakah nomor WA yang dia pegang beneran tersambung SEKARANG
  // (Cloud API: status='connected'; QR/pairing: connection_state='connected').
  // Kalau 1 orang pegang lebih dari 1 nomor, dianggap online kalau SALAH SATU
  // nomornya tersambung.
  const { rows: channelRows } = await pool.query(
    `SELECT owner_user_id AS user_id, connection_type, status, connection_state, label
     FROM whatsapp_channels
     WHERE organization_id = $1 AND owner_user_id IS NOT NULL`,
    [organizationId]
  );
  const onlineByUser = new Map<string, boolean>();
  const channelsByUser = new Map<string, { label: string | null; online: boolean }[]>();
  for (const row of channelRows) {
    const online =
      row.connection_type === "qr_session" ? row.connection_state === "connected" : row.status === "connected";
    if (online) onlineByUser.set(row.user_id, true);
    else if (!onlineByUser.has(row.user_id)) onlineByUser.set(row.user_id, false);
    const list = channelsByUser.get(row.user_id) ?? [];
    list.push({ label: row.label, online });
    channelsByUser.set(row.user_id, list);
  }

  const result = users.map((u) => {
    const stat = statByUser.get(u.id) ?? { messagesToday: 0, lastActiveAt: null };
    const percent = Math.max(0, Math.min(100, Math.round((stat.messagesToday / DAILY_MESSAGE_TARGET) * 100)));
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      departments: deptByUser.get(u.id) ?? [],
      messagesToday: stat.messagesToday,
      dailyTarget: DAILY_MESSAGE_TARGET,
      performancePercent: percent,
      openConversations: openByUser.get(u.id) ?? 0,
      isActiveToday: stat.messagesToday > 0,
      lastActiveAt: stat.lastActiveAt,
      waOnline: onlineByUser.get(u.id) ?? false,
      waChannels: channelsByUser.get(u.id) ?? [],
    };
  });

  res.json(result);
});
