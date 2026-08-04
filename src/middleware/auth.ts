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
