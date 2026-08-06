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
