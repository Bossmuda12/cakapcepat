import { pool } from "../db/pool";
import { config } from "../config";

// F-9: tujuan pemakaian AI — dicatat di ai_usage_log.purpose (lihat schema.sql)
// supaya biaya bisa dipilah per fitur (balas chat vs klasifikasi vs ringkasan).
export type AiPurpose = "reply" | "classify" | "detect_product" | "summarize" | "followup";

export interface AiConfig {
  apiKey: string;
  model: string;
  modelSmall: string;
  systemPrompt: string | null;
}

// Model kecil dipakai untuk tugas murah & sering (klasifikasi/deteksi produk)
// — jauh lebih murah daripada model besar yang dipakai untuk menjawab chat.
const DEFAULT_MODEL_SMALL = "claude-haiku-4-5-20251001";

/**
 * F-9: tarif per model, dalam SEN per SEJUTA token — satuan yang sama dengan
 * products.price_cents (integer sen, bukan desimal) supaya konsisten dengan
 * penyimpanan uang di seluruh sistem ini.
 *
 * PENTING: angka di bawah ini PERKIRAAN KASAR (kira-kira mengikuti harga
 * publik Anthropic per model), BUKAN tarif resmi yang dijamin akurat.
 * Sesuaikan sendiri kalau harga resmi Anthropic berubah — nilai ini cuma
 * dipakai untuk kontrol budget internal (ai_daily_budget_cents), BUKAN untuk
 * tagihan resmi ke siapa pun.
 */
const PRICING_CENTS_PER_MILLION_TOKENS: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5-20251001": { input: 100, output: 500 }, // kira-kira $1 / $5 per 1 juta token
  "claude-sonnet-4-5-20250929": { input: 300, output: 1500 }, // kira-kira $3 / $15 per 1 juta token
  "claude-opus-4-1-20250805": { input: 1500, output: 7500 }, // kira-kira $15 / $75 per 1 juta token
};

// Kalau model yang dipakai tidak ada di tabel tarif di atas (mis. model baru
// yang belum sempat ditambahkan), pakai tarif kelas "sonnet" sebagai
// perkiraan aman (tidak menyepelekan biaya, tidak juga terlalu berlebihan).
const FALLBACK_PRICING = { input: 300, output: 1500 };

function pricingFor(model: string): { input: number; output: number } {
  return PRICING_CENTS_PER_MILLION_TOKENS[model] ?? FALLBACK_PRICING;
}

/** Hitung perkiraan biaya (dalam SEN, dibulatkan) untuk sejumlah token input/output. */
function estimateCostCents(model: string, inputTokens: number, outputTokens: number): number {
  const rate = pricingFor(model);
  const cost = (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000;
  return Math.max(0, Math.round(cost));
}

export interface RecordUsageParams {
  organizationId: string;
  conversationId?: string;
  purpose: AiPurpose;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * F-9: catat SETIAP pemakaian Claude API ke ai_usage_log (untuk audit/laporan
 * biaya per fitur), lalu tambahkan perkiraan biayanya ke
 * organization.ai_spend_cents — dipakai isBudgetExceeded untuk menghentikan
 * panggilan AI kalau organisasi sudah melewati ai_daily_budget_cents.
 *
 * Reset otomatis: kalau ai_spend_date bukan hari ini, ai_spend_cents ditimpa
 * (bukan ditambah) dengan biaya panggilan ini — artinya hari baru = mulai
 * hitung ulang dari nol. Dilakukan dalam satu statement SQL (CASE ... WHEN)
 * supaya atomik, tidak ada race condition baca-lalu-tulis kalau beberapa
 * pesan masuk hampir bersamaan untuk organisasi yang sama.
 */
export async function recordUsage(params: RecordUsageParams): Promise<void> {
  const { organizationId, conversationId, purpose, model, inputTokens, outputTokens } = params;
  const costCents = estimateCostCents(model, inputTokens, outputTokens);

  await pool.query(
    `INSERT INTO ai_usage_log
       (organization_id, conversation_id, purpose, model, input_tokens, output_tokens, cost_cents)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [organizationId, conversationId ?? null, purpose, model, inputTokens, outputTokens, costCents]
  );

  await pool.query(
    `UPDATE organization SET
       ai_spend_cents = CASE
         WHEN ai_spend_date IS DISTINCT FROM CURRENT_DATE THEN $2
         ELSE ai_spend_cents + $2
       END,
       ai_spend_date = CURRENT_DATE
     WHERE id = $1`,
    [organizationId, costCents]
  );
}

/**
 * F-9: true kalau organisasi SUDAH mengisi batas budget harian (kolom NULL =
 * tidak ada batas, jadi selalu false) DAN pemakaian hari ini sudah melampaui
 * batas itu. Perbandingan tanggal dilakukan di sisi SQL (CURRENT_DATE) supaya
 * tidak ada risiko selisih zona waktu antara driver Node dan database.
 */
export async function isBudgetExceeded(organizationId: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT ai_daily_budget_cents,
            CASE WHEN ai_spend_date = CURRENT_DATE THEN ai_spend_cents ELSE 0 END AS spent_today
     FROM organization WHERE id = $1`,
    [organizationId]
  );
  const org = rows[0];
  if (!org || org.ai_daily_budget_cents == null) return false;
  return Number(org.spent_today) >= Number(org.ai_daily_budget_cents);
}

/**
 * Ambil konfigurasi AI organisasi (kredensial + pilihan model), dengan
 * fallback ke env var (config.ai.*) kalau organisasi belum mengisi apa pun
 * lewat dashboard — sama seperti perilaku lama di chatbot.ts/leadsAnalyzer.ts.
 */
export async function getAiConfig(organizationId: string): Promise<AiConfig> {
  const { rows } = await pool.query(
    "SELECT ai_api_key, ai_model, ai_model_small, ai_system_prompt FROM organization WHERE id = $1",
    [organizationId]
  );
  const org = rows[0];
  return {
    apiKey: org?.ai_api_key || config.ai.apiKey || "",
    model: org?.ai_model || config.ai.model,
    modelSmall: org?.ai_model_small || DEFAULT_MODEL_SMALL,
    systemPrompt: org?.ai_system_prompt || null,
  };
}
