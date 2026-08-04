import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import { config } from "../config";

export const channelsRouter = Router();

/**
 * Daftar semua nomor WhatsApp yang terhubung, lengkap dengan siapa CS
 * pemiliknya dan untuk produk apa.
 */
channelsRouter.get("/channels", requireAuth, async (req: AuthedRequest, res) => {
  const { rows } = await pool.query(
    `SELECT wc.id, wc.label, wc.display_phone_number, wc.status,
            wc.owner_user_id, u.name AS owner_name,
            wc.product_id, p.name AS product_name,
            wc.department_id, d.name AS department_name,
            wc.created_at
     FROM whatsapp_channels wc
     LEFT JOIN users u ON u.id = wc.owner_user_id
     LEFT JOIN products p ON p.id = wc.product_id
     LEFT JOIN departments d ON d.id = wc.department_id
     WHERE wc.organization_id = $1
     ORDER BY wc.created_at DESC`,
    [req.auth!.organizationId]
  );
  res.json(rows);
});

const registerChannelSchema = z.object({
  phoneNumberId: z.string().min(1),
  accessToken: z.string().min(1),
  displayPhoneNumber: z.string().optional(),
  label: z.string().optional(),        // mis. "CS Budi - Skincare Line"
  ownerUserId: z.string().uuid().optional(),  // CS yang memegang nomor ini
  productId: z.string().uuid().optional(),    // produk yang dijual lewat nomor ini
  departmentId: z.string().uuid().optional(),
});

/**
 * Daftarkan nomor WhatsApp BARU ke CakapCepat.
 *
 * Alur di dunia nyata (lihat Bab 7 dokumen rencana):
 *   1. Tambahkan nomor baru ke WhatsApp Business Account (WABA) kamu lewat
 *      Meta Business Manager — cepat (menit-jam) begitu bisnis sudah terverifikasi.
 *      Ingat batas jumlah nomor: mulai 2, naik otomatis ke 20 setelah bisnis
 *      terverifikasi / 2.000 pesan terkirim, bisa ajukan sampai 50 lewat support Meta.
 *   2. Salin phone_number_id & buat access token (System User token) dari
 *      Meta Business Settings.
 *   3. Panggil endpoint ini untuk mendaftarkan nomor itu ke CakapCepat,
 *      sekalian assign ke CS & produk yang relevan.
 *
 * Ini BELUM "Embedded Signup" (alur klik-klik otomatis dari dashboard) —
 * itu peningkatan Fase 2 yang butuh setup tambahan Facebook Login for Business.
 * Untuk pemakaian internal dengan frekuensi nomor baru yang tidak terlalu
 * tinggi, alur manual + endpoint ini sudah cukup praktis.
 */
channelsRouter.post("/channels", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = registerChannelSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { phoneNumberId, accessToken, displayPhoneNumber, label, ownerUserId, productId, departmentId } =
    parsed.data;

  // Verifikasi ringan: pastikan phoneNumberId & accessToken benar-benar valid
  // dengan menanyakannya ke Meta, sebelum disimpan. Best-effort — kalau gagal,
  // tetap simpan sebagai status 'pending' supaya bisa dicek manual nanti.
  let status = "pending";
  try {
    const verifyRes = await fetch(
      `https://graph.facebook.com/${config.whatsapp.graphApiVersion}/${phoneNumberId}?fields=display_phone_number,verified_name`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (verifyRes.ok) status = "connected";
  } catch (err) {
    console.warn("[channels] Gagal verifikasi ke Meta, disimpan sebagai 'pending':", err);
  }

  const { rows } = await pool.query(
    `INSERT INTO whatsapp_channels
       (organization_id, department_id, product_id, owner_user_id, label,
        phone_number_id, display_phone_number, access_token, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, label, display_phone_number, status`,
    [
      req.auth!.organizationId,
      departmentId ?? null,
      productId ?? null,
      ownerUserId ?? null,
      label ?? null,
      phoneNumberId,
      displayPhoneNumber ?? null,
      accessToken,
      status,
    ]
  );
  res.status(201).json(rows[0]);
});

const reassignChannelSchema = z.object({
  ownerUserId: z.string().uuid().nullable().optional(),
  productId: z.string().uuid().nullable().optional(),
  departmentId: z.string().uuid().nullable().optional(),
});

/**
 * Pindahkan kepemilikan nomor — mis. CS resign dan nomornya dialihkan ke CS
 * baru, atau nomor lama dipakai ulang untuk produk yang berbeda.
 *
 * CATATAN developer: implementasi COALESCE di bawah ini hanya bisa MENGISI
 * field yang kosong, belum bisa dipakai untuk sengaja MENGOSONGKAN
 * (set ke NULL) owner/product/department yang sudah terisi. Kalau butuh
 * fitur "lepas kepemilikan", tambahkan flag terpisah (mis. `unsetOwner: true`)
 * daripada mengandalkan null lewat COALESCE.
 */
channelsRouter.patch("/channels/:id/assign", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = reassignChannelSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { ownerUserId, productId, departmentId } = parsed.data;

  const { rows } = await pool.query(
    `UPDATE whatsapp_channels SET
       owner_user_id = COALESCE($2, owner_user_id),
       product_id = COALESCE($3, product_id),
       department_id = COALESCE($4, department_id)
     WHERE id = $1 AND organization_id = $5
     RETURNING id, owner_user_id, product_id, department_id`,
    [req.params.id, ownerUserId, productId, departmentId, req.auth!.organizationId]
  );
  if (!rows[0]) return res.status(404).json({ error: "Channel tidak ditemukan" });
  res.json(rows[0]);
});
