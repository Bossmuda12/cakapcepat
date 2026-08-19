import crypto from "node:crypto";
import { config } from "../config";
import { pool } from "../db/pool";

interface ReportConversionParams {
  conversationId: string;
  eventName: string; // mis. "Lead" | "Purchase" | nama custom event lain
  value?: number;
  currency?: string; // mis. "IDR"
}

/**
 * Laporkan konversi (mis. closing/lead) balik ke Meta lewat Conversions API
 * for Business Messaging, supaya iklan CTWA punya data hasil closing —
 * bukan cuma jumlah chat masuk. Lihat Bab 8 dokumen rencana untuk alur lengkap.
 *
 * Dipanggil dari routes/conversations.ts saat agent menandai lead sebagai
 * closing_won, dan dari routes/orders.ts saat status order COD diupdate jadi
 * qualified_cod/closing (lihat STATUS_TO_CAPI_EVENT di sana).
 */
export async function reportConversionToMeta({
  conversationId,
  eventName,
  value,
  currency = "IDR",
}: ReportConversionParams) {
  const { rows } = await pool.query(
    `SELECT conv.ctwa_clid, conv.conversion_reported, c.wa_number, o.capi_pixel_id, o.capi_access_token
     FROM conversations conv
     JOIN contacts c ON c.id = conv.contact_id
     JOIN organization o ON o.id = c.organization_id
     WHERE conv.id = $1`,
    [conversationId]
  );
  const row = rows[0];

  if (!row?.ctwa_clid) {
    // Bukan chat yang datang dari iklan CTWA — tidak ada yang bisa dilaporkan.
    console.log(`[capi] Conversation ${conversationId} tidak punya ctwa_clid, dilewati.`);
    return null;
  }

  // Kredensial CAPI: utamakan yang diatur lewat dashboard (tabel organization),
  // fallback ke env var kalau belum diisi lewat dashboard.
  const pixelId: string | undefined = row.capi_pixel_id || config.capi.pixelId || undefined;
  const accessToken: string | undefined = row.capi_access_token || config.capi.accessToken || undefined;

  if (!pixelId || !accessToken) {
    throw new Error(
      "Meta CAPI belum dikonfigurasi — isi Pixel ID & Access Token di halaman CTWA & Iklan pada dashboard."
    );
  }

  // Sertakan nomor HP yang di-hash (SHA-256, wajib format E.164 tanpa "+") di
  // user_data supaya Event Match Quality di Events Manager lebih tinggi —
  // ctwa_clid saja biasanya sudah cukup untuk attribusi, tapi makin lengkap
  // sinyalnya makin akurat (lihat catatan awal permintaan fitur ini).
  const normalizedPhone = row.wa_number ? row.wa_number.replace(/[^0-9]/g, "") : null;

  const payload = {
    data: [
      {
        event_name: eventName,
        event_time: Math.floor(Date.now() / 1000),
        action_source: "business_messaging",
        messaging_channel: "whatsapp",
        ctwa_clid: row.ctwa_clid,
        ...(normalizedPhone ? { user_data: { ph: [sha256(normalizedPhone)] } } : {}),
        ...(value !== undefined ? { custom_data: { value, currency } } : {}),
      },
    ],
  };

  const url = `https://graph.facebook.com/${config.whatsapp.graphApiVersion}/${pixelId}/events?access_token=${accessToken}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();

  await pool.query(
    `INSERT INTO ad_conversion_events (conversation_id, event_name, ctwa_clid, payload_sent, response_status)
     VALUES ($1, $2, $3, $4, $5)`,
    [conversationId, eventName, row.ctwa_clid, JSON.stringify(payload), res.status]
  );

  if (res.ok) {
    await pool.query("UPDATE conversations SET conversion_reported = true WHERE id = $1", [conversationId]);
  } else {
    console.error(`[capi] Gagal kirim event ke Meta:`, data);
  }

  return data;
}

// Dipakai kalau perlu hash data pelanggan (email/nomor) untuk event CAPI berbasis
// identitas lain di luar ctwa_clid — CAPI mensyaratkan hash SHA-256 untuk PII.
export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}
