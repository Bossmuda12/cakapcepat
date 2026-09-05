import { pool } from "../db/pool";

/**
 * F-4: pecah balasan panjang jadi beberapa gelembung chat (bubble) berurutan
 * seperti manusia biasa ngetik WhatsApp — bukan satu paragraf panjang sekali
 * kirim. Teks pendek (satu kalimat singkat) tetap 1 gelembung, teks panjang
 * dipecah 2-3 gelembung di batas paragraf/kalimat (bukan dipotong asal
 * sepanjang N karakter, supaya tidak motong kalimat di tengah).
 */
export function splitIntoBubbles(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const SHORT_THRESHOLD = 90; // kira-kira 1 kalimat singkat, tidak perlu dipecah
  if (trimmed.length <= SHORT_THRESHOLD) return [trimmed];

  // Coba pecah di batas paragraf dulu (baris kosong) — paling natural.
  let parts = trimmed
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  // Kalau cuma 1 paragraf, pecah di batas kalimat (titik/tanda tanya/seru
  // diikuti spasi) — heuristik sederhana, tidak sempurna untuk singkatan
  // ("dll.", "Bpk.") tapi cukup untuk balasan chat pendek seperti ini.
  if (parts.length < 2) {
    parts =
      trimmed
        .split(/(?<=[.!?])\s+/)
        .map((p) => p.trim())
        .filter(Boolean) || [];
    if (parts.length === 0) parts = [trimmed];
  }

  if (parts.length <= 1) return [trimmed];

  const MAX_BUBBLES = 3;
  if (parts.length <= MAX_BUBBLES) return parts;

  // Lebih dari 3 potongan — gabungkan jadi maksimal 3 gelembung supaya tidak
  // terasa "diberondong" pesan.
  const groups: string[] = [];
  const perGroup = Math.ceil(parts.length / MAX_BUBBLES);
  for (let i = 0; i < parts.length; i += perGroup) {
    groups.push(parts.slice(i, i + perGroup).join(" "));
  }
  return groups;
}

// Kira-kira kecepatan mengetik manusia wajar di HP: ~13 karakter/detik
// (termasuk jeda mikir sebentar), dibulatkan jadi angka bulat yang gampang
// dibaca di kode.
const MS_PER_CHAR = 45;
const MIN_DELAY_MS = 5000;
const MAX_DELAY_MS = 40000;

/**
 * F-4: hitung jeda "mengetik" (typing delay) sebelum balasan dikirim —
 * menyesuaikan panjang teks, dengan batas bawah/atas supaya tidak terasa
 * instan (robot) atau kelamaan (pelanggan pikir tidak dibalas). Ditambah
 * keacakan (jitter) supaya jedanya tidak selalu identik persis tiap balasan.
 */
export function typingDelayMs(text: string): number {
  const length = text.trim().length;
  const base = MIN_DELAY_MS + length * MS_PER_CHAR;
  const clamped = Math.min(Math.max(base, MIN_DELAY_MS), MAX_DELAY_MS);

  // Jitter ±15% supaya jeda antar balasan tidak seragam-persis (ciri khas bot).
  const jitterFactor = 0.85 + Math.random() * 0.3;
  const withJitter = clamped * jitterFactor;

  return Math.round(Math.min(Math.max(withJitter, MIN_DELAY_MS), MAX_DELAY_MS));
}

/**
 * F-5: 20 kalimat pembuka terakhir yang sudah dipakai AI di nomor ini —
 * dipakai chatbot.ts untuk melarang Claude mengulang pembuka yang sama
 * ("Baik kak, terima kasih sudah menghubungi..." di puluhan chat berbeda
 * jelas terbaca sebagai bot).
 */
export async function recentOpeners(organizationId: string, channelId: string | null): Promise<string[]> {
  const { rows } = await pool.query(
    `SELECT opener FROM ai_opener_history
     WHERE organization_id = $1 AND channel_id IS NOT DISTINCT FROM $2
     ORDER BY created_at DESC LIMIT 20`,
    [organizationId, channelId]
  );
  return rows.map((r) => String(r.opener));
}

/**
 * F-5: simpan kalimat pembuka balasan ini ke ai_opener_history, lalu pangkas
 * riwayat supaya tabel tidak menumpuk tak terbatas — sisakan 200 baris
 * terbaru PER CHANNEL (bukan per organisasi, supaya nomor sibuk tidak
 * "menghabiskan jatah" riwayat nomor yang jarang dipakai).
 */
export async function rememberOpener(
  organizationId: string,
  channelId: string | null,
  replyText: string
): Promise<void> {
  const opener = extractOpener(replyText);
  if (!opener) return;

  await pool.query(
    "INSERT INTO ai_opener_history (organization_id, channel_id, opener) VALUES ($1, $2, $3)",
    [organizationId, channelId, opener]
  );

  await pool.query(
    `DELETE FROM ai_opener_history
     WHERE organization_id = $1 AND channel_id IS NOT DISTINCT FROM $2
       AND id NOT IN (
         SELECT id FROM ai_opener_history
         WHERE organization_id = $1 AND channel_id IS NOT DISTINCT FROM $2
         ORDER BY created_at DESC LIMIT 200
       )`,
    [organizationId, channelId]
  );
}

// Ambil kalimat pertama (sampai tanda titik/tanya/seru pertama) dari baris
// pertama balasan, sebagai representasi "pembuka" yang dibandingkan di
// recentOpeners — dipangkas 200 karakter untuk jaga-jaga kalau tidak ada
// tanda baca sama sekali.
function extractOpener(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const firstLine = trimmed.split("\n")[0];
  const sentenceMatch = firstLine.match(/^[^.!?]*[.!?]?/);
  const opener = (sentenceMatch?.[0] || firstLine).trim();
  return opener.slice(0, 200);
}

/**
 * F-4: true kalau jam saat ini (dikonversi ke zona waktu utcOffsetHours) berada
 * DI LUAR rentang [startHour, endHour). Default utcOffsetHours=7 mengikuti
 * default zona waktu yang sudah dipakai di isOutsideOfficeHours (ingest.ts) —
 * untuk toko yang berjualan ke Malaysia (UTC+8), pemanggil sebaiknya kirim
 * utcOffsetHours=8 secara eksplisit. Mendukung rentang yang "melewati tengah
 * malam" (mis. start=22, end=6).
 */
export function isOutsideWorkHours(startHour: number, endHour: number, utcOffsetHours = 7): boolean {
  const now = new Date();
  const localHour = Math.floor(((now.getUTCHours() + utcOffsetHours) * 60 + now.getUTCMinutes()) / 60) % 24;

  if (startHour <= endHour) {
    return localHour < startHour || localHour >= endHour;
  }
  // Jam kerja melewati tengah malam — "di dalam jam kerja" berarti
  // localHour >= start ATAU localHour < end.
  return localHour >= endHour && localHour < startHour;
}
