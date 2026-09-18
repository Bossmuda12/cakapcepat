import bcrypt from "bcryptjs";
import { pool } from "../db/pool";

/**
 * Membuat staf platform PERTAMA dari environment variable.
 *
 * Kenapa lewat env, bukan halaman web: control plane ini bisa menyentuh semua
 * penjual sekaligus. Halaman "setup awal" yang otomatis aktif selama tabel
 * staf masih kosong adalah lomba siapa cepat dengan orang asing di internet —
 * siapa pun yang menemukan URL-nya lebih dulu jadi pemilik platform. Env var
 * hanya bisa diisi orang yang sudah punya akses ke dashboard hosting, jadi
 * kepercayaannya sudah ada sebelum akun ini dibuat.
 *
 * Kenapa bukan hardcode password di kode: password tidak pernah masuk
 * repository, tidak pernah masuk riwayat git, dan yang memilihnya adalah
 * pemilik platform sendiri.
 *
 * Aman dijalankan tiap kali server start:
 *  - Kalau sudah ada staf platform, TIDAK melakukan apa pun. Env yang
 *    tertinggal tidak bisa dipakai untuk mengubah password akun yang sudah
 *    ada, apalagi menaikkan perannya.
 *  - Kalau env-nya tidak diisi, diam saja.
 */
export async function bootstrapPlatformAdmin(): Promise<void> {
  const email = process.env.PLATFORM_BOOTSTRAP_EMAIL?.trim().toLowerCase();
  const password = process.env.PLATFORM_BOOTSTRAP_PASSWORD;
  if (!email || !password) return;

  const { rows } = await pool.query("SELECT count(*)::int AS n FROM platform_admins");
  if (rows[0].n > 0) {
    console.warn(
      "[platform] PLATFORM_BOOTSTRAP_* masih terpasang padahal staf platform sudah ada — diabaikan. " +
        "Sebaiknya hapus kedua variabel itu dari pengaturan hosting."
    );
    return;
  }

  if (password.length < 12) {
    console.error("[platform] PLATFORM_BOOTSTRAP_PASSWORD terlalu pendek (minimal 12 karakter) — dilewati.");
    return;
  }

  const hash = await bcrypt.hash(password, 10);
  const { rows: dibuat } = await pool.query(
    `INSERT INTO platform_admins (email, name, password_hash, role)
     VALUES ($1, $2, $3, 'platform_owner')
     RETURNING id, email`,
    [email, email.split("@")[0], hash]
  );

  await pool.query(
    `INSERT INTO platform_audit_events (platform_admin_id, actor_email, action, target_type, target_id, detail)
     VALUES ($1, $2, 'platform_admin.bootstrap', 'platform_admin', $1, $3)`,
    [dibuat[0].id, dibuat[0].email, JSON.stringify({ via: "env", role: "platform_owner" })]
  );

  console.log(
    `[platform] Staf platform pertama dibuat: ${dibuat[0].email} (platform_owner). ` +
      "Masuk lewat /superadmin, lalu HAPUS PLATFORM_BOOTSTRAP_EMAIL dan PLATFORM_BOOTSTRAP_PASSWORD dari pengaturan hosting."
  );
}
