import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  initAuthCreds,
  downloadMediaMessage,
  BufferJSON,
  proto,
  Browsers,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataTypeMap,
  type WASocket,
} from "@whiskeysockets/baileys";
import path from "node:path";
import pino from "pino";
import QRCode from "qrcode";
import { pool } from "../db/pool";
import { ingestInboundMessage, maybeAutoReply, type IngestMediaInfo } from "./ingest";
import { saveIncomingMedia, transcribeVoiceNote, resolveDiskPath, mimeFromExt, kindFromExt } from "./media";

/**
 * Sesi WhatsApp TANPA API resmi — nyambung persis seperti WhatsApp Web
 * (scan QR atau kode pairing), lewat library Baileys. Ini jalur "hybrid"
 * yang dipakai KHUSUS untuk nomor tim yang belum bisa dapat akses WhatsApp
 * Cloud API resmi dari Meta. Nomor utama tetap disarankan pakai Cloud API
 * resmi (src/whatsapp/client.ts + webhook.ts) supaya atribusi iklan CTWA &
 * Meta CAPI tetap jalan.
 *
 * PENTING soal risiko: ini koneksi TIDAK RESMI (bukan lewat Graph API Meta).
 * WhatsApp bisa membatasi/banned nomor yang dianggap otomatisasi mencurigakan
 * (kirim pesan sangat cepat/massal, dsb). Pakai wajar seperti CS manusia
 * biasa chat, terutama untuk nomor yang baru pertama kali dipakai.
 *
 * Socket Baileys aktif disimpan di MEMORY proses ini (bukan di DB) — kalau
 * service di-restart/redeploy, semua koneksi terputus dan resumeAllQrSessions()
 * otomatis mencoba menyambung ulang pakai kredensial yang tersimpan di
 * Postgres (whatsapp_qr_auth_keys), TANPA perlu scan/pairing ulang selama
 * sesinya belum di-logout dari sisi HP.
 */

const baileysLogger = pino({ level: process.env.BAILEYS_LOG_LEVEL || "warn" }) as any;

interface ActiveSession {
  sock: WASocket;
  saveCreds: () => Promise<void>;
}

const activeSessions = new Map<string, ActiveSession>();

// P-12: hitungan percobaan reconnect berturut-turut per channel — dipakai utk
// exponential backoff & batas maksimal percobaan (lihat handleConnectionUpdate).
const reconnectAttempts = new Map<string, number>();
const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_RECONNECT_DELAY_MS = 3000;
const MAX_RECONNECT_DELAY_MS = 5 * 60 * 1000;

// P-12: pengunci in-memory supaya startQrSession untuk channelId yang SAMA
// tidak pernah berjalan dua kali bersamaan (mis. dipanggil manual dari
// dashboard tepat saat resumeAllQrSessions() masih jalan saat startup, atau
// race antara retry reconnect otomatis dengan klik "mulai ulang" manual).
// Isinya Promise dari proses start yang SEDANG berjalan — panggilan lain untuk
// channelId yang sama ikut menunggu Promise itu, bukan membuat socket baru.
const startingSessions = new Map<string, Promise<void>>();

// F-34: jangan spam peringatan "nomor terputus" tiap kali reconnect gagal
// (bisa berkali-kali dalam hitungan menit selama backoff) — cukup 1x per
// 30 menit per channel. Dicek lewat whatsapp_channels.last_disconnect_notified_at.
const DISCONNECT_NOTIFY_COOLDOWN_MS = 30 * 60 * 1000;

// --- Auth-state Baileys disimpan di Postgres, bukan file lokal (lihat catatan di atas). ---

async function readAuthKey(channelId: string, keyName: string): Promise<any> {
  const { rows } = await pool.query(
    "SELECT value FROM whatsapp_qr_auth_keys WHERE channel_id = $1 AND key_name = $2",
    [channelId, keyName]
  );
  if (!rows[0] || rows[0].value === null) return null;
  return JSON.parse(JSON.stringify(rows[0].value), BufferJSON.reviver);
}

async function writeAuthKey(channelId: string, keyName: string, value: unknown): Promise<void> {
  const json = JSON.parse(JSON.stringify(value, BufferJSON.replacer));
  await pool.query(
    `INSERT INTO whatsapp_qr_auth_keys (channel_id, key_name, value, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (channel_id, key_name) DO UPDATE SET value = $3, updated_at = now()`,
    [channelId, keyName, json]
  );
}

async function removeAuthKey(channelId: string, keyName: string): Promise<void> {
  await pool.query("DELETE FROM whatsapp_qr_auth_keys WHERE channel_id = $1 AND key_name = $2", [
    channelId,
    keyName,
  ]);
}

async function usePostgresAuthState(
  channelId: string
): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> {
  const storedCreds = await readAuthKey(channelId, "creds");
  const creds: AuthenticationCreds = storedCreds ?? initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data: Record<string, SignalDataTypeMap[typeof type]> = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await readAuthKey(channelId, `${type}-${id}`);
              if (type === "app-state-sync-key" && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value);
              }
              if (value !== null) data[id] = value;
            })
          );
          return data;
        },
        set: async (data) => {
          const tasks: Promise<void>[] = [];
          for (const category of Object.keys(data) as (keyof SignalDataTypeMap)[]) {
            const items = data[category];
            if (!items) continue;
            for (const id of Object.keys(items)) {
              const value = items[id];
              const keyName = `${category}-${id}`;
              tasks.push(value ? writeAuthKey(channelId, keyName, value) : removeAuthKey(channelId, keyName));
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: () => writeAuthKey(channelId, "creds", creds),
  };
}

// --- Update status koneksi di whatsapp_channels — dipakai frontend utk polling. ---

async function updateChannelConnState(
  channelId: string,
  patch: {
    connection_state?: string;
    status?: string;
    qr_data_url?: string | null;
    pairing_code?: string | null;
    display_phone_number?: string | null;
  }
) {
  const entries = Object.entries(patch);
  if (!entries.length) return;
  const setClauses = entries.map(([col], i) => `${col} = $${i + 2}`);
  const values = entries.map(([, v]) => v);
  await pool.query(`UPDATE whatsapp_channels SET ${setClauses.join(", ")} WHERE id = $1`, [
    channelId,
    ...values,
  ]);
}

function stopInMemory(channelId: string) {
  const active = activeSessions.get(channelId);
  if (!active) return;
  try {
    active.sock.ev.removeAllListeners("connection.update" as any);
    active.sock.ev.removeAllListeners("messages.upsert" as any);
    active.sock.ev.removeAllListeners("creds.update" as any);
    active.sock.end(undefined);
  } catch (err) {
    console.warn(`[qr-session] Gagal menutup socket lama channel ${channelId} (diabaikan):`, err);
  }
  activeSessions.delete(channelId);
}

interface StartOptions {
  pairingPhoneNumber?: string;
}

/**
 * Mulai (atau sambungkan ulang) sesi QR/pairing untuk 1 channel. Aman
 * dipanggil berkali-kali — sesi lama (kalau ada) ditutup dulu di memory
 * sebelum yang baru dibuat.
 *
 * P-12: dilindungi pengunci `startingSessions` — kalau sudah ada proses start
 * yang sedang berjalan untuk channelId ini, panggilan ini ikut menunggu
 * Promise yang sama alih-alih memicu pembuatan socket kedua yang tumpang tindih.
 */
export function startQrSession(
  channelId: string,
  organizationId: string,
  opts: StartOptions = {}
): Promise<void> {
  const inFlight = startingSessions.get(channelId);
  if (inFlight) return inFlight;

  const startPromise = doStartQrSession(channelId, organizationId, opts).finally(() => {
    // Cuma lepas kunci kalau ini masih Promise yang sama (jaga-jaga andai
    // ada penggantian map di tengah jalan — seharusnya tidak terjadi, tapi aman).
    if (startingSessions.get(channelId) === startPromise) {
      startingSessions.delete(channelId);
    }
  });
  startingSessions.set(channelId, startPromise);
  return startPromise;
}

async function doStartQrSession(
  channelId: string,
  organizationId: string,
  opts: StartOptions
): Promise<void> {
  // Kalau sudah ada sesi aktif untuk channel ini, tutup socket lama dulu
  // sebelum membuat yang baru.
  stopInMemory(channelId);

  const { state, saveCreds } = await usePostgresAuthState(channelId);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger: baileysLogger,
    printQRInTerminal: false,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, baileysLogger),
    },
    browser: Browsers.ubuntu("CakapCepat"),
    generateHighQualityLinkPreview: false,
  });

  activeSessions.set(channelId, { sock, saveCreds });

  await updateChannelConnState(channelId, {
    connection_state: opts.pairingPhoneNumber ? "pairing_pending" : "qr_pending",
  });

  if (opts.pairingPhoneNumber && !state.creds.registered) {
    try {
      const code = await sock.requestPairingCode(opts.pairingPhoneNumber.replace(/[^0-9]/g, ""));
      await updateChannelConnState(channelId, { pairing_code: code, connection_state: "pairing_pending" });
    } catch (err) {
      console.error(`[qr-session] Gagal minta kode pairing untuk channel ${channelId}:`, err);
    }
  }

  sock.ev.on("creds.update", () => {
    saveCreds().catch((err) => console.error(`[qr-session] Gagal simpan creds channel ${channelId}:`, err));
  });

  sock.ev.on("connection.update", async (update) => {
    try {
      await handleConnectionUpdate(sock, channelId, organizationId, opts, update);
    } catch (err) {
      // Jaring pengaman per-channel — lihat juga process.on('unhandledRejection', ...)
      // di server.ts untuk error internal Baileys yang tidak lewat handler ini sama sekali.
      console.error(`[qr-session] Gagal memproses connection.update channel ${channelId}:`, err);
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const m of messages) {
      try {
        await handleIncomingBaileysMessage(sock, channelId, organizationId, m);
      } catch (err) {
        console.error(`[qr-session] Gagal memproses pesan masuk channel ${channelId}:`, err);
      }
    }
  });
}

async function handleConnectionUpdate(
  sock: WASocket,
  channelId: string,
  organizationId: string,
  opts: StartOptions,
  update: Partial<import("@whiskeysockets/baileys").ConnectionState>
) {
  const { connection, lastDisconnect, qr } = update;

  if (qr && !opts.pairingPhoneNumber) {
    try {
      const dataUrl = await QRCode.toDataURL(qr);
      await updateChannelConnState(channelId, { qr_data_url: dataUrl, connection_state: "qr_pending" });
    } catch (err) {
      console.error(`[qr-session] Gagal membuat gambar QR untuk channel ${channelId}:`, err);
    }
  }

  if (connection === "open") {
    // P-12: koneksi berhasil terbuka lagi — reset hitungan percobaan reconnect.
    reconnectAttempts.delete(channelId);
    const meNumber = sock.user?.id?.split(":")[0]?.split("@")[0] ?? null;
    await updateChannelConnState(channelId, {
      connection_state: "connected",
      status: "connected",
      qr_data_url: null,
      pairing_code: null,
      display_phone_number: meNumber,
    });
    console.log(`[qr-session] Channel ${channelId} terhubung ke WhatsApp.`);
  } else if (connection === "close") {
    activeSessions.delete(channelId);
    const statusCode = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output
      ?.statusCode;
    const loggedOut = statusCode === DisconnectReason.loggedOut;

    if (loggedOut) {
      reconnectAttempts.delete(channelId);
      await updateChannelConnState(channelId, {
        connection_state: "logged_out",
        status: "disconnected",
        qr_data_url: null,
        pairing_code: null,
      });
      await pool.query("DELETE FROM whatsapp_qr_auth_keys WHERE channel_id = $1", [channelId]);
      console.log(`[qr-session] Channel ${channelId} logout dari HP — perlu scan/pairing ulang.`);
    } else {
      // P-12: exponential backoff — percobaan ke-n menunggu
      // min(3000 * 2^(n-1), 5 menit), dibatasi maksimal MAX_RECONNECT_ATTEMPTS
      // kali berturut-turut supaya tidak reconnect-loop selamanya kalau
      // nomornya memang bermasalah (mis. koneksi diblokir terus-menerus).
      const attempt = (reconnectAttempts.get(channelId) ?? 0) + 1;

      if (attempt > MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts.delete(channelId);
        await updateChannelConnState(channelId, { connection_state: "error", status: "disconnected" });
        console.error(
          `[qr-session] Channel ${channelId} GAGAL menyambung ulang setelah ${MAX_RECONNECT_ATTEMPTS} ` +
            `percobaan berturut-turut — berhenti mencoba otomatis. Perlu disambungkan manual ulang dari dashboard.`
        );
        return;
      }

      reconnectAttempts.set(channelId, attempt);
      const delay = Math.min(BASE_RECONNECT_DELAY_MS * 2 ** (attempt - 1), MAX_RECONNECT_DELAY_MS);
      await updateChannelConnState(channelId, { connection_state: "reconnecting", status: "disconnected" });
      console.warn(
        `[qr-session] Channel ${channelId} terputus, mencoba menyambung ulang ` +
          `(percobaan ${attempt}/${MAX_RECONNECT_ATTEMPTS}) dalam ${delay}ms...`
      );

      // F-34: nomor tim yang tiba-tiba terputus (bukan logout disengaja) adalah
      // closing yang berpotensi hilang tanpa ketahuan — owner PERLU diberi tahu,
      // bukan cuma dicatat di log server yang tidak pernah dilihat siapa pun.
      // Pengiriman laporannya sendiri dikerjakan agen lain (lihat komentar
      // notifyChannelDisconnected) — di sini cuma pengecekan cooldown + log.
      notifyChannelDisconnected(channelId).catch((err) =>
        console.error(`[qr-session] Gagal memproses peringatan disconnect channel ${channelId}:`, err)
      );

      setTimeout(() => {
        startQrSession(channelId, organizationId).catch((err) =>
          console.error(`[qr-session] Gagal menyambung ulang channel ${channelId}:`, err)
        );
      }, delay);
    }
  }
}

/**
 * F-34: dipanggil setiap kali koneksi channel putus BUKAN karena logout
 * disengaja (mis. HP mati, internet putus, WhatsApp memblokir sesi). Kalau
 * last_disconnect_notified_at masih dalam 30 menit terakhir, TIDAK melakukan
 * apa-apa (cooldown, lihat DISCONNECT_NOTIFY_COOLDOWN_MS) — kalau sudah lewat
 * (atau belum pernah), catat log peringatan yang jelas, perbarui
 * last_disconnect_notified_at, dan kembalikan data organisasi+label channel.
 *
 * PENTING: fungsi ini SENGAJA TIDAK mengirim WhatsApp apa pun sendiri —
 * pengiriman laporan ke owner (mis. lewat nomor grup closing/daily report)
 * dikerjakan agen lain di luar src/whatsapp/ (lihat organization.closing_group_channel_id
 * / daily_report_channel_id di schema.sql). Return null berarti "belum perlu
 * dikirim apa-apa" (masih cooldown, atau channel tidak ditemukan).
 */
export async function notifyChannelDisconnected(
  channelId: string
): Promise<{ organizationId: string; label: string } | null> {
  const { rows } = await pool.query(
    "SELECT organization_id, label, display_phone_number, last_disconnect_notified_at FROM whatsapp_channels WHERE id = $1",
    [channelId]
  );
  const channel = rows[0];
  if (!channel) return null;

  const lastNotified: Date | null = channel.last_disconnect_notified_at;
  const withinCooldown = lastNotified && Date.now() - new Date(lastNotified).getTime() < DISCONNECT_NOTIFY_COOLDOWN_MS;
  if (withinCooldown) return null;

  const label: string = channel.label || channel.display_phone_number || channelId;
  console.warn(
    `[qr-session] PERINGATAN: nomor WhatsApp "${label}" (channel ${channelId}, org ${channel.organization_id}) ` +
      `terputus dan belum berhasil menyambung ulang — pelanggan yang chat ke nomor ini TIDAK akan terlayani ` +
      `sampai tersambung kembali. Owner perlu diberi tahu (lihat notifyChannelDisconnected).`
  );

  await pool.query("UPDATE whatsapp_channels SET last_disconnect_notified_at = now() WHERE id = $1", [channelId]);

  return { organizationId: channel.organization_id, label };
}

async function handleIncomingBaileysMessage(
  sock: WASocket,
  channelId: string,
  organizationId: string,
  m: proto.IWebMessageInfo
) {
  if (m.key.fromMe) return;
  const jid = m.key.remoteJid;
  if (!jid || jid.endsWith("@g.us") || jid === "status@broadcast") return; // lewati grup & status

  // P-7: JID modern WhatsApp bisa berbentuk "<...>@lid" — itu IDENTITAS
  // internal (linked ID) Meta, BUKAN nomor telepon. Kalau begitu, coba ambil
  // nomor telepon ASLI dari field alternatif yang Baileys sisipkan di message
  // key (senderPn / participantPn) — field ini belum tentu ada di semua versi
  // tipe Baileys (proto.IMessageKey resmi belum mendeklarasikannya), jadi
  // diakses defensif lewat `as any` + optional chaining. Kalau nomor asli
  // tetap tidak ketemu, pesan TETAP disimpan (jangan sampai chat hilang dari
  // dashboard) — waNumber dicatat apa adanya (isi @lid-nya) plus warning jelas
  // supaya ketahuan di log kalau ada kontak "aneh" yang bukan nomor telepon asli.
  let waNumber = jid.split("@")[0];
  if (jid.endsWith("@lid")) {
    const keyAny = m.key as any;
    const realPhoneJid: string | undefined = keyAny?.senderPn ?? keyAny?.participantPn ?? undefined;
    if (realPhoneJid) {
      waNumber = String(realPhoneJid).split("@")[0];
    } else {
      console.warn(
        `[qr-session] Channel ${channelId}: pesan masuk dari JID @lid (${jid}) tanpa nomor telepon asli ` +
          `(senderPn/participantPn tidak ada di payload) — tetap disimpan dengan waNumber="${waNumber}", ` +
          `KEMUNGKINAN BUKAN nomor telepon valid.`
      );
    }
  }

  let textBody =
    m.message?.conversation ??
    m.message?.extendedTextMessage?.text ??
    m.message?.imageMessage?.caption ??
    m.message?.videoMessage?.caption ??
    "";

  // F-30/F-31/F-33: dulu cuma pesan berisi teks yang dicatat — foto, voice
  // note, video, dokumen, & stiker DIBUANG total (`if (!textBody) return;`
  // di atas ini sebelumnya). Sekarang isinya diunduh lewat downloadMediaMessage
  // & disimpan lokal (media.ts), lalu pesan tetap dicatat dengan content_type
  // & kolom media_* terisi.
  let media: IngestMediaInfo | null = null;
  const mc = m.message;
  const mediaKind: string | null = mc?.imageMessage
    ? "image"
    : mc?.audioMessage
    ? "audio"
    : mc?.videoMessage
    ? "video"
    : mc?.documentMessage
    ? "document"
    : mc?.stickerMessage
    ? "sticker"
    : null;

  if (mediaKind) {
    const mimetype =
      mc?.imageMessage?.mimetype ??
      mc?.audioMessage?.mimetype ??
      mc?.videoMessage?.mimetype ??
      mc?.documentMessage?.mimetype ??
      mc?.stickerMessage?.mimetype ??
      "application/octet-stream";

    try {
      const buffer = await downloadMediaMessage(
        m,
        "buffer",
        {},
        { logger: baileysLogger, reuploadRequest: sock.updateMediaMessage }
      );
      const saved = await saveIncomingMedia({ organizationId, buffer, mime: mimetype, kind: mediaKind });

      if (!saved) {
        console.error(
          `[qr-session] Channel ${channelId}: gagal simpan media (${mediaKind}) utk pesan ${m.key.id} — pesan TETAP dicatat, tanpa berkas.`
        );
      } else {
        media = { type: mediaKind, mime: mimetype, url: saved.url, size: saved.size };

        if (mediaKind === "audio") {
          // Voice note: teks yg dipakai utk auto-reply/AI adalah transkripnya.
          const transcript = await transcribeVoiceNote({ organizationId, filePath: saved.url, mime: mimetype });
          if (transcript) {
            media.transcript = transcript;
            media.transcribedAt = new Date();
            if (!textBody) textBody = transcript;
          }
        } else if (mediaKind === "document" && !textBody) {
          textBody = mc?.documentMessage?.caption ?? mc?.documentMessage?.title ?? mc?.documentMessage?.fileName ?? "";
        }
      }
    } catch (err) {
      console.error(`[qr-session] Channel ${channelId}: gagal unduh media (${mediaKind}) utk pesan ${m.key.id}:`, err);
    }
  }

  // Pesan tanpa teks DAN tanpa media (mis. jenis pesan lain yg belum
  // didukung sama sekali) boleh dilewati — tidak ada apa pun yg bisa dicatat.
  if (!textBody && !media) return;

  // S-11/P-27: info iklan Click-to-WhatsApp (CTWA) yang dibawa dari jalur QR.
  // Baileys menaruhnya di contextInfo.externalAdReply pesan pertama yang
  // datang dari klik iklan — mirip objek "referral" di webhook Cloud API
  // (lihat webhook.ts), tapi lewat struktur berbeda karena bukan lewat Graph
  // API resmi. Diakses defensif per jenis pesan karena tidak semuanya punya
  // contextInfo.
  const contextInfo =
    m.message?.extendedTextMessage?.contextInfo ??
    m.message?.imageMessage?.contextInfo ??
    m.message?.videoMessage?.contextInfo ??
    undefined;
  const externalAdReply = contextInfo?.externalAdReply ?? undefined;
  const adSourceUrl = externalAdReply?.sourceUrl ?? null;
  const ctwaClid = externalAdReply?.ctwaClid ?? null;
  if (ctwaClid || adSourceUrl) {
    console.log(
      `[qr-session] Channel ${channelId}: chat ini berasal dari iklan CTWA (jalur QR) — ` +
        `ctwaClid=${ctwaClid}, sourceUrl=${adSourceUrl}, sourceId=${externalAdReply?.sourceId}, ` +
        `title=${externalAdReply?.title}`
    );
  }

  const { conversationId, duplicate } = await ingestInboundMessage({
    channelId,
    organizationId,
    waNumber,
    contactName: m.pushName ?? null,
    waMessageId: m.key.id ?? null,
    textBody,
    ctwaClid,
    adSourceUrl,
    media,
  });

  // P-3: pesan kembar (event Baileys yang diproses dua kali, mis. setelah
  // reconnect) tidak boleh memicu auto-reply lagi.
  if (duplicate) {
    console.warn(
      `[qr-session] Channel ${channelId}: pesan duplikat dilewati (wa_message_id=${m.key.id}), auto-reply tidak dipicu.`
    );
    return;
  }

  await maybeAutoReply({
    organizationId,
    conversationId,
    channelId,
    incomingText: textBody,
    waNumber: jid,
    send: async (text) => {
      await sock.sendMessage(jid, { text });
    },
    // F-4: jalur QR MENDUKUNG presence "sedang mengetik" beneran (tidak
    // seperti Cloud API resmi di webhook.ts) — dipakai sendHumanized (outbox.ts).
    presence: async (state) => {
      await sock.sendPresenceUpdate(state, jid);
    },
  });
}

/** Putuskan & hapus sesi (logout beneran dari HP) — dipakai saat CS ganti nomor atau nomor mau dihapus. */
export async function disconnectQrSession(channelId: string): Promise<void> {
  const active = activeSessions.get(channelId);
  if (active) {
    try {
      await active.sock.logout();
    } catch (err) {
      console.warn(`[qr-session] logout() gagal untuk channel ${channelId} (diabaikan):`, err);
    }
    try {
      active.sock.end(undefined);
    } catch {
      // socket mungkin sudah tertutup — aman diabaikan
    }
    activeSessions.delete(channelId);
  }
  await pool.query("DELETE FROM whatsapp_qr_auth_keys WHERE channel_id = $1", [channelId]);
  await updateChannelConnState(channelId, {
    connection_state: "logged_out",
    status: "disconnected",
    qr_data_url: null,
    pairing_code: null,
  });
}

/**
 * Kirim pesan teks lewat sesi QR/pairing yang lagi aktif — dipakai halaman
 * Percakapan supaya balas manual dari dashboard tetap jalan untuk nomor tim
 * (bukan cuma nomor Cloud API resmi). Melempar error kalau sesinya sedang
 * tidak tersambung (mis. belum di-scan lagi setelah logout).
 */
export async function sendViaQrSession(channelId: string, waNumber: string, text: string): Promise<void> {
  const active = activeSessions.get(channelId);
  if (!active) {
    throw new Error(
      "Sesi WhatsApp (QR/pairing) nomor ini sedang tidak tersambung — sambungkan ulang dari halaman Nomor WhatsApp."
    );
  }
  const jid = waNumber.includes("@") ? waNumber : `${waNumber}@s.whatsapp.net`;
  await active.sock.sendMessage(jid, { text });
}

/**
 * F-32: kirim berkas media keluar (foto/video/voice note/dokumen) lewat
 * sesi QR/pairing aktif — padanan sendImage/sendDocument (client.ts) utk
 * jalur Cloud API. `filePath` boleh berupa media_url relatif hasil
 * saveIncomingMedia ("/uploads/media/<org>/<file>") ATAU path disk asli —
 * resolveDiskPath (media.ts) menerjemahkan keduanya jadi path fisik yang
 * sama, dan Baileys membaca isinya langsung dari disk (beda dgn Cloud API
 * yg wajib url publik).
 */
export async function sendMediaViaQrSession(
  channelId: string,
  waNumberOrJid: string,
  filePath: string,
  caption?: string
): Promise<void> {
  const active = activeSessions.get(channelId);
  if (!active) {
    throw new Error(
      "Sesi WhatsApp (QR/pairing) nomor ini sedang tidak tersambung — sambungkan ulang dari halaman Nomor WhatsApp."
    );
  }
  const jid = waNumberOrJid.includes("@") ? waNumberOrJid : `${waNumberOrJid}@s.whatsapp.net`;
  const diskPath = resolveDiskPath(filePath);
  const ext = path.extname(diskPath);
  const kind = kindFromExt(ext);
  const mimetype = mimeFromExt(ext);

  if (kind === "image") {
    await active.sock.sendMessage(jid, { image: { url: diskPath }, caption, mimetype });
  } else if (kind === "video") {
    await active.sock.sendMessage(jid, { video: { url: diskPath }, caption, mimetype });
  } else if (kind === "audio") {
    // ptt=true -> tampil sbg voice note (bukan file audio biasa), lebih wajar
    // dipakai CS/AI membalas dgn suara meniru gaya chat manusia.
    await active.sock.sendMessage(jid, { audio: { url: diskPath }, mimetype, ptt: true });
  } else {
    await active.sock.sendMessage(jid, {
      document: { url: diskPath },
      mimetype,
      fileName: path.basename(diskPath),
      caption,
    });
  }
}

/**
 * F-19: Ambil daftar grup WhatsApp yang diikuti nomor ini, supaya pemilik bisa
 * MEMILIH "Grup Closingan" dari dropdown di dashboard alih-alih mengetik JID
 * grup secara manual (JID grup tidak terlihat di aplikasi WhatsApp biasa).
 *
 * Hanya jalan untuk nomor yang tersambung lewat QR/pairing — Cloud API resmi
 * memang tidak mendukung grup sama sekali.
 */
export async function listGroupsForChannel(
  channelId: string
): Promise<{ jid: string; name: string }[]> {
  const active = activeSessions.get(channelId);
  if (!active) {
    throw new Error(
      "Sesi WhatsApp nomor ini sedang tidak tersambung — sambungkan dulu di halaman Nomor WhatsApp, lalu coba lagi."
    );
  }
  const groups = await active.sock.groupFetchAllParticipating();
  return Object.values(groups)
    .map((g: any) => ({ jid: String(g?.id ?? ""), name: String(g?.subject ?? "(tanpa nama)") }))
    .filter((g) => g.jid.endsWith("@g.us"))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Dipanggil sekali saat server start — coba sambungkan ulang semua channel
 * QR/pairing yang statusnya belum logged_out, pakai kredensial tersimpan,
 * supaya sesi WA tim TIDAK hilang tiap kali Railway redeploy service.
 */
export async function resumeAllQrSessions(): Promise<void> {
  const { rows } = await pool.query(
    "SELECT id, organization_id FROM whatsapp_channels WHERE connection_type = 'qr_session' AND connection_state <> 'logged_out'"
  );
  for (const row of rows) {
    startQrSession(row.id, row.organization_id).catch((err) =>
      console.error(`[qr-session] Gagal resume channel ${row.id} saat startup:`, err)
    );
  }
  if (rows.length) {
    console.log(`[qr-session] Mencoba menyambung ulang ${rows.length} channel QR/pairing...`);
  }
}
