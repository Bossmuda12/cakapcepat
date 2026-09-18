import { pool } from "../db/pool";
import { classifyConversation, type OrderClassificationExtracted } from "../ai/orderClassifier";
import { callClaude } from "../ai/anthropic";
import { getAiConfig } from "../ai/usage";
import { sendViaQrSession } from "../whatsapp/qrSessionManager";
import { canSendNow, recordSend } from "../whatsapp/outbox";

/**
 * F-8 (penyimpanan) + F-17 (pesan paket bermasalah) — lintas organisasi,
 * dipanggil berkala oleh src/scheduler.ts. Semua query di sini SENGAJA tidak
 * difilter ke 1 organizationId (beda dengan endpoint dashboard yang selalu
 * scoped ke req.auth!.organizationId) — pola yang sama dipakai
 * pollCourierMailbox() (src/courier/emailReader.ts) untuk job berkala lintas
 * tenant.
 */

// Batas jumlah percakapan/pesanan yang diproses per tick — supaya satu run
// scheduler tidak memanggil AI/mengirim WA ratusan kali sekaligus kalau
// datanya menumpuk (mis. server baru nyala lagi setelah lama mati).
const CLASSIFY_BATCH_LIMIT = 50;
const PROBLEM_NOTIFY_BATCH_LIMIT = 50;

const UTC_OFFSET_HOURS_WIB = 7;
const BUSINESS_HOUR_START = 9;
const BUSINESS_HOUR_END = 21;

// P-9: dihitung eksplisit dari UTC (BUKAN now.getHours(), itu jam lokal
// server) — sama pola dengan scheduler.ts & isOutsideOfficeHours() di
// src/whatsapp/ingest.ts.
function isOutsideBusinessHoursWib(): boolean {
  const now = new Date();
  const wibHour = (now.getUTCHours() + UTC_OFFSET_HOURS_WIB) % 24;
  return wibHour < BUSINESS_HOUR_START || wibHour >= BUSINESS_HOUR_END;
}

// Kalimat cadangan kalau AI gagal/tidak dikonfigurasi — DIACAK supaya pesan
// tidak selalu memakai template yang persis sama ke banyak pelanggan
// berbeda (pola berulang identik adalah salah satu ciri paling mudah
// dikenali sebagai bot/spam).
const PROBLEM_ORDER_FALLBACK_TEMPLATES: ((name: string, product: string) => string)[] = [
  (name, product) =>
    `Salam${name ? ` ${name}` : ""}, kami dapati ada sedikit isu dengan penghantaran pesanan${
      product ? ` ${product}` : ""
    } akak/abang. Boleh kongsikan situasi terkini di alamat penghantaran? Kami nak bantu selesaikan secepat mungkin.`,
  (name, product) =>
    `Hai${name ? ` ${name}` : ""}, kurier ada laporkan kendala semasa cuba hantar pesanan${
      product ? ` ${product}` : ""
    } tuan/puan. Boleh minta info — ada orang di rumah/pejabat, atau alamat perlu dikemaskini?`,
  (name, product) =>
    `Salam sejahtera${name ? ` ${name}` : ""}. Pesanan${
      product ? ` ${product}` : ""
    } akak/abang nampaknya ada masalah semasa proses penghantaran. Kalau boleh, kami perlukan sedikit maklumat untuk pastikan paket sampai — boleh reply chat ni bila sempat?`,
];

export interface OrderCandidateForClassify {
  conversation_id: string;
  organization_id: string;
  contact_id: string;
  channel_id: string;
  product_id: string | null;
}

/**
 * F-8: klasifikasi status order percakapan aktif yang belum pernah
 * diklasifikasi (order_status masih NULL) atau yang ada pesan baru sejak
 * klasifikasi terakhir (last_message_at lebih baru dari
 * order_status_updated_at — kolom itu yang jadi "penanda terakhir kali
 * status ini ditentukan", baik oleh AI di sini maupun perubahan manual lewat
 * POST /conversations/:id/order-status).
 *
 * Kalau hasilnya closing dengan confidence >= 0.7: perbarui
 * conversations.order_status DAN buat baris `orders` baru (kalau percakapan
 * ini belum punya order sama sekali) dari data `extracted`, lalu catat
 * order_events (source='ai'). Selain itu (bukan closing, atau sudah pernah
 * punya order), cukup perbarui conversations.order_status.
 *
 * Return jumlah percakapan yang berhasil diklasifikasi (order_status
 * ter-update) pada run ini.
 */
export async function autoClassifyConversations(): Promise<number> {
  const { rows: candidates } = await pool.query<OrderCandidateForClassify>(
    `SELECT conv.id AS conversation_id, ct.organization_id AS organization_id,
            conv.contact_id AS contact_id, conv.channel_id AS channel_id, conv.product_id AS product_id
     FROM conversations conv
     JOIN contacts ct ON ct.id = conv.contact_id
     WHERE conv.ai_paused = false
       AND conv.last_message_at IS NOT NULL
       AND (conv.order_status IS NULL OR conv.last_message_at > conv.order_status_updated_at)
     ORDER BY conv.last_message_at ASC
     LIMIT $1`,
    [CLASSIFY_BATCH_LIMIT]
  );

  let classified = 0;

  for (const cand of candidates) {
    try {
      const result = await classifyConversation({
        organizationId: cand.organization_id,
        conversationId: cand.conversation_id,
      });
      // AI belum dikonfigurasi / belum ada riwayat / gagal dipanggil — biarkan
      // apa adanya, dicoba lagi tick berikutnya (tidak menyentuh order_status_updated_at
      // supaya kandidat ini tetap muncul lagi selama masih belum pernah berhasil diklasifikasi).
      if (!result) continue;

      if (result.status === "closing" && result.confidence >= 0.7) {
        await pool.query(
          `UPDATE conversations SET order_status = 'closing', order_status_updated_at = now() WHERE id = $1`,
          [cand.conversation_id]
        );

        const { rows: existingOrderRows } = await pool.query(
          "SELECT id FROM orders WHERE conversation_id = $1",
          [cand.conversation_id]
        );

        if (!existingOrderRows[0]) {
          await createOrderFromClassification(cand, result.extracted);
        }
      } else {
        await pool.query(`UPDATE conversations SET order_status = $1, order_status_updated_at = now() WHERE id = $2`, [
          result.status,
          cand.conversation_id,
        ]);
      }

      classified++;
    } catch (err) {
      console.error(`[jobs/orderAutomation] Gagal klasifikasi percakapan ${cand.conversation_id}:`, err);
    }
  }

  return classified;
}

async function createOrderFromClassification(
  cand: OrderCandidateForClassify,
  extracted: OrderClassificationExtracted | undefined
) {
  let unitPriceCents: number | null = null;
  let currency = "MYR";
  if (cand.product_id) {
    const { rows: prodRows } = await pool.query(
      "SELECT price_cents, currency FROM products WHERE id = $1",
      [cand.product_id]
    );
    if (prodRows[0]) {
      unitPriceCents = prodRows[0].price_cents ?? null;
      currency = prodRows[0].currency || "MYR";
    }
  }

  const quantity = extracted?.quantity && extracted.quantity > 0 ? Math.floor(extracted.quantity) : 1;
  const totalCents = unitPriceCents != null ? unitPriceCents * quantity : null;

  const { rows: orderRows } = await pool.query(
    `INSERT INTO orders
       (organization_id, conversation_id, contact_id, channel_id, product_id,
        customer_name, customer_phone, address_line, postcode, city, state,
        quantity, unit_price_cents, total_cents, currency, sales_status, shipping_status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'closing','pending')
     RETURNING id`,
    [
      cand.organization_id,
      cand.conversation_id,
      cand.contact_id,
      cand.channel_id,
      cand.product_id,
      extracted?.customerName ?? null,
      extracted?.phone ?? null,
      extracted?.address ?? null,
      extracted?.postcode ?? null,
      extracted?.city ?? null,
      extracted?.state ?? null,
      quantity,
      unitPriceCents,
      totalCents,
      currency,
    ]
  );

  await pool.query(
    `INSERT INTO order_events (organization_id, order_id, field, old_value, new_value, source, note)
     SELECT o.organization_id, $1, 'sales_status', NULL, 'closing', 'ai', $2 FROM orders o WHERE o.id = $1`,
    [orderRows[0].id, "Order dibuat otomatis dari hasil classifyConversation (F-8)."]
  );
}

interface ProblemOrderRow {
  id: string;
  organization_id: string;
  conversation_id: string | null;
  channel_id: string;
  customer_name: string | null;
  customer_phone: string | null;
  problem_reason: string | null;
  product_name: string | null;
  contact_wa_number: string | null;
}

/**
 * F-17: cari pesanan bermasalah (has_problem=true) yang BELUM pernah
 * dikirimi pesan tanya kabar (problem_notified_at IS NULL), susun pesan
 * Bahasa Melayu sopan lewat AI (fallback ke template acak kalau AI gagal),
 * lalu kirim ke pelanggan lewat channel yang dulu melayani order ini.
 *
 * Menghormati jam kerja 09:00-21:00 WIB — di luar itu, pesan DITUNDA (baris
 * dilewati, problem_notified_at TIDAK diisi, dicoba lagi tick berikutnya).
 *
 * problem_notified_at diisi SEGERA setelah pesan berhasil terkirim — ini
 * pengaman anti-dobel WAJIB (satu order jangan sampai ditanya berkali-kali).
 */
export async function notifyProblemOrders(): Promise<number> {
  if (isOutsideBusinessHoursWib()) {
    console.log("[jobs/orderAutomation] Di luar jam kerja (09-21 WIB) — notifikasi paket bermasalah ditunda.");
    return 0;
  }

  const { rows: problemOrders } = await pool.query<ProblemOrderRow>(
    `SELECT o.id, o.organization_id, o.conversation_id, o.channel_id,
            o.customer_name, o.customer_phone, o.problem_reason,
            p.name AS product_name, ct.wa_number AS contact_wa_number
     FROM orders o
     LEFT JOIN products p ON p.id = o.product_id
     LEFT JOIN conversations conv ON conv.id = o.conversation_id
     LEFT JOIN contacts ct ON ct.id = conv.contact_id
     WHERE o.has_problem = true
       AND o.problem_notified_at IS NULL
       AND o.channel_id IS NOT NULL
       AND (o.conversation_id IS NOT NULL OR o.customer_phone IS NOT NULL)
     ORDER BY o.problem_at ASC NULLS LAST, o.created_at ASC
     LIMIT $1`,
    [PROBLEM_NOTIFY_BATCH_LIMIT]
  );

  let sent = 0;

  for (const order of problemOrders) {
    try {
      const targetNumber = order.contact_wa_number || order.customer_phone;
      if (!targetNumber) continue;

      if (!(await canSendNow(order.channel_id))) {
        console.warn(
          `[jobs/orderAutomation] Channel ${order.channel_id} sudah kena batas kirim per jam — ` +
            `notifikasi paket bermasalah order ${order.id} ditunda ke tick berikutnya.`
        );
        continue;
      }

      const name = order.customer_name || "";
      const product = order.product_name || "";
      const text = await composeProblemOrderMessage(order.organization_id, name, product, order.problem_reason);

      await sendViaQrSession(order.channel_id, targetNumber, text);
      await recordSend(order.channel_id);

      await pool.query("UPDATE orders SET problem_notified_at = now() WHERE id = $1", [order.id]);
      sent++;
    } catch (err) {
      console.error(`[jobs/orderAutomation] Gagal kirim notifikasi paket bermasalah utk order ${order.id}:`, err);
    }
  }

  return sent;
}

async function composeProblemOrderMessage(
  organizationId: string,
  customerName: string,
  productName: string,
  problemReason: string | null
): Promise<string> {
  const aiConfig = await getAiConfig(organizationId);
  if (aiConfig.apiKey) {
    const system = [
      "Kamu menyusun SATU pesan WhatsApp pendek dalam Bahasa Melayu yang sopan untuk toko COD ke pelanggan.",
      "Tujuan pesan: memberitahu ada kendala penghantaran pesanan pelanggan, dan menanyakan situasi terkini (mis. alamat, ketiadaan di rumah) supaya bisa dibantu selesaikan.",
      "Sebut nama pelanggan & nama produk kalau disediakan — jangan mengarang nama/produk kalau tidak diberi.",
      "JANGAN mengarang harga, potongan, atau promo apa pun.",
      "Nada: ramah, ringkas (2-3 ayat), bukan bahasa formal surat rasmi.",
      "Balas HANYA teks pesannya — jangan pakai heading, list, markdown, atau tanda kutip pembungkus.",
    ].join("\n");
    const userContent = [
      customerName ? `Nama pelanggan: ${customerName}` : "Nama pelanggan: (tidak diketahui)",
      productName ? `Produk: ${productName}` : "Produk: (tidak diketahui)",
      problemReason ? `Catatan kendala dari kurir: ${problemReason}` : "Catatan kendala dari kurir: (tidak ada)",
    ].join("\n");

    const text = await callClaude({
      organizationId,
      purpose: "followup",
      model: aiConfig.modelSmall,
      system,
      messages: [{ role: "user", content: userContent }],
      maxTokens: 200,
    });
    if (text) return text;
  }

  const template = PROBLEM_ORDER_FALLBACK_TEMPLATES[Math.floor(Math.random() * PROBLEM_ORDER_FALLBACK_TEMPLATES.length)];
  return template(customerName, productName);
}
