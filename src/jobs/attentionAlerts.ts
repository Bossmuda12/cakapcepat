import { pool } from "../db/pool";
import { sendViaQrSession } from "../whatsapp/qrSessionManager";

/**
 * F-39: Beri tahu owner lewat WhatsApp pribadinya kalau ada chat yang ditandai
 * "butuh perhatian" — dipicu pagar pengaman AI (pelanggan minta refund,
 * komplain, dsb) atau ditandai manual.
 *
 * Tanpa ini, tanda "butuh perhatian" hanya terlihat kalau owner kebetulan
 * membuka dashboard — padahal justru chat inilah yang paling mahal kalau
 * terlambat ditangani.
 *
 * Pengaman anti-dobel: conversations.attention_notified_at.
 * Digabung jadi SATU pesan per organisasi supaya owner tidak dibanjiri.
 */
export async function notifyAttentionNeeded(): Promise<number> {
  const { rows: orgs } = await pool.query(
    `SELECT o.id, o.daily_report_wa_number, o.daily_report_channel_id
     FROM organization o
     WHERE o.attention_alert_enabled = true
       AND o.daily_report_wa_number IS NOT NULL
       AND o.daily_report_channel_id IS NOT NULL`
  );

  let terkirim = 0;

  for (const org of orgs) {
    try {
      const { rows: convos } = await pool.query(
        `SELECT conv.id, conv.attention_reason, c.name AS contact_name, c.wa_number
         FROM conversations conv
         JOIN contacts c ON c.id = conv.contact_id
         WHERE c.organization_id = $1
           AND conv.needs_attention = true
           AND conv.attention_notified_at IS NULL
         ORDER BY conv.attention_at ASC
         LIMIT 20`,
        [org.id]
      );
      if (convos.length === 0) continue;

      const baris = convos
        .map(
          (c: any, i: number) =>
            `${i + 1}. ${c.contact_name || c.wa_number} — ${c.attention_reason || "perlu diperiksa"}`
        )
        .join("\n");

      const teks =
        `⚠️ *${convos.length} chat butuh perhatian Anda*\n\n${baris}\n\n` +
        `Buka dashboard CakapCepat untuk menanganinya. AI sudah berhenti membalas chat yang dikunci.`;

      await sendViaQrSession(org.daily_report_channel_id, org.daily_report_wa_number, teks);

      await pool.query(
        `UPDATE conversations SET attention_notified_at = now() WHERE id = ANY($1::uuid[])`,
        [convos.map((c: any) => c.id)]
      );
      terkirim += convos.length;
    } catch (err) {
      // Satu organisasi gagal tidak boleh menjatuhkan yang lain.
      console.error(`[jobs/attentionAlerts] Gagal memberi tahu organisasi ${org.id}:`, err);
    }
  }

  return terkirim;
}
