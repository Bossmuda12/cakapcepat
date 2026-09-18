/**
 * UJI ESKALASI PERAN DI DALAM SATU ORGANISASI
 *
 * Dijalankan lewat HTTP ke server sungguhan, bukan memanggil fungsi langsung —
 * yang diuji justru middleware dan pemeriksaan di dalam handler.
 *
 *   npm run test:peran
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
function ok(n: string, c: boolean, e = "") {
  if (c) { pass++; console.log("  LULUS  " + n); }
  else { fail++; console.log("  GAGAL  " + n + (e ? "  -> " + e : "")); }
}

let base = "";
async function req(method: string, path: string, opts: { token?: string; body?: unknown } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json", ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const t = await res.text();
  let body: any = null;
  try { body = t ? JSON.parse(t) : null; } catch { body = { raw: t }; }
  return { status: res.status, body };
}

(async () => {
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as any).port}/api`;

  const { rows: o } = await pool.query("INSERT INTO organization (name) VALUES ($1) RETURNING id", [
    `Uji Peran ${RUN}`,
  ]);
  const orgId = o[0].id;
  const hash = await bcrypt.hash("passwordpanjang", 10);

  async function buatUser(email: string, role: string) {
    const { rows } = await pool.query(
      `INSERT INTO users (organization_id, email, name, password_hash, role, email_verified)
       VALUES ($1,$2,$3,$4,$5,true) RETURNING id`,
      [orgId, email, email.split("@")[0], hash, role]
    );
    return rows[0].id as string;
  }
  function token(userId: string, role: string) {
    return jwt.sign({ userId, organizationId: orgId, role }, config.jwtSecret, {
      expiresIn: "1h",
      audience: AUD_TENANT,
    });
  }

  const ownerId = await buatUser(`owner${RUN}@uji.test`, "owner");
  const adminId = await buatUser(`admin${RUN}@uji.test`, "admin");
  const agentId = await buatUser(`agent${RUN}@uji.test`, "agent");
  const tokenOwner = token(ownerId, "owner");
  const tokenAdmin = token(adminId, "admin");

  console.log("\n== 1. Admin tidak bisa MENCETAK owner baru ==");
  const buatOwner = await req("POST", "/users", {
    token: tokenAdmin,
    body: { name: "Owner Selundupan", email: `selundup${RUN}@uji.test`, password: "passwordpanjang", role: "owner" },
  });
  ok("admin membuat akun owner ditolak", buatOwner.status === 403, String(buatOwner.status));

  const ownerBuatOwner = await req("POST", "/users", {
    token: tokenOwner,
    body: { name: "Owner Kedua", email: `owner2${RUN}@uji.test`, password: "passwordpanjang", role: "owner" },
  });
  ok("owner tetap boleh membuat owner", ownerBuatOwner.status === 201, String(ownerBuatOwner.status));

  console.log("\n== 2. Admin tidak bisa MENAIKKAN orang jadi owner ==");
  const naikkan = await req("PATCH", `/users/${agentId}`, { token: tokenAdmin, body: { role: "owner" } });
  ok("admin menaikkan agent jadi owner ditolak", naikkan.status === 403, String(naikkan.status));

  console.log("\n== 3. Admin tidak bisa MENGUTAK-ATIK akun owner ==");
  const ubahOwner = await req("PATCH", `/users/${ownerId}`, { token: tokenAdmin, body: { name: "Diubah Admin" } });
  ok("admin mengubah akun owner ditolak", ubahOwner.status === 403, String(ubahOwner.status));

  const resetOwner = await req("PATCH", `/users/${ownerId}`, {
    token: tokenAdmin,
    body: { password: "passwordbarusekali" },
  });
  ok("admin mereset password owner ditolak", resetOwner.status === 403, String(resetOwner.status));

  const hapusOwner = await req("DELETE", `/users/${ownerId}`, { token: tokenAdmin });
  ok("admin menghapus owner ditolak", hapusOwner.status === 403, String(hapusOwner.status));

  console.log("\n== 4. Tidak ada yang bisa mengubah peran SENDIRI ==");
  const naikSendiri = await req("PATCH", `/users/${adminId}`, { token: tokenAdmin, body: { role: "owner" } });
  ok("admin menaikkan dirinya sendiri ditolak", naikSendiri.status !== 200, String(naikSendiri.status));

  const ownerTurunSendiri = await req("PATCH", `/users/${ownerId}`, { token: tokenOwner, body: { role: "admin" } });
  ok("owner mengubah perannya sendiri ditolak", ownerTurunSendiri.status === 400, String(ownerTurunSendiri.status));

  console.log("\n== 5. Yang memang boleh tetap jalan ==");
  const adminUbahAgent = await req("PATCH", `/users/${agentId}`, { token: tokenAdmin, body: { name: "Agent Baru" } });
  ok("admin tetap boleh mengubah agent", adminUbahAgent.status === 200, String(adminUbahAgent.status));

  const ownerTurunkanAdmin = await req("PATCH", `/users/${adminId}`, { token: tokenOwner, body: { role: "agent" } });
  ok("owner tetap boleh menurunkan admin", ownerTurunkanAdmin.status === 200, String(ownerTurunkanAdmin.status));

  console.log("\n== 6. Peran diambil dari DATABASE, bukan dari token ==");
  // tokenAdmin masih mengaku "admin" padahal barusan diturunkan jadi agent.
  const pakaiTokenBasi = await req("POST", "/users", {
    token: tokenAdmin,
    body: { name: "X", email: `x${RUN}@uji.test`, password: "passwordpanjang", role: "agent" },
  });
  ok(
    "token lama yang mengaku admin sudah tidak berlaku",
    pakaiTokenBasi.status === 403,
    String(pakaiTokenBasi.status)
  );

  console.log(`\n==== HASIL: ${pass} lulus, ${fail} gagal ====`);
  server.close();
  await pool.end();
  process.exit(fail === 0 ? 0 : 1);
})().catch(async (e) => { console.error(e); await pool.end().catch(() => {}); process.exit(1); });
