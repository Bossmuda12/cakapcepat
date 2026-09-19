import { pool } from "../db/pool";
import { writePlatformAudit, type PlatformRequest } from "./auth";

/**
 * PERSETUJUAN DUA-MATA (four-eyes).
 *
 * Untuk tindakan yang paling sulit dibatalkan, satu orang tidak cukup. Bukan
 * karena stafnya tidak dipercaya — tapi karena satu akun yang diambil alih,
 * satu klik yang salah, atau satu orang yang sedang marah seharusnya tidak
 * bisa mematikan penjual secara permanen sendirian.
 *
 * Yang disimpan bukan deskripsi tindakannya, tapi RENCANA-nya (payload). Jadi
 * yang disetujui penyetuju kedua adalah persis tindakan yang akan dijalankan,
 * bukan ringkasan yang bisa berbeda dari isinya.
 */
export const JENIS_PERLU_DUA_MATA = {
  "tenant.disable": "Menonaktifkan penjual secara permanen",
  "platform_admin.role_change": "Mengubah peran staf platform",
  "platform_admin.deactivate": "Menonaktifkan staf platform",
} as const;

export type JenisPersetujuan = keyof typeof JENIS_PERLU_DUA_MATA;

export interface BuatPersetujuanParams {
  req: PlatformRequest;
  type: JenisPersetujuan;
  targetType: "organization" | "platform_admin";
  targetId: string;
  targetLabel: string | null;
  payload: Record<string, unknown>;
  reasonCode: string;
  reasonText: string;
}

/** Tandai permintaan yang sudah lewat masa berlakunya. Dipanggil sebelum dibaca. */
export async function kedaluwarsakanYangLewat(): Promise<void> {
  await pool.query(
    `UPDATE platform_approvals SET status = 'expired'
     WHERE status = 'pending' AND expires_at < now()`
  );
}

export async function buatPermintaan(p: BuatPersetujuanParams) {
  await kedaluwarsakanYangLewat();

  const { rows } = await pool.query(
    `INSERT INTO platform_approvals
       (type, target_type, target_id, target_label, payload, reason_code, reason_text,
        requested_by, requested_email)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (type, target_id) WHERE status = 'pending' DO NOTHING
     RETURNING id, type, target_id, expires_at`,
    [
      p.type,
      p.targetType,
      p.targetId,
      p.targetLabel,
      JSON.stringify(p.payload),
      p.reasonCode,
      p.reasonText,
      p.req.platform!.platformAdminId,
      p.req.platform!.email,
    ]
  );

  if (!rows[0]) {
    // Sudah ada permintaan aktif untuk sasaran yang sama. Dikembalikan apa
    // adanya, bukan dibuatkan permintaan kembar — lima permintaan identik
    // hanya memperbesar peluang salah satunya disetujui tanpa dibaca teliti.
    const { rows: adaRows } = await pool.query(
      `SELECT id, requested_email, created_at FROM platform_approvals
       WHERE type = $1 AND target_id = $2 AND status = 'pending'`,
      [p.type, p.targetId]
    );
    return { dibuat: false as const, permintaan: adaRows[0] ?? null };
  }

  await writePlatformAudit({
    req: p.req,
    action: `approval.requested:${p.type}`,
    targetType: p.targetType,
    targetId: p.targetId,
    reasonCode: p.reasonCode,
    reasonText: p.reasonText,
    detail: { approvalId: rows[0].id, payload: p.payload },
  });

  return { dibuat: true as const, permintaan: rows[0] };
}

export interface HasilKeputusan {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Setujui atau tolak. Pelaksana tindakannya dioper dari pemanggil supaya file
 * ini tidak perlu tahu cara menjalankan tiap jenis tindakan.
 */
export async function putuskan(
  req: PlatformRequest,
  approvalId: string,
  keputusan: "approve" | "reject",
  alasan: string,
  jalankan: (baris: any) => Promise<{ ok: boolean; pesan: string }>
): Promise<HasilKeputusan> {
  await kedaluwarsakanYangLewat();

  const { rows } = await pool.query("SELECT * FROM platform_approvals WHERE id = $1", [approvalId]);
  const p = rows[0];
  if (!p) return { status: 404, body: { error: "Permintaan tidak ditemukan" } };

  if (p.status !== "pending") {
    return {
      status: 409,
      body: { error: `Permintaan ini sudah "${p.status}", tidak bisa diputuskan lagi`, currentStatus: p.status },
    };
  }

  // INTI FOUR-EYES: pemohon tidak boleh jadi penyetuju.
  //
  // Diperiksa di sini, di server, bukan dengan menyembunyikan tombolnya di
  // layar — tombol yang disembunyikan tetap bisa dipanggil langsung lewat API.
  if (p.requested_by === req.platform!.platformAdminId) {
    await writePlatformAudit({
      req,
      action: "approval.self_decision_blocked",
      targetType: p.target_type,
      targetId: p.target_id,
      detail: { approvalId, type: p.type },
    });
    return {
      status: 403,
      body: { error: "Kamu yang mengajukan permintaan ini — persetujuan harus dari orang lain" },
    };
  }

  if (keputusan === "reject") {
    await pool.query(
      `UPDATE platform_approvals
       SET status = 'rejected', decided_by = $1, decided_email = $2, decision_reason = $3, decided_at = now()
       WHERE id = $4 AND status = 'pending'`,
      [req.platform!.platformAdminId, req.platform!.email, alasan, approvalId]
    );
    await writePlatformAudit({
      req,
      action: `approval.rejected:${p.type}`,
      targetType: p.target_type,
      targetId: p.target_id,
      reasonText: alasan,
      detail: { approvalId },
    });
    return { status: 200, body: { ok: true, message: "Permintaan ditolak." } };
  }

  const hasil = await jalankan(p);
  if (!hasil.ok) {
    return { status: 409, body: { error: hasil.pesan } };
  }

  await pool.query(
    `UPDATE platform_approvals
     SET status = 'approved', decided_by = $1, decided_email = $2, decision_reason = $3, decided_at = now()
     WHERE id = $4 AND status = 'pending'`,
    [req.platform!.platformAdminId, req.platform!.email, alasan, approvalId]
  );
  await writePlatformAudit({
    req,
    action: `approval.approved:${p.type}`,
    targetType: p.target_type,
    targetId: p.target_id,
    reasonText: alasan,
    detail: { approvalId, diajukanOleh: p.requested_email },
  });

  return { status: 200, body: { ok: true, message: hasil.pesan } };
}
