import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config";
import { pool } from "../db/pool";

/**
 * AUDIENCE TOKEN TERPISAH.
 *
 * Ini inti pemisahan control plane. Token penjual dan token staf platform
 * ditandatangani dengan rahasia yang sama, jadi tanpa penanda audience,
 * sebuah token penjual akan lolos begitu saja di rute platform — dan
 * sebaliknya. Dengan `aud`, keduanya tidak bisa saling dipakai.
 *
 * Token penjual lama (dibuat sebelum ini ada) TIDAK punya `aud`. Itu
 * diperlakukan sebagai "tenant_app" supaya orang tidak tiba-tiba ter-logout,
 * tapi tetap DITOLAK di rute platform — yang longgar cuma sisi penjual.
 */
export const AUD_TENANT = "tenant_app";
export const AUD_PLATFORM = "platform_control_plane";

export interface PlatformContext {
  platformAdminId: string;
  email: string;
  role: PlatformRole;
  permissions: ReadonlySet<string>;
}

export interface PlatformRequest extends Request {
  platform?: PlatformContext;
}

export type PlatformRole = "platform_owner" | "platform_admin" | "support_agent" | "readonly_auditor";

/**
 * Izin berbutir, bukan satu boolean `isSuperAdmin`.
 *
 * Bedanya nyata: dengan satu boolean, setiap orang yang butuh MELIHAT daftar
 * penjual otomatis juga bisa MENONAKTIFKAN penjual. Di sini melihat dan
 * menonaktifkan adalah dua izin berbeda, dan sebagian besar staf cuma punya
 * yang pertama.
 */
export const PERMISSIONS = {
  DASHBOARD_READ: "platform.dashboard.read",
  TENANTS_READ: "platform.tenants.read",
  TENANTS_RESTRICT: "platform.tenants.restrict",
  TENANTS_SUSPEND: "platform.tenants.suspend",
  TENANTS_DISABLE: "platform.tenants.disable",
  TENANTS_REACTIVATE: "platform.tenants.reactivate",
  AUDIT_READ: "platform.audit.read",
  ADMINS_MANAGE: "platform.admins.manage",
} as const;

const ROLE_PERMISSIONS: Record<PlatformRole, string[]> = {
  readonly_auditor: [PERMISSIONS.DASHBOARD_READ, PERMISSIONS.TENANTS_READ, PERMISSIONS.AUDIT_READ],
  support_agent: [PERMISSIONS.DASHBOARD_READ, PERMISSIONS.TENANTS_READ],
  platform_admin: [
    PERMISSIONS.DASHBOARD_READ,
    PERMISSIONS.TENANTS_READ,
    PERMISSIONS.TENANTS_RESTRICT,
    PERMISSIONS.TENANTS_SUSPEND,
    PERMISSIONS.TENANTS_REACTIVATE,
    PERMISSIONS.AUDIT_READ,
  ],
  // Menonaktifkan penjual (disable) dan mengelola staf platform sengaja HANYA
  // di platform_owner — dua tindakan itu yang paling sulit dibatalkan.
  platform_owner: Object.values(PERMISSIONS),
};

export function permissionsFor(role: PlatformRole): ReadonlySet<string> {
  return new Set(ROLE_PERMISSIONS[role] ?? []);
}

export function signPlatformToken(adminId: string, role: PlatformRole): string {
  return jwt.sign({ platformAdminId: adminId, role }, config.jwtSecret, {
    audience: AUD_PLATFORM,
    // Jauh lebih pendek daripada 30 hari sesi penjual: panel ini bisa
    // menyentuh semua penjual sekaligus, jadi sesi yang tertinggal terbuka di
    // laptop jauh lebih mahal akibatnya.
    expiresIn: "8h",
  });
}

/**
 * Wajib untuk SEMUA rute /api/platform.
 *
 * Seperti requireAuth sisi penjual, perannya diambil dari database setiap
 * request (dengan cache pendek), bukan dari token — supaya mencabut akses
 * seorang staf berlaku dalam hitungan detik, bukan sampai tokennya
 * kedaluwarsa.
 */
const CACHE_TTL_MS = 10_000;
const cache = new Map<string, { at: number; row: AdminRow | null }>();

interface AdminRow {
  id: string;
  email: string;
  role: PlatformRole;
  is_active: boolean;
}

export function invalidatePlatformCache(adminId: string): void {
  cache.delete(adminId);
}

async function loadAdmin(id: string): Promise<AdminRow | null> {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.row;
  const { rows } = await pool.query<AdminRow>(
    "SELECT id, email, role, is_active FROM platform_admins WHERE id = $1",
    [id]
  );
  const row = rows[0] ?? null;
  cache.set(id, { at: Date.now(), row });
  return row;
}

export async function requirePlatformAuth(req: PlatformRequest, res: Response, next: NextFunction) {
  const header = req.get("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Token tidak ditemukan" });

  let payload: { platformAdminId?: string; role?: PlatformRole };
  try {
    // audience diverifikasi di sini: token penjual akan gagal, bukan lolos.
    payload = jwt.verify(token, config.jwtSecret, { audience: AUD_PLATFORM }) as typeof payload;
  } catch {
    return res.status(401).json({ error: "Token panel platform tidak valid atau kedaluwarsa" });
  }
  if (!payload.platformAdminId) {
    return res.status(401).json({ error: "Token bukan token panel platform" });
  }

  try {
    const admin = await loadAdmin(payload.platformAdminId);
    if (!admin) return res.status(401).json({ error: "Akun staf platform tidak ditemukan" });
    if (!admin.is_active) return res.status(403).json({ error: "Akun staf platform sudah dinonaktifkan" });

    req.platform = {
      platformAdminId: admin.id,
      email: admin.email,
      role: admin.role, // dari database, bukan dari token
      permissions: permissionsFor(admin.role),
    };
    next();
  } catch (err) {
    console.error("[platform-auth] gagal memeriksa staf:", err);
    res.status(503).json({ error: "Tidak bisa memverifikasi sesi panel saat ini" });
  }
}

/** Pasang SETELAH requirePlatformAuth. */
export function requirePermission(permission: string) {
  return (req: PlatformRequest, res: Response, next: NextFunction) => {
    if (!req.platform?.permissions.has(permission)) {
      return res.status(403).json({
        error: `Peran ${req.platform?.role ?? "-"} tidak punya izin ${permission}`,
      });
    }
    next();
  };
}

/** Catatan audit control plane. Selalu dipanggil, tidak pernah opsional. */
export async function writePlatformAudit(params: {
  req: PlatformRequest;
  action: string;
  targetType?: string;
  targetId?: string | null;
  reasonCode?: string | null;
  reasonText?: string | null;
  detail?: unknown;
}): Promise<void> {
  const { req, action, targetType, targetId, reasonCode, reasonText, detail } = params;
  try {
    await pool.query(
      `INSERT INTO platform_audit_events
         (platform_admin_id, actor_email, action, target_type, target_id, reason_code, reason_text, detail, ip)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        req.platform?.platformAdminId ?? null,
        req.platform?.email ?? null,
        action,
        targetType ?? null,
        targetId ?? null,
        reasonCode ?? null,
        reasonText ?? null,
        detail ? JSON.stringify(detail) : null,
        req.ip ?? null,
      ]
    );
  } catch (err) {
    // Audit tidak boleh menggagalkan tindakannya, tapi juga tidak boleh hilang
    // diam-diam.
    console.error("[platform-audit] GAGAL MENCATAT:", action, err);
  }
}
