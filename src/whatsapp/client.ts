import { config } from "../config";

const BASE_URL = "https://graph.facebook.com";

interface SendTextParams {
  to: string;
  body: string;
  phoneNumberId?: string;
  accessToken?: string;
}

interface SendTemplateParams {
  to: string;
  templateName: string;
  languageCode?: string;
  parameters?: string[];
  phoneNumberId?: string;
  accessToken?: string;
}

/**
 * Kirim pesan teks bebas — hanya valid dalam jendela layanan 24 jam sejak
 * pelanggan terakhir chat kita. Di luar itu WAJIB pakai sendTemplateMessage().
 */
export async function sendTextMessage({ to, body, phoneNumberId, accessToken }: SendTextParams) {
  const id = phoneNumberId ?? config.whatsapp.phoneNumberId;
  const token = accessToken ?? config.whatsapp.accessToken;

  return callGraphApi(id, token, {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body },
  });
}

export async function sendTemplateMessage({
  to,
  templateName,
  languageCode = "id",
  parameters = [],
  phoneNumberId,
  accessToken,
}: SendTemplateParams) {
  const id = phoneNumberId ?? config.whatsapp.phoneNumberId;
  const token = accessToken ?? config.whatsapp.accessToken;

  return callGraphApi(id, token, {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: templateName,
      language: { code: languageCode },
      components: parameters.length
        ? [{ type: "body", parameters: parameters.map((text) => ({ type: "text", text })) }]
        : [],
    },
  });
}

interface SendImageParams {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  /**
   * WAJIB url PUBLIK yang bisa diakses server Meta (bukan path lokal/relatif
   * seperti media_url hasil saveIncomingMedia di media.ts) — kalau sumbernya
   * berkas lokal, gabungkan dulu dengan base URL publik server API (di luar
   * wewenang berkas ini menambahkan config-nya, lihat config.ts) sebelum
   * dipanggil di sini.
   */
  imageUrl: string;
  caption?: string;
}

interface SendDocumentParams {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  /** Sama seperti imageUrl di atas — wajib url publik, bukan path lokal. */
  documentUrl: string;
  caption?: string;
  filename?: string;
}

/** F-32: kirim foto keluar (mis. katalog produk, bukti resi) lewat Cloud API resmi. */
export async function sendImage({ phoneNumberId, accessToken, to, imageUrl, caption }: SendImageParams) {
  return callGraphApi(phoneNumberId, accessToken, {
    messaging_product: "whatsapp",
    to,
    type: "image",
    image: { link: imageUrl, caption },
  });
}

/** F-32: kirim dokumen keluar (mis. invoice PDF) lewat Cloud API resmi. */
export async function sendDocument({ phoneNumberId, accessToken, to, documentUrl, caption, filename }: SendDocumentParams) {
  return callGraphApi(phoneNumberId, accessToken, {
    messaging_product: "whatsapp",
    to,
    type: "document",
    document: { link: documentUrl, caption, filename },
  });
}

interface SendVideoParams {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  /** Sama seperti imageUrl — wajib url publik yang bisa diambil server Meta. */
  videoUrl: string;
  caption?: string;
}

interface SendAudioParams {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  /** Sama seperti imageUrl — wajib url publik yang bisa diambil server Meta. */
  audioUrl: string;
}

/** Kirim video keluar lewat Cloud API resmi. */
export async function sendVideo({ phoneNumberId, accessToken, to, videoUrl, caption }: SendVideoParams) {
  return callGraphApi(phoneNumberId, accessToken, {
    messaging_product: "whatsapp",
    to,
    type: "video",
    video: { link: videoUrl, caption },
  });
}

/** Kirim audio/voice note keluar lewat Cloud API resmi (tanpa caption — Meta tidak menerimanya untuk audio). */
export async function sendAudio({ phoneNumberId, accessToken, to, audioUrl }: SendAudioParams) {
  return callGraphApi(phoneNumberId, accessToken, {
    messaging_product: "whatsapp",
    to,
    type: "audio",
    audio: { link: audioUrl },
  });
}

interface WhatsAppSendResult {
  messaging_product?: string;
  contacts?: { input: string; wa_id: string }[];
  messages?: { id: string }[];
}

async function callGraphApi(
  phoneNumberId: string,
  accessToken: string,
  payload: unknown
): Promise<WhatsAppSendResult> {
  if (!phoneNumberId || !accessToken) {
    throw new Error(
      "WhatsApp belum dikonfigurasi — isi WHATSAPP_PHONE_NUMBER_ID & WHATSAPP_ACCESS_TOKEN di .env " +
        "(didapat setelah Business Verification ke Meta, lihat Bab 7 dokumen rencana)."
    );
  }

  const url = `${BASE_URL}/${config.whatsapp.graphApiVersion}/${phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = (await res.json()) as WhatsAppSendResult;
  if (!res.ok) {
    throw new Error(`WhatsApp API error (${res.status}): ${JSON.stringify(data)}`);
  }
  return data;
}
