/**
 * Lampiran KELUAR (foto, video, voice note, dokumen) dari dashboard ke pelanggan.
 *
 * Sebelumnya CS hanya bisa mengirim teks dari halaman Percakapan, padahal di
 * WhatsApp Business asli mengirim foto produk, bukti resi, atau invoice PDF
 * adalah hal yang paling sering dilakukan. Berkas masuk sudah ditangani
 * media.ts; berkas KELUAR ditangani di sini, termasuk pemeriksaan keamanannya.
 *
 * Aturan keamanan yang dipaksakan di sini (jangan dilonggarkan supaya "lebih
 * gampang"): jenis berkas dibatasi daftar putih, ukurannya dibatasi per jenis,
 * dan isi berkas diperiksa lewat magic bytes — bukan cuma percaya pada
 * Content-Type/nama berkas yang dikirim browser.
 */

export type MediaKind = "image" | "video" | "audio" | "document";

export interface AllowedMedia {
  kind: MediaKind;
  /** Batas ukuran mengikuti batas WhatsApp Cloud API, dibulatkan ke bawah. */
  maxBytes: number;
  /** Urutan byte awal yang wajib cocok (salah satu). Kosong = tidak diperiksa. */
  magic: number[][];
}

const MB = 1024 * 1024;

// Magic bytes: nilai -1 berarti "byte apa pun" (dipakai untuk kotak ukuran
// pada berkas MP4/MOV yang 4 byte pertamanya adalah panjang kotak).
const JPEG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const GIF = [0x47, 0x49, 0x46, 0x38];
const WEBP = [0x52, 0x49, 0x46, 0x46, -1, -1, -1, -1, 0x57, 0x45, 0x42, 0x50];
const PDF = [0x25, 0x50, 0x44, 0x46];
const MP4 = [-1, -1, -1, -1, 0x66, 0x74, 0x79, 0x70];
const OGG = [0x4f, 0x67, 0x67, 0x53];
const ID3 = [0x49, 0x44, 0x33];
const MP3 = [0xff, 0xfb];
const ZIP = [0x50, 0x4b, 0x03, 0x04]; // docx/xlsx/pptx sebenarnya arsip zip
const OLE = [0xd0, 0xcf, 0x11, 0xe0]; // doc/xls lama

export const ALLOWED_OUTBOUND_MEDIA: Record<string, AllowedMedia> = {
  "image/jpeg": { kind: "image", maxBytes: 5 * MB, magic: [JPEG] },
  "image/png": { kind: "image", maxBytes: 5 * MB, magic: [PNG] },
  "image/webp": { kind: "image", maxBytes: 5 * MB, magic: [WEBP] },
  "image/gif": { kind: "image", maxBytes: 5 * MB, magic: [GIF] },
  "video/mp4": { kind: "video", maxBytes: 16 * MB, magic: [MP4] },
  "audio/mpeg": { kind: "audio", maxBytes: 16 * MB, magic: [ID3, MP3] },
  "audio/ogg": { kind: "audio", maxBytes: 16 * MB, magic: [OGG] },
  "audio/mp4": { kind: "audio", maxBytes: 16 * MB, magic: [MP4] },
  "application/pdf": { kind: "document", maxBytes: 90 * MB, magic: [PDF] },
  "application/msword": { kind: "document", maxBytes: 90 * MB, magic: [OLE] },
  "application/vnd.ms-excel": { kind: "document", maxBytes: 90 * MB, magic: [OLE] },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
    kind: "document",
    maxBytes: 90 * MB,
    magic: [ZIP],
  },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
    kind: "document",
    maxBytes: 90 * MB,
    magic: [ZIP],
  },
  "text/plain": { kind: "document", maxBytes: 10 * MB, magic: [] },
};

export interface MediaCheckResult {
  ok: boolean;
  /** Pesan siap tampil ke pengguna kalau ok=false. */
  error?: string;
  kind?: MediaKind;
}

function matchesMagic(buffer: Buffer, pattern: number[]): boolean {
  if (buffer.length < pattern.length) return false;
  return pattern.every((byte, i) => byte === -1 || buffer[i] === byte);
}

/**
 * Periksa satu berkas lampiran keluar. Dipakai SEBELUM berkas disimpan ke
 * disk maupun dikirim ke WhatsApp.
 */
export function checkOutboundMedia(buffer: Buffer, mime: string): MediaCheckResult {
  const rule = ALLOWED_OUTBOUND_MEDIA[mime.toLowerCase().split(";")[0].trim()];
  if (!rule) {
    return {
      ok: false,
      error:
        "Jenis berkas ini tidak didukung. Yang bisa dikirim: foto (JPG/PNG/WebP/GIF), video MP4, audio (MP3/OGG/M4A), PDF, Word, Excel, dan teks biasa.",
    };
  }
  if (buffer.length === 0) return { ok: false, error: "Berkasnya kosong." };
  if (buffer.length > rule.maxBytes) {
    const mb = Math.round(rule.maxBytes / MB);
    return { ok: false, error: `Berkas terlalu besar. Batas WhatsApp untuk jenis ini sekitar ${mb} MB.` };
  }
  if (rule.magic.length > 0 && !rule.magic.some((p) => matchesMagic(buffer, p))) {
    return {
      ok: false,
      error:
        "Isi berkas tidak cocok dengan jenis yang disebutkan (kemungkinan berkas rusak atau ekstensinya diganti). Dibatalkan demi keamanan.",
    };
  }
  return { ok: true, kind: rule.kind };
}
