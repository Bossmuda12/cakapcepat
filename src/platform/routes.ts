import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { pool } from "../db/pool";
import {
  requirePlatformAuth,
  requirePermission,
  signPlatformToken,
  writePlatformAudit,
  permissionsFor,
  invalidatePlatformCache,
  PERMISSIONS,
  type PlatformRequest,
  type PlatformRole,
} from "./auth";
import {
  buatPermintaan,
  putuskan,
  kedaluwarsakanYangLewat,
  JENIS_PERLU_DUA_MATA,
  type JenisPersetujuan,
} from "./approvals";

export const platformRouter = Router();

// ============================================================================
// MASUK
// Tidak ada pendaftaran mandiri di control plane — sengaja. Staf platform
// pertama dibuat lewat `npm run platform:admin` di server, bukan lewat
// halaman web yang bisa dijangkau siapa saja.
// ============================================================================
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/**
 * Apakah panel ini sudah punya staf sama sekali?
 *
 * Hanya mengembalikan satu boolean — tidak ada email, tidak ada nama, tidak
 * ada jumlah. Tanpa ini, pemilik yang baru pertama membuka panelnya cuma
 * melihat "Email atau password salah" dan mengira ada yang rusak, padahal
 * akunnya memang belum pernah dibuat. Pesan gagal login sengaja tetap
 * seragam (lihat di bawah), jadi keterangan ini yang menjembatani.
 */
platformRouter.get("/platform/status", async (_req, res) => {
  const { rows } = await pool.query("SELECT count(*)::int AS n FROM platform_admins");
  res.json({ needsBootstrap: rows[0].n === 0 });
});

platformRouter.post("/platform/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Email atau password tidak valid" });

  const { rows } = await pool.query(
    "SELECT id, email, name, role, password_hash, is_active FROM platform_admins WHERE email = $1",
    [parsed.data.email.toLowerCase()]
  );
  const admin = rows[0];

  // Pesan gagal sengaja sama persis untuk "email tidak ada", "password salah",
  // dan "akun dinonaktifkan" — kalau dibedakan, halaman ini jadi alat untuk
  // menebak siapa saja staf platform.
  const gagal = () => res.status(401).json({ error: "Email atau password salah" });
  if (!admin || !admin.is_active) {
    // Tetap jalankan bcrypt supaya waktu responsnya tidak membocorkan
    // apakah emailnya ada.
    await bcrypt.compare(parsed.data.password, "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva");
    return gagal();
  }
  const cocok = await bcrypt.compare(parsed.data.password, admin.password_hash);
  if (!cocok) return gagal();

  await pool.query("UPDATE platform_admins SET last_login_at = now() WHERE id = $1", [admin.id]);
  const token = signPlatformToken(admin.id, admin.role as PlatformRole);

  await writePlatformAudit({
    req: { ...req, platform: { platformAdminId: admin.id, email: admin.email, role: admin.role, permissions: permissionsFor(admin.role) } } as PlatformRequest,
    action: "auth.login",
    targetType: "platform_admin",
    targetId: admin.id,
  });

  res.json({
    token,
    admin: {
      id: admin.id,
      email: admin.email,
      name: admin.name,
      role: admin.role,
      permissions: Array.from(permissionsFor(admin.role)),
    },
  });
});

platformRouter.get("/platform/me", requirePlatformAuth, async (req: PlatformRequest, res) => {
  const { rows } = await pool.query("SELECT id, email, name, role FROM platform_admins WHERE id = $1", [
    req.platform!.platformAdminId,
  ]);
  res.json({ ...rows[0], permissions: Array.from(req.platform!.permissions) });
});

// ============================================================================
// GANTI PASSWORD SENDIRI
//
// Wajib ada, dan bukan sekadar kenyamanan. Password staf pertama dibuat lewat
// environment variable di dashboard hosting — artinya nilainya sempat
// tersimpan sebagai teks biasa di sana, dan mungkin juga tercatat di tempat
// lain saat dituliskan. Tanpa cara mengganti dari dalam panel, satu-satunya
// jalan memutar password adalah mengisi ulang env itu lagi, yang justru
// mengulang masalahnya.
//
// Tersedia untuk SEMUA peran: hak mengelola staf lain tidak ada hubungannya
// dengan hak mengganti password sendiri.
// ============================================================================
const gantiPasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(12, "Password baru minimal 12 karakter"),
});

platformRouter.post("/platform/me/password", requirePlatformAuth, async (req: PlatformRequest, res) => {
  const parsed = gantiPasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { currentPassword, newPassword } = parsed.data;

  if (currentPassword === newPassword) {
    return res.status(400).json({ error: "Password baru harus berbeda dari yang sekarang" });
  }

  const { rows } = await pool.query("SELECT password_hash FROM platform_admins WHERE id = $1", [
    req.platform!.platformAdminId,
  ]);
  if (!rows[0]) return res.status(404).json({ error: "Akun tidak ditemukan" });

  // Password lama tetap diminta walaupun sesinya sudah terbukti sah. Kalau
  // tidak, sesi yang tertinggal terbuka di perangkat orang lain cukup untuk
  // mengunci pemilik aslinya keluar dari panelnya sendiri.
  const cocok = await bcrypt.compare(currentPassword, rows[0].password_hash);
  if (!cocok) {
    await writePlatformAudit({
      req,
      action: "auth.password_change_failed",
      targetType: "platform_admin",
      targetId: req.platform!.platformAdminId,
    });
    return res.status(401).json({ error: "Password sekarang salah" });
  }

  const hash = await bcrypt.hash(newPassword, 10);
  await pool.query("UPDATE platform_admins SET password_hash = $1 WHERE id = $2", [
    hash,
    req.platform!.platformAdminId,
  ]);

  await writePlatformAudit({
    req,
    action: "auth.password_changed",
    targetType: "platform_admin",
    targetId: req.platform!.platformAdminId,
  });

  // Password barunya TIDAK dicatat di audit, dan tidak pernah dikembalikan.
  res.json({ ok: true, message: "Password panel berhasil diganti." });
});

// ============================================================================
// RINGKASAN — semua angkanya dari database, tidak ada yang dikarang.
// ============================================================================
platformRouter.get(
  "/platform/dashboard",
  requirePlatformAuth,
  requirePermission(PERMISSIONS.DASHBOARD_READ),
  async (_req, res) => {
    const [tenants, channels, aktivitas, pesan] = await Promise.all([
      pool.query(`SELECT status, count(*)::int AS n FROM organization GROUP BY status`),
      pool.query(`SELECT status, count(*)::int AS n FROM whatsapp_channels GROUP BY status`),
      pool.query(
        `SELECT action, actor_email, target_type, target_id, reason_text, created_at
         FROM platform_audit_events ORDER BY created_at DESC LIMIT 10`
      ),
      pool.query(
        `SELECT count(*)::int AS n FROM messages WHERE created_at > now() - interval '24 hours'`
      ),
    ]);

    const byStatus = (rows: any[]) =>
      rows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.status ?? "unknown"]: r.n }), {});

    res.json({
      tenants: byStatus(tenants.rows),
      tenantsTotal: tenants.rows.reduce((a, r) => a + r.n, 0),
      channels: byStatus(channels.rows),
      messages24h: pesan.rows[0]?.n ?? 0,
      recentActions: aktivitas.rows,
      generatedAt: new Date().toISOString(),
    });
  }
);

// ============================================================================
// DAFTAR PENJUAL
// Sengaja TIDAK mengembalikan isi chat, nomor pelanggan, atau kredensial apa
// pun. Panel ini untuk mengurus akun, bukan untuk membaca percakapan orang.
// ============================================================================
const listSchema = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.enum(["active", "restricted", "suspended", "disabled"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

platformRouter.get(
  "/platform/tenants",
  requirePlatformAuth,
  requirePermission(PERMISSIONS.TENANTS_READ),
  async (req: PlatformRequest, res) => {
    const parsed = listSchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { q, status, limit, offset } = parsed.data;

    const where: string[] = [];
    const params: unknown[] = [];
    if (q) {
      params.push(`%${q}%`);
      where.push(`(o.name ILIKE $${params.length} OR EXISTS (
        SELECT 1 FROM users u WHERE u.organization_id = o.id AND u.email ILIKE $${params.length}))`);
    }
    if (status) {
      params.push(status);
      where.push(`o.status = $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    params.push(limit, offset);
    const { rows } = await pool.query(
      `SELECT o.id, o.name, o.status, o.status_reason, o.status_changed_at, o.created_at,
              (SELECT count(*)::int FROM users u WHERE u.organization_id = o.id) AS user_count,
              (SELECT count(*)::int FROM whatsapp_channels c WHERE c.organization_id = o.id) AS channel_count,
              (SELECT count(*)::int FROM orders od WHERE od.organization_id = o.id) AS order_count,
              (SELECT max(m.created_at) FROM messages m WHERE m.organization_id = o.id) AS last_message_at,
              (SELECT u.email FROM users u WHERE u.organization_id = o.id AND u.role = 'owner'
                ORDER BY u.created_at LIMIT 1) AS owner_email
       FROM organization o
       ${whereSql}
       ORDER BY o.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const { rows: countRows } = await pool.query(
      `SELECT count(*)::int AS n FROM organization o ${whereSql}`,
      params.slice(0, params.length - 2)
    );
    res.json({ items: rows, total: countRows[0]?.n ?? 0, limit, offset });
  }
);

platformRouter.get(
  "/platform/tenants/:id",
  requirePlatformAuth,
  requirePermission(PERMISSIONS.TENANTS_READ),
  async (req: PlatformRequest, res) => {
    const id = req.params.id;
    if (!z.string().uuid().safeParse(id).success) return res.status(400).json({ error: "ID tidak valid" });

    const { rows } = await pool.query(
      `SELECT id, name, status, status_reason, status_changed_at, created_at FROM organization WHERE id = $1`,
      [id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Organisasi tidak ditemukan" });

    const [users, channels, hitung, riwayat] = await Promise.all([
      pool.query(
        `SELECT id, email, name, role, created_at FROM users WHERE organization_id = $1 ORDER BY created_at`,
        [id]
      ),
      // Kredensial (access_token) SENGAJA tidak ikut diambil.
      pool.query(
        `SELECT id, label, connection_type, display_phone_number, status, ai_enabled, created_at
         FROM whatsapp_channels WHERE organization_id = $1 ORDER BY created_at`,
        [id]
      ),
      pool.query(
        `SELECT
           (SELECT count(*)::int FROM contacts WHERE organization_id = $1)      AS contacts,
           (SELECT count(*)::int FROM conversations WHERE organization_id = $1) AS conversations,
           (SELECT count(*)::int FROM messages WHERE organization_id = $1)      AS messages,
           (SELECT count(*)::int FROM orders WHERE organization_id = $1)        AS orders,
           (SELECT count(*)::int FROM products WHERE organization_id = $1)      AS products`,
        [id]
      ),
      pool.query(
        `SELECT action, actor_email, reason_code, reason_text, created_at
         FROM platform_audit_events
         WHERE target_type = 'organization' AND target_id = $1
         ORDER BY created_at DESC LIMIT 50`,
        [id]
      ),
    ]);

    await writePlatformAudit({
      req,
      action: "tenant.view",
      targetType: "organization",
      targetId: id,
    });

    res.json({
      organization: rows[0],
      users: users.rows,
      channels: channels.rows,
      counts: hitung.rows[0],
      history: riwayat.rows,
    });
  }
);

// ============================================================================
// PENEGAKAN
// Tiap tindakan wajib punya alasan tertulis, dicatat, dan punya izin sendiri.
// "Nonaktifkan" TIDAK sama dengan "hapus" — tidak ada satu baris data pun yang
// dihapus di sini.
// ============================================================================
const AKSI = {
  restrict: { status: "restricted", izin: PERMISSIONS.TENANTS_RESTRICT, label: "dibatasi" },
  suspend: { status: "suspended", izin: PERMISSIONS.TENANTS_SUSPEND, label: "ditangguhkan" },
  disable: { status: "disabled", izin: PERMISSIONS.TENANTS_DISABLE, label: "dinonaktifkan" },
  reactivate: { status: "active", izin: PERMISSIONS.TENANTS_REACTIVATE, label: "diaktifkan kembali" },
} as const;

const enforcementSchema = z.object({
  action: z.enum(["restrict", "suspend", "disable", "reactivate"]),
  reasonCode: z.string().trim().min(1).max(80),
  // Minimal 10 karakter: "spam" bukan alasan yang bisa dibaca ulang enam bulan
  // kemudian oleh orang lain yang harus memutuskan apakah ini boleh dibuka.
  reasonText: z.string().trim().min(10, "Alasan harus dijelaskan, minimal 10 karakter").max(2000),
  expectedStatus: z.string().min(1),
});

platformRouter.post(
  "/platform/tenants/:id/enforcement",
  requirePlatformAuth,
  async (req: PlatformRequest, res) => {
    const id = req.params.id;
    if (!z.string().uuid().safeParse(id).success) return res.status(400).json({ error: "ID tidak valid" });

    const parsed = enforcementSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { action, reasonCode, reasonText, expectedStatus } = parsed.data;
    const spec = AKSI[action];

    if (!req.platform!.permissions.has(spec.izin)) {
      return res.status(403).json({ error: `Peran ${req.platform!.role} tidak boleh melakukan "${action}"` });
    }

    // MENONAKTIFKAN PERMANEN butuh persetujuan orang kedua.
    //
    // Ini tindakan yang paling sulit dibatalkan di seluruh panel: penjualnya
    // kehilangan akses ke seluruh API, dan dalam keadaan normal tidak akan
    // dibuka lagi. Satu akun staf yang diambil alih tidak boleh cukup untuk
    // melakukannya. Membatasi dan menangguhkan tetap bisa langsung — keduanya
    // reversibel dan kadang memang harus cepat.
    if (action === "disable") {
      const { rows: org } = await pool.query("SELECT name, status FROM organization WHERE id = $1", [id]);
      if (!org[0]) return res.status(404).json({ error: "Organisasi tidak ditemukan" });
      if (org[0].status !== expectedStatus) {
        return res.status(409).json({
          error: `Status sudah berubah jadi "${org[0].status}" — muat ulang halaman dulu`,
          currentStatus: org[0].status,
        });
      }

      const hasil = await buatPermintaan({
        req,
        type: "tenant.disable",
        targetType: "organization",
        targetId: id,
        targetLabel: org[0].name,
        payload: { action: "disable", status: "disabled", expectedStatus },
        reasonCode,
        reasonText,
      });

      if (!hasil.dibuat) {
        return res.status(409).json({
          error: `Sudah ada permintaan menonaktifkan yang menunggu persetujuan (diajukan ${hasil.permintaan?.requested_email ?? "staf lain"})`,
          approvalId: hasil.permintaan?.id ?? null,
        });
      }

      return res.status(202).json({
        ok: true,
        needsSecondApproval: true,
        approvalId: hasil.permintaan.id,
        expiresAt: hasil.permintaan.expires_at,
        message:
          "Permintaan dicatat. Menonaktifkan penjual butuh persetujuan staf platform LAIN — kamu tidak bisa menyetujui permintaanmu sendiri.",
      });
    }

    // expectedStatus = kontrol konkurensi. Kalau admin lain sudah mengubah
    // status organisasi ini sejak halaman dimuat, tindakannya ditolak — bukan
    // menimpa keputusan orang lain tanpa dia tahu.
    const { rows } = await pool.query(
      "UPDATE organization SET status = $1, status_reason = $2, status_changed_at = now(), status_changed_by = $3 WHERE id = $4 AND status = $5 RETURNING id, name, status",
      [spec.status, reasonText, req.platform!.platformAdminId, id, expectedStatus]
    );

    if (!rows[0]) {
      const { rows: sekarang } = await pool.query("SELECT status FROM organization WHERE id = $1", [id]);
      if (!sekarang[0]) return res.status(404).json({ error: "Organisasi tidak ditemukan" });
      return res.status(409).json({
        error: `Status sudah berubah jadi "${sekarang[0].status}" — muat ulang halaman dulu`,
        currentStatus: sekarang[0].status,
      });
    }

    await writePlatformAudit({
      req,
      action: `tenant.${action}`,
      targetType: "organization",
      targetId: id,
      reasonCode,
      reasonText,
      detail: { from: expectedStatus, to: spec.status },
    });

    res.json({ ok: true, organization: rows[0], message: `Organisasi ${spec.label}.` });
  }
);

// ============================================================================
// ANTREAN PERSETUJUAN
// ============================================================================
platformRouter.get(
  "/platform/approvals",
  requirePlatformAuth,
  requirePermission(PERMISSIONS.TENANTS_READ),
  async (req: PlatformRequest, res) => {
    await kedaluwarsakanYangLewat();
    const status = typeof req.query.status === "string" ? req.query.status : "pending";
    const { rows } = await pool.query(
      `SELECT id, type, target_type, target_id, target_label, payload, reason_code, reason_text,
              requested_email, requested_by, status, decided_email, decision_reason, decided_at,
              expires_at, created_at
       FROM platform_approvals
       WHERE ($1 = 'semua' OR status = $1)
       ORDER BY created_at DESC LIMIT 100`,
      [status]
    );
    res.json({
      items: rows.map((r) => ({
        ...r,
        // Supaya layar bisa menonaktifkan tombolnya juga — tapi yang mengikat
        // tetap pemeriksaan di server, bukan ini.
        diajukanOlehSaya: r.requested_by === req.platform!.platformAdminId,
        judul: JENIS_PERLU_DUA_MATA[r.type as JenisPersetujuan] ?? r.type,
      })),
      jenis: JENIS_PERLU_DUA_MATA,
    });
  }
);

const keputusanSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  reason: z.string().trim().min(10, "Alasan keputusan minimal 10 karakter").max(2000),
});

platformRouter.post(
  "/platform/approvals/:id/decision",
  requirePlatformAuth,
  async (req: PlatformRequest, res) => {
    const parsed = keputusanSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const hasil = await putuskan(
      req,
      req.params.id,
      parsed.data.decision,
      parsed.data.reason,
      async (baris) => {
        if (baris.type === "tenant.disable") {
          if (!req.platform!.permissions.has(PERMISSIONS.TENANTS_DISABLE)) {
            return { ok: false, pesan: "Peran kamu tidak boleh menonaktifkan penjual" };
          }
          const { rows } = await pool.query(
            `UPDATE organization
             SET status = 'disabled', status_reason = $1, status_changed_at = now(), status_changed_by = $2
             WHERE id = $3 AND status = $4 RETURNING name`,
            [baris.reason_text, req.platform!.platformAdminId, baris.target_id, baris.payload.expectedStatus]
          );
          if (!rows[0]) {
            return { ok: false, pesan: "Status organisasi sudah berubah sejak permintaan diajukan — permintaan ini tidak lagi berlaku" };
          }
          return { ok: true, pesan: `Organisasi ${rows[0].name} dinonaktifkan.` };
        }

        if (baris.type === "platform_admin.role_change" || baris.type === "platform_admin.deactivate") {
          if (!req.platform!.permissions.has(PERMISSIONS.ADMINS_MANAGE)) {
            return { ok: false, pesan: "Peran kamu tidak boleh mengelola staf platform" };
          }
          const sets: string[] = [];
          const vals: unknown[] = [];
          if (baris.payload.role) { vals.push(baris.payload.role); sets.push(`role = $${vals.length}`); }
          if (baris.payload.isActive !== undefined) { vals.push(baris.payload.isActive); sets.push(`is_active = $${vals.length}`); }
          if (sets.length === 0) return { ok: false, pesan: "Rencana tindakan kosong" };
          vals.push(baris.target_id);
          const { rows } = await pool.query(
            `UPDATE platform_admins SET ${sets.join(", ")} WHERE id = $${vals.length} RETURNING email`,
            vals
          );
          if (!rows[0]) return { ok: false, pesan: "Staf platform tidak ditemukan" };
          invalidatePlatformCache(baris.target_id);
          return { ok: true, pesan: `Staf ${rows[0].email} diperbarui.` };
        }

        return { ok: false, pesan: `Jenis permintaan "${baris.type}" tidak dikenali` };
      }
    );
    res.status(hasil.status).json(hasil.body);
  }
);

// Pemohon boleh membatalkan permintaannya sendiri.
platformRouter.post(
  "/platform/approvals/:id/cancel",
  requirePlatformAuth,
  async (req: PlatformRequest, res) => {
    const { rows } = await pool.query(
      `UPDATE platform_approvals SET status = 'cancelled', decided_at = now()
       WHERE id = $1 AND status = 'pending' AND requested_by = $2 RETURNING id, type, target_id, target_type`,
      [req.params.id, req.platform!.platformAdminId]
    );
    if (!rows[0]) {
      return res.status(404).json({ error: "Permintaan tidak ditemukan, sudah diputuskan, atau bukan milikmu" });
    }
    await writePlatformAudit({
      req, action: `approval.cancelled:${rows[0].type}`,
      targetType: rows[0].target_type, targetId: rows[0].target_id,
    });
    res.json({ ok: true, message: "Permintaan dibatalkan." });
  }
);

// ============================================================================
// CATATAN AUDIT
// ============================================================================
platformRouter.get(
  "/platform/audit",
  requirePlatformAuth,
  requirePermission(PERMISSIONS.AUDIT_READ),
  async (req: PlatformRequest, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const { rows } = await pool.query(
      `SELECT a.id, a.action, a.actor_email, a.target_type, a.target_id,
              a.reason_code, a.reason_text, a.ip, a.created_at,
              o.name AS target_name
       FROM platform_audit_events a
       LEFT JOIN organization o ON o.id = a.target_id AND a.target_type = 'organization'
       ORDER BY a.created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    const { rows: c } = await pool.query("SELECT count(*)::int AS n FROM platform_audit_events");
    res.json({ items: rows, total: c[0].n, limit, offset });
  }
);

// ============================================================================
// STAF PLATFORM — hanya platform_owner
// ============================================================================
platformRouter.get(
  "/platform/admins",
  requirePlatformAuth,
  requirePermission(PERMISSIONS.ADMINS_MANAGE),
  async (_req, res) => {
    const { rows } = await pool.query(
      "SELECT id, email, name, role, is_active, last_login_at, created_at FROM platform_admins ORDER BY created_at"
    );
    res.json({ items: rows });
  }
);

const adminSchema = z.object({
  email: z.string().email(),
  name: z.string().trim().min(1),
  password: z.string().min(12, "Password staf platform minimal 12 karakter"),
  role: z.enum(["platform_owner", "platform_admin", "support_agent", "readonly_auditor"]),
});

platformRouter.post(
  "/platform/admins",
  requirePlatformAuth,
  requirePermission(PERMISSIONS.ADMINS_MANAGE),
  async (req: PlatformRequest, res) => {
    const parsed = adminSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { email, name, password, role } = parsed.data;

    const { rows: ada } = await pool.query("SELECT id FROM platform_admins WHERE email = $1", [
      email.toLowerCase(),
    ]);
    if (ada[0]) return res.status(409).json({ error: "Email ini sudah terdaftar sebagai staf platform" });

    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO platform_admins (email, name, password_hash, role)
       VALUES ($1,$2,$3,$4) RETURNING id, email, name, role, is_active, created_at`,
      [email.toLowerCase(), name, hash, role]
    );

    await writePlatformAudit({
      req,
      action: "platform_admin.create",
      targetType: "platform_admin",
      targetId: rows[0].id,
      detail: { role },
    });
    res.status(201).json(rows[0]);
  }
);

platformRouter.patch(
  "/platform/admins/:id",
  requirePlatformAuth,
  requirePermission(PERMISSIONS.ADMINS_MANAGE),
  async (req: PlatformRequest, res) => {
    const id = req.params.id;
    const schema = z.object({
      role: z.enum(["platform_owner", "platform_admin", "support_agent", "readonly_auditor"]).optional(),
      isActive: z.boolean().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    // Tidak bisa mengubah peran atau menonaktifkan diri sendiri. Ini mencegah
    // dua hal sekaligus: menaikkan diri sendiri diam-diam, dan mengunci diri
    // sendiri keluar sehingga tidak ada lagi yang bisa mengelola platform.
    if (id === req.platform!.platformAdminId) {
      return res.status(400).json({ error: "Tidak bisa mengubah peran atau status akun sendiri" });
    }

    if (parsed.data.role === undefined && parsed.data.isActive === undefined) {
      return res.status(400).json({ error: "Tidak ada perubahan dikirim" });
    }

    // Mengubah peran atau menonaktifkan staf platform butuh persetujuan orang
    // KETIGA (pemohon + penyetuju, keduanya bukan sasaran). Tanpa ini, satu
    // akun platform_owner yang diambil alih bisa menurunkan semua staf lain
    // lalu tinggal sendirian mengendalikan seluruh platform.
    const { rows: sasaran } = await pool.query(
      "SELECT email, role, is_active FROM platform_admins WHERE id = $1",
      [id]
    );
    if (!sasaran[0]) return res.status(404).json({ error: "Staf platform tidak ditemukan" });

    const jenis = parsed.data.role !== undefined ? "platform_admin.role_change" : "platform_admin.deactivate";
    const hasil = await buatPermintaan({
      req,
      type: jenis,
      targetType: "platform_admin",
      targetId: id,
      targetLabel: sasaran[0].email,
      payload: { ...parsed.data, isActive: parsed.data.isActive },
      reasonCode: jenis,
      reasonText: `Perubahan staf platform ${sasaran[0].email}: ${JSON.stringify(parsed.data)}`,
    });

    if (!hasil.dibuat) {
      return res.status(409).json({
        error: `Sudah ada permintaan perubahan untuk staf ini yang menunggu persetujuan (diajukan ${hasil.permintaan?.requested_email ?? "staf lain"})`,
        approvalId: hasil.permintaan?.id ?? null,
      });
    }
    res.status(202).json({
      ok: true,
      needsSecondApproval: true,
      approvalId: hasil.permintaan.id,
      expiresAt: hasil.permintaan.expires_at,
      message:
        "Permintaan dicatat. Perubahan peran/status staf platform butuh persetujuan staf LAIN — kamu tidak bisa menyetujui permintaanmu sendiri.",
    });
  }
);
