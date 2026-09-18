/**
 * Membuat / mengubah akun staf platform.
 *
 *   npm run platform:admin -- <email> <password> [peran]
 *
 * peran: platform_owner | platform_admin | support_agent | readonly_auditor
 *        (default: platform_owner untuk akun pertama, readonly_auditor setelahnya)
 *
 * SENGAJA lewat baris perintah di server, bukan lewat halaman web.
 * Control plane ini bisa menyentuh semua penjual sekaligus, jadi tidak boleh
 * ada satu pun jalan masuk yang bisa dijangkau dari internet untuk membuat
 * akunnya — termasuk "halaman setup awal" yang aktif saat tabelnya masih
 * kosong. Halaman seperti itu adalah lomba siapa cepat dengan orang asing.
 */
import bcrypt from "bcryptjs";
import { pool } from "../src/db/pool";

const PERAN = ["platform_owner", "platform_admin", "support_agent", "readonly_auditor"] as const;

(async () => {
  const [email, password, peranArg] = process.argv.slice(2);

  if (!email || !password) {
    console.error("Pemakaian: npm run platform:admin -- <email> <password> [peran]");
    console.error("Peran:", PERAN.join(" | "));
    process.exit(1);
  }
  if (password.length < 12) {
    console.error("Password staf platform minimal 12 karakter.");
    process.exit(1);
  }

  const { rows: sudahAda } = await pool.query("SELECT count(*)::int AS n FROM platform_admins");
  const pertama = sudahAda[0].n === 0;
  const peran = peranArg ?? (pertama ? "platform_owner" : "readonly_auditor");

  if (!PERAN.includes(peran as (typeof PERAN)[number])) {
    console.error(`Peran "${peran}" tidak dikenal. Pilih: ${PERAN.join(", ")}`);
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 10);
  const { rows } = await pool.query(
    `INSERT INTO platform_admins (email, name, password_hash, role)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role, is_active = true
     RETURNING id, email, role, created_at`,
    [email.toLowerCase(), email.split("@")[0], hash, peran]
  );

  await pool.query(
    `INSERT INTO platform_audit_events (platform_admin_id, actor_email, action, target_type, target_id, detail)
     VALUES ($1, $2, 'platform_admin.provision_cli', 'platform_admin', $1, $3)`,
    [rows[0].id, rows[0].email, JSON.stringify({ role: peran, firstAdmin: pertama })]
  );

  console.log(`\nStaf platform siap:\n  email : ${rows[0].email}\n  peran : ${rows[0].role}\n`);
  console.log("Masuk lewat: /superadmin\n");
  await pool.end();
})().catch(async (err) => {
  console.error(err);
  await pool.end().catch(() => {});
  process.exit(1);
});
