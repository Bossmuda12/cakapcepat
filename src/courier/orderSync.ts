import { pool } from "../db/pool";
import type { ShippingStatus } from "../routes/orders";

// ============================================================================
// Logika "terapkan status dari kurir ke sebuah order" — dipakai BERSAMA oleh
// emailReader.ts (IMAP) dan routes/courier.ts (webhook), supaya kedua sumber
// (email & webhook) memperbarui order + mencatat order_events dengan cara
// yang PERSIS SAMA (satu tempat untuk diperbaiki kalau ada bug).
// ============================================================================

// Cukup kolom yang benar-benar dipakai di sini — pemanggil boleh mengoper
// baris `orders` penuh (dari `SELECT *`), TypeScript cuma memeriksa yang perlu.
export interface OrderForCourierSync {
  id: string;
  shipping_status: string;
  has_problem: boolean;
}

/**
 * Terapkan mappedStatus (hasil parseCourierEmail/mapStatusKeyword) ke sebuah
 * order: update orders.shipping_status/has_problem/problem_reason + kolom
 * waktu (shipped_at/delivered_at/returned_at, cuma diisi kalau masih kosong),
 * lalu catat perubahan ke order_events dengan source='courier_email' atau
 * 'courier_webhook' (bukan 'manual' — supaya kelihatan di riwayat bahwa
 * perubahan ini datang otomatis dari kurir, bukan diklik manual oleh CS/owner).
 *
 * SENGAJA TIDAK mengirim pesan WhatsApp apa pun dari sini — pengiriman
 * notifikasi "paket bermasalah" ke customer/grup dikerjakan agen/fitur lain
 * yang membaca order_events atau courier_events; di sini cukup datanya benar.
 */
export async function applyCourierStatusToOrder(
  order: OrderForCourierSync,
  mappedStatus: ShippingStatus,
  rawStatus: string | null,
  source: "courier_email" | "courier_webhook"
): Promise<void> {
  const hasProblem = mappedStatus === "problem";

  await pool.query(
    `UPDATE orders SET
       shipping_status = $1,
       has_problem = $2,
       problem_reason = CASE WHEN $2 THEN COALESCE($3, problem_reason) ELSE problem_reason END,
       problem_at = CASE WHEN $2 AND problem_at IS NULL THEN now() ELSE problem_at END,
       shipped_at = CASE WHEN $1 IN ('handed_to_courier','in_transit','delivered') AND shipped_at IS NULL
                      THEN now() ELSE shipped_at END,
       delivered_at = CASE WHEN $1 = 'delivered' AND delivered_at IS NULL THEN now() ELSE delivered_at END,
       returned_at = CASE WHEN $1 = 'returned' AND returned_at IS NULL THEN now() ELSE returned_at END,
       updated_at = now()
     WHERE id = $4`,
    [mappedStatus, hasProblem, rawStatus, order.id]
  );

  if (mappedStatus !== order.shipping_status) {
    await pool.query(
      `INSERT INTO order_events (order_id, field, old_value, new_value, source, note)
       VALUES ($1, 'shipping_status', $2, $3, $4, $5)`,
      [order.id, order.shipping_status, mappedStatus, source, rawStatus]
    );
  }
  if (hasProblem !== order.has_problem) {
    await pool.query(
      `INSERT INTO order_events (order_id, field, old_value, new_value, source, note)
       VALUES ($1, 'has_problem', $2, $3, $4, $5)`,
      [order.id, String(order.has_problem), String(hasProblem), source, rawStatus]
    );
  }
}
