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
 *
 * `organizationId` WAJIB. Ini query paling banyak dipakai di seluruh lapisan
 * AI dan isinya teks mentah pesan pelanggan. Versi lama cuma menyaring
 * `conversation_id`, jadi kalau id percakapan dari organisasi lain sampai
 * masuk ke sini — lewat job latar belakang, id yang keliru, atau bug di
 * pemanggil — isi chat pelanggan organisasi itu ikut masuk ke prompt AI
 * organisasi ini. Tabel `messages` belum punya kolom organization_id, jadi
 * tenant-nya ditelusuri lewat conversations -> contacts.
 */
export async function getRecentHistory(
  organizationId: string,
  conversationId: string
): Promise<ChatMessage[]> {
  const { rows } = await pool.query(
    `SELECT m.direction, m.content
     FROM messages m
     JOIN conversations c ON c.id = m.conversation_id
     JOIN contacts ct ON ct.id = c.contact_id
     WHERE m.conversation_id = $1
       AND ct.organization_id = $3
       AND m.content_type = 'text'
     ORDER BY m.created_at DESC
     LIMIT $2`,
    [conversationId, MAX_HISTORY_MESSAGES, organizationId]
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
