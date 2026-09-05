import { SHIPPING_STATUSES, type ShippingStatus } from "../routes/orders";

// ============================================================================
// F-15/F-16: Pengenal nomor resi & pemetaan status dari isi email kurir.
// Dipisah dari emailReader.ts (yang urusan IMAP/koneksi) supaya logika
// "teks -> {resi, status}" ini bisa dites sendiri tanpa perlu koneksi Gmail.
// ============================================================================

export interface ParsedCourierEmail {
  trackingNo: string | null;
  rawStatus: string | null;
  mappedStatus: ShippingStatus | null;
  courier: string | null;
}

// Pola resi PER KURIR — dicek lebih dulu (lebih spesifik = lebih akurat),
// baru kalau tidak ada yang cocok jatuh ke pola umum di bawah. Tinggal
// tambah baris baru di sini kalau ketemu format resi kurir lain.
const COURIER_TRACKING_PATTERNS: Array<{ courier: string; regex: RegExp }> = [
  // Ninja Van: umumnya "NV" + kode negara/huruf + digit, mis. NVMY1234567890,
  // NVANID1234567890. Ada juga varian numerik murni setelah prefix "NV".
  { courier: "Ninja Van", regex: /\bNV[A-Z]{2,8}\d{6,15}\b/i },
  { courier: "Ninja Van", regex: /\bNV\d{9,15}\b/i },
  // J&T Express
  { courier: "J&T Express", regex: /\bJ[&T]{0,2}\d{10,15}\b/i },
  // Pos Laju / Pos Malaysia — format ala EMS internasional: 2 huruf + 9 digit + "MY"
  { courier: "Pos Laju", regex: /\b[A-Z]{2}\d{9}MY\b/i },
  // City-Link Express
  { courier: "City-Link Express", regex: /\bCL(?:EX)?\d{7,13}\b/i },
  // DHL eCommerce
  { courier: "DHL eCommerce", regex: /\bDHL\d{8,15}\b/i },
  // Shopee Xpress
  { courier: "Shopee Xpress", regex: /\bSPX[A-Z0-9]{8,15}\b/i },
  // Lalamove (biasanya kode order pendek, bukan resi kurir tradisional)
  { courier: "Lalamove", regex: /\bLM[A-Z0-9]{8,15}\b/i },
];

// Format resi UMUM lain (fallback kalau tidak ada pola kurir spesifik di atas
// yang cocok) — kebanyakan kurir lokal masih pakai kombinasi huruf+digit atau
// digit murni yang panjang.
const GENERIC_TRACKING_PATTERNS: RegExp[] = [
  /\b[A-Z]{2,4}\d{9,15}\b/i, // 2-4 huruf diikuti 9-15 digit
  /\b\d{10,15}\b/, // digit murni panjang
];

// Nama kurir yang disebut langsung di subjek/isi email, dipakai kalau nomor
// resinya tidak match pola spesifik kurir manapun di atas (mis. kurir kirim
// notifikasi tanpa mencantumkan resi di format yang kita kenali).
const COURIER_NAME_KEYWORDS: Array<{ courier: string; keywords: string[] }> = [
  { courier: "Ninja Van", keywords: ["ninja van", "ninjavan"] },
  { courier: "J&T Express", keywords: ["j&t express", "j&t", "jnt express"] },
  { courier: "Pos Laju", keywords: ["pos laju", "poslaju", "pos malaysia"] },
  { courier: "City-Link Express", keywords: ["city-link", "citylink"] },
  { courier: "DHL eCommerce", keywords: ["dhl ecommerce", "dhl"] },
  { courier: "Shopee Xpress", keywords: ["shopee xpress", "spx express"] },
  { courier: "Lalamove", keywords: ["lalamove"] },
];

// Kata kunci Melayu/Inggris -> shipping_status baku (lihat SHIPPING_STATUSES
// di routes/orders.ts). Urutan array ini menentukan PRIORITAS pencocokan —
// taruh yang paling spesifik/genting (gagal/retur) di atas, supaya tidak
// ketiban keyword umum lain. Gampang ditambah: tinggal sisip baris baru.
const STATUS_KEYWORD_MAP: Array<{ status: ShippingStatus; keywords: string[] }> = [
  {
    status: "problem",
    keywords: ["gagal dihantar", "gagal", "ditolak", "penerima tidak dapat dihubungi", "failed delivery", "failed", "rejected"],
  },
  {
    status: "returned",
    keywords: ["dipulangkan", "pemulangan", "return to sender", "returned", "retur", "dikembalikan"],
  },
  {
    status: "rescheduled",
    keywords: ["dijadualkan semula", "jadual semula", "rescheduled", "reschedule"],
  },
  {
    status: "delivered",
    keywords: ["berjaya dihantar", "telah dihantar", "telah diterima", "delivered", "successfully delivered"],
  },
  {
    status: "in_transit",
    keywords: ["sedang dihantar", "dalam penghantaran", "out for delivery", "in transit", "on the way"],
  },
];

function detectCourierFromText(text: string): string | null {
  const lower = text.toLowerCase();
  for (const entry of COURIER_NAME_KEYWORDS) {
    if (entry.keywords.some((kw) => lower.includes(kw))) return entry.courier;
  }
  return null;
}

// Ambil baris yang memuat kata kunci status, supaya rawStatus lebih
// informatif daripada sekadar menyimpan kata kuncinya sendiri (mis. isinya
// "Status: Gagal dihantar - alamat tidak lengkap" bukan cuma "gagal").
function extractKeywordLine(text: string, keyword: string): string | null {
  const idx = text.toLowerCase().indexOf(keyword.toLowerCase());
  if (idx === -1) return null;
  const lineStart = text.lastIndexOf("\n", idx) + 1;
  let lineEnd = text.indexOf("\n", idx);
  if (lineEnd === -1) lineEnd = text.length;
  const line = text.slice(lineStart, lineEnd).trim();
  return line || null;
}

/**
 * Parse subjek+isi email kurir jadi {trackingNo, rawStatus, mappedStatus, courier}.
 * TIDAK melakukan apa pun ke database — murni fungsi teks masuk/keluar,
 * dipanggil oleh emailReader.ts (IMAP) dan routes/courier.ts (webhook).
 */
export function parseCourierEmail(subject: string, body: string): ParsedCourierEmail {
  const combined = `${subject ?? ""}\n${body ?? ""}`;

  let trackingNo: string | null = null;
  let courier: string | null = null;
  for (const p of COURIER_TRACKING_PATTERNS) {
    const m = combined.match(p.regex);
    if (m) {
      trackingNo = m[0].toUpperCase();
      courier = p.courier;
      break;
    }
  }
  if (!trackingNo) {
    for (const regex of GENERIC_TRACKING_PATTERNS) {
      const m = combined.match(regex);
      if (m) {
        trackingNo = m[0].toUpperCase();
        break;
      }
    }
  }
  if (!courier) courier = detectCourierFromText(combined);

  let rawStatus: string | null = null;
  let mappedStatus: ShippingStatus | null = null;
  outer: for (const entry of STATUS_KEYWORD_MAP) {
    for (const kw of entry.keywords) {
      if (combined.toLowerCase().includes(kw.toLowerCase())) {
        rawStatus = extractKeywordLine(combined, kw) ?? kw;
        mappedStatus = entry.status;
        break outer;
      }
    }
  }

  return { trackingNo, rawStatus, mappedStatus, courier };
}

/**
 * Dipakai routes/courier.ts (webhook) untuk kasus status datang sebagai teks
 * bebas (bukan nilai SHIPPING_STATUSES yang sudah baku) — coba petakan lewat
 * tabel kata kunci yang sama dengan email.
 */
export function mapStatusKeyword(text: string): ShippingStatus | null {
  if ((SHIPPING_STATUSES as readonly string[]).includes(text)) return text as ShippingStatus;
  const lower = text.toLowerCase();
  for (const entry of STATUS_KEYWORD_MAP) {
    if (entry.keywords.some((kw) => lower.includes(kw.toLowerCase()))) return entry.status;
  }
  return null;
}
