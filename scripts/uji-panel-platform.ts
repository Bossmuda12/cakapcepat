/**
 * UJI PANEL SUPERADMIN — lawan server Express yang benar-benar berjalan.
 *
 * Bukan memanggil fungsinya langsung: yang mau dibuktikan justru lapisan HTTP —
 * middleware, audience token, izin per peran, dan apakah penangguhan benar-benar
 * menutup pintu di API penjual. Memanggil fungsi secara langsung akan
 * melewatkan persis bagian yang paling penting.
 *
 *   npm run test:platform
 */
import http from "node:http";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool } from "../src/db/pool";
import { config } from "../src/config";
import { app } from "../src/app";
import { AUD_TENANT } from "../src/platform/auth";

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

let base = "";

async function req(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {}
): Promise<{ status: number; body: any }> {
  const res = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  return { status: res.status, body };
}

async function buatStaf(email: string, password: string, role: string): Promise<string> {
  const hash = await bcrypt.hash(password, 10);
  const { rows } = await pool.query(
    `INSERT INTO platform_admins (email, name, password_hash, role)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role, is_active = true
     RETURNING id`,
    [email, email.split("@")[0], hash, role]
  );
  return rows[0].id;
}

(async () => {
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as any).port;
  base = `http://127.0.0.1:${port}/api`;

  // --- data uji ---
  const { rows: orgRows } = await pool.query(
    "INSERT INTO organization (name) VALUES ($1) RETURNING id",
    [`Penjual Uji Panel ${RUN}`]
  );
  const orgId = orgRows[0].id;
  const penjualHash = await bcrypt.hash("passwordpenjual", 10);
  const { rows: userRows } = await pool.query(
    `INSERT INTO users (organization_id, email, name, password_hash, role, email_verified)
     VALUES ($1,$2,'Owner Uji',$3,'owner',true) RETURNING id`,
    [orgId, `penjual${RUN}@uji.test`, penjualHash]
  );
  const penjualToken = jwt.sign(
    { userId: userRows[0].id, organizationId: orgId, role: "owner" },
    config.jwtSecret,
    { expiresIn: "1h", audience: AUD_TENANT }
  );

  const pwOwner = `rahasia-panel-${RUN}`;
  const emailOwner = `owner${RUN}@platform.test`;
  const emailAuditor = `auditor${RUN}@platform.test`;
  await buatStaf(emailOwner, pwOwner, "platform_owner");
  await buatStaf(emailAuditor, pwOwner, "readonly_auditor");

  console.log("\n== 1. Masuk panel ==");
  const salah = await req("POST", "/platform/login", {
    body: { email: emailOwner, password: "password-salah" },
  });
  ok("password salah ditolak", salah.status === 401, String(salah.status));

  const tidakAda = await req("POST", "/platform/login", {
    body: { email: `hantu${RUN}@platform.test`, password: pwOwner },
  });
  ok("email tidak terdaftar ditolak", tidakAda.status === 401);
  ok(
    "pesan gagal sama persis (tidak membocorkan email mana yang ada)",
    salah.body?.error === tidakAda.body?.error,
    `${salah.body?.error} vs ${tidakAda.body?.error}`
  );

  const masukOwner = await req("POST", "/platform/login", {
    body: { email: emailOwner, password: pwOwner },
  });
  ok("platform_owner berhasil masuk", masukOwner.status === 200 && Boolean(masukOwner.body?.token));
  const tokenOwner: string = masukOwner.body.token;

  const masukAuditor = await req("POST", "/platform/login", {
    body: { email: emailAuditor, password: pwOwner },
  });
  const tokenAuditor: string = masukAuditor.body.token;
  ok("readonly_auditor berhasil masuk", masukAuditor.status === 200 && Boolean(tokenAuditor));

  console.log("\n== 2. Audience token benar-benar memisahkan dua dunia ==");
  const penjualKePanel = await req("GET", "/platform/dashboard", { token: penjualToken });
  ok("token PENJUAL ditolak di API panel", penjualKePanel.status === 401, String(penjualKePanel.status));

  const panelKePenjual = await req("GET", "/stats/overview", { token: tokenOwner });
  ok("token PANEL ditolak di API penjual", panelKePenjual.status === 401, String(panelKePenjual.status));

  const tanpaToken = await req("GET", "/platform/tenants");
  ok("tanpa token ditolak", tanpaToken.status === 401);

  console.log("\n== 3. Izin berbutir, bukan satu tombol superadmin ==");
  const auditorLihat = await req("GET", "/platform/tenants", { token: tokenAuditor });
  ok("auditor BOLEH melihat daftar penjual", auditorLihat.status === 200);

  const auditorTangguhkan = await req("POST", `/platform/tenants/${orgId}/enforcement`, {
    token: tokenAuditor,
    body: {
      action: "suspend",
      reasonCode: "uji",
      reasonText: "Percobaan menangguhkan oleh peran yang tidak berhak.",
      expectedStatus: "active",
    },
  });
  ok("auditor TIDAK boleh menangguhkan", auditorTangguhkan.status === 403, String(auditorTangguhkan.status));

  const auditorKelolaStaf = await req("GET", "/platform/admins", { token: tokenAuditor });
  ok("auditor TIDAK boleh mengelola staf", auditorKelolaStaf.status === 403);

  console.log("\n== 4. Alasan wajib dan bisa dibaca ==");
  const tanpaAlasan = await req("POST", `/platform/tenants/${orgId}/enforcement`, {
    token: tokenOwner,
    body: { action: "suspend", reasonCode: "spam", reasonText: "spam", expectedStatus: "active" },
  });
  ok("alasan terlalu pendek ditolak", tanpaAlasan.status === 400, String(tanpaAlasan.status));

  console.log("\n== 5. Penangguhan benar-benar menutup API penjual ==");
  const sebelum = await req("GET", "/stats/overview", { token: penjualToken });
  ok("penjual bisa masuk sebelum ditangguhkan", sebelum.status === 200, String(sebelum.status));

  const tangguhkan = await req("POST", `/platform/tenants/${orgId}/enforcement`, {
    token: tokenOwner,
    body: {
      action: "suspend",
      reasonCode: "uji-otomatis",
      reasonText: "Ditangguhkan oleh uji otomatis untuk membuktikan penegakan berdampak nyata.",
      expectedStatus: "active",
    },
  });
  ok("platform_owner boleh menangguhkan", tangguhkan.status === 200, JSON.stringify(tangguhkan.body));

  // Cache requireAuth 10 detik — tunggu supaya yang diuji efek sebenarnya.
  await new Promise((r) => setTimeout(r, 11_000));
  const sesudah = await req("GET", "/stats/overview", { token: penjualToken });
  ok("penjual DITOLAK setelah ditangguhkan", sesudah.status === 403, String(sesudah.status));
  ok("alasannya dijelaskan ke penjual", String(sesudah.body?.error ?? "").includes("ditangguhkan"));

  console.log("\n== 6. Kontrol konkurensi ==");
  const basi = await req("POST", `/platform/tenants/${orgId}/enforcement`, {
    token: tokenOwner,
    body: {
      action: "disable",
      reasonCode: "uji",
      reasonText: "Memakai status lama yang sudah kedaluwarsa, harus ditolak.",
      expectedStatus: "active", // padahal sekarang sudah suspended
    },
  });
  ok("expectedStatus basi ditolak dengan 409", basi.status === 409, String(basi.status));

  console.log("\n== 7. Pemulihan ==");
  const pulihkan = await req("POST", `/platform/tenants/${orgId}/enforcement`, {
    token: tokenOwner,
    body: {
      action: "reactivate",
      reasonCode: "uji-selesai",
      reasonText: "Diaktifkan kembali setelah pengujian penegakan selesai dijalankan.",
      expectedStatus: "suspended",
    },
  });
  ok("bisa diaktifkan kembali", pulihkan.status === 200);

  await new Promise((r) => setTimeout(r, 11_000));
  const pulih = await req("GET", "/stats/overview", { token: penjualToken });
  ok("penjual bisa masuk lagi setelah dipulihkan", pulih.status === 200, String(pulih.status));

  console.log("\n== 8. Data penjual TIDAK dihapus oleh penegakan ==");
  const { rows: masihAda } = await pool.query(
    "SELECT count(*)::int AS n FROM users WHERE organization_id = $1",
    [orgId]
  );
  ok("pengguna organisasi tetap utuh", masihAda[0].n === 1);

  console.log("\n== 9. Semuanya tercatat di audit ==");
  const audit = await req("GET", "/platform/audit?limit=50", { token: tokenOwner });
  const aksi = (audit.body?.items ?? []).map((a: any) => a.action);
  ok("audit bisa dibaca", audit.status === 200);
  ok("login tercatat", aksi.includes("auth.login"));
  ok("penangguhan tercatat", aksi.includes("tenant.suspend"));
  ok("pemulihan tercatat", aksi.includes("tenant.reactivate"));

  const barisSuspend = (audit.body?.items ?? []).find((a: any) => a.action === "tenant.suspend");
  ok("alasan ikut tersimpan", String(barisSuspend?.reason_text ?? "").includes("uji otomatis"));
  ok("identitas pelaku ikut tersimpan", barisSuspend?.actor_email === emailOwner);

  console.log("\n== 10. Panel tidak mengambil isi chat atau kredensial ==");
  const detail = await req("GET", `/platform/tenants/${orgId}`, { token: tokenOwner });
  const teks = JSON.stringify(detail.body);
  ok("detail penjual bisa dibuka", detail.status === 200);
  ok("tidak ada access_token di respons", !teks.includes("access_token"));
  ok("tidak ada isi pesan di respons", !teks.includes('"content"'));

  console.log(`\n==== HASIL: ${pass} lulus, ${fail} gagal ====`);
  server.close();
  await pool.end();
  process.exit(fail === 0 ? 0 : 1);
})().catch(async (err) => {
  console.error(err);
  await pool.end().catch(() => {});
  process.exit(1);
});
