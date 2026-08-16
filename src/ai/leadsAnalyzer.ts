import { config } from "../config";
import { pool } from "../db/pool";

interface AiConfig {
  apiKey: string;
  model: string;
}

export interface LeadItem {
  contactName: string;
  waNumber: string;
  role: string | null;
  reason: string;
  nextStep: string;
}

export interface LeadFlag {
  contactName: string;
  issue: string;
  severity: "low" | "medium" | "high";
}

export interface LeadAnalysisResult {
  summary: string;
  hotLeads: LeadItem[];
  warmLeads: LeadItem[];
  dropLeads: LeadItem[];
  flags: LeadFlag[];
  estimatedValue: number | null;
}

const MAX_CONVERSATIONS = 25;
const MAX_MESSAGES_PER_CONVERSATION = 12;

/**
 * Analisis "Hot Leads AI": ambil percakapan yang paling aktif dalam organization,
 * kirim ringkasan isinya ke Claude, minta diklasifikasikan jadi hot/warm/drop leads
 * plus estimasi potensi nilai closing dan flag potensi masalah (nada tidak
 * profesional, janji yang berisiko, dsb — versi ringan dari "SOP & fraud check").
 *
 * Dipakai baik dari endpoint on-demand (POST /leads/analyze) maupun dari laporan
 * AI harian via WhatsApp (lihat src/scheduler.ts).
 */
export async function analyzeLeads(organizationId: string): Promise<LeadAnalysisResult> {
  const aiConfig = await getAiConfig(organizationId);
  const conversations = await gatherConversations(organizationId);

  if (!aiConfig.apiKey) {
    return {
      summary:
        "AI belum dikonfigurasi. Isi API key di halaman Otomatisasi supaya CakapCepat bisa " +
        "menganalisis leads secara otomatis.",
      hotLeads: [],
      warmLeads: [],
      dropLeads: [],
      flags: [],
      estimatedValue: null,
    };
  }

  if (conversations.length === 0) {
    return {
      summary: "Belum ada percakapan yang bisa dianalisis.",
      hotLeads: [],
      warmLeads: [],
      dropLeads: [],
      flags: [],
      estimatedValue: null,
    };
  }

  const prompt = buildPrompt(conversations);

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
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = (await res.json()) as {
      content?: { type: string; text?: string }[];
      error?: { message?: string };
    };

    if (!res.ok) {
      console.error(`[leads] Panggilan Claude API gagal (${res.status}):`, data?.error?.message ?? data);
      return fallbackResult("Gagal menghubungi AI — coba lagi beberapa saat lagi.");
    }

    const text = data.content?.find((b) => b.type === "text")?.text?.trim() ?? "";
    return parseResult(text);
  } catch (err) {
    console.error("[leads] Gagal menganalisis leads:", err);
    return fallbackResult("Terjadi kesalahan saat menghubungi AI.");
  }
}

function fallbackResult(summary: string): LeadAnalysisResult {
  return { summary, hotLeads: [], warmLeads: [], dropLeads: [], flags: [], estimatedValue: null };
}

const SYSTEM_PROMPT = [
  "Kamu adalah analis sales & customer service untuk tim internal yang berjualan lewat WhatsApp.",
  "Tugasmu: baca ringkasan percakapan yang diberikan, lalu klasifikasikan tiap kontak ke salah satu",
  "kategori: hot (siap closing / sangat tertarik), warm (masih prospek, butuh follow-up), atau",
  "drop (sepertinya tidak akan lanjut / sudah lama tidak respon). Juga tandai (flag) percakapan yang",
  "berpotensi bermasalah, misalnya CS janji diskon tidak wajar, nada tidak profesional, atau",
  "keluhan pelanggan yang belum ditangani.",
  "",
  "Balas HANYA dalam format JSON valid (tanpa markdown, tanpa penjelasan tambahan) dengan struktur:",
  `{"summary": string, "estimatedValue": number|null, ` +
    `"hotLeads": [{"contactName": string, "waNumber": string, "role": string|null, "reason": string, "nextStep": string}], ` +
    `"warmLeads": [...sama seperti hotLeads...], ` +
    `"dropLeads": [...sama seperti hotLeads, "reason" diisi kenapa sepertinya drop...], ` +
    `"flags": [{"contactName": string, "issue": string, "severity": "low"|"medium"|"high"}]}`,
  "estimatedValue adalah estimasi kasar total potensi nilai closing (dalam Rupiah) dari hotLeads, boleh null kalau tidak bisa diperkirakan.",
  "Jawab dalam Bahasa Indonesia untuk semua teks di dalam JSON. Jangan mengarang nomor WA atau nama — pakai persis yang diberikan.",
].join("\n");

interface ConversationSummary {
  contactName: string;
  waNumber: string;
  status: string;
  pipelineStage: string | null;
  messages: { direction: string; body: string }[];
}

async function gatherConversations(organizationId: string): Promise<ConversationSummary[]> {
  const { rows: convoRows } = await pool.query(
    `SELECT conv.id, conv.status, c.wa_number, c.name AS contact_name, c.pipeline_stage
     FROM conversations conv
     JOIN contacts c ON c.id = conv.contact_id
     WHERE c.organization_id = $1
     ORDER BY conv.last_message_at DESC NULLS LAST
     LIMIT $2`,
    [organizationId, MAX_CONVERSATIONS]
  );

  const results: ConversationSummary[] = [];
  for (const convo of convoRows) {
    const { rows: msgRows } = await pool.query(
      `SELECT direction, content
       FROM messages
       WHERE conversation_id = $1 AND content_type = 'text'
       ORDER BY created_at DESC
       LIMIT $2`,
      [convo.id, MAX_MESSAGES_PER_CONVERSATION]
    );
    const messages = msgRows
      .reverse()
      .map((m) => ({
        direction: m.direction,
        body: typeof m.content?.body === "string" ? m.content.body : "",
      }))
      .filter((m) => m.body.trim().length > 0);

    if (messages.length === 0) continue;

    results.push({
      contactName: convo.contact_name || convo.wa_number,
      waNumber: convo.wa_number,
      status: convo.status,
      pipelineStage: convo.pipeline_stage,
      messages,
    });
  }
  return results;
}

function buildPrompt(conversations: ConversationSummary[]): string {
  const lines: string[] = ["Berikut daftar percakapan untuk dianalisis:\n"];
  conversations.forEach((c, i) => {
    lines.push(`### Percakapan ${i + 1}: ${c.contactName} (${c.waNumber})`);
    lines.push(`Status: ${c.status} | Tahap pipeline: ${c.pipelineStage ?? "-"}`);
    c.messages.forEach((m) => {
      lines.push(`- [${m.direction === "inbound" ? "Pelanggan" : "CS"}] ${m.body}`);
    });
    lines.push("");
  });
  return lines.join("\n");
}

function parseResult(text: string): LeadAnalysisResult {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return fallbackResult("AI tidak mengembalikan hasil yang bisa dibaca. Coba lagi.");

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      hotLeads: Array.isArray(parsed.hotLeads) ? parsed.hotLeads : [],
      warmLeads: Array.isArray(parsed.warmLeads) ? parsed.warmLeads : [],
      dropLeads: Array.isArray(parsed.dropLeads) ? parsed.dropLeads : [],
      flags: Array.isArray(parsed.flags) ? parsed.flags : [],
      estimatedValue: typeof parsed.estimatedValue === "number" ? parsed.estimatedValue : null,
    };
  } catch (err) {
    console.error("[leads] Gagal parse hasil AI:", err, text);
    return fallbackResult("Gagal membaca hasil AI. Coba lagi.");
  }
}

async function getAiConfig(organizationId: string): Promise<AiConfig> {
  const { rows } = await pool.query("SELECT ai_api_key, ai_model FROM organization WHERE id = $1", [
    organizationId,
  ]);
  const org = rows[0];
  return {
    apiKey: org?.ai_api_key || config.ai.apiKey || "",
    model: org?.ai_model || config.ai.model,
  };
}
