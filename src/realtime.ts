import type { Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import jwt from "jsonwebtoken";
import { config } from "./config";

interface AuthedSocket extends WebSocket {
  organizationId?: string;
  userId?: string;
}

const orgSockets = new Map<string, Set<AuthedSocket>>();

/**
 * Server WebSocket sederhana untuk update real-time di dashboard (halaman
 * Percakapan & Monitor): pesan baru masuk/keluar, dan perubahan status
 * percakapan. Semua koneksi di-scope per organization — broadcastToOrg
 * cuma mengirim ke client yang satu organization dengan event-nya.
 *
 * Autentikasi lewat query param ?token=<JWT> saat handshake (WebSocket
 * browser API tidak bisa kirim header Authorization custom).
 */
export function initRealtime(server: HttpServer) {
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws: AuthedSocket, req) => {
    try {
      const url = new URL(req.url ?? "", "http://localhost");
      const token = url.searchParams.get("token");
      if (!token) throw new Error("no token");
      const payload = jwt.verify(token, config.jwtSecret) as {
        userId: string;
        organizationId: string;
      };
      ws.organizationId = payload.organizationId;
      ws.userId = payload.userId;
    } catch {
      ws.close(4401, "unauthorized");
      return;
    }

    const orgId = ws.organizationId!;
    if (!orgSockets.has(orgId)) orgSockets.set(orgId, new Set());
    orgSockets.get(orgId)!.add(ws);

    ws.on("close", () => {
      orgSockets.get(orgId)?.delete(ws);
    });
    ws.on("error", () => {
      orgSockets.get(orgId)?.delete(ws);
    });

    ws.send(JSON.stringify({ type: "connected" }));
  });

  // Ping berkala supaya koneksi tidak ditutup paksa oleh proxy/load balancer
  // karena dianggap idle (Railway & kebanyakan reverse proxy punya idle timeout).
  const interval = setInterval(() => {
    for (const sockets of orgSockets.values()) {
      for (const ws of sockets) {
        if (ws.readyState === ws.OPEN) ws.ping();
      }
    }
  }, 30000);
  wss.on("close", () => clearInterval(interval));

  return wss;
}

export function broadcastToOrg(organizationId: string, event: Record<string, unknown>) {
  const sockets = orgSockets.get(organizationId);
  if (!sockets || sockets.size === 0) return;
  const payload = JSON.stringify(event);
  for (const ws of sockets) {
    if (ws.readyState === ws.OPEN) ws.send(payload);
  }
}
