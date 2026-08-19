import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import { startQrSession, disconnectQrSession } from "../whatsapp/qrSessionManager";

export const qrChannelsRouter = Router();

const createQrChannelSchema = z.object({
  label: z.string().optional(),
  ownerUserId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
});

/**
 * Daftarkan nomor WA baru dengan koneksi QR/kode pairing (BUKAN Cloud API
 * resmi) — dipakai untuk nomor TIM yang belum bisa dapat akses Cloud API
 * resmi dari Meta. Setelah dibuat, panggil POST /channels/:id/qr/start
 * untuk memunculkan QR code atau kode pairing yang di-scan/dimasukkan dari HP.
 */
qrChannelsRouter.post("/channels/qr", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = createQrChannelSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { label, ownerUserId, productId, departmentId } = parsed.data;

  const { rows } = await pool.query(
    `INSERT INTO whatsapp_channels
       (organization_id, department_id, product_id, owner_user_id, label, connection_type, connection_state, status)
     VALUES ($1, $2, $3, $4, $5, 'qr_session', 'idle', 'pending')
     RETURNING id, label, status, connection_type, connection_state`,
    [req.auth!.organizationId, departmentId ?? null, productId ?? null, ownerUserId ?? null, label ?? null]
  );
  res.status(201).json(rows[0]);
});

async function loadOwnedChannel(channelId: string, organizationId: string) {
  const { rows } = await pool.query(
    "SELECT * FROM whatsapp_channels WHERE id = $1 AND organization_id = $2 AND connection_type = 'qr_session'",
    [channelId, organizationId]
  );
  return rows[0];
}

const startQrSchema = z.object({
  method: z.enum(["qr", "pairing"]).default("qr"),
  // Wajib diisi kalau method === "pairing" — nomor HP tujuan, format internasional (mis. 62812xxxxxxx)
  phoneNumber: z.string().min(8).optional(),
});

/**
 * Mulai proses sambung: minta CakapCepat membuka socket WhatsApp Web untuk
 * channel ini, lalu tampilkan QR code (poll GET .../qr/status utk gambarnya)
 * atau minta kode pairing 8-digit yang dimasukkan manual dari HP
 * (Pengaturan > Perangkat Tertaut > Tautkan dengan nomor telepon).
 */
qrChannelsRouter.post("/channels/:id/qr/start", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = startQrSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { method, phoneNumber } = parsed.data;

  const channel = await loadOwnedChannel(req.params.id, req.auth!.organizationId);
  if (!channel) return res.status(404).json({ error: "Channel QR tidak ditemukan" });
  if (method === "pairing" && !phoneNumber) {
    return res.status(400).json({ error: "Nomor HP wajib diisi untuk metode kode pairing" });
  }

  try {
    await startQrSession(channel.id, req.auth!.organizationId, {
      pairingPhoneNumber: method === "pairing" ? phoneNumber : undefined,
    });
    res.json({ ok: true });
  } catch (err: any) {
    console.error("[qr-channels] Gagal memulai sesi QR:", err);
    res.status(500).json({ error: "Gagal memulai sesi WhatsApp", detail: String(err?.message ?? err) });
  }
});

/**
 * Dipoll dari frontend tiap beberapa detik selagi menunggu QR di-scan /
 * kode pairing dimasukkan, sampai connection_state jadi "connected".
 */
qrChannelsRouter.get("/channels/:id/qr/status", requireAuth, async (req: AuthedRequest, res) => {
  const channel = await loadOwnedChannel(req.params.id, req.auth!.organizationId);
  if (!channel) return res.status(404).json({ error: "Channel QR tidak ditemukan" });

  res.json({
    connectionState: channel.connection_state,
    status: channel.status,
    qrDataUrl: channel.qr_data_url,
    pairingCode: channel.pairing_code,
    displayPhoneNumber: channel.display_phone_number,
  });
});

/** Putuskan sesi (logout beneran dari HP) — dipakai sebelum CS pakai nomor lain, atau nomor mau dihapus. */
qrChannelsRouter.post("/channels/:id/qr/disconnect", requireAuth, async (req: AuthedRequest, res) => {
  const channel = await loadOwnedChannel(req.params.id, req.auth!.organizationId);
  if (!channel) return res.status(404).json({ error: "Channel QR tidak ditemukan" });

  await disconnectQrSession(channel.id);
  res.json({ ok: true });
});
