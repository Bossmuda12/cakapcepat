import { pool } from "../db/pool";

export interface GuardrailResult {
  triggered: boolean;
  reason?: string;
  /**
   * true  = percakapan DIKUNCI, AI berhenti sampai manusia melepas manual.
   * false = AI tetap boleh menjawab giliran ini, TAPI dengan larangan keras
   *         menjanjikan apa pun (lihat chatbot.ts). Dulu kasus ini membuat AI
   *         diam total — pelanggan yang bertanya "boleh kurang sikit tak?"
   *         tidak dibalas sama sekali sampai ada admin yang sadar, dan itu
   *         terbaca seperti di-ghosting.
   */
  pauseAi?: boolean;
}

export interface CheckGuardrailsParams {
  organizationId: string;
  conversationId: string;
  incomingText: string;
}

/**
 * F-6: pagar pengaman AI. Cocokkan incomingText dengan ai_guardrails.keyword
 * (aktif saja) organisasi ini, tidak peka huruf besar/kecil. Kalau kena DAN
 * kata kunci itu diatur pause_ai=true, percakapan dikunci: ai_paused=true,
 * needs_attention=true, attention_reason & attention_at diisi — supaya
 * pemilik/CS harus mengambil alih manual (lihat kolom conversations di
 * schema.sql, bagian F-6/F-7).
 *
 * triggered=true berarti "ada hal sensitif di pesan ini". Yang menentukan
 * tindakannya adalah pause_ai:
 *   pause_ai = true  -> percakapan DIKUNCI (ai_paused), AI berhenti total
 *                       sampai manusia melepas manual. Untuk hal berat:
 *                       tuduhan tipu, sebut peguam/polis, barang rosak.
 *   pause_ai = false -> percakapan TIDAK dikunci dan AI TETAP membalas, tapi
 *                       dengan larangan keras menjanjikan apa pun (lihat
 *                       holdingReason di chatbot.ts). Untuk nego harga:
 *                       dulu AI diam total di kasus ini dan pelanggan merasa
 *                       di-ghosting — justru kehilangan calon pembeli.
 * Kedua-duanya menandai percakapan needs_attention supaya muncul di daftar
 * "butuh perhatian" pemilik.
 */
export async function checkGuardrails(params: CheckGuardrailsParams): Promise<GuardrailResult> {
  const { organizationId, conversationId, incomingText } = params;
  const text = incomingText.toLowerCase().trim();
  if (!text) return { triggered: false };

  const { rows } = await pool.query(
    "SELECT keyword, reason, pause_ai FROM ai_guardrails WHERE organization_id = $1 AND is_active = true",
    [organizationId]
  );

  const hit = rows.find((r) => text.includes(String(r.keyword).toLowerCase()));
  if (!hit) return { triggered: false };

  if (hit.pause_ai) {
    await pool.query(
      `UPDATE conversations c
       SET ai_paused = true, needs_attention = true, attention_reason = $1, attention_at = now()
       FROM contacts ct
       WHERE c.contact_id = ct.id AND c.id = $2 AND ct.organization_id = $3`,
      [hit.reason, conversationId, organizationId]
    );
  } else {
    // Tidak dikunci, tapi TETAP ditandai butuh perhatian: permintaan diskon
    // yang tidak pernah muncul di daftar "butuh perhatian" sama saja dengan
    // hilang — pemilik tidak akan pernah tahu ada calon pembeli menawar.
    await pool.query(
      `UPDATE conversations c
       SET needs_attention = true,
           attention_reason = COALESCE(c.attention_reason, $1),
           attention_at = COALESCE(c.attention_at, now())
       FROM contacts ct
       WHERE c.contact_id = ct.id
         AND c.id = $2
         AND c.needs_attention = false
         AND ct.organization_id = $3`,
      [hit.reason, conversationId, organizationId]
    );
  }

  return { triggered: true, reason: hit.reason, pauseAi: hit.pause_ai === true };
}

export interface DefaultGuardrail {
  keyword: string;
  reason: string;
  pauseAi: boolean;
}

/**
 * Daftar bawaan untuk pasar Malaysia (Bahasa Melayu/Indonesia campur, sesuai
 * gaya chat pelanggan sungguhan) — pemilik boleh menambah/menghapus lewat
 * dashboard, ini cuma titik awal supaya organisasi baru tidak mulai dari nol.
 *
 * Kata kunci yang menyangkut RISIKO SERIUS (tuduhan tipu, ancaman hukum,
 * barang rosak) mengunci percakapan penuh (pauseAi=true). Kata kunci
 * negosiasi harga (diskon/nego) sengaja TIDAK mengunci penuh (pauseAi=false)
 * — AI tetap membalas ramah tanpa menjanjikan angka apa pun, sambil percakapan
 * ditandai butuh perhatian supaya pemilik bisa memberi keputusan harga.
 */
export const DEFAULT_GUARDRAILS: DefaultGuardrail[] = [
  { keyword: "refund", reason: "Pelanggan minta refund/pulangkan wang — perlu ditangani manusia.", pauseAi: true },
  {
    keyword: "pulangkan wang",
    reason: "Pelanggan minta refund/pulangkan wang — perlu ditangani manusia.",
    pauseAi: true,
  },
  { keyword: "komplain", reason: "Pelanggan komplain/mengadu — perlu ditangani manusia.", pauseAi: true },
  { keyword: "aduan", reason: "Pelanggan komplain/mengadu — perlu ditangani manusia.", pauseAi: true },
  {
    keyword: "tipu",
    reason: "Pelanggan menuduh tipu/scam/penipu — perlu ditangani manusia SEGERA.",
    pauseAi: true,
  },
  {
    keyword: "scam",
    reason: "Pelanggan menuduh tipu/scam/penipu — perlu ditangani manusia SEGERA.",
    pauseAi: true,
  },
  {
    keyword: "penipu",
    reason: "Pelanggan menuduh tipu/scam/penipu — perlu ditangani manusia SEGERA.",
    pauseAi: true,
  },
  {
    keyword: "lawyer",
    reason: "Pelanggan menyebut lawyer/peguam/polis — perlu ditangani manusia SEGERA.",
    pauseAi: true,
  },
  {
    keyword: "peguam",
    reason: "Pelanggan menyebut lawyer/peguam/polis — perlu ditangani manusia SEGERA.",
    pauseAi: true,
  },
  {
    keyword: "polis",
    reason: "Pelanggan menyebut lawyer/peguam/polis — perlu ditangani manusia SEGERA.",
    pauseAi: true,
  },
  {
    keyword: "diskon",
    reason: "Pelanggan minta diskon/kurang harga/nego — perlu persetujuan manusia sebelum dijanjikan.",
    pauseAi: false,
  },
  {
    keyword: "kurang harga",
    reason: "Pelanggan minta diskon/kurang harga/nego — perlu persetujuan manusia sebelum dijanjikan.",
    pauseAi: false,
  },
  // Ejaan & ungkapan Melayu yang benar-benar dipakai pembeli Malaysia — tanpa
  // ini, "boleh kurang sikit tak?" (cara paling lazim minta diskon di sana)
  // lolos begitu saja karena tidak mengandung kata "diskon".
  {
    keyword: "diskaun",
    reason: "Pelanggan minta diskon/nego harga — keputusan harga ada di pemilik.",
    pauseAi: false,
  },
  {
    keyword: "boleh kurang",
    reason: "Pelanggan minta diskon/nego harga — keputusan harga ada di pemilik.",
    pauseAi: false,
  },
  {
    keyword: "kurang sikit",
    reason: "Pelanggan minta diskon/nego harga — keputusan harga ada di pemilik.",
    pauseAi: false,
  },
  {
    keyword: "murah sikit",
    reason: "Pelanggan minta diskon/nego harga — keputusan harga ada di pemilik.",
    pauseAi: false,
  },
  {
    keyword: "harga borong",
    reason: "Pelanggan tanya harga borong/pukal — keputusan harga ada di pemilik.",
    pauseAi: false,
  },
  {
    keyword: "nego",
    reason: "Pelanggan minta diskon/kurang harga/nego — perlu persetujuan manusia sebelum dijanjikan.",
    pauseAi: false,
  },
  { keyword: "rosak", reason: "Pelanggan bilang barang rosak/pecah/salah barang.", pauseAi: true },
  { keyword: "pecah", reason: "Pelanggan bilang barang rosak/pecah/salah barang.", pauseAi: true },
  { keyword: "salah barang", reason: "Pelanggan bilang barang rosak/pecah/salah barang.", pauseAi: true },
];

/**
 * Isi DEFAULT_GUARDRAILS untuk organisasi ini SEKALI SAJA — idempotent,
 * dicek dulu kata kunci mana yang sudah ada (tidak peka huruf besar/kecil)
 * supaya dipanggil berulang (mis. tiap kali server start) tidak menggandakan
 * baris.
 */
export async function seedDefaultGuardrails(organizationId: string): Promise<void> {
  const { rows } = await pool.query(
    "SELECT lower(keyword) AS keyword FROM ai_guardrails WHERE organization_id = $1",
    [organizationId]
  );
  const existing = new Set<string>(rows.map((r) => r.keyword));

  const missing = DEFAULT_GUARDRAILS.filter((g) => !existing.has(g.keyword.toLowerCase()));
  if (missing.length === 0) return;

  for (const g of missing) {
    await pool.query(
      `INSERT INTO ai_guardrails (organization_id, keyword, reason, pause_ai, is_active)
       VALUES ($1, $2, $3, $4, true)`,
      [organizationId, g.keyword, g.reason, g.pauseAi]
    );
  }
}
