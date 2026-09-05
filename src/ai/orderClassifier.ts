import { getAiConfig } from "./usage";
import { callClaude } from "./anthropic";
import { getRecentHistory } from "./history";

export type OrderClassificationStatus =
  | "qualified_cod"
  | "closing"
  | "cancelled"
  | "spam"
  | "no_response"
  | "cs_blocked";

const VALID_STATUSES: OrderClassificationStatus[] = [
  "qualified_cod",
  "closing",
  "cancelled",
  "spam",
  "no_response",
  "cs_blocked",
];

export interface OrderClassificationExtracted {
  customerName?: string;
  phone?: string;
  address?: string;
  postcode?: string;
  city?: string;
  state?: string;
  quantity?: number;
  variant?: string;
}

export interface OrderClassificationResult {
  status: OrderClassificationStatus;
  confidence: number;
  extracted?: OrderClassificationExtracted;
}

export interface ClassifyConversationParams {
  organizationId: string;
  conversationId: string;
}

/**
 * F-8: minta AI (model KECIL — dipanggil sekali per percakapan, bukan tiap
 * pesan, jadi cukup murah) membaca riwayat chat dan menyimpulkan status order
 * COD + (kalau statusnya closing) data pembeli terstruktur untuk diisi ke
 * tabel `orders`.
 *
 * SENGAJA TIDAK menulis ke tabel `orders` di sini — cuma mengembalikan hasil
 * klasifikasi. Menyimpannya (termasuk mencocokkan/membuat baris order, cek
 * duplikat, dsb) adalah tanggung jawab pemanggil di src/routes/orders.ts
 * (dikerjakan agen lain, lihat catatan F-8 di komentar tugas ini).
 *
 * Return null kalau: belum ada riwayat pesan, AI belum dikonfigurasi, panggilan
 * Claude gagal, atau hasilnya tidak bisa di-parse sebagai JSON yang valid.
 */
export async function classifyConversation(
  params: ClassifyConversationParams
): Promise<OrderClassificationResult | null> {
  const { organizationId, conversationId } = params;

  const history = await getRecentHistory(conversationId);
  if (history.length === 0) return null;

  const aiConfig = await getAiConfig(organizationId);
  if (!aiConfig.apiKey) return null;

  const transcript = history.map((m) => `[${m.role === "user" ? "Pelanggan" : "CS"}] ${m.content}`).join("\n");

  const system = [
    "Kamu menganalisis transkrip chat WhatsApp toko yang berjualan COD (Cash on Delivery) ke Malaysia lewat iklan Meta.",
    "Tugasmu: simpulkan status order dari transkrip ini, dan KALAU statusnya closing, ekstrak data pembeli.",
    "",
    "Definisi status (pilih SATU):",
    "- qualified_cod: pelanggan serius mau COD/beli, tapi data alamat pembeli belum lengkap.",
    "- closing: data pembeli (nama + alamat pengiriman) sudah lengkap disebut di chat, order siap diproses.",
    "- cancelled: pelanggan sudah bilang batal/tidak jadi beli.",
    "- spam: bukan pembeli sungguhan / chat iseng / salah kirim, bukan soal jualan sama sekali.",
    "- no_response: pelanggan sempat tanya-tanya lalu berhenti membalas, tidak jelas keputusannya.",
    "- cs_blocked: butuh keputusan/tindakan manusia yang tidak bisa disimpulkan AI dari transkrip ini.",
    "",
    "Balas HANYA dengan JSON valid (JANGAN dibungkus ``` atau teks penjelasan apa pun), struktur PERSIS:",
    '{"status": "qualified_cod|closing|cancelled|spam|no_response|cs_blocked", "confidence": <angka 0 sampai 1>, ' +
      '"extracted": {"customerName": string|null, "phone": string|null, "address": string|null, "postcode": string|null, "city": string|null, "state": string|null, "quantity": number|null, "variant": string|null}}',
    "extracted HANYA diisi kalau status closing — kalau bukan closing, isi extracted dengan semua field null.",
    "JANGAN MENGARANG data yang tidak disebut jelas di transkrip — biarkan null kalau tidak ada.",
  ].join("\n");

  const raw = await callClaude({
    organizationId,
    conversationId,
    purpose: "classify",
    model: aiConfig.modelSmall,
    system,
    messages: [{ role: "user", content: transcript }],
    maxTokens: 500,
  });
  if (!raw) return null;

  return parseClassification(raw);
}

// Model kadang membungkus JSON dengan ```json ... ``` walau sudah diminta
// tidak — parsing DEFENSIF: buang fence markdown dulu, baru cari blok {...}
// pertama yang valid. Sama polanya dengan parseResult() di leadsAnalyzer.ts.
function parseClassification(raw: string): OrderClassificationResult | null {
  const withoutFence = raw
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
  const jsonMatch = withoutFence.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (typeof parsed.status !== "string" || !VALID_STATUSES.includes(parsed.status)) return null;

    const confidence =
      typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence)
        ? Math.min(1, Math.max(0, parsed.confidence))
        : 0;

    let extracted: OrderClassificationExtracted | undefined;
    if (parsed.extracted && typeof parsed.extracted === "object") {
      const e = parsed.extracted;
      extracted = {
        customerName: typeof e.customerName === "string" ? e.customerName : undefined,
        phone: typeof e.phone === "string" ? e.phone : undefined,
        address: typeof e.address === "string" ? e.address : undefined,
        postcode: typeof e.postcode === "string" ? e.postcode : undefined,
        city: typeof e.city === "string" ? e.city : undefined,
        state: typeof e.state === "string" ? e.state : undefined,
        quantity: typeof e.quantity === "number" ? e.quantity : undefined,
        variant: typeof e.variant === "string" ? e.variant : undefined,
      };
    }

    return { status: parsed.status as OrderClassificationStatus, confidence, extracted };
  } catch (err) {
    console.error("[ai] Gagal parse hasil classifyConversation:", err, raw);
    return null;
  }
}
