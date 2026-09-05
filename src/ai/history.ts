import { pool } from "../db/pool";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const MAX_HISTORY_MESSAGES = 10;

/**
 * Ambil beberapa pesan terakhir di percakapan ini supaya AI punya konteks
 * obrolan (bukan cuma menjawab 1 pesan tanpa tahu apa yang sudah dibahas).
 * Dipakai bersama oleh chatbot.ts (balas chat), orderClassifier.ts (F-8),
 * dan summarizer.ts (F-10) — jangan duplikasi query ini di file lain.
 */
export async function getRecentHistory(conversationId: string): Promise<ChatMessage[]> {
  const { rows } = await pool.query(
    `SELECT direction, content
     FROM messages
     WHERE conversation_id = $1 AND content_type = 'text'
     ORDER BY created_at DESC
     LIMIT $2`,
    [conversationId, MAX_HISTORY_MESSAGES]
  );
  const messages = rows
    .reverse()
    .map((m): ChatMessage => ({
      role: m.direction === "inbound" ? "user" : "assistant",
      content: typeof m.content?.body === "string" ? m.content.body : "",
    }))
    .filter((m) => m.content.trim().length > 0);

  // P-22: API Claude mewajibkan urutan peran user/assistant berselang-seling
  // dan wajib DIMULAI dari "user" — riwayat mentah bisa melanggar ini kalau
  // ada 2+ pesan berurutan dengan arah yang sama (mis. CS balas manual 2x
  // berturut-turut, atau pelanggan kirim 2 pesan terpisah tanpa dibalas dulu).
  // Gabungkan pesan berurutan dengan role sama jadi satu (isi disambung baris
  // baru), lalu buang dari depan sampai pesan pertama ber-role "user".
  const merged: ChatMessage[] = [];
  for (const m of messages) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) {
      last.content = `${last.content}\n${m.content}`;
    } else {
      merged.push({ ...m });
    }
  }

  const firstUserIndex = merged.findIndex((m) => m.role === "user");
  return firstUserIndex === -1 ? [] : merged.slice(firstUserIndex);
}
