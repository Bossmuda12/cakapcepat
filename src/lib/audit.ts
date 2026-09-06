import { pool } from "../db/pool";

/**
 * F-41: Catatan aktivitas — siapa mengubah apa, kapan.
 *
 * Dipakai untuk perubahan yang berdampak uang atau susah dilacak kalau salah:
 * status pesanan, resi, COD, hapus percakapan/kontak, ubah nomor WhatsApp.
 * Sengaja TIDAK mencatat pembacaan biasa — catatan yang terlalu ramai justru
 * tidak pernah dibaca orang.
 *
 * Best-effort: kegagalan pencatatan TIDAK boleh menggagalkan aksi utamanya.
 */
export async function writeAudit(params: {
  organizationId: string;
  actorUserId?: string | null;
  action: string;
  entity?: string | null;
  entityId?: string | null;
  detail?: unknown;
}): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO audit_log (organization_id, actor_user_id, action, entity, entity_id, detail)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        params.organizationId,
        params.actorUserId ?? null,
        params.action,
        params.entity ?? null,
        params.entityId ?? null,
        params.detail === undefined ? null : JSON.stringify(params.detail),
      ]
    );
  } catch (err) {
    console.error("[audit] Gagal menulis catatan aktivitas (diabaikan):", err);
  }
}
