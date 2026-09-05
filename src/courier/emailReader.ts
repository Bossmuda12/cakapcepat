import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { pool } from "../db/pool";
import { parseCourierEmail } from "./parser";
import { applyCourierStatusToOrder, type OrderForCourierSync } from "./orderSync";

// ============================================================================
// F-15/F-16: Baca kotak masuk Gmail (kredensial GMAIL_USER/GMAIL_APP_PASSWORD,
// SUDAH ADA di Railway) untuk menangkap notifikasi kurir (Ninja Van, J&T,
// Pos Laju, dst) dan mencocokkannya ke pesanan lewat nomor resi.
//
// TIDAK mengirim pesan WhatsApp apa pun dari sini — cuma menulis data ke
// courier_events & orders/order_events. Pengiriman notifikasi ke customer
// (mis. "paket bermasalah, mohon dihubungi ulang") dikerjakan agen/fitur lain
// yang membaca hasilnya dari sini.
// ============================================================================

export interface CourierPollResult {
  processed: number;
  matched: number;
  skipped: number;
}

const LOOKBACK_DAYS = 30;

interface OrderRow extends OrderForCourierSync {
  organization_id: string;
}

// Cari order berdasarkan nomor resi. Kalau organizationId sudah tahu (mis.
// dipanggil dari endpoint POST /courier/poll yang sudah login), saring
// langsung ke organisasi itu. Kalau tidak (mis. dipanggil scheduler tanpa
// konteks user login, satu kotak masuk Gmail dipakai bareng semua
// organisasi), cari lintas organisasi lewat resi — organisasi dari ORDER yang
// cocok itulah yang dipakai untuk mencatat courier_events (kolom
// organization_id-nya NOT NULL, jadi kalau tidak ada order yang cocok DAN
// tidak ada organizationId eksplisit, email itu terpaksa dilewati).
async function resolveOrgAndOrder(
  organizationId: string | undefined,
  trackingNo: string
): Promise<{ organizationId: string | null; order: OrderRow | null }> {
  if (organizationId) {
    const { rows } = await pool.query<OrderRow>(
      `SELECT id, organization_id, shipping_status, has_problem
       FROM orders WHERE organization_id = $1 AND tracking_no = $2`,
      [organizationId, trackingNo]
    );
    return { organizationId, order: rows[0] ?? null };
  }

  const { rows } = await pool.query<OrderRow>(
    `SELECT id, organization_id, shipping_status, has_problem
     FROM orders WHERE tracking_no = $1 LIMIT 1`,
    [trackingNo]
  );
  if (rows[0]) return { organizationId: rows[0].organization_id, order: rows[0] };
  return { organizationId: null, order: null };
}

/**
 * Poll kotak masuk Gmail sekali: ambil email BELUM DIBACA dari 30 hari
 * terakhir, parse tiap email, cocokkan resinya ke `orders`, dan perbarui
 * shipping_status/has_problem kalau cocok. Idempotent — email yang sama
 * (Message-ID) tidak pernah diproses dua kali berkat unique index
 * courier_events(organization_id, source, source_ref).
 *
 * `organizationId` opsional: kalau diisi, cuma cocokkan ke order milik
 * organisasi itu (dipakai endpoint POST /courier/poll). Kalau kosong, cari
 * lintas organisasi lewat nomor resi (dipakai scheduler/cron latar belakang).
 */
export async function pollCourierMailbox(organizationId?: string): Promise<CourierPollResult> {
  const result: CourierPollResult = { processed: 0, matched: 0, skipped: 0 };

  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    console.warn(
      "[courier] GMAIL_USER/GMAIL_APP_PASSWORD belum diisi di env — pembacaan email kurir dilewati. " +
        "Set kedua env var ini (Railway sudah punya keduanya) untuk mengaktifkan fitur ini."
    );
    return result;
  }

  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user, pass },
    logger: false,
  });

  try {
    await client.connect();
  } catch (err) {
    console.error("[courier] Gagal konek ke Gmail IMAP:", err);
    return result;
  }

  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
      const uids = await client.search({ seen: false, since }, { uid: true });
      if (!uids || uids.length === 0) return result;

      for (const uid of uids) {
        let message;
        try {
          message = await client.fetchOne(uid, { source: true }, { uid: true });
        } catch (err) {
          console.error(`[courier] Gagal ambil email uid=${uid}:`, err);
          continue;
        }
        if (!message || !message.source) continue;

        result.processed++;

        let parsedMail;
        try {
          parsedMail = await simpleParser(message.source);
        } catch (err) {
          console.error(`[courier] Gagal parse isi email uid=${uid}:`, err);
          result.skipped++;
          continue;
        }

        const messageId = parsedMail.messageId;
        if (!messageId) {
          // Tidak ada Message-ID -> tidak bisa dijamin anti-dobel, lebih aman dilewati.
          result.skipped++;
          continue;
        }

        const subject = parsedMail.subject ?? "";
        const bodyText = parsedMail.text ?? (typeof parsedMail.html === "string" ? parsedMail.html : "") ?? "";

        const { trackingNo, rawStatus, mappedStatus, courier } = parseCourierEmail(subject, bodyText);
        if (!trackingNo) {
          result.skipped++;
          continue;
        }

        const { organizationId: resolvedOrgId, order } = await resolveOrgAndOrder(organizationId, trackingNo);
        if (!resolvedOrgId) {
          // Resi tidak cocok order manapun DAN tidak ada organizationId eksplisit
          // -> tidak tahu mau dicatat ke organisasi mana (kolom NOT NULL).
          result.skipped++;
          continue;
        }

        const { rows: inserted } = await pool.query<{ id: string }>(
          `INSERT INTO courier_events
             (organization_id, courier, tracking_no, raw_status, mapped_status, source, source_ref, order_id)
           VALUES ($1, $2, $3, $4, $5, 'email', $6, $7)
           ON CONFLICT (organization_id, source, source_ref) DO NOTHING
           RETURNING id`,
          [resolvedOrgId, courier, trackingNo, rawStatus, mappedStatus, messageId, order?.id ?? null]
        );

        if (!inserted[0]) {
          // source_ref (Message-ID) ini sudah pernah tercatat — email dobel, lewati.
          result.skipped++;
          continue;
        }

        if (order && mappedStatus) {
          await applyCourierStatusToOrder(order, mappedStatus, rawStatus, "courier_email");
          await pool.query("UPDATE courier_events SET processed_at = now() WHERE id = $1", [inserted[0].id]);
          result.matched++;
        }

        // Tandai email sudah dibaca supaya polling berikutnya tidak mengambilnya lagi
        // (di atas juga sudah dijaga oleh unique index courier_events, ini lapis kedua).
        try {
          await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
        } catch (err) {
          console.error(`[courier] Gagal tandai email uid=${uid} sebagai dibaca:`, err);
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {
      // Abaikan error logout — koneksi mungkin sudah putus, tidak perlu bikin gagal seluruh polling.
    });
  }

  return result;
}
