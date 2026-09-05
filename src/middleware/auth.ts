import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config";

export interface AuthedRequest extends Request {
  auth?: { userId: string; organizationId: string; role: string };
}

/**
 * STUB SEDERHANA — single-organization, role-based (owner/admin/agent).
 * Belum production-ready: belum ada refresh token, revoke/logout, dsb.
 */
export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.get("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) return res.status(401).json({ error: "Token tidak ditemukan" });

  try {
    const payload = jwt.verify(token, config.jwtSecret) as {
      userId: string;
      organizationId: string;
      role: string;
    };
    req.auth = payload;
    next();
  } catch {
    res.status(401).json({ error: "Token tidak valid atau kedaluwarsa" });
  }
}

/**
 * P-14: helper pengecekan peran untuk endpoint yang mengubah hal sensitif
 * (daftar/ubah/hapus nomor WA, kirim/buat broadcast, aturan otomatisasi,
 * knowledge base, produk & departemen, dsb). Pasang SETELAH requireAuth,
 * mis. router.post("/x", requireAuth, requireOwnerOrAdmin, handler).
 * Endpoint BACA (GET) tidak perlu ini — tetap boleh diakses semua peran.
 */
export function requireOwnerOrAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (req.auth?.role !== "owner" && req.auth?.role !== "admin") {
    return res.status(403).json({ error: "Hanya owner/admin yang bisa melakukan aksi ini" });
  }
  next();
}
