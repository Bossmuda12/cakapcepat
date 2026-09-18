import { pool } from "../db/pool";
import { getAiConfig, isBudgetExceeded } from "./usage";
import { callClaude } from "./anthropic";
import { getRecentHistory } from "./history";
import { buildKnowledgeContext } from "./knowledge";
import { buildCustomerContext } from "./customerContext";
import { detectProduct } from "./productDetector";
import { checkGuardrails } from "./guardrails";
import { splitIntoBubbles, typingDelayMs, recentOpeners, rememberOpener } from "./humanizer";

export interface GenerateReplyParams {
  organizationId: string;
  conversationId: string;
  incomingText: string;
  /**
   * P-6: dipakai untuk menentukan produk yang sedang dibicarakan (lewat
   * whatsapp_channels.product_id) kalau conversations.product_id belum diisi,
   * dan untuk mengambil persona/pengaturan AI nomor ini. Opsional supaya
   * pemanggil lama tetap kompilasi — kalau kosong, dipakai channel_id yang
   * tersimpan di baris conversations itu sendiri (selalu ada, NOT NULL).
   */
  channelId?: string;
  /** F-2: URL/teks sumber iklan (CTWA) — dipakai detectProduct untuk mencocokkan produk tanpa AI. */
  adSourceUrl?: string | null;
}

export interface AiReplyDetail {
  text: string;
  productId: string | null;
  /** F-4: pecahan gelembung chat siap kirim berurutan (lihat humanizer.ts). */
  bubbles: string[];
  /** F-4: jeda "mengetik" (ms) yang disarankan sebelum mengirim balasan ini. */
  delayMs: number;
}

interface ConversationContext {
  channelId: string;
  aiPaused: boolean;
}

interface ChannelPersona {
  aiEnabled: boolean;
  personaName: string | null;
  personaPrompt: string | null;
}

const MAX_TOKENS_REPLY = 600;

/**
 * "Otak AI" CakapCepat — perakit semua modul src/ai/* jadi satu balasan siap
 * kirim, dipakai baik oleh maybeGenerateAiReply (perilaku lama, cuma butuh
 * teksnya sebagai string|null) maupun oleh kode pengiriman manusiawi di
 * src/whatsapp/* (butuh detail: produk yang terdeteksi, pecahan gelembung
 * chat, jeda mengetik — lihat generateAiReplyDetailed di bawah).
 *
 * Urutan langkahnya sesuai keputusan produk (F-1 s/d F-10, lihat schema.sql):
 *   (a) berhenti kalau ai_paused (dikunci guardrail/manual) atau nomor ini
 *       memang belum dinyalakan AI-nya (whatsapp_channels.ai_enabled)
 *   (b) pagar pengaman (guardrails) dulu — kalau kena, AI mundur giliran ini
 *   (c) deteksi produk yang sedang dibicarakan
 *   (d) susun pengetahuan berlapis (toko > kategori > produk)
 *   (e) sisipkan persona nomor ke system prompt
 *   (f) larang mengulang pembuka yang baru saja dipakai di nomor ini
 *   (g) larangan keras: cuma boleh sebut fakta yang ada di konteks
 *   (h) panggil Claude lewat satu pintu (callClaude — mencatat biaya & cek budget)
 *   (i) ingat pembuka balasan ini supaya tidak diulang lagi ke depan
 */
export async function generateAiReplyDetailed(params: GenerateReplyParams): Promise<AiReplyDetail | null> {
  const { organizationId, conversationId, incomingText } = params;
  if (!incomingText.trim()) return null;

  const convo = await loadConversationContext(conversationId, params.channelId);
  if (!convo) return null;
  if (convo.aiPaused) return null; // (a) — chat sedang dipegang manusia / dikunci guardrail sebelumnya

  const channel = await loadChannelPersona(convo.channelId);
  if (channel && !channel.aiEnabled) return null; // (a) — AI belum dinyalakan utk nomor ini (F-3, default MATI)

  const guardrail = await checkGuardrails({ organizationId, conversationId, incomingText }); // (b)
  // Pagar "berat" (tuduhan tipu, sebut peguam, barang rosak) → AI mundur
  // sepenuhnya dan percakapan dikunci untuk manusia. Pagar "ringan" (minta
  // diskon/nego) → AI TETAP membalas supaya pelanggan tidak di-ghosting, tapi
  // dengan larangan keras menjanjikan apa pun; lihat holdingInstruction.
  if (guardrail.triggered && guardrail.pauseAi) return null;
  const holdingReason = guardrail.triggered ? guardrail.reason ?? null : null;

  const aiConfig = await getAiConfig(organizationId);
  if (!aiConfig.apiKey) {
    // AI belum dikonfigurasi sama sekali (dashboard maupun env var) — biarkan
    // chat masuk normal ke inbox untuk dijawab manusia.
    return null;
  }

  if (await isBudgetExceeded(organizationId)) {
    console.error(`[ai] Batas biaya AI harian organisasi ${organizationId} sudah habis — balasan AI ditahan.`);
    return null;
  }

  const productId = await detectProduct({
    organizationId,
    conversationId,
    channelId: convo.channelId,
    incomingText,
    adSourceUrl: params.adSourceUrl ?? null,
  }); // (c)

  const [knowledge, customer, history, openers] = await Promise.all([
    buildKnowledgeContext(organizationId, productId), // (d)
    buildCustomerContext(organizationId, conversationId), // (d2) fakta pesanan pelanggan ini
    getRecentHistory(conversationId),
    recentOpeners(organizationId, convo.channelId), // (f)
  ]);

  const system = buildSystemPrompt({
    knowledge,
    customer,
    holdingReason,
    orgSystemPrompt: aiConfig.systemPrompt,
    personaName: channel?.personaName ?? null,
    personaPrompt: channel?.personaPrompt ?? null,
    recentOpeners: openers,
  }); // (e) + (f) + (g)

  const text = await callClaude({
    organizationId,
    conversationId,
    purpose: "reply",
    model: aiConfig.model,
    system,
    messages: [...history, { role: "user", content: incomingText }],
    maxTokens: MAX_TOKENS_REPLY,
  }); // (h)
  if (!text) return null;

  await rememberOpener(organizationId, convo.channelId, text); // (i)

  return {
    text,
    productId,
    bubbles: splitIntoBubbles(text),
    delayMs: typingDelayMs(text),
  };
}

/**
 * Balasan otomatis berbasis Claude API — dipakai sebagai fallback terakhir
 * di src/whatsapp/ingest.ts (lihat maybeAutoReply), hanya jalan kalau tidak
 * ada aturan kata kunci/jam kerja yang cocok.
 *
 * JANGAN UBAH tipe kembalian ini (Promise<string|null>) — pemanggil lama
 * mengharapkan persis ini. Untuk detail lengkap (produk terdeteksi, pecahan
 * gelembung chat, jeda mengetik) dipakai pengiriman manusiawi, pakai
 * generateAiReplyDetailed di atas.
 */
export async function maybeGenerateAiReply(params: GenerateReplyParams): Promise<string | null> {
  const detail = await generateAiReplyDetailed(params);
  return detail?.text ?? null;
}

async function loadConversationContext(
  conversationId: string,
  paramChannelId?: string
): Promise<ConversationContext | null> {
  const { rows } = await pool.query("SELECT channel_id, ai_paused FROM conversations WHERE id = $1", [
    conversationId,
  ]);
  const convo = rows[0];
  if (!convo) return null;

  return {
    channelId: paramChannelId ?? convo.channel_id,
    aiPaused: convo.ai_paused === true,
  };
}

async function loadChannelPersona(channelId: string): Promise<ChannelPersona | null> {
  const { rows } = await pool.query(
    "SELECT ai_enabled, persona_name, persona_prompt FROM whatsapp_channels WHERE id = $1",
    [channelId]
  );
  const ch = rows[0];
  if (!ch) return null;
  return {
    aiEnabled: ch.ai_enabled === true,
    personaName: ch.persona_name ?? null,
    personaPrompt: ch.persona_prompt ?? null,
  };
}

function buildSystemPrompt(args: {
  knowledge: string;
  customer: string;
  holdingReason: string | null;
  orgSystemPrompt: string | null;
  personaName: string | null;
  personaPrompt: string | null;
  recentOpeners: string[];
}): string {
  const { knowledge, customer, holdingReason, orgSystemPrompt, personaName, personaPrompt, recentOpeners } = args;

  const lines: string[] = [];

  // (e) Persona ikut NOMOR (mis. "Rina"), pengetahuan ikut PRODUK — lihat
  // komentar F-3 di schema.sql — supaya satu CS virtual bisa layani banyak
  // produk tanpa gaya bicaranya berubah-ubah.
  if (personaName) {
    lines.push(
      `Kamu berperan sebagai ${personaName}, staf customer service toko ini yang membalas chat WhatsApp pelanggan.`
    );
    if (personaPrompt) lines.push(personaPrompt);
    if (orgSystemPrompt) lines.push(orgSystemPrompt);
  } else {
    lines.push(orgSystemPrompt || "Kamu adalah staf customer service yang membalas chat WhatsApp pelanggan toko ini.");
    if (personaPrompt) lines.push(personaPrompt);
  }

  lines.push(
    "Balas SEPERTI MANUSIA SUNGGUHAN: singkat, natural, ramah, dalam Bahasa Melayu/Indonesia santai sesuai gaya pelanggan (ikuti bahasa pelanggan kalau menulis dalam bahasa lain).",
    "Jangan terdengar seperti template/robot — jangan selalu mulai balasan dengan sapaan formal yang sama persis."
  );

  // (f) F-5 anti pembuka berulang — 50 chat dengan pembuka identik tetap
  // terbaca sebagai bot walau isi selebihnya berbeda-beda.
  if (recentOpeners.length > 0) {
    lines.push(
      "",
      "JANGAN memulai balasan dengan kalimat pembuka yang PERSIS SAMA seperti salah satu daftar berikut (baru saja dipakai di chat lain, cari kalimat pembuka lain):",
      ...recentOpeners.map((o) => `- "${o}"`)
    );
  }

  // (g) Larangan keras — tujuan bisnis utama: AI TIDAK PERNAH salah menyebut
  // fakta produk (harga/stok/janji pengiriman yang dikarang bisa langsung
  // merugikan bisnis nyata & merusak kepercayaan pelanggan COD).
  lines.push(
    "",
    "ATURAN KERAS (WAJIB dipatuhi):",
    "1. Kamu HANYA boleh menyebut harga, stok, varian, atau fakta produk lain yang ADA di dalam Knowledge Base di bawah ini.",
    "2. DILARANG KERAS mengarang harga, stok, waktu pengiriman, atau janji apa pun yang tidak tertulis di Knowledge Base.",
    "3. Kalau pelanggan tanya sesuatu yang jawabannya TIDAK ADA di Knowledge Base, JUJUR bilang akan dicek dulu oleh tim — jangan menebak atau mengarang.",
    "4. Jangan pernah menjanjikan diskon, refund, atau kompensasi apa pun tanpa persetujuan tim.",
    "",
    "=== Knowledge Base (satu-satunya sumber fakta produk yang boleh kamu pakai) ===",
    knowledge
  );

  if (customer.trim()) {
    lines.push("", customer.trim());
  }

  if (holdingReason) {
    lines.push(
      "",
      "SITUASI KHUSUS PESAN INI: " + holdingReason,
      "Untuk balasan ini kamu WAJIB:",
      "- Tetap membalas dengan ramah supaya pelanggan tidak merasa diabaikan.",
      "- TIDAK menyebut angka diskon, potongan, harga khusus, atau janji apa pun.",
      "- Katakan dengan bahasa sendiri (jangan template) bahwa kamu akan cek dulu ke tim/pemilik dan kabari lagi.",
      "- Kalau relevan, tetap jawab pertanyaan lain pelanggan yang faktanya ada di Knowledge Base."
    );
  }

  return lines.join("\n");
}
