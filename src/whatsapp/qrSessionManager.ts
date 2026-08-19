import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  initAuthCreds,
  BufferJSON,
  proto,
  Browsers,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataTypeMap,
  type WASocket,
} from "@whiskeysockets/baileys";
import pino from "pino";
import QRCode from "qrcode";
import { pool } from "../db/pool";
import { ingestInboundMessage, maybeAutoReply } from "./ingest";

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
 */
export async function startQrSession(
  channelId: string,
  organizationId: string,
  opts: StartOptions = {}
): Promise<void> {
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
      await updateChannelConnState(channelId, {
        connection_state: "logged_out",
        status: "disconnected",
        qr_data_url: null,
        pairing_code: null,
      });
      await pool.query("DELETE FROM whatsapp_qr_auth_keys WHERE channel_id = $1", [channelId]);
      console.log(`[qr-session] Channel ${channelId} logout dari HP — perlu scan/pairing ulang.`);
    } else {
      await updateChannelConnState(channelId, { connection_state: "reconnecting", status: "disconnected" });
      console.warn(`[qr-session] Channel ${channelId} terputus, mencoba menyambung ulang dalam 3 detik...`);
      setTimeout(() => {
        startQrSession(channelId, organizationId).catch((err) =>
          console.error(`[qr-session] Gagal menyambung ulang channel ${channelId}:`, err)
        );
      }, 3000);
    }
  }
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

  const waNumber = jid.split("@")[0];
  const textBody =
    m.message?.conversation ??
    m.message?.extendedTextMessage?.text ??
    m.message?.imageMessage?.caption ??
    m.message?.videoMessage?.caption ??
    "";
  // Untuk versi awal ini cuma pesan berisi teks yang dicatat (media/stiker
  // dilewati) — cukup untuk kebutuhan pencatatan chat & klasifikasi order.
  if (!textBody) return;

  const { conversationId } = await ingestInboundMessage({
    channelId,
    organizationId,
    waNumber,
    contactName: m.pushName ?? null,
    waMessageId: m.key.id ?? null,
    textBody,
  });

  await maybeAutoReply({
    organizationId,
    conversationId,
    channelId,
    incomingText: textBody,
    send: async (text) => {
      await sock.sendMessage(jid, { text });
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
