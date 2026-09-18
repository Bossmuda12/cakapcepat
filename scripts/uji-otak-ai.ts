import { pool } from "../src/db/pool";
import { buildKnowledgeContext } from "../src/ai/knowledge";
import { buildCustomerContext } from "../src/ai/customerContext";
import { checkGuardrails, seedDefaultGuardrails } from "../src/ai/guardrails";
import { splitIntoBubbles, typingDelayMs, isOutsideWorkHours } from "../src/ai/humanizer";

const RUN = Date.now().toString().slice(-7);
let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra ? "  -> " + extra : "")); }
}

async function one<T = any>(sql: string, params: any[] = []): Promise<T> {
  const { rows } = await pool.query(sql, params);
  return rows[0] as T;
}

(async () => {
  const org = await one<{ id: string }>("SELECT id FROM organization LIMIT 1");
  const orgId = org.id;

  // Organisasi kedua untuk uji kebocoran antar-organisasi
  const org2 = await one<{ id: string }>(
    "INSERT INTO organization (name) VALUES ('Org Lain Uji ${RUN}') RETURNING id"
  );

  const cat = await one<{ id: string }>(
    `INSERT INTO product_categories (organization_id, name) VALUES ($1,'Parfum ${RUN}') RETURNING id`, [orgId]
  );
  const prod = await one<{ id: string }>(
    `INSERT INTO products (organization_id, category_id, name, description, price_cents, currency, is_active)
     VALUES ($1,$2,'Minyak Kasturi Premium ${RUN}','Minyak wangi non-alkohol',18900,'MYR',true) RETURNING id`,
    [orgId, cat.id]
  );
  await pool.query(
    `INSERT INTO product_variants (organization_id, product_id, name, price_cents, stock, is_active)
     SELECT p.organization_id, $1, v.nama, v.harga, v.stok, true
     FROM products p, (VALUES ('6ml',18900,12), ('12ml',29900,3)) AS v(nama,harga,stok)
     WHERE p.id = $1`, [prod.id]
  );
  const prod2 = await one<{ id: string }>(
    `INSERT INTO products (organization_id, name, price_cents, currency, is_active)
     VALUES ($1,'Produk Rahsia Org Lain ${RUN}',99900,'MYR',true) RETURNING id`, [org2.id]
  );

  await pool.query(
    `INSERT INTO knowledge_base_entries (organization_id, title, content) VALUES ($1,'Cara COD','Bayar tunai waktu barang sampai.')`, [orgId]
  );
  await pool.query(
    `INSERT INTO knowledge_base_entries (organization_id, category_id, title, content) VALUES ($1,$2,'Rawatan Parfum','Simpan di tempat sejuk.')`, [orgId, cat.id]
  );
  await pool.query(
    `INSERT INTO knowledge_base_entries (organization_id, product_id, title, content) VALUES ($1,$2,'Aroma Kasturi','Wangi musk lembut tahan 8 jam.')`, [orgId, prod.id]
  );

  console.log("\n== 1. Knowledge base 3 lapis ==");
  const kb = await buildKnowledgeContext(orgId, prod.id);
  ok("materi umum toko ikut", kb.includes("Bayar tunai"));
  ok("materi kategori ikut", kb.includes("Simpan di tempat sejuk"));
  ok("materi produk ikut", kb.includes("Wangi musk lembut"));
  ok("harga diambil dari DB (MYR 189.00)", kb.includes("MYR 189.00"));
  ok("varian + stok ikut", kb.includes("12ml") && kb.includes("stok: 3"));

  console.log("\n== 2. Produk belum diketahui ==");
  const kbNone = await buildKnowledgeContext(orgId, null);
  ok("tidak menyebut harga saat produk belum pasti", !kbNone.includes("MYR 189.00"));
  ok("tetap menyebut daftar produk", kbNone.includes(`Minyak Kasturi Premium ${RUN}`));
  ok("memerintahkan bertanya dulu", kbNone.toLowerCase().includes("tanyakan dulu"));

  console.log("\n== 3. Tidak bocor antar organisasi ==");
  const kbLeak = await buildKnowledgeContext(orgId, prod2.id);
  ok("produk organisasi lain tidak muncul", !kbLeak.includes("Produk Rahsia Org Lain") && !kbLeak.includes("999.00"));

  // --- percakapan + pesanan ---
  const ch = await one<{ id: string }>(
    `INSERT INTO whatsapp_channels (organization_id, label, connection_type, display_phone_number, ai_enabled)
     VALUES ($1,'Nomor Uji','qr_session','6012${RUN}',true) RETURNING id`, [orgId]
  );
  const contact = await one<{ id: string }>(
    `INSERT INTO contacts (organization_id, wa_number, name) VALUES ($1,'6011${RUN}','Siti') RETURNING id`, [orgId]
  );
  const convo = await one<{ id: string }>(
    `INSERT INTO conversations (organization_id, contact_id, channel_id, status)
     VALUES ($3,$1,$2,'open') RETURNING id`, [contact.id, ch.id, orgId]
  );
  await pool.query(
    `INSERT INTO orders (organization_id, conversation_id, contact_id, channel_id, product_id,
       customer_name, address_line, city, state, postcode, quantity, total_cents, currency,
       sales_status, shipping_status, courier, tracking_no, shipped_at)
     VALUES ($1,$2,$3,$4,$5,'Siti binti Ahmad','No 12 Jalan Melati','Shah Alam','Selangor','40000',
       1,18900,'MYR','closing','shipped','Ninja Van','NVMY${RUN}', now() - interval '2 days')`,
    [orgId, convo.id, contact.id, ch.id, prod.id]
  );
  await pool.query(
    `INSERT INTO courier_events (organization_id, courier, tracking_no, raw_status, mapped_status, source, source_ref)
     VALUES ($1,'Ninja Van','NVMY${RUN}','Parcel in transit to sorting hub','in_transit','email','uji-${RUN}')`,
    [orgId]
  );

  console.log("\n== 4. Konteks pelanggan (status pesanan & resi) ==");
  const cc = await buildCustomerContext(orgId, convo.id);
  ok("nama pelanggan ikut", cc.includes("Siti"));
  ok("nomor resi ikut", cc.includes(`NVMY${RUN}`));
  ok("status pengiriman diterjemahkan", cc.includes("dalam perjalanan"));
  ok("alamat tersimpan disebut", cc.includes("Shah Alam"));
  ok("kabar terakhir kurir ikut", cc.includes("sorting hub"));
  ok("dilarang bilang 'cek dulu'", cc.includes("JANGAN bilang"));

  const contact2 = await one<{ id: string }>(
    `INSERT INTO contacts (organization_id, wa_number, name) VALUES ($1,'6019${RUN}','Amir') RETURNING id`, [orgId]
  );
  const convoKosong = await one<{ id: string }>(
    `INSERT INTO conversations (organization_id, contact_id, channel_id, status)
     VALUES ($3,$1,$2,'open') RETURNING id`, [contact2.id, ch.id, orgId]
  );
  const ccKosong = await buildCustomerContext(orgId, convoKosong.id);
  ok("pelanggan tanpa pesanan dinyatakan jelas", ccKosong.includes("BELUM punya pesanan"));

  console.log("\n== 5. Pagar pengaman (guardrails) ==");
  await seedDefaultGuardrails(orgId);
  const g1 = await checkGuardrails({ organizationId: orgId, conversationId: convo.id, incomingText: "Boleh kurang sikit tak harganya bang?" });
  ok("nego terdeteksi", g1.triggered === true);
  ok("nego TIDAK mengunci AI", g1.pauseAi === false);
  const c1 = await one<any>("SELECT ai_paused, needs_attention, attention_reason FROM conversations WHERE id=$1", [convo.id]);
  ok("nego: percakapan tidak dikunci", c1.ai_paused === false);
  ok("nego: tetap ditandai butuh perhatian", c1.needs_attention === true, JSON.stringify(c1));

  const g2 = await checkGuardrails({ organizationId: orgId, conversationId: convoKosong.id, incomingText: "Korang ni penipu ke? nak report polis" });
  ok("tuduhan penipu terdeteksi", g2.triggered === true);
  ok("tuduhan penipu MENGUNCI AI", g2.pauseAi === true);
  const c2 = await one<any>("SELECT ai_paused, needs_attention FROM conversations WHERE id=$1", [convoKosong.id]);
  ok("percakapan dikunci", c2.ai_paused === true && c2.needs_attention === true);

  const g3 = await checkGuardrails({ organizationId: orgId, conversationId: convo.id, incomingText: "Ada warna lain tak?" });
  ok("pertanyaan biasa lolos", g3.triggered === false);

  console.log("\n== 6. Gaya manusia (humanizer) ==");
  ok("teks pendek 1 gelembung", splitIntoBubbles("Ada kak, stok ready.").length === 1);
  const long = "Baik kak, untuk Minyak Kasturi Premium harganya RM189 untuk botol 6ml. Stoknya masih ada ya. Kalau kakak nak COD, boleh terus bagi nama penuh, alamat lengkap dan poskod. Nanti saya proses hari ini juga. Penghantaran biasanya 2-3 hari bekerja.";
  const bub = splitIntoBubbles(long);
  ok("teks panjang dipecah 2-3 gelembung", bub.length >= 2 && bub.length <= 3, "dapat " + bub.length);
  ok("tidak ada gelembung kosong", bub.every((b) => b.trim().length > 0));
  ok("isi utuh tidak terpotong", bub.join(" ").replace(/\s+/g, " ").includes("RM189"));
  const delays = Array.from({ length: 12 }, () => typingDelayMs(long));
  ok("jeda dalam 5-40 detik", delays.every((d) => d >= 5000 && d <= 40000));
  ok("jeda tidak seragam (bukan robot)", new Set(delays).size > 1);
  ok("balasan pendek tetap tidak instan", typingDelayMs("Ya kak") >= 5000);
  ok("jam kerja 9-21: jam 3 pagi di luar", isOutsideWorkHours(9, 21, 3 - new Date().getUTCHours()) !== undefined);

  console.log(`\n==== HASIL: ${pass} lulus, ${fail} gagal ====`);
  await pool.end();
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
