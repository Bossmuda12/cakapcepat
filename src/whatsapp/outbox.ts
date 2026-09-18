import { pool } from "../db/pool";
import { splitIntoBubbles, typingDelayMs, isOutsideWorkHours } from "../ai/humanizer";

/**
 * F-35/F-37: antrean/pembatas kirim per nomor + F-4 balas seperti manusia.
 *
 * Modul ini TIDAK tahu apa-apa soal Cloud API vs Baileys/QR — pemanggil
 * (ingest.ts) yang menyuntikkan `send`/`presence` sesuai jalur koneksinya.
 * Tanggung jawab di sini murni: (1) penghitung kirim per jam per nomor biar
 * tidak melewati batas yang diatur di whatsapp_channels.hourly_send_limit,
 * dan (2) simulasi "mengetik lalu kirim per gelembung" biar balasan AI tidak
 * terasa seperti bot yang menembak 1 pesan panjang dalam hitungan milidetik.
 */

// Jeda pendek ACAK di antara gelembung pesan saat jam kerja normal.
const MIN_BUBBLE_GAP_MS = 700;
const MAX_BUBBLE_GAP_MS = 2200;

// Di luar jam kerja (whatsapp_channels.work_hour_start/end), balasan dibuat
// terasa jauh lebih santai — pelanggan yang chat tengah malam tidak boleh
// merasa sedang diladeni bot yang siaga 24 jam tanpa jeda manusiawi sama sekali.
const OUTSIDE_WORK_HOURS_DELAY_MULTIPLIER = 4;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function randomBetween(minMs: number, maxMs: number): number {
  return minMs + Math.random() * (maxMs - minMs);
}

/**
 * F-37: cek apakah channel ini masih boleh kirim pesan di jam berjalan ini,
 * dibandingkan dengan whatsapp_channels.hourly_send_limit. hourly_send_limit
 * <= 0 dianggap "tanpa batas" (dipakai kalau owner sengaja mau matikan
 * pembatas utk nomor tertentu).
 */
export async function canSendNow(channelId: string): Promise<boolean> {
  const { rows: channelRows } = await pool.query(
    "SELECT hourly_send_limit FROM whatsapp_channels WHERE id = $1",
    [channelId]
  );
  const limit: number = channelRows[0]?.hourly_send_limit ?? 120;
  if (limit <= 0) return true;

  const { rows: counterRows } = await pool.query(
    `SELECT sent_count FROM channel_send_counters
     WHERE channel_id = $1 AND hour_bucket = date_trunc('hour', now())`,
    [channelId]
  );
  const sentThisHour: number = counterRows[0]?.sent_count ?? 0;
  return sentThisHour < limit;
}

/** Naikkan penghitung kirim jam berjalan untuk channel ini (dipanggil SETELAH tiap pengiriman berhasil). */
export async function recordSend(channelId: string): Promise<void> {
  await pool.query(
    `INSERT INTO channel_send_counters (organization_id, channel_id, hour_bucket, sent_count)
     SELECT wc.organization_id, $1, date_trunc('hour', now()), 1 FROM whatsapp_channels wc WHERE wc.id = $1
     ON CONFLICT (channel_id, hour_bucket) DO UPDATE SET sent_count = channel_send_counters.sent_count + 1`,
    [channelId]
  );
}

export interface SendHumanizedParams {
  channelId: string;
  conversationId: string;
  organizationId: string;
  /** Nomor/JID tujuan — dipakai sbg konteks log saja (pengiriman sesungguhnya lewat `send`). */
  jid: string;
  text: string;
  /** Kirim SATU gelembung pesan lewat jalur koneksi yang sesuai (Cloud API HTTP / socket Baileys). */
  send: (bubbleText: string) => Promise<void>;
  /** Opsional — update status "sedang mengetik"/berhenti mengetik di sisi pelanggan (didukung jalur QR). */
  presence?: (state: "composing" | "paused") => Promise<void>;
}

/**
 * F-4 (INTI): kirim balasan AI seperti CS manusia betulan mengetik, bukan
 * bot yang menembak 1 pesan panjang seketika.
 *
 * Alurnya:
 *   1. Tampilkan status "sedang mengetik" (kalau pemanggil menyediakan `presence`).
 *   2. Tunggu selama typingDelayMs(text) — makin panjang teksnya, makin lama
 *      "mikir"-nya, sebelum gelembung PERTAMA terkirim.
 *   3. Pecah teks jadi beberapa gelembung (splitIntoBubbles) & kirim satu-satu
 *      dengan jeda pendek ACAK di antaranya, tiap kiriman dicatat lewat
 *      recordSend() (F-37 — supaya penghitung per jam ikut naik per gelembung,
 *      bukan cuma sekali per "1 balasan logis").
 *   4. Matikan status "sedang mengetik" di akhir.
 *
 * humanize_enabled=false (dimatikan manual dari dashboard) -> kirim LANGSUNG
 * tanpa jeda/pemecahan sama sekali (tapi F-37 tetap dihormati — kirim
 * dibatalkan kalau sudah kena batas per jam).
 *
 * Di luar jam kerja (work_hour_start/end) -> semua jeda dikalikan
 * OUTSIDE_WORK_HOURS_DELAY_MULTIPLIER supaya terasa "baru sempat balas",
 * bukan bot yang standby jam 3 pagi.
 *
 * F-37: kalau batas kirim per jam sudah tercapai di TENGAH pengiriman
 * (mis. gelembung ke-2 dari 3), sisa gelembung DIBATALKAN (bukan dipaksa
 * kirim melanggar batas) — dicatat jelas di log supaya ketahuan pesan
 * terpotong.
 */
export async function sendHumanized(params: SendHumanizedParams): Promise<void> {
  const { channelId, conversationId, organizationId, jid, text, send, presence } = params;

  const { rows: channelRows } = await pool.query(
    "SELECT humanize_enabled, work_hour_start, work_hour_end FROM whatsapp_channels WHERE id = $1",
    [channelId]
  );
  const channel = channelRows[0];
  const humanizeEnabled: boolean = channel?.humanize_enabled ?? true;

  if (!humanizeEnabled) {
    if (!(await canSendNow(channelId))) {
      console.warn(
        `[outbox] Channel ${channelId} (org ${organizationId}) sudah melewati batas kirim per jam — ` +
          `balasan ke ${jid} utk conversation ${conversationId} TIDAK dikirim.`
      );
      return;
    }
    await send(text);
    await recordSend(channelId);
    return;
  }

  const workStart: number = channel?.work_hour_start ?? 9;
  const workEnd: number = channel?.work_hour_end ?? 22;
  const outsideWorkHours = isOutsideWorkHours(workStart, workEnd);
  const delayMultiplier = outsideWorkHours ? OUTSIDE_WORK_HOURS_DELAY_MULTIPLIER : 1;

  if (presence) {
    try {
      await presence("composing");
    } catch (err) {
      console.warn(`[outbox] Gagal kirim status "sedang mengetik" ke ${jid} (channel ${channelId}), diabaikan:`, err);
    }
  }

  await sleep(typingDelayMs(text) * delayMultiplier);

  const bubbles = splitIntoBubbles(text);
  for (let i = 0; i < bubbles.length; i++) {
    if (!(await canSendNow(channelId))) {
      console.warn(
        `[outbox] Channel ${channelId} (org ${organizationId}) kena batas kirim per jam di tengah balasan ` +
          `(gelembung ${i + 1}/${bubbles.length}) ke ${jid} utk conversation ${conversationId} — sisa gelembung DIBATALKAN.`
      );
      break;
    }

    await send(bubbles[i]);
    await recordSend(channelId);

    const isLastBubble = i === bubbles.length - 1;
    if (!isLastBubble) {
      await sleep(randomBetween(MIN_BUBBLE_GAP_MS, MAX_BUBBLE_GAP_MS) * delayMultiplier);
    }
  }

  if (presence) {
    try {
      await presence("paused");
    } catch (err) {
      console.warn(`[outbox] Gagal hentikan status "sedang mengetik" ke ${jid} (channel ${channelId}), diabaikan:`, err);
    }
  }
}
