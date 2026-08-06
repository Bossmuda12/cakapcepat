import { config } from "../config";
import { pool } from "../db/pool";

interface GenerateReplyParams {
  organizationId: string;
  conversationId: string;
  incomingText: string;
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
}

interface AnthropicMessageResponse {
  content?: AnthropicContentBlock[];
  error?: { message?: string; type?: string };
}

interface AiConfig {
  apiKey: string;
  model: string;
  systemPrompt: string | null;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const MAX_HISTORY_MESSAGES = 10;

/**
 * Balasan otomatis berbasis Claude API (Anthropic), dipakai sebagai fallback
 * terakhir di webhook.ts (lihat maybeAutoReply) — hanya jalan kalau tidak ada
 * aturan kata kunci/jam kerja yang cocok.
 *
 * Kredensial diambil dari database dulu (diatur lewat dashboard, halaman
 * Otomatisasi), baru fallback ke env var AI_PROVIDER_API_KEY/AI_MODEL kalau
 * organisasi belum mengisi apa pun di dashboard.
 *
 * Return null berarti "jangan balas otomatis" — AI belum dikonfigurasi,
 * pesan kosong, atau panggilan ke Claude API gagal. Dalam semua kasus itu,
 * chat tetap masuk normal ke inbox untuk dijawab manusia.
 */
export async function maybeGenerateAiReply({
  organizationId,
  conversationId,
  incomingText,
}: GenerateReplyParams): Promise<string | null> {
  if (!incomingText.trim()) return null;

  const aiConfig = await getAiConfig(organizationId);
  if (!aiConfig.apiKey) {
    // AI belum disetel di dashboard maupun env var — biarkan chat masuk
    // normal ke inbox untuk dijawab manusia.
    return null;
  }

  const [knowledge, history] = await Promise.all([
    getKnowledgeBaseContext(organizationId),
    getRecentHistory(conversationId),
  ]);

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": aiConfig.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: aiConfig.model,
        max_tokens: 400,
        system: buildSystemPrompt(knowledge, aiConfig.systemPrompt),
        messages: [...history, { role: "user", content: incomingText }],
      }),
    });

    const data = (await res.json()) as AnthropicMessageResponse;

    if (!res.ok) {
      console.error(
        `[ai] Panggilan Claude API gagal (${res.status}) untuk conversation ${conversationId}:`,
        data?.error?.message ?? data
      );
      return null;
    }

    const reply = data.content?.find((block) => block.type === "text")?.text?.trim();
    return reply || null;
  } catch (err) {
    console.error(`[ai] Gagal menghubungi Claude API untuk conversation ${conversationId}:`, err);
    return null;
  }
}

async function getAiConfig(organizationId: string): Promise<AiConfig> {
  const { rows } = await pool.query(
    "SELECT ai_api_key, ai_model, ai_system_prompt FROM organization WHERE id = $1",
    [organizationId]
  );
  const org = rows[0];
  return {
    apiKey: org?.ai_api_key || config.ai.apiKey || "",
    model: org?.ai_model || config.ai.model,
    systemPrompt: org?.ai_system_prompt || null,
  };
}

async function getKnowledgeBaseContext(organizationId: string): Promise<string> {
  const { rows } = await pool.query(
    "SELECT title, content FROM knowledge_base_entries WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 50",
    [organizationId]
  );
  if (rows.length === 0) return "(Tim belum mengisi materi apa pun di Knowledge Base.)";
  return rows.map((r) => `## ${r.title}\n${r.content}`).join("\n\n");
}

// Ambil beberapa pesan terakhir di percakapan ini supaya AI punya konteks
// obrolan (bukan cuma menjawab 1 pesan tanpa tahu apa yang sudah dibahas).
async function getRecentHistory(conversationId: string): Promise<ChatMessage[]> {
  const { rows } = await pool.query(
    `SELECT direction, content
     FROM messages
     WHERE conversation_id = $1 AND content_type = 'text'
     ORDER BY created_at DESC
     LIMIT $2`,
    [conversationId, MAX_HISTORY_MESSAGES]
  );
  return rows
    .reverse()
    .map((m): ChatMessage => ({
      role: m.direction === "inbound" ? "user" : "assistant",
      content: typeof m.content?.body === "string" ? m.content.body : "",
    }))
    .filter((m) => m.content.trim().length > 0);
}

function buildSystemPrompt(knowledge: string, customPersona: string | null): string {
  return [
    customPersona ||
      "Kamu adalah asisten customer service yang membalas chat WhatsApp untuk tim internal.",
    "Jawab singkat, ramah, dan dalam Bahasa Indonesia (kecuali pelanggan menulis dalam bahasa lain).",
    "Jawab HANYA berdasarkan informasi di Knowledge Base berikut. Kalau pertanyaannya di luar itu atau kamu tidak yakin, jujur bilang belum tahu dan sarankan pelanggan menunggu dibalas tim — jangan mengarang jawaban.",
    "",
    "=== Knowledge Base ===",
    knowledge,
  ].join("\n");
}
