import type { Response } from "express";
import { pool } from "../db/pool";
import { writePlatformAudit, type PlatformRequest } from "./auth";

/**
 * IZIN AKSES DUKUNGAN — berbatas waktu, satu penjual, hanya baca.
 *
 * Panel Superadmin sengaja tidak bisa membaca isi percakapan penjual. Tapi
 * kalau penjual melapor "AI-nya salah jawab", stafnya harus bisa melihat chat
 * yang dimaksud. Jawabannya bukan membuka aksesnya permanen, tapi izin yang
 * punya alasan, disetujui orang lain, mati sendiri, dan tiap pembacaannya
 * dicatat satu per satu.
 */

/** Tandai izin yang masa berlakunya sudah lewat. Dipanggil sebelum dipakai. */
export async function kedaluwarsakanIzin(): Promise<void> {
  await pool.query(
    `UPDATE platform_access_grants SET status = 'expired'
     WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at < now()`
  );
}

export interface IzinAktif {
  id: string;
  organization_id: string;
  organization_name: string | null;
  expires_at: string;
  ticket_ref: string;
  purpose: string;
}

/** Izin aktif milik staf ini untuk organisasi ini — atau null. */
export async function izinAktifUntuk(
  platformAdminId: string,
  organizationId: string
): Promise<IzinAktif | null> {
  await kedaluwarsakanIzin();
  const { rows } = await pool.query<IzinAktif>(
    `SELECT id, organization_id, organization_name, expires_at, ticket_ref, purpose
     FROM platform_access_grants
     WHERE platform_admin_id = $1 AND organization_id = $2
       AND status = 'active' AND expires_at > now()`,
    [platformAdminId, organizationId]
  );
  return rows[0] ?? null;
}

/**
 * Pagar untuk setiap rute yang membaca DATA ISI milik penjual.
 *
 * Mengembalikan izinnya kalau ada, atau null setelah mengirim 403 yang
 * menjelaskan apa yang harus dilakukan. Sengaja tidak melempar exception
 * supaya pemanggilnya terbaca lurus.
 */
export async function wajibPunyaIzin(
  req: PlatformRequest,
  res: Response,
  organizationId: string
): Promise<IzinAktif | null> {
  const izin = await izinAktifUntuk(req.platform!.platformAdminId, organizationId);
  if (!izin) {
    res.status(403).json({
      error:
        "Butuh izin akses dukungan yang masih berlaku untuk penjual ini. Ajukan lewat halaman penjual, lalu minta staf platform lain menyetujuinya.",
      needsAccessGrant: true,
    });
    return null;
  }
  return izin;
}

/**
 * Catat SATU pembacaan di bawah izin ini.
 *
 * Yang dicatat bukan cuma "pernah diberi akses", tapi setiap kali datanya
 * benar-benar dibuka — kalau ada yang menyalahgunakan, jejaknya per-akses,
 * bukan per-izin.
 */
export async function catatPembacaan(
  req: PlatformRequest,
  izin: IzinAktif,
  apa: string,
  detail?: Record<string, unknown>
): Promise<void> {
  await pool.query(
    "UPDATE platform_access_grants SET reads_count = reads_count + 1 WHERE id = $1",
    [izin.id]
  );
  await writePlatformAudit({
    req,
    action: `support_access.read:${apa}`,
    targetType: "organization",
    targetId: izin.organization_id,
    reasonCode: izin.ticket_ref,
    reasonText: izin.purpose,
    detail: { grantId: izin.id, ...detail },
  });
}
