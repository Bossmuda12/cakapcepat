import { config } from "../config";
import { pool } from "../db/pool";

interface GenerateReplyParams {
  organizationId: string;
  conversationId: string;
  incomingText: string;
}

/**
 * STUB — kerangka dasar AI chatbot (Bab 9 dokumen rencana).
 *
 * Developer perlu melengkapi:
 *  1. Panggilan ke provider AI pilihan (mis. Claude API) memakai AI_PROVIDER_API_KEY.
 *  2. Retrieval knowledge base yang relevan (saat ini masih ambil SEMUA entries —
 *     untuk knowledge base besar, ganti dengan pencarian vector/embedding).
 *  3. Logika "uncertain → eskalasi ke manusia": kalau AI tidak yakin, JANGAN
 *     kirim balasan otomatis — biarkan agent manusia yang menjawab.
 *
 * Return null berarti "jangan balas otomatis" (mis. AI belum dikonfigurasi,
 * atau sengaja diserahkan ke agent manusia).
 */
export async function maybeGenerateAiReply({
  organizationId,
  conversationId,
  incomingText,
}: GenerateReplyParams): Promise<string | null> {
  if (!config.ai.apiKey) {
    // AI belum disetel — biarkan chat masuk normal ke inbox untuk dijawab manusia.
    return null;
  }
  if (!incomingText.trim()) return null;

  const knowledge = await getKnowledgeBaseContext(organizationId);

  // TODO developer: ganti fetch di bawah ini dengan panggilan provider AI
  // sungguhan. Contoh kerangka pemanggilan (generik, sesuaikan dengan provider):
  //
  // const res = await fetch("https://api.anthropic.com/v1/messages", {
  //   method: "POST",
  //   headers: {
  //     "x-api-key": config.ai.apiKey,
  //     "anthropic-version": "2023-06-01",
  //     "content-type": "application/json",
  //   },
  //   body: JSON.stringify({
  //     model: "claude-sonnet-4-5",
  //     max_tokens: 300,
  //     system: buildSystemPrompt(knowledge),
  //     messages: [{ role: "user", content: incomingText }],
  //   }),
  // });
  // const data = await res.json();
  // const reply = data.content?.[0]?.text ?? null;
  // return isUncertain(reply) ? null : reply;

  console.log(
    `[ai] (stub) Akan membalas conversation ${conversationId} — lengkapi ai/chatbot.ts dengan provider AI sungguhan.`
  );
  return null;
}

async function getKnowledgeBaseContext(organizationId: string): Promise<string> {
  const { rows } = await pool.query(
    "SELECT title, content FROM knowledge_base_entries WHERE organization_id = $1 LIMIT 50",
    [organizationId]
  );
  return rows.map((r) => `## ${r.title}\n${r.content}`).join("\n\n");
}

function buildSystemPrompt(knowledge: string): string {
  return [
    "Kamu adalah asisten customer service yang membalas chat WhatsApp.",
    "Jawab HANYA berdasarkan informasi di knowledge base berikut. Kalau tidak yakin atau informasinya tidak ada, katakan tidak tahu — jangan mengarang.",
    "",
    knowledge,
  ].join("\n");
}
