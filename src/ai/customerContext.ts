import { pool } from "../db/pool";

/**
 * Konteks PELANGGAN INI (bukan produk) untuk otak AI.
 *
 * Tanpa ini, pertanyaan yang paling sering muncul di toko COD — "pesanan saya
 * sudah dihantar belum?", "resi saya berapa?", "kenapa belum sampai?" — selalu
 * dijawab "nanti saya cek dulu ya kak", padahal jawabannya SUDAH ADA di
 * database (tabel orders + courier_events). Blok ini menyodorkan fakta itu ke
 * AI sebagai FAKTA, bukan tebakan, sehingga:
 *   - pertanyaan status pengiriman bisa dijawab langsung dan benar,
 *   - AI tahu nama pelanggan dan tidak mengulang menanyakan alamat yang sudah
 *     lengkap tersimpan,
 *   - AI TIDAK menawarkan produk baru ke orang yang paketnya sedang bermasalah.
 *
 * Semua angka di sini diambil apa adanya dari database; AI tetap dilarang
 * mengarang di luar blok ini (lihat ATURAN KERAS di chatbot.ts).
 */

const SALES_LABEL: Record<string, string> = {
  closing: "sudah closing (pesanan dibuat)",
  pending: "belum closing (masih tanya-tanya)",
  cancelled: "dibatalkan",
  lost: "batal / tidak jadi",
};

const SHIPPING_LABEL: Record<string, string> = {
  pending: "belum dikirim, masih diproses",
  packed: "sudah dikemas, menunggu kurir",
  shipped: "sudah diserahkan ke kurir / dalam perjalanan",
  in_transit: "sedang dalam perjalanan",
  out_for_delivery: "sedang diantar kurir hari ini",
  delivered: "sudah sampai / diterima",
  returned: "diretur / dikembalikan ke penjual",
  failed: "gagal dikirim",
};

function label(map: Record<string, string>, value: string | null): string {
  if (!value) return "tidak diketahui";
  return map[value] ?? value;
}

function money(cents: number | string | null, currency: string | null): string | null {
  if (cents == null) return null;
  return `${currency || "MYR"} ${(Number(cents) / 100).toFixed(2)}`;
}

function daysAgo(ts: Date | string | null): string {
  if (!ts) return "";
  const then = new Date(ts).getTime();
  if (Number.isNaN(then)) return "";
  const days = Math.floor((Date.now() - then) / 86400000);
  if (days <= 0) return " (hari ini)";
  if (days === 1) return " (kemarin)";
  return ` (${days} hari lalu)`;
}

export async function buildCustomerContext(
  organizationId: string,
  conversationId: string
): Promise<string> {
  const { rows: convoRows } = await pool.query(
    /* conversations TIDAK punya kolom organization_id — organisasinya melekat
       di contacts (lihat schema.sql). Join ini sekaligus jadi pagar supaya
       percakapan organisasi lain tidak pernah terbaca dari sini. */
    `SELECT c.contact_id, ct.name AS contact_name, ct.wa_number, ct.pipeline_stage
     FROM conversations c
     JOIN contacts ct ON ct.id = c.contact_id
     WHERE c.id = $1 AND ct.organization_id = $2`,
    [conversationId, organizationId]
  );
  const convo = convoRows[0];
  if (!convo) return "";

  const lines: string[] = [];
  if (convo.contact_name) lines.push(`Nama pelanggan tersimpan: ${convo.contact_name}`);

  const { rows: orderRows } = await pool.query(
    `SELECT o.id, o.sales_status, o.shipping_status, o.has_problem, o.problem_reason,
            o.courier, o.tracking_no, o.quantity, o.total_cents, o.currency,
            o.customer_name, o.address_line, o.city, o.state, o.postcode,
            o.shipped_at, o.delivered_at, o.returned_at, o.created_at,
            p.name AS product_name, v.name AS variant_name
     FROM orders o
     LEFT JOIN products p ON p.id = o.product_id
     LEFT JOIN product_variants v ON v.id = o.variant_id
     WHERE o.organization_id = $1
       AND (o.conversation_id = $2 OR ($3::uuid IS NOT NULL AND o.contact_id = $3::uuid))
     ORDER BY o.created_at DESC
     LIMIT 3`,
    [organizationId, conversationId, convo.contact_id ?? null]
  );

  if (orderRows.length === 0) {
    lines.push(
      "Pelanggan ini BELUM punya pesanan tercatat di sistem — jadi belum ada resi atau status pengiriman apa pun untuk dia."
    );
    return wrap(lines);
  }

  // Kabar terakhir dari kurir untuk resi pesanan paling baru — inilah yang
  // membuat AI bisa menjawab "sampai mana paket saya" dengan tepat.
  const latestTracking: string | null = orderRows[0].tracking_no ?? null;
  let courierNote = "";
  if (latestTracking) {
    const { rows: evRows } = await pool.query(
      `SELECT raw_status, mapped_status, created_at
       FROM courier_events
       WHERE organization_id = $1 AND tracking_no = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [organizationId, latestTracking]
    );
    const ev = evRows[0];
    if (ev) {
      courierNote = `Kabar terakhir dari kurir untuk resi ${latestTracking}: "${ev.raw_status || ev.mapped_status}"${daysAgo(ev.created_at)}.`;
    }
  }

  orderRows.forEach((o, idx) => {
    const head = idx === 0 ? "Pesanan TERAKHIR pelanggan ini" : `Pesanan sebelumnya #${idx + 1}`;
    const detail: string[] = [];
    if (o.product_name) {
      detail.push(`produk: ${o.product_name}${o.variant_name ? ` (${o.variant_name})` : ""}`);
    }
    if (o.quantity) detail.push(`jumlah: ${o.quantity}`);
    const total = money(o.total_cents, o.currency);
    if (total) detail.push(`total: ${total}`);
    detail.push(`status penjualan: ${label(SALES_LABEL, o.sales_status)}`);
    detail.push(`status pengiriman: ${label(SHIPPING_LABEL, o.shipping_status)}`);
    if (o.courier) detail.push(`kurir: ${o.courier}`);
    if (o.tracking_no) detail.push(`no. resi: ${o.tracking_no}`);
    if (o.shipped_at) detail.push(`dikirim ${new Date(o.shipped_at).toISOString().slice(0, 10)}${daysAgo(o.shipped_at)}`);
    if (o.delivered_at) detail.push(`diterima ${new Date(o.delivered_at).toISOString().slice(0, 10)}${daysAgo(o.delivered_at)}`);
    if (o.returned_at) detail.push(`diretur ${new Date(o.returned_at).toISOString().slice(0, 10)}${daysAgo(o.returned_at)}`);
    if (o.has_problem) detail.push(`DITANDAI BERMASALAH: ${o.problem_reason || "tanpa keterangan"}`);
    lines.push(`${head}: ${detail.join("; ")}`);

    if (idx === 0) {
      const alamat = [o.address_line, o.city, o.state, o.postcode].filter(Boolean).join(", ");
      if (alamat) {
        lines.push(
          `Alamat pengiriman pesanan terakhir SUDAH tersimpan: ${alamat}. Jangan minta pelanggan mengetik ulang alamat ini kecuali dia sendiri yang minta mengubahnya.`
        );
      }
    }
  });

  if (courierNote) lines.push(courierNote);
  if (orderRows[0].has_problem) {
    lines.push(
      "Paket pelanggan ini sedang bermasalah — utamakan menenangkan dan menjelaskan keadaannya, JANGAN menawarkan produk lain dulu."
    );
  }

  return wrap(lines);
}

/* Dipisah supaya perubahan susunan di atas tidak perlu menyentuh format blok. */
function wrap(lines: string[]): string {
  if (lines.length === 0) return "";
  return [
    "=== Data Pelanggan & Pesanannya (FAKTA dari database — boleh disebut ke pelanggan) ===",
    ...lines,
    "Kalau pelanggan bertanya soal status pengiriman atau nomor resi, jawab memakai fakta di atas — JANGAN bilang \"nanti saya cek dulu\" kalau datanya sudah ada di sini.",
  ].join("\n");
}
