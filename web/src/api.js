const TOKEN_KEY = "cakapcepat_token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

async function request(method, path, body) {
  const headers = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`/api${path}`, {
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
    const message =
      (data && (data.error?.formErrors?.join(", ") || data.error?.message || data.error)) ||
      `Request gagal (${res.status})`;
    const err = new Error(typeof message === "string" ? message : JSON.stringify(message));
    err.status = res.status;
    throw err;
  }
  return data;
}

/**
 * Unggah satu berkas mentah (lampiran chat). Sengaja TIDAK memakai JSON/base64:
 * base64 membengkakkan berkas ~33% dan menembus batas body-parser untuk foto
 * biasa dari kamera HP.
 */
async function upload(path, file, params = {}) {
  const query = new URLSearchParams({
    filename: file.name || "berkas",
    mime: file.type || "application/octet-stream",
    ...params,
  });
  const headers = { "Content-Type": "application/octet-stream" };
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`/api${path}?${query.toString()}`, { method: "POST", headers, body: file });

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
    const message =
      (data && (data.error?.formErrors?.join(", ") || data.error?.message || data.error)) ||
      `Unggahan gagal (${res.status})`;
    const err = new Error(typeof message === "string" ? message : JSON.stringify(message));
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  upload,
  get: (path) => request("GET", path),
  post: (path, body) => request("POST", path, body),
  patch: (path, body) => request("PATCH", path, body),
  put: (path, body) => request("PUT", path, body),
  del: (path) => request("DELETE", path),
};
