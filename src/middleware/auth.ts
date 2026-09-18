import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config";
import { pool } from "../db/pool";
import { AUD_PLATFORM } from "../platform/auth";

export interface AuthedRequest extends Request {
  auth?: { userId: string; organizationId: string; role: string };
}

/**
 * Cache kecil di dalam proses untuk baris `users`.
 *
 * Kenapa perlu: sekarang SETIAP request yang login memeriksa ulang penggunanya
 * ke database (alasan di bawah). Tanpa cache, halaman dasbor yang menembak 7
 * endpoint sekaligus jadi 7 query tambahan. Dengan TTL sependek ini, perubahan
 * peran atau penghapusan akun berlaku paling lambat beberapa detik — bukan
 * 30 hari seperti sebelumnya.
 */
const USER_CACHE_TTL_MS = 10_000;
const userCache = new Map<string, { at: number; row: UserRow | null }>();

interface UserRow {
  id: string;
  organization_id: string;
  role: string;
  org_status: string;
}

/**
 * Status organisasi yang MASIH boleh memakai API penjual.
 *
 * `restricted` sengaja ikut: penjual yang dibatasi tetap harus bisa masuk dan
 * melihat datanya sendiri — pembatasan fiturnya ditegakkan per-fitur, bukan
 * dengan mengunci seluruh pintu. `suspended` dan `disabled` yang benar-benar
 * ditolak di sini.
 */
const STATUS_BOLEH_MASUK = new Set(["active", "restricted"]);

/** Dipanggil setelah peran/akun berubah supaya efeknya langsung terasa. */
export function invalidateAuthCache(userId: string): void {
  userCache.delete(userId);
}

async function loadUser(userId: string): Promise<UserRow | null> {
  const cached = userCache.get(userId);
  if (cached && Date.now() - cached.at < USER_CACHE_TTL_MS) return cached.row;

  const { rows } = await pool.query<UserRow>(
    `SELECT u.id, u.organization_id, u.role, o.status AS org_status
     FROM users u JOIN organization o ON o.id = u.organization_id
     WHERE u.id = $1`,
    [userId]
  );
  const row = rows[0] ?? null;
  userCache.set(userId, { at: Date.now(), row });

  // Jangan biarkan map tumbuh selamanya di proses yang hidup lama.
  if (userCache.size > 5000) {
    const cutoff = Date.now() - USER_CACHE_TTL_MS;
    for (const [k, v] of userCache) if (v.at < cutoff) userCache.delete(k);
  }
  return row;
}

/**
 * Verifikasi token DAN cocokkan ulang ke baris `users` yang sebenarnya.
 *
 * Versi lama hanya `jwt.verify` lalu `req.auth = payload` — organisasi dan
 * peran diambil apa adanya dari token, tanpa sekali pun menyentuh database.
 * Token berlaku 30 hari tanpa refresh dan tanpa revoke, jadi akibatnya nyata:
 *
 *   - Pengguna yang DIHAPUS tetap punya akses penuh sampai 30 hari.
 *   - Pengguna yang DITURUNKAN dari admin jadi agent tetap admin sampai dia
 *     login ulang, karena requireOwnerOrAdmin membaca peran dari token.
 *
 * Sekarang: pengguna harus masih ada, organisasi di token harus sama dengan
 * organisasi di barisnya, dan PERAN DIAMBIL DARI DATABASE — token cuma dipakai
 * untuk membuktikan "ini siapa", bukan "ini boleh apa".
 */
export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.get("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) return res.status(401).json({ error: "Token tidak ditemukan" });

  let payload: { userId: string; organizationId: string; role: string; aud?: string | string[] };
  try {
    payload = jwt.verify(token, config.jwtSecret) as typeof payload;
  } catch {
    return res.status(401).json({ error: "Token tidak valid atau kedaluwarsa" });
  }

  // Token panel platform TIDAK boleh dipakai di API penjual. Keduanya
  // ditandatangani dengan rahasia yang sama, jadi tanpa pemeriksaan ini satu
  // sesi staf platform otomatis jadi sesi penjual mana pun yang dia mau.
  // Token penjual lama belum punya `aud` sama sekali — itu tetap diterima,
  // yang ditolak khusus adalah yang bertanda platform.
  const aud = payload.aud;
  const audList = Array.isArray(aud) ? aud : aud ? [aud] : [];
  if (audList.includes(AUD_PLATFORM)) {
    return res.status(401).json({ error: "Token panel platform tidak berlaku di sini" });
  }

  try {
    const user = await loadUser(payload.userId);

    // Akun sudah dihapus -> token ikut mati sekarang juga.
    if (!user) return res.status(401).json({ error: "Akun sudah tidak aktif — silakan masuk lagi" });

    // Organisasi di token tidak cocok dengan organisasi akunnya. Ini tidak
    // pernah normal: token lama dari organisasi sebelumnya, atau token yang
    // dirakit orang. Ditolak, tidak dipakai sebagiannya.
    if (user.organization_id !== payload.organizationId) {
      return res.status(401).json({ error: "Token tidak cocok dengan akun — silakan masuk lagi" });
    }

    // Penegakan dari panel Superadmin harus benar-benar berdampak, bukan cuma
    // label di layar admin. Organisasi yang ditangguhkan/dinonaktifkan ditolak
    // di SELURUH API penjual, di satu tempat — bukan ditambal per rute.
    if (!STATUS_BOLEH_MASUK.has(user.org_status)) {
      return res.status(403).json({
        error:
          user.org_status === "disabled"
            ? "Akun organisasi ini sudah dinonaktifkan. Hubungi dukungan CakapCepat."
            : "Akun organisasi ini sedang ditangguhkan sementara. Hubungi dukungan CakapCepat.",
        organizationStatus: user.org_status,
      });
    }

    req.auth = {
      userId: user.id,
      organizationId: user.organization_id,
      role: user.role, // dari database, BUKAN dari token
    };
    next();
  } catch (err) {
    console.error("[auth] Gagal memeriksa pengguna:", err);
    res.status(503).json({ error: "Tidak bisa memverifikasi sesi saat ini" });
  }
}

/**
 * P-14: helper pengecekan peran untuk endpoint yang mengubah hal sensitif
 * (daftar/ubah/hapus nomor WA, kirim/buat broadcast, aturan otomatisasi,
 * knowledge base, produk & departemen, dsb). Pasang SETELAH requireAuth,
 * mis. router.post("/x", requireAuth, requireOwnerOrAdmin, handler).
 * Endpoint BACA (GET) tidak perlu ini — tetap boleh diakses semua peran.
 *
 * Aman dibaca dari req.auth karena requireAuth sudah mengisinya dari database.
 */
export function requireOwnerOrAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (req.auth?.role !== "owner" && req.auth?.role !== "admin") {
    return res.status(403).json({ error: "Hanya owner/admin yang bisa melakukan aksi ini" });
  }
  next();
}
