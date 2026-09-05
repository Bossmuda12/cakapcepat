import { getAiConfig, isBudgetExceeded, recordUsage, AiPurpose } from "./usage";

export interface ClaudeMessage {
  role: "user" | "assistant";
  content: string;
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
}

interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
}

interface AnthropicMessageResponse {
  content?: AnthropicContentBlock[];
  usage?: AnthropicUsage;
  error?: { message?: string; type?: string };
}

export interface CallClaudeParams {
  organizationId: string;
  conversationId?: string;
  purpose: AiPurpose;
  model: string;
  system: string;
  messages: ClaudeMessage[];
  maxTokens: number;
}

/**
 * Satu pintu pemanggilan Claude API (Anthropic) — SEMUA modul di src/ai/*
 * WAJIB lewat sini, bukan fetch langsung, supaya:
 *   1. Batas biaya harian (organization.ai_daily_budget_cents) benar-benar
 *      dihormati SEBELUM uang keluar (dicek lewat isBudgetExceeded).
 *   2. Pemakaian token tercatat konsisten ke ai_usage_log lewat recordUsage
 *      (dipakai laporan biaya per fitur — lihat ai_usage_log.purpose).
 *
 * TIDAK PERNAH melempar — kegagalan apa pun (budget habis, API key kosong,
 * error jaringan, error dari Anthropic) selalu berujung return null, supaya
 * pemanggil bisa jatuh ke perilaku "diam saja" (chat tetap masuk normal ke
 * inbox untuk dijawab manusia, bukan crash).
 */
export async function callClaude(params: CallClaudeParams): Promise<string | null> {
  const { organizationId, conversationId, purpose, model, system, messages, maxTokens } = params;

  if (await isBudgetExceeded(organizationId)) {
    console.error(
      `[ai] Batas biaya AI harian organisasi ${organizationId} sudah terlampaui — ` +
        `panggilan Claude (purpose=${purpose}) dibatalkan tanpa dikirim.`
    );
    return null;
  }

  const aiConfig = await getAiConfig(organizationId);
  if (!aiConfig.apiKey) {
    console.error(
      `[ai] API key belum diisi untuk organisasi ${organizationId} (dashboard maupun env var) — ` +
        `panggilan Claude (purpose=${purpose}) dibatalkan.`
    );
    return null;
  }

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": aiConfig.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system,
        messages,
      }),
    });

    const data = (await res.json()) as AnthropicMessageResponse;

    if (!res.ok) {
      console.error(
        `[ai] Panggilan Claude API gagal (status ${res.status}, purpose=${purpose}, org=${organizationId}):`,
        data?.error?.message ?? data
      );
      return null;
    }

    // Catat pemakaian token walau baru sebagian berhasil (usage biasanya tetap
    // ada di respons sukses) — dilakukan sebelum return supaya tidak pernah
    // terlewat gara-gara early return di baris berikutnya.
    if (data.usage) {
      await recordUsage({
        organizationId,
        conversationId,
        purpose,
        model,
        inputTokens: data.usage.input_tokens ?? 0,
        outputTokens: data.usage.output_tokens ?? 0,
      });
    }

    const text = data.content?.find((block) => block.type === "text")?.text?.trim();
    return text || null;
  } catch (err) {
    console.error(`[ai] Gagal menghubungi Claude API (purpose=${purpose}, org=${organizationId}):`, err);
    return null;
  }
}
