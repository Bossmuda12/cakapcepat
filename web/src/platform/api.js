/**
 * Klien API panel platform.
 *
 * Token disimpan di kunci localStorage yang BERBEDA dari token penjual
 * (`cakapcepat_token`). Kalau keduanya berbagi satu kunci, masuk ke panel
 * platform akan menendang keluar sesi penjual di tab sebelah, dan lebih buruk:
 * satu bug kecil bisa membuat token yang salah terkirim ke API yang salah.
 * Servernya pun menolak silang — tokennya punya audience masing-masing.
 */
const KEY = "cakapcepat_platform_token";

export function getPlatformToken() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
export function setPlatformToken(t) {
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* mode privat / penyimpanan diblokir */
  }
}
export function clearPlatformToken() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* abaikan */
  }
}

async function request(method, path, body) {
  const headers = { "Content-Type": "application/json" };
  const token = getPlatformToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`/api/platform${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let data = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }
  if (!res.ok) {
    const msg =
      (data && (data.error?.formErrors?.join(", ") || data.error?.fieldErrors && Object.values(data.error.fieldErrors).flat().join(", ") || data.error?.message || data.error)) ||
      `Permintaan gagal (${res.status})`;
    const err = new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const platformApi = {
  get: (p) => request("GET", p),
  post: (p, b) => request("POST", p, b),
  patch: (p, b) => request("PATCH", p, b),
};
