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
 * closing_won (atau event bisnis lain yang relevan).
 */
export async function reportConversionToMeta({
  conversationId,
  eventName,
  value,
  currency = "IDR",
}: ReportConversionParams) {
  const { rows } = await pool.query(
    "SELECT ctwa_clid, conversion_reported FROM conversations WHERE id = $1",
    [conversationId]
  );
  const conversation = rows[0];

  if (!conversation?.ctwa_clid) {
    // Bukan chat yang datang dari iklan CTWA — tidak ada yang bisa dilaporkan.
    console.log(`[capi] Conversation ${conversationId} tidak punya ctwa_clid, dilewati.`);
    return null;
  }

  if (!config.capi.pixelId || !config.capi.accessToken) {
    throw new Error(
      "Meta CAPI belum dikonfigurasi — isi META_PIXEL_ID & META_CAPI_ACCESS_TOKEN di .env " +
        "(lihat Bab 8 dokumen rencana untuk cara mendapatkannya)."
    );
  }

  const payload = {
    data: [
      {
        event_name: eventName,
        event_time: Math.floor(Date.now() / 1000),
        action_source: "business_messaging",
        messaging_channel: "whatsapp",
        ctwa_clid: conversation.ctwa_clid,
        ...(value !== undefined ? { custom_data: { value, currency } } : {}),
      },
    ],
  };

  const url = `https://graph.facebook.com/${config.whatsapp.graphApiVersion}/${config.capi.pixelId}/events?access_token=${config.capi.accessToken}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();

  await pool.query(
    `INSERT INTO ad_conversion_events (conversation_id, event_name, ctwa_clid, payload_sent, response_status)
     VALUES ($1, $2, $3, $4, $5)`,
    [conversationId, eventName, conversation.ctwa_clid, JSON.stringify(payload), res.status]
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
