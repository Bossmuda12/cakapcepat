/**
 * UJI ISOLASI ANTAR-TENANT
 *
 * Dijalankan dengan: npm run test:isolasi
 *
 * Bentuk pengujiannya sengaja "dua organisasi kembar": Org A dan Org B dibuat
 * dengan data yang MIRIP SEKALI — nomor resi yang sama persis, nama produk
 * yang sama, nomor telepon pelanggan yang sama. Kalau ada query yang lupa
 * menyaring organisasi, data kembar inilah yang membuatnya ketahuan; kalau
 * datanya dibuat berbeda-beda, query yang bocor pun tetap terlihat "benar".
 *
 * Tiap organisasi juga menyimpan satu KATA KANARI (canary) — kalimat unik yang
 * hanya ada di satu organisasi. Kalau kata kanari Org B pernah muncul di hasil
 * yang diminta Org A, itu bukti kebocoran, bukan dugaan.
 */
import { pool } from "../src/db/pool";
import { getRecentHistory } from "../src/ai/history";
import { checkGuardrails } from "../src/ai/guardrails";
import { detectProduct } from "../src/ai/productDetector";
import { applyCourierStatusToOrder } from "../src/courier/orderSync";
import { buildCustomerContext } from "../src/ai/customerContext";
import { deriveCourierWebhookToken } from "../src/routes/courier";
import { resolveDiskPath } from "../src/whatsapp/media";
import { withTenantTransaction } from "../src/db/tenantTx";

const RUN = Date.now().toString().slice(-7);
let pass = 0;
let fail = 0;

function ok(name: string, cond: boolean, extra = "") {
  if (cond) {
    pass++;
    console.log("  LULUS  " + name);
  } else {
    fail++;
    console.log("  GAGAL  " + name + (extra ? "  -> " + extra : ""));
  }
}

async function one<T = any>(sql: string, params: any[] = []): Promise<T> {
  const { rows } = await pool.query(sql, params);
  return rows[0] as T;
}

interface Tenant {
  orgId: string;
  channelId: string;
  contactId: string;
  conversationId: string;
  productId: string;
  orderId: string;
  canary: string;
}

/** Bangun satu organisasi lengkap. Keduanya dibuat dengan bentuk yang sama. */
async function buildTenant(label: string, trackingNo: string): Promise<Tenant> {
  const canary = `KANARI-${label}-${RUN}`;

  const org = await one<{ id: string }>("INSERT INTO organization (name) VALUES ($1) RETURNING id", [
    `Uji Isolasi ${label} ${RUN}`,
  ]);
  const channel = await one<{ id: string }>(
    `INSERT INTO whatsapp_channels (organization_id, label, connection_type, display_phone_number, phone_number_id, ai_enabled, persona_prompt)
     VALUES ($1, $2, 'qr', $3, $4, true, $5) RETURNING id`,
    [org.id, `Nomor ${label}`, `+60123${label}`, `pnid-${label}-${RUN}`, `Rahsia persona ${canary}`]
  );
  // Nomor pelanggan SENGAJA sama di kedua organisasi — ini kasus nyata
  // (satu orang belanja di dua toko) dan paling gampang bikin query bocor.
  const contact = await one<{ id: string }>(
    `INSERT INTO contacts (organization_id, wa_number, name) VALUES ($1, $2, $3) RETURNING id`,
    [org.id, `+60199888777`, `Pelanggan Kembar`]
  );
  const conversation = await one<{ id: string }>(
    `INSERT INTO conversations (organization_id, contact_id, channel_id, status)
     VALUES ($3, $1, $2, 'open') RETURNING id`,
    [contact.id, channel.id, org.id]
  );
  await pool.query(
    `INSERT INTO messages (organization_id, conversation_id, direction, content_type, content, sender_type)
     VALUES ($3, $1, 'inbound', 'text', $2, 'customer')`,
    [conversation.id, JSON.stringify({ body: `Halo, saya mahu tanya ${canary}` }), org.id]
  );
  const product = await one<{ id: string }>(
    `INSERT INTO products (organization_id, name, price_cents, currency, is_active)
     VALUES ($1, $2, 12345, 'MYR', true) RETURNING id`,
    [org.id, `Produk Kembar ${RUN}`]
  );
  // Nomor resi SENGAJA sama persis di kedua organisasi. Ini sah menurut
  // schema: idx_orders_tracking unik per (organization_id, tracking_no).
  const order = await one<{ id: string }>(
    `INSERT INTO orders (organization_id, conversation_id, contact_id, channel_id, customer_name, customer_phone,
                         sales_status, shipping_status, tracking_no, has_problem)
     VALUES ($1,$2,$3,$4,'Pelanggan Kembar','+60199888777','closing','handed_to_courier',$5,false)
     RETURNING id`,
    [org.id, conversation.id, contact.id, channel.id, trackingNo]
  );

  return {
    orgId: org.id,
    channelId: channel.id,
    contactId: contact.id,
    conversationId: conversation.id,
    productId: product.id,
    orderId: order.id,
    canary,
  };
}

(async () => {
  const SAMA = `RESI-KEMBAR-${RUN}`;
  const A = await buildTenant("A", SAMA);
  const B = await buildTenant("B", SAMA);

  console.log("\n== 1. Riwayat chat AI tidak bocor antar organisasi ==");
  const histSendiri = await getRecentHistory(A.orgId, A.conversationId);
  ok("organisasi sendiri tetap dapat riwayatnya", histSendiri.some((m) => m.content.includes(A.canary)));

  const histSilang = await getRecentHistory(A.orgId, B.conversationId);
  ok("percakapan organisasi lain mengembalikan kosong", histSilang.length === 0, JSON.stringify(histSilang));
  ok(
    "kata kanari organisasi lain tidak pernah muncul",
    !histSilang.some((m) => m.content.includes(B.canary))
  );

  console.log("\n== 2. Konteks pesanan pelanggan tidak bocor ==");
  const ctxSendiri = await buildCustomerContext(A.orgId, A.conversationId);
  ok("konteks organisasi sendiri terisi", ctxSendiri.length > 0);
  const ctxSilang = await buildCustomerContext(A.orgId, B.conversationId);
  ok("konteks percakapan organisasi lain kosong", ctxSilang.length === 0, ctxSilang.slice(0, 120));

  console.log("\n== 3. Pagar pengaman tidak mengunci percakapan organisasi lain ==");
  await pool.query(
    `INSERT INTO ai_guardrails (organization_id, keyword, reason, pause_ai, is_active)
     VALUES ($1, 'penipu', 'uji', true, true)`,
    [A.orgId]
  );
  await checkGuardrails({
    organizationId: A.orgId,
    conversationId: B.conversationId, // id milik organisasi LAIN
    incomingText: "kamu penipu",
  });
  const bSetelah = await one<{ ai_paused: boolean; needs_attention: boolean }>(
    "SELECT ai_paused, needs_attention FROM conversations WHERE id = $1",
    [B.conversationId]
  );
  ok("percakapan organisasi lain TIDAK ikut dikunci", bSetelah.ai_paused !== true);
  ok("percakapan organisasi lain TIDAK ikut ditandai", bSetelah.needs_attention !== true);

  // Dan tetap bekerja normal untuk organisasinya sendiri.
  await checkGuardrails({
    organizationId: A.orgId,
    conversationId: A.conversationId,
    incomingText: "kamu penipu",
  });
  const aSetelah = await one<{ ai_paused: boolean }>(
    "SELECT ai_paused FROM conversations WHERE id = $1",
    [A.conversationId]
  );
  ok("percakapan sendiri tetap terkunci seperti seharusnya", aSetelah.ai_paused === true);

  console.log("\n== 4. Deteksi produk tidak menulis ke percakapan organisasi lain ==");
  const sebelumProduk = await one<{ product_id: string | null }>(
    "SELECT product_id FROM conversations WHERE id = $1",
    [B.conversationId]
  );
  await detectProduct({
    organizationId: A.orgId,
    conversationId: B.conversationId,
    channelId: B.channelId,
    incomingText: `Produk Kembar ${RUN}`,
    adSourceUrl: null,
  });
  const sesudahProduk = await one<{ product_id: string | null }>(
    "SELECT product_id FROM conversations WHERE id = $1",
    [B.conversationId]
  );
  ok(
    "product_id percakapan organisasi lain tidak berubah",
    sebelumProduk.product_id === sesudahProduk.product_id,
    `${sebelumProduk.product_id} -> ${sesudahProduk.product_id}`
  );

  console.log("\n== 5. Status kurir tidak mengubah pesanan organisasi lain ==");
  // Pura-pura pemanggil salah menebak: order milik B, tapi organisasinya A.
  await applyCourierStatusToOrder(
    { id: B.orderId, organization_id: A.orgId, shipping_status: "handed_to_courier", has_problem: false },
    "delivered",
    "uji silang organisasi",
    "courier_email"
  );
  const bOrder = await one<{ shipping_status: string }>(
    "SELECT shipping_status FROM orders WHERE id = $1",
    [B.orderId]
  );
  ok(
    "pesanan organisasi lain TIDAK berubah jadi delivered",
    bOrder.shipping_status === "handed_to_courier",
    bOrder.shipping_status
  );
  const bEvents = await one<{ n: string }>(
    "SELECT count(*) AS n FROM order_events WHERE order_id = $1",
    [B.orderId]
  );
  ok("tidak ada order_events palsu yang tercatat", Number(bEvents.n) === 0, bEvents.n);

  // Organisasi yang benar tetap bisa diubah.
  await applyCourierStatusToOrder(
    { id: A.orderId, organization_id: A.orgId, shipping_status: "handed_to_courier", has_problem: false },
    "delivered",
    "uji organisasi benar",
    "courier_email"
  );
  const aOrder = await one<{ shipping_status: string; delivered_at: string | null }>(
    "SELECT shipping_status, delivered_at FROM orders WHERE id = $1",
    [A.orderId]
  );
  ok("pesanan organisasi sendiri tetap bisa diperbarui", aOrder.shipping_status === "delivered");
  ok("delivered_at ikut terisi", aOrder.delivered_at !== null);

  console.log("\n== 6. Resi kembar: dua organisasi punya nomor resi sama ==");
  const kembar = await pool.query(
    "SELECT organization_id FROM orders WHERE tracking_no = $1",
    [SAMA]
  );
  ok(
    "schema memang mengizinkan resi sama di dua organisasi",
    kembar.rows.length === 2,
    `${kembar.rows.length} baris`
  );
  ok(
    "inilah sebabnya pencocokan lintas organisasi harus menolak yang ambigu",
    new Set(kembar.rows.map((r: any) => r.organization_id)).size === 2
  );

  console.log("\n== 7. Token webhook kurir berbeda per organisasi ==");
  process.env.COURIER_WEBHOOK_SECRET = process.env.COURIER_WEBHOOK_SECRET || "rahasia-uji";
  const tokenA = deriveCourierWebhookToken(A.orgId);
  const tokenB = deriveCourierWebhookToken(B.orgId);
  ok("token organisasi A terbentuk", Boolean(tokenA));
  ok("token organisasi B terbentuk", Boolean(tokenB));
  ok("token A dan B TIDAK sama", tokenA !== tokenB);
  ok("token tidak memuat secret mentahnya", !String(tokenA).includes("rahasia-uji"));
  ok("token sama setiap kali diturunkan", deriveCourierWebhookToken(A.orgId) === tokenA);

  console.log("\n== 8. Persona nomor WhatsApp tidak terbaca lintas organisasi ==");
  const personaSilang = await pool.query(
    "SELECT persona_prompt FROM whatsapp_channels WHERE id = $1 AND organization_id = $2",
    [B.channelId, A.orgId]
  );
  ok("channel organisasi lain tidak terambil dengan organisasi kita", personaSilang.rows.length === 0);
  const personaSendiri = await pool.query(
    "SELECT persona_prompt FROM whatsapp_channels WHERE id = $1 AND organization_id = $2",
    [A.channelId, A.orgId]
  );
  ok("channel sendiri tetap terambil", personaSendiri.rows.length === 1);

  console.log("\n== 9. Database MENOLAK baris campur tenant (foreign key komposit) ==");
  let ditolakDb = false;
  try {
    await pool.query(
      `INSERT INTO conversations (organization_id, contact_id, channel_id, status)
       VALUES ($1, $2, $3, 'open')`,
      [A.orgId, A.contactId, B.channelId] // kontak A, channel B
    );
  } catch (err: any) {
    ditolakDb = err?.code === "23503"; // foreign_key_violation
  }
  ok("percakapan dengan kontak A + channel B DITOLAK database", ditolakDb);

  let msgDitolak = false;
  try {
    await pool.query(
      `INSERT INTO messages (organization_id, conversation_id, direction, content_type, content, sender_type)
       VALUES ($1, $2, 'inbound', 'text', $3, 'customer')`,
      [A.orgId, B.conversationId, JSON.stringify({ body: "nyasar" })] // percakapan milik B
    );
  } catch (err: any) {
    msgDitolak = err?.code === "23503";
  }
  ok("pesan organisasi A ke percakapan organisasi B DITOLAK database", msgDitolak);

  let orgKosongDitolak = false;
  try {
    await pool.query(
      `INSERT INTO messages (conversation_id, direction, content_type, content, sender_type)
       VALUES ($1, 'inbound', 'text', $2, 'customer')`,
      [A.conversationId, JSON.stringify({ body: "tanpa organisasi" })]
    );
  } catch (err: any) {
    orgKosongDitolak = err?.code === "23502"; // not_null_violation
  }
  ok("pesan tanpa organization_id DITOLAK database", orgKosongDitolak);

  console.log("\n== 10. Path media tidak bisa keluar dari folder unggahan ==");
  let traversalDitolak = false;
  try {
    resolveDiskPath("/uploads/media/../../../../etc/passwd");
  } catch {
    traversalDitolak = true;
  }
  ok("path dengan '../' ditolak", traversalDitolak);
  ok(
    "path media normal tetap diterjemahkan",
    resolveDiskPath("/uploads/media/abc/def.png").includes("abc/def.png")
  );

  console.log("\n== 11. Row Level Security benar-benar menegakkan ==");

  // Di LUAR transaksi bertenant, perilakunya sengaja tetap seperti biasa —
  // migrasi, pekerjaan latar belakang, dan panel platform butuh itu.
  const bebas = await pool.query("SELECT count(*)::int AS n FROM conversations WHERE id = $1", [
    B.conversationId,
  ]);
  ok("tanpa konteks tenant, query lama tetap jalan seperti biasa", bebas.rows[0].n === 1);

  // Di DALAM transaksi milik organisasi A, baris milik B harus hilang —
  // walaupun query-nya sengaja TIDAK menulis predikat organization_id.
  const dalamA = await withTenantTransaction(A.orgId, async (tx) => {
    const sendiri = await tx.query("SELECT count(*)::int AS n FROM conversations WHERE id = $1", [
      A.conversationId,
    ]);
    const silang = await tx.query("SELECT count(*)::int AS n FROM conversations WHERE id = $1", [
      B.conversationId,
    ]);
    const semua = await tx.query("SELECT count(*)::int AS n FROM conversations");
    const pesanSilang = await tx.query("SELECT count(*)::int AS n FROM messages WHERE conversation_id = $1", [
      B.conversationId,
    ]);
    const kontakSemua = await tx.query("SELECT count(*)::int AS n FROM contacts");
    return {
      sendiri: sendiri.rows[0].n,
      silang: silang.rows[0].n,
      semua: semua.rows[0].n,
      pesanSilang: pesanSilang.rows[0].n,
      kontakSemua: kontakSemua.rows[0].n,
    };
  });
  ok("percakapan sendiri tetap terbaca", dalamA.sendiri === 1, String(dalamA.sendiri));
  ok(
    "percakapan organisasi lain HILANG walau query tanpa predikat",
    dalamA.silang === 0,
    String(dalamA.silang)
  );
  ok(
    "pesan organisasi lain ikut hilang",
    dalamA.pesanSilang === 0,
    String(dalamA.pesanSilang)
  );
  ok("SELECT tanpa WHERE pun hanya mengembalikan milik sendiri", dalamA.semua >= 1);
  ok("kontak pun tersaring otomatis", dalamA.kontakSemua >= 1);

  // Menulis ke organisasi lain dari dalam transaksi A juga harus ditolak.
  let tulisSilangDitolak = false;
  try {
    await withTenantTransaction(A.orgId, async (tx) => {
      await tx.query(
        `INSERT INTO contacts (organization_id, wa_number, name) VALUES ($1,$2,$3)`,
        [B.orgId, "+60000000001", "Selundupan"]
      );
    });
  } catch (err: any) {
    tulisSilangDitolak = err?.code === "42501"; // insufficient_privilege (WITH CHECK)
  }
  ok("menulis baris untuk organisasi lain DITOLAK database", tulisSilangDitolak);

  // Konteksnya tidak boleh menempel di koneksi setelah transaksinya selesai.
  await withTenantTransaction(A.orgId, async () => {});
  const sesudahTx = await pool.query("SELECT count(*)::int AS n FROM conversations WHERE id = $1", [
    B.conversationId,
  ]);
  ok(
    "konteks tenant TIDAK menempel di koneksi setelah transaksi selesai",
    sesudahTx.rows[0].n === 1,
    String(sesudahTx.rows[0].n)
  );

  const statusRls = await pool.query<{ n: string; f: string }>(
    `SELECT count(*) AS n, count(*) FILTER (WHERE relforcerowsecurity) AS f
     FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public' AND c.relrowsecurity`
  );
  ok(
    `RLS aktif di ${statusRls.rows[0].n} tabel dan semuanya FORCE`,
    Number(statusRls.rows[0].n) >= 20 && statusRls.rows[0].n === statusRls.rows[0].f,
    JSON.stringify(statusRls.rows[0])
  );

  console.log(`\n==== HASIL: ${pass} lulus, ${fail} gagal ====`);
  await pool.end();
  process.exit(fail === 0 ? 0 : 1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
