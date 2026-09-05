import { promises as fsp } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/**
 * F-30/F-31/F-33: Media & voice note masuk (foto, bukti transfer, voice
 * note, video, dokumen, stiker) dari pelanggan.
 *
 * Sebelumnya (lihat komentar F-30 di schema.sql) pesan yang tidak berisi
 * teks DIBUANG TOTAL oleh webhook.ts/qrSessionManager.ts (`if (!textBody)
 * return;`) — foto alamat, bukti transfer, dan voice note pelanggan hilang
 * tanpa jejak, tanpa pernah ketahuan. Modul ini yang menyimpan berkasnya ke
 * disk supaya pesan itu tetap tercatat di tabel messages (kolom media_type/
 * media_mime/media_url/media_size/transcript/transcribed_at, lihat schema.sql)
 * dan bisa dilihat CS di dashboard.
 *
 * CATATAN INFRA (di luar wewenang berkas ini — src/server.ts tidak boleh
 * disentuh dari tugas ini): folder `uploads/` di root project BELUM
 * disajikan lewat HTTP. Supaya media_url ("/uploads/media/<org>/<file>")
 * benar-benar bisa dibuka dari dashboard, server.ts perlu menambah:
 *   app.use("/uploads", express.static(path.join(process.cwd(), "uploads")))
 * (atau setara) yang mengarah ke folder yang sama dengan UPLOAD_ROOT di bawah.
 */

const UPLOAD_ROOT = path.join(process.cwd(), "uploads", "media");

// Pemetaan mime -> ekstensi berkas (dua arah dengan EXT_TO_MIME di bawah,
// tapi tidak harus simetris sempurna — banyak mime yang beda menghasilkan
// ekstensi sama, mis. audio/ogg & audio/opus sama-sama dianggap ".ogg").
const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "audio/ogg": "ogg",
  "audio/opus": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/amr": "amr",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/plain": "txt",
};

const EXT_TO_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  ogg: "audio/ogg",
  opus: "audio/opus",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  amr: "audio/amr",
  mp4: "video/mp4",
  "3gp": "video/3gpp",
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  txt: "text/plain",
};

const EXT_TO_KIND: Record<string, "image" | "video" | "audio" | "document"> = {
  jpg: "image",
  jpeg: "image",
  png: "image",
  webp: "image",
  gif: "image",
  mp4: "video",
  "3gp": "video",
  ogg: "audio",
  opus: "audio",
  mp3: "audio",
  m4a: "audio",
  aac: "audio",
  amr: "audio",
};

/** mime (dengan atau tanpa parameter, mis. "audio/ogg; codecs=opus") -> ekstensi berkas tanpa titik. */
export function extFromMime(mime: string): string {
  const clean = (mime || "").split(";")[0].trim().toLowerCase();
  if (MIME_TO_EXT[clean]) return MIME_TO_EXT[clean];
  const subtype = clean.split("/")[1] ?? "bin";
  const sanitized = subtype.replace(/^x-/, "").replace(/[^a-z0-9]/g, "");
  return sanitized || "bin";
}

/** Kebalikan extFromMime — dipakai saat KIRIM berkas keluar (kita cuma punya path/ekstensi, bukan mime asli). */
export function mimeFromExt(ext: string): string {
  const clean = ext.replace(/^\./, "").toLowerCase();
  return EXT_TO_MIME[clean] ?? "application/octet-stream";
}

/** Ekstensi -> kategori media (dipakai qrSessionManager.sendMediaViaQrSession menentukan field Baileys yang dipakai). */
export function kindFromExt(ext: string): "image" | "video" | "audio" | "document" {
  const clean = ext.replace(/^\./, "").toLowerCase();
  return EXT_TO_KIND[clean] ?? "document";
}

/**
 * media_url yang disimpan di DB berbentuk path relatif ("/uploads/media/<org>/<file>"),
 * sedangkan berkas fisiknya ada di disk relatif ke UPLOAD_ROOT. Fungsi ini
 * menerjemahkan path relatif itu balik ke path fisik di disk. Kalau
 * argumennya BUKAN path relatif kita (mis. sudah berupa path disk asli),
 * dikembalikan apa adanya — supaya aman dipakai baik untuk media_url dari DB
 * maupun path lokal yang sudah benar.
 */
export function resolveDiskPath(pathOrUrl: string): string {
  if (!/^\/?uploads\/media\//.test(pathOrUrl)) return pathOrUrl;
  const withoutPrefix = pathOrUrl.replace(/^\/?uploads\/media\//, "");
  return path.join(UPLOAD_ROOT, withoutPrefix);
}

export interface SaveIncomingMediaParams {
  organizationId: string;
  /** ID media dari Meta Graph API (jalur Cloud API). Null/absen kalau buffer sudah tersedia (jalur Baileys). */
  mediaId?: string | null;
  /** Isi berkas yang sudah diunduh (jalur Baileys lewat downloadMediaMessage). */
  buffer?: Buffer | null;
  mime: string;
  /** image | audio | video | document | sticker — cuma dipakai utk log, bukan validasi. */
  kind: string;
  /** Wajib diisi kalau mediaId dipakai (jalur Cloud API) — access_token milik channel (whatsapp_channels.access_token). */
  accessToken?: string | null;
}

/**
 * Simpan 1 berkas media masuk ke disk lokal, folder
 * `uploads/media/<organizationId>/<uuid>.<ext>` (dibuat kalau belum ada).
 * Return null (bukan melempar) kalau gagal — pemanggil (webhook.ts/
 * qrSessionManager.ts) tetap mencatat pesannya di DB TANPA berkas media
 * (lebih baik chat tercatat tanpa lampiran daripada chat hilang total sama
 * sekali seperti perilaku lama).
 */
export async function saveIncomingMedia(
  params: SaveIncomingMediaParams
): Promise<{ url: string; size: number } | null> {
  const { organizationId, mediaId, mime, kind, accessToken } = params;
  let buffer = params.buffer ?? null;

  if (!buffer) {
    if (!mediaId || !accessToken) {
      console.error(
        `[media] saveIncomingMedia dipanggil tanpa buffer maupun (mediaId+accessToken) — tidak ada yang bisa disimpan (org=${organizationId}, kind=${kind}).`
      );
      return null;
    }
    buffer = await downloadFromGraphApi(mediaId, accessToken);
    if (!buffer) return null;
  }

  try {
    const dir = path.join(UPLOAD_ROOT, organizationId);
    await fsp.mkdir(dir, { recursive: true });
    const ext = extFromMime(mime);
    const filename = `${crypto.randomUUID()}.${ext}`;
    await fsp.writeFile(path.join(dir, filename), buffer);

    return { url: `/uploads/media/${organizationId}/${filename}`, size: buffer.length };
  } catch (err) {
    console.error(`[media] Gagal menyimpan berkas media ke disk (org=${organizationId}, kind=${kind}):`, err);
    return null;
  }
}

/** Unduh isi media dari Graph API — dua langkah: ambil url sementara lewat mediaId, baru unduh isinya. */
async function downloadFromGraphApi(mediaId: string, accessToken: string): Promise<Buffer | null> {
  try {
    const metaRes = await fetch(`https://graph.facebook.com/v20.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!metaRes.ok) {
      console.error(`[media] Gagal ambil metadata media id=${mediaId} dari Graph API (status ${metaRes.status}).`);
      return null;
    }
    const meta = (await metaRes.json()) as { url?: string };
    if (!meta.url) {
      console.error(`[media] Metadata media id=${mediaId} tidak berisi url unduhan.`);
      return null;
    }

    const fileRes = await fetch(meta.url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!fileRes.ok) {
      console.error(`[media] Gagal unduh isi media id=${mediaId} dari Graph API (status ${fileRes.status}).`);
      return null;
    }
    return Buffer.from(await fileRes.arrayBuffer());
  } catch (err) {
    console.error(`[media] Error saat mengunduh media id=${mediaId} dari Graph API:`, err);
    return null;
  }
}

export interface TranscribeVoiceNoteParams {
  organizationId: string;
  /** media_url hasil saveIncomingMedia (path relatif "/uploads/media/<org>/<file>") ATAU path disk asli. */
  filePath: string;
  mime: string;
}

/**
 * Transkrip voice note lewat Whisper (OpenAI).
 *
 * BUTUH ENV VAR BARU `OPENAI_API_KEY` — belum ada di .env.example/config.ts
 * (di luar wewenang berkas ini untuk ditambahkan, config.ts tidak boleh
 * disentuh dari tugas ini). Tambahkan manual di Railway/.env sebelum fitur
 * ini betulan mentranskrip apa pun.
 *
 * Tanpa env var itu, fungsi ini SENGAJA mengembalikan null (bukan melempar
 * error) dan mencatat log yang jelas — voice note tetap tersimpan & tampil
 * di dashboard (lewat media_url), cuma belum ada transkripnya, dan proses
 * webhook/qr-session TIDAK boleh crash gara-gara ini.
 */
export async function transcribeVoiceNote(params: TranscribeVoiceNoteParams): Promise<string | null> {
  const { organizationId, filePath, mime } = params;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn(
      `[media] Transkrip voice note DILEWATI (org=${organizationId}) — env var OPENAI_API_KEY belum diisi. ` +
        `Voice note tetap tersimpan di ${filePath}, cuma tanpa transkrip otomatis.`
    );
    return null;
  }

  try {
    const diskPath = resolveDiskPath(filePath);
    const fileBuffer = await fsp.readFile(diskPath);
    const ext = extFromMime(mime);

    const form = new FormData();
    form.append("model", "whisper-1");
    form.append("file", new Blob([fileBuffer], { type: mime || "application/octet-stream" }), `voice-note.${ext}`);

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error(`[media] Whisper API gagal (status ${res.status}) untuk org ${organizationId}: ${errText}`);
      return null;
    }

    const data = (await res.json()) as { text?: string };
    return data.text?.trim() || null;
  } catch (err) {
    console.error(`[media] Gagal mentranskrip voice note (org=${organizationId}, file=${filePath}):`, err);
    return null;
  }
}
