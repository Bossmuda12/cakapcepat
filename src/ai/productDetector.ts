import { pool } from "../db/pool";
import { getAiConfig } from "./usage";
import { callClaude } from "./anthropic";

export interface DetectProductParams {
  organizationId: string;
  conversationId: string;
  channelId: string;
  incomingText: string;
  adSourceUrl?: string | null;
}

interface ProductRow {
  id: string;
  name: string;
  category_id: string | null;
  category_name: string | null;
}

/**
 * F-2: tentukan produk yang sedang dibicarakan di percakapan ini, dari yang
 * PALING murah/akurat ke yang paling mahal, berhenti begitu ada yang cocok:
 *
 *   1. conversations.product_id sudah terisi -> terkunci, pakai itu, JANGAN
 *      diubah lagi (supaya tidak "loncat" produk di tengah percakapan).
 *   2. Cocokkan ad_source_url (atribusi iklan CTWA) dengan nama produk/nama
 *      kategori — pencocokan TEKS BIASA, TANPA memanggil AI sama sekali
 *      (gratis, dan paling akurat karena iklan memang untuk produk tertentu).
 *   3. whatsapp_channels.product_id — nomor WA ini memang didedikasikan
 *      untuk 1 produk (lihat komentar whatsapp_channels di schema.sql).
 *   4. Klasifikasi pakai model KECIL (murah) dengan daftar nama produk aktif.
 *
 * Begitu produk ditemukan, dikunci ke conversations.product_id supaya langkah
 * 1 dipakai di pesan-pesan berikutnya. Return null kalau tidak ada satu pun
 * langkah yang berhasil (AI tetap boleh balas, cuma tanpa fakta spesifik
 * produk — lihat knowledge.ts, materi umum toko tetap disertakan).
 */
export async function detectProduct(params: DetectProductParams): Promise<string | null> {
  const { organizationId, conversationId, channelId, incomingText, adSourceUrl } = params;

  // 1. Sudah terkunci sebelumnya?
  const { rows: convoRows } = await pool.query(
    `SELECT c.product_id
     FROM conversations c
     JOIN contacts ct ON ct.id = c.contact_id
     WHERE c.id = $1 AND ct.organization_id = $2`,
    [conversationId, organizationId]
  );
  const existing: string | null = convoRows[0]?.product_id ?? null;
  if (existing) return existing;

  const { rows: products } = await pool.query<ProductRow>(
    `SELECT p.id, p.name, p.category_id, pc.name AS category_name
     FROM products p
     LEFT JOIN product_categories pc ON pc.id = p.category_id
     WHERE p.organization_id = $1 AND p.is_active = true`,
    [organizationId]
  );

  let detected: string | null = null;

  // 2. Cocokkan ad_source_url dengan nama produk/kategori (teks biasa, tanpa AI).
  if (adSourceUrl && adSourceUrl.trim()) {
    detected = matchAdSourceToProduct(adSourceUrl, products);
  }

  // 3. Nomor WA ini terikat 1 produk.
  if (!detected) {
    const { rows: channelRows } = await pool.query(
      "SELECT product_id FROM whatsapp_channels WHERE id = $1 AND organization_id = $2",
      [channelId, organizationId]
    );
    if (channelRows[0]?.product_id) detected = channelRows[0].product_id;
  }

  // 4. Terakhir: klasifikasi pakai model kecil.
  if (!detected && products.length > 0 && incomingText.trim()) {
    detected = await classifyProductWithAi({ organizationId, conversationId, incomingText, products });
  }

  // Kunci hasilnya — WHERE product_id IS NULL supaya tidak menimpa kalau
  // sudah keburu diisi manual/proses lain di antara SELECT dan UPDATE ini.
  if (detected) {
    await pool.query(
      `UPDATE conversations c
       SET product_id = $1
       FROM contacts ct
       WHERE c.contact_id = ct.id
         AND c.id = $2
         AND c.product_id IS NULL
         AND ct.organization_id = $3`,
      [detected, conversationId, organizationId]
    );
  }

  return detected;
}

function matchAdSourceToProduct(adSourceUrl: string, products: ProductRow[]): string | null {
  const haystack = adSourceUrl.toLowerCase();

  // Cocokkan langsung ke nama produk dulu — paling spesifik.
  const directHit = products.find((p) => p.name.trim() && haystack.includes(p.name.toLowerCase()));
  if (directHit) return directHit.id;

  // Kalau cuma nama KATEGORI yang cocok, cuma bisa dipakai kalau kategori itu
  // memang punya TEPAT 1 produk aktif — kalau lebih dari 1, tidak bisa
  // dipastikan produk mana yang dimaksud iklan itu.
  const categoryHit = products.find(
    (p) => p.category_name && p.category_name.trim() && haystack.includes(p.category_name.toLowerCase())
  );
  if (categoryHit) {
    const siblings = products.filter((p) => p.category_id === categoryHit.category_id);
    if (siblings.length === 1) return siblings[0].id;
  }

  return null;
}

async function classifyProductWithAi(args: {
  organizationId: string;
  conversationId: string;
  incomingText: string;
  products: ProductRow[];
}): Promise<string | null> {
  const { organizationId, conversationId, incomingText, products } = args;

  const aiConfig = await getAiConfig(organizationId);
  if (!aiConfig.apiKey) return null;

  const productList = products.map((p) => `- ${p.name}`).join("\n");
  const system = [
    "Kamu membantu menentukan produk apa yang sedang dibicarakan pelanggan, dari satu pesan WhatsApp berikut.",
    "Daftar NAMA PRODUK yang tersedia (persis seperti tertulis):",
    productList,
    "",
    "Balas HANYA dengan salah satu nama produk di atas, PERSIS SAMA (tanpa tambahan kata apa pun, tanpa tanda kutip),",
    "atau balas PERSIS dengan kata TIDAK_TAHU kalau pesan ini tidak cukup jelas menunjukkan produk mana yang dimaksud.",
  ].join("\n");

  const answer = await callClaude({
    organizationId,
    conversationId,
    purpose: "detect_product",
    model: aiConfig.modelSmall,
    system,
    messages: [{ role: "user", content: incomingText }],
    maxTokens: 30,
  });

  const cleaned = answer?.trim();
  if (!cleaned || cleaned.toUpperCase() === "TIDAK_TAHU") return null;

  const match = products.find((p) => p.name.toLowerCase() === cleaned.toLowerCase());
  return match?.id ?? null;
}
