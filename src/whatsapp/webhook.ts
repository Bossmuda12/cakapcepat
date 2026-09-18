import { Router, type Request, type Response } from "express";
import crypto from "node:crypto";
import { config } from "../config";
import { pool } from "../db/pool";
import { sendTextMessage } from "./client";
import { ingestInboundMessage, maybeAutoReply, type IngestMediaInfo } from "./ingest";
import { saveIncomingMedia, transcribeVoiceNote } from "./media";

/** Jenis pesan Meta Cloud API yang berisi lampiran media (lihat F-30/F-31/F-33). */
const MEDIA_MESSAGE_TYPES = ["image", "audio", "video", "document", "sticker"] as const;

export const webhookRouter = Router();

/**
 * GET /webhook/whatsapp — verifikasi URL webhook, dipanggil sekali oleh Meta
 * saat kamu mendaftarkan URL ini di Meta App Dashboard.
 */
webhookRouter.get("/webhook/whatsapp", (req: Request, res: Response) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === config.whatsapp.webhookVerifyToken) {
    console.log("[webhook] Verifikasi berhasil.");
    res.status(200).send(challenge);
  } else {
    console.warn("[webhook] Verifikasi GAGAL — cek WHATSAPP_WEBHOOK_VERIFY_TOKEN di .env.");
    res.sendStatus(403);
  }
});

/**
 * POST /webhook/whatsapp — event pesan masuk & update status pesan keluar.
 * Butuh raw body untuk verifikasi signature (lihat server.ts).
 */
webhookRouter.post("/webhook/whatsapp", async (req: Request, res: Response) => {
  if (!isValidSignature(req)) {
    console.warn("[webhook] Signature tidak valid — request ditolak.");
    return res.sendStatus(401);
  }

  // Balas cepat ke Meta dulu, proses berat dilakukan setelahnya.
  res.sendStatus(200);

  try {
    await handleIncomingPayload(req.body);
  } catch (err) {
    console.error("[webhook] Gagal memproses payload:", err);
  }
});

/**
 * Verifikasi tanda tangan Meta. GAGAL-TERTUTUP.
 *
 * Versi lama: `if (!signatureHeader || !appSecret) return nodeEnv !== "production"`.
 * Artinya di mana pun NODE_ENV bukan "production" — mesin developer, staging,
 * container yang env-nya lupa diisi — SETIAP POST tanpa tanda tangan
 * diterima. Padahal handler di bawahnya menulis ke database. Satu deploy
 * dengan NODE_ENV salah sudah cukup untuk membuka endpoint ini ke siapa pun
 * di internet.
 *
 * Satu-satunya kelonggaran yang tersisa: kalau appSecret memang belum diisi
 * DAN ini bukan production, request diterima tapi dicatat keras di log,
 * supaya pengembangan lokal tanpa kredensial Meta masih bisa jalan sementara
 * kekurangannya tidak pernah diam-diam.
 */
function isValidSignature(req: Request): boolean {
  const signatureHeader = req.get("x-hub-signature-256");

  if (!config.whatsapp.appSecret) {
    if (config.nodeEnv === "production") {
      console.error("[webhook] DITOLAK: WHATSAPP_APP_SECRET belum diisi di production.");
      return false;
    }
    console.warn(
      "[webhook] WHATSAPP_APP_SECRET kosong — payload diterima TANPA verifikasi. Jangan pernah begini di production."
    );
    return true;
  }
  // Secret ada tapi tanda tangan tidak dikirim -> tolak, di lingkungan mana pun.
  if (!signatureHeader) return false;

  const expected =
    "sha256=" +
    crypto
      .createHmac("sha256", config.whatsapp.appSecret)
      // @ts-expect-error rawBody ditempel di server.ts lewat express.json({ verify })
      .update(req.rawBody ?? "")
      .digest("hex");

  try {
    return crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected));
  } catch {
    return false;
  }
}

async function handleIncomingPayload(body: any) {
  const entries = body?.entry ?? [];

  for (const entry of entries) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      const phoneNumberId = value.metadata?.phone_number_id;

      // P-2: tiap pesan/status diproses dalam try/catch SENDIRI supaya 1 item
      // yang gagal (mis. error DB sesaat, atau bentuk payload tak terduga)
      // tidak menggagalkan seluruh batch — item lain dalam payload yang sama
      // tetap lanjut diproses, bukan ikut hilang.
      for (const msg of value.messages ?? []) {
        try {
          await handleIncomingMessage(phoneNumberId, msg, value.contacts?.[0]);
        } catch (err) {
          console.error(`[webhook] Gagal memproses pesan masuk (wa_message_id=${msg?.id}):`, err);
        }
      }

      for (const status of value.statuses ?? []) {
        try {
          // Dikunci ke nomor WhatsApp yang mengirim webhook ini.
          //
          // `wa_message_id` unik GLOBAL (idx_messages_wa_message_id di
          // schema.sql), satu ruang nama yang dipakai bersama semua
          // organisasi. Versi lama cuma `WHERE wa_message_id = $2`, jadi satu
          // payload webhook yang diterima bisa mengubah status pesan milik
          // organisasi mana pun. Sekarang barisnya harus benar-benar milik
          // percakapan di channel yang phone_number_id-nya sama dengan
          // pengirim webhook.
          await pool.query(
            `UPDATE messages m
             SET status = $1
             FROM conversations c
             JOIN whatsapp_channels wc ON wc.id = c.channel_id
             WHERE m.conversation_id = c.id
               AND m.wa_message_id = $2
               AND wc.phone_number_id = $3`,
            [status.status, status.id, phoneNumberId]
          );
        } catch (err) {
          console.error(`[webhook] Gagal memproses update status (wa_message_id=${status?.id}):`, err);
        }
      }
    }
  }
}

async function handleIncomingMessage(phoneNumberId: string, msg: any, waContact: any) {
  const { rows: channelRows } = await pool.query(
    "SELECT id, organization_id, access_token FROM whatsapp_channels WHERE phone_number_id = $1",
    [phoneNumberId]
  );
  const channel = channelRows[0];
  if (!channel) {
    console.warn(`[webhook] Pesan masuk dari channel yang belum terdaftar: ${phoneNumberId}`);
    return;
  }

  // organization_id sekarang langsung di whatsapp_channels — channel bisa dimiliki
  // 1 CS untuk 1 produk tanpa harus terikat departemen (lihat Bab 4 dokumen rencana v2).
  const organizationId = channel.organization_id;

  // --- Tangkap data atribusi iklan CTWA (Click-to-WhatsApp), lihat Bab 8 dokumen rencana ---
  // Meta menyisipkan objek "referral" di pesan PERTAMA yang datang dari klik iklan CTWA.
  // Sejak S-11/P-27, jalur QR/pairing JUGA bisa membawa info iklan ini (lewat
  // contextInfo.externalAdReply Baileys, lihat qrSessionManager.ts) — jalur
  // ini (Cloud API resmi) tetap yang paling lengkap & terpercaya karena
  // datanya langsung dari Meta, tapi bukan lagi satu-satunya.
  const referral = msg.referral; // { source_url, ctwa_clid, headline, ... } kalau berasal dari iklan
  const ctwaClid: string | null = referral?.ctwa_clid ?? null;
  if (ctwaClid) {
    console.log(`[webhook] Chat ini berasal dari iklan CTWA, ctwa_clid=${ctwaClid}`);
  }

  const msgType: string = msg.type ?? "text";
  let textBody: string = msg.text?.body ?? "";
  let media: IngestMediaInfo | null = null;

  // F-30/F-31/F-33: dulu HANYA type === 'text' yang diproses — pesan foto
  // (alamat, bukti transfer), voice note, video, dokumen, & stiker DIBUANG
  // total (tidak pernah masuk ke ingestInboundMessage sama sekali). Sekarang
  // semua jenis itu disimpan: berkasnya diunduh & disimpan lokal lewat
  // saveIncomingMedia, lalu pesan tetap dicatat dengan content_type &
  // kolom media_* terisi — bukan hilang tanpa jejak.
  if ((MEDIA_MESSAGE_TYPES as readonly string[]).includes(msgType)) {
    const mediaObj = msg[msgType] as { id?: string; mime_type?: string; caption?: string } | undefined;
    const mediaId = mediaObj?.id;
    const mime = mediaObj?.mime_type ?? "application/octet-stream";
    const caption = mediaObj?.caption ?? "";

    if (!mediaId) {
      console.warn(`[webhook] Pesan bertipe ${msgType} tanpa media id (wa_message_id=${msg.id}) — dilewati.`);
    } else {
      const saved = await saveIncomingMedia({
        organizationId,
        mediaId,
        mime,
        kind: msgType,
        accessToken: channel.access_token,
      });

      if (!saved) {
        console.error(
          `[webhook] Gagal simpan media (${msgType}) utk wa_message_id=${msg.id} — pesan TETAP dicatat, tanpa berkas.`
        );
        if (caption) textBody = caption;
      } else {
        media = { type: msgType, mime, url: saved.url, size: saved.size };

        if (msgType === "audio") {
          // Voice note: teks yang dipakai utk auto-reply/AI adalah HASIL
          // TRANSKRIPNYA, bukan caption (audio Cloud API tidak punya caption).
          const transcript = await transcribeVoiceNote({ organizationId, filePath: saved.url, mime });
          if (transcript) {
            media.transcript = transcript;
            media.transcribedAt = new Date();
            textBody = transcript;
          }
        } else if (caption) {
          textBody = caption;
        }
      }
    }
  }

  // Pesan tanpa teks DAN tanpa media (mis. jenis pesan yang belum kita
  // dukung sama sekali, atau media yang gagal diunduh tanpa caption) boleh
  // dilewati — tidak ada apa pun yang bisa dicatat.
  if (!textBody && !media) {
    console.warn(`[webhook] Pesan tanpa teks & media dilewati (type=${msgType}, wa_message_id=${msg.id}).`);
    return;
  }

  const { conversationId, duplicate } = await ingestInboundMessage({
    channelId: channel.id,
    organizationId,
    waNumber: msg.from,
    contactName: waContact?.profile?.name ?? null,
    waMessageId: msg.id,
    textBody,
    ctwaClid,
    adSourceUrl: referral?.source_url ?? null,
    media,
  });

  // P-3: pesan kembar (retry webhook dari Meta) tidak boleh memicu auto-reply
  // lagi — pesannya sendiri sudah dilewati penyimpanannya di ingestInboundMessage.
  if (duplicate) {
    console.warn(`[webhook] Pesan duplikat dilewati (wa_message_id=${msg.id}), auto-reply tidak dipicu.`);
    return;
  }

  await maybeAutoReply({
    organizationId,
    conversationId,
    channelId: channel.id,
    incomingText: textBody,
    waNumber: msg.from,
    send: async (replyText) => {
      await sendTextMessage({ to: msg.from, body: replyText, phoneNumberId, accessToken: channel.access_token });
    },
    // Cloud API resmi tidak punya endpoint presence "sedang mengetik" yang
    // setara dengan Baileys utk MVP ini — presence sengaja dilewati
    // (undefined), sendHumanized tetap jalan tanpa indikator itu.
  });
}
