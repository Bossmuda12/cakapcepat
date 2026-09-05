import { pool } from "../db/pool";
import { getAiConfig } from "./usage";
import { callClaude } from "./anthropic";
import { getRecentHistory } from "./history";

/**
 * F-10: ringkas percakapan jadi MAKSIMAL 2 kalimat Bahasa Indonesia, simpan
 * ke conversations.ai_summary + ai_summary_at — supaya owner bisa lihat
 * intisari chat dari daftar percakapan tanpa perlu buka & baca semuanya.
 *
 * Pakai model KECIL (ringkasan bukan tugas yang butuh model besar) lewat
 * satu pintu callClaude, jadi tetap tercatat biayanya & tunduk batas budget
 * harian seperti panggilan AI lain.
 *
 * Return null (dan TIDAK menulis apa pun ke database) kalau belum ada
 * riwayat pesan, AI belum dikonfigurasi, atau panggilan Claude gagal.
 */
export async function summarizeConversation(
  organizationId: string,
  conversationId: string
): Promise<string | null> {
  const history = await getRecentHistory(conversationId);
  if (history.length === 0) return null;

  const aiConfig = await getAiConfig(organizationId);
  if (!aiConfig.apiKey) return null;

  const transcript = history.map((m) => `[${m.role === "user" ? "Pelanggan" : "CS"}] ${m.content}`).join("\n");

  const system = [
    "Ringkas transkrip chat WhatsApp berikut jadi MAKSIMAL 2 kalimat Bahasa Indonesia.",
    "Fokus ke: apa yang pelanggan mau, sudah sampai tahap apa (tanya-tanya/nego/closing/komplain/dll), dan apa yang perlu dilakukan tim selanjutnya kalau ada.",
    "Balas HANYA kalimat ringkasannya — jangan pakai heading, list, markdown, atau tanda kutip pembungkus.",
  ].join("\n");

  const summary = await callClaude({
    organizationId,
    conversationId,
    purpose: "summarize",
    model: aiConfig.modelSmall,
    system,
    messages: [{ role: "user", content: transcript }],
    maxTokens: 200,
  });
  if (!summary) return null;

  await pool.query("UPDATE conversations SET ai_summary = $1, ai_summary_at = now() WHERE id = $2", [
    summary,
    conversationId,
  ]);

  return summary;
}
