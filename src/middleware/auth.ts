import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config";
import { pool } from "../db/pool";

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
}

/** Dipanggil setelah peran/akun berubah supaya efeknya langsung terasa. */
export function invalidateAuthCache(userId: string): void {
  userCache.delete(userId);
}

async function loadUser(userId: string): Promise<UserRow | null> {
  const cached = userCache.get(userId);
  if (cached && Date.now() - cached.at < USER_CACHE_TTL_MS) return cached.row;

  const { rows } = await pool.query<UserRow>(
    "SELECT id, organization_id, role FROM users WHERE id = $1",
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

  let payload: { userId: string; organizationId: string; role: string };
  try {
    payload = jwt.verify(token, config.jwtSecret) as typeof payload;
  } catch {
    return res.status(401).json({ error: "Token tidak valid atau kedaluwarsa" });
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
