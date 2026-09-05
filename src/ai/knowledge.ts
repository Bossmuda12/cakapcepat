import { pool } from "../db/pool";

/**
 * F-1: Pengetahuan berlapis Toko > Kategori > Produk — bukan cuma tombol
 * filter, tapi supaya materi "cara COD" ditulis sekali di lapis toko, "cara
 * rawat parfum" sekali di lapis kategori, dan hanya harga/aroma/stok yang
 * ditulis berulang per produk (lihat komentar product_categories di
 * schema.sql).
 *
 * Susunan hasil (3 lapis + fakta produk terstruktur):
 *   1. Materi UMUM toko     -> knowledge_base_entries dengan product_id DAN
 *                              category_id sama-sama NULL. Selalu disertakan.
 *   2. Materi KATEGORI      -> entries dengan category_id = kategori produk
 *                              yang sedang dibicarakan (kalau produk diketahui
 *                              dan produknya punya kategori).
 *   3. Materi PRODUK        -> entries dengan product_id = produk yang sedang
 *                              dibicarakan.
 *   4. Fakta produk terstruktur (nama/harga/varian) dari tabel products &
 *      product_variants — ini yang membuat AI TIDAK PERLU mengarang harga.
 *
 * Kalau productId null (belum terdeteksi — lihat productDetector.ts), cuma
 * materi umum toko yang disertakan, plus daftar nama produk aktif supaya AI
 * setidaknya tahu apa saja yang dijual toko ini.
 */
export async function buildKnowledgeContext(
  organizationId: string,
  productId?: string | null
): Promise<string> {
  const sections: string[] = [];

  const { rows: generalRows } = await pool.query(
    `SELECT title, content FROM knowledge_base_entries
     WHERE organization_id = $1 AND product_id IS NULL AND category_id IS NULL
     ORDER BY created_at DESC LIMIT 50`,
    [organizationId]
  );
  sections.push(formatEntries("Materi Umum Toko (berlaku untuk semua produk)", generalRows));

  if (!productId) {
    const { rows: productRows } = await pool.query(
      `SELECT name FROM products WHERE organization_id = $1 AND is_active = true ORDER BY name`,
      [organizationId]
    );
    if (productRows.length > 0) {
      sections.push(
        [
          "=== Daftar Produk Aktif ===",
          "(Produk yang sedang dibicarakan pelanggan belum diketahui pasti — ini daftar semua produk yang dijual toko ini. Jangan sebut harga/detail produk tertentu kalau belum yakin produk mana yang dimaksud, tanyakan dulu ke pelanggan.)",
          ...productRows.map((r) => `- ${r.name}`),
        ].join("\n")
      );
    }
    return sections.filter(Boolean).join("\n\n");
  }

  const { rows: productDetailRows } = await pool.query(
    `SELECT p.id, p.name, p.description, p.price_cents, p.currency, p.sku, p.category_id,
            pc.name AS category_name
     FROM products p
     LEFT JOIN product_categories pc ON pc.id = p.category_id
     WHERE p.id = $1 AND p.organization_id = $2`,
    [productId, organizationId]
  );
  const product = productDetailRows[0];
  if (!product) {
    // productId tidak valid / beda organisasi — perlakukan seperti produk
    // tidak diketahui (jangan sampai bocor data organisasi lain).
    return sections.filter(Boolean).join("\n\n");
  }

  if (product.category_id) {
    const { rows: categoryRows } = await pool.query(
      `SELECT title, content FROM knowledge_base_entries
       WHERE organization_id = $1 AND category_id = $2 AND product_id IS NULL
       ORDER BY created_at DESC LIMIT 50`,
      [organizationId, product.category_id]
    );
    sections.push(formatEntries(`Materi Kategori: ${product.category_name ?? "-"}`, categoryRows));
  }

  const { rows: productKbRows } = await pool.query(
    `SELECT title, content FROM knowledge_base_entries
     WHERE organization_id = $1 AND product_id = $2
     ORDER BY created_at DESC LIMIT 50`,
    [organizationId, productId]
  );
  sections.push(formatEntries(`Materi Produk: ${product.name}`, productKbRows));

  const { rows: variantRows } = await pool.query(
    `SELECT name, price_cents, stock FROM product_variants
     WHERE product_id = $1 AND is_active = true ORDER BY name`,
    [productId]
  );

  const factLines: string[] = [
    `Nama produk: ${product.name}`,
    ...(product.description ? [`Deskripsi: ${product.description}`] : []),
    ...(product.sku ? [`SKU: ${product.sku}`] : []),
    product.price_cents != null
      ? `Harga: ${formatMoney(product.price_cents, product.currency)}`
      : "Harga: BELUM DIISI di sistem — JANGAN mengarang angka, bilang ke pelanggan akan dicek dulu.",
  ];
  if (variantRows.length > 0) {
    factLines.push(
      "Varian tersedia:",
      ...variantRows.map((v) => {
        const price = v.price_cents != null ? ` — ${formatMoney(v.price_cents, product.currency)}` : "";
        const stock = v.stock != null ? ` (stok: ${v.stock})` : "";
        return `  - ${v.name}${price}${stock}`;
      })
    );
  }

  sections.push(
    ["=== Data Produk (FAKTA — satu-satunya angka harga/stok yang boleh kamu sebut) ===", ...factLines].join("\n")
  );

  return sections.filter(Boolean).join("\n\n");
}

function formatEntries(heading: string, rows: { title: string; content: string }[]): string {
  if (rows.length === 0) return `=== ${heading} ===\n(Belum ada materi untuk bagian ini.)`;
  return [`=== ${heading} ===`, ...rows.map((r) => `## ${r.title}\n${r.content}`)].join("\n\n");
}

// Harga disimpan dalam SEN (integer) di database — lihat komentar
// products.price_cents di schema.sql (RM189.00 = 18900). Ini cuma format
// tampilan, bukan hitungan baru.
function formatMoney(cents: number | string, currency: string): string {
  const value = Number(cents) / 100;
  return `${currency} ${value.toFixed(2)}`;
}
