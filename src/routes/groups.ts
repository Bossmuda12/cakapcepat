import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool";
import { requireAuth, requireOwnerOrAdmin, type AuthedRequest } from "../middleware/auth";
import * as qrSessionManager from "../whatsapp/qrSessionManager";

export const groupsRouter = Router();

export interface WhatsAppGroupInfo {
  jid: string;
  name: string;
}

// PENTING (lihat laporan tugas): src/whatsapp/qrSessionManager.ts BELUM
// mengekspor fungsi ini — agen ini dilarang mengubah file di src/whatsapp/*,
// jadi diakses lewat cast defensif (bukan named import statis) supaya
// `tsc --noEmit` tetap lolos SEKARANG walau fungsinya belum ada, dan endpoint
// di bawah otomatis berfungsi begitu agen WhatsApp menambahkannya (tidak
// perlu redeploy file ini lagi). Kalau belum ada, endpoint GET /groups/:channelId
// membalas 501 dengan pesan jelas.
type ListGroupsFn = (channelId: string) => Promise<WhatsAppGroupInfo[]>;
const listGroupsForChannel = (qrSessionManager as unknown as { listGroupsForChannel?: ListGroupsFn })
  .listGroupsForChannel;

/**
 * F-19: daftar grup WhatsApp yang diikuti nomor (channel) tertentu — dipakai
 * dashboard utk pemilih "pilih grup closingan". Cuma masuk akal utk channel
 * jalur QR/pairing (Baileys) — grup WhatsApp bukan konsep yang didukung lewat
 * WhatsApp Cloud API resmi.
 */
groupsRouter.get("/groups/:channelId", requireAuth, async (req: AuthedRequest, res) => {
  const { channelId } = req.params;

  const { rows: channelRows } = await pool.query(
    "SELECT id, connection_type FROM whatsapp_channels WHERE id = $1 AND organization_id = $2",
    [channelId, req.auth!.organizationId]
  );
  const channel = channelRows[0];
  if (!channel) return res.status(404).json({ error: "Nomor WhatsApp tidak ditemukan" });
  if (channel.connection_type !== "qr_session") {
    return res.status(400).json({
      error: "Daftar grup hanya tersedia untuk nomor jalur QR/pairing (bukan Cloud API resmi).",
    });
  }

  if (!listGroupsForChannel) {
    return res.status(501).json({
      error:
        "Fitur daftar grup belum tersedia — src/whatsapp/qrSessionManager.ts perlu menambahkan " +
        "export async function listGroupsForChannel(channelId: string): Promise<{jid:string;name:string}[]> " +
        "(mis. lewat sock.groupFetchAllParticipating() dari Baileys) sebelum endpoint ini bisa dipakai.",
    });
  }

  try {
    const groups = await listGroupsForChannel(channelId);
    res.json({ items: groups });
  } catch (err) {
    console.error(`[groups] Gagal ambil daftar grup channel ${channelId}:`, err);
    res.status(500).json({ error: "Gagal mengambil daftar grup WhatsApp. Coba lagi." });
  }
});

const selectGroupSchema = z.object({
  channelId: z.string().uuid(),
  jid: z.string().trim().min(1),
  name: z.string().trim().min(1).max(200),
});

/**
 * F-19: simpan pilihan grup closingan — dipakai reportClosingsToGroup() &
 * sendDailyGroupSummary() (src/jobs/groupReport.ts) utk tahu mau kirim ke
 * grup mana lewat channel mana.
 */
groupsRouter.post("/groups/select", requireAuth, requireOwnerOrAdmin, async (req: AuthedRequest, res) => {
  const parsed = selectGroupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { channelId, jid, name } = parsed.data;

  const { rows: channelRows } = await pool.query(
    "SELECT id, connection_type FROM whatsapp_channels WHERE id = $1 AND organization_id = $2",
    [channelId, req.auth!.organizationId]
  );
  const channel = channelRows[0];
  if (!channel) return res.status(400).json({ error: "channelId tidak ditemukan di organisasi ini" });
  if (channel.connection_type !== "qr_session") {
    return res.status(400).json({ error: "Grup closingan hanya bisa dikirim lewat nomor jalur QR/pairing" });
  }
  if (!jid.includes("@")) {
    return res.status(400).json({ error: "jid grup tidak valid (harus mengandung @, mis. 1203xxxx@g.us)" });
  }

  await pool.query(
    `UPDATE organization SET
       closing_group_jid = $2,
       closing_group_name = $3,
       closing_group_channel_id = $4
     WHERE id = $1`,
    [req.auth!.organizationId, jid, name, channelId]
  );
  res.json({ ok: true });
});
