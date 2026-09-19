import type { PoolClient } from "pg";
import { pool } from "./pool";

/**
 * Menjalankan pekerjaan di dalam SATU transaksi yang sudah "dikunci" ke satu
 * organisasi. Selama di dalamnya, Row Level Security Postgres menolak baris
 * milik organisasi lain — bahkan kalau query-nya sendiri lupa menulis
 * predikat organization_id.
 *
 * Kenapa transaction-local, bukan SET biasa:
 * Koneksi di sini dipakai bergantian lewat pool. Kalau nilainya dipasang
 * dengan SET biasa, nilai itu MENEMPEL di koneksinya dan request berikutnya
 * yang kebetulan mendapat koneksi yang sama akan mewarisi organisasi orang
 * lain. set_config(..., true) membuat nilainya hilang begitu transaksinya
 * selesai — commit maupun rollback.
 *
 * Ini lapis KETIGA, bukan pengganti dua lapis sebelumnya:
 *   1. predikat organization_id di setiap query,
 *   2. foreign key komposit (organization_id, id) di database,
 *   3. RLS — jaring terakhir kalau lapis 1 lupa ditulis.
 */
export async function withTenantTransaction<T>(
  organizationId: string,
  fn: (tx: PoolClient) => Promise<T>
): Promise<T> {
  if (!organizationId) {
    throw new Error("withTenantTransaction dipanggil tanpa organizationId");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Parameter ketiga true = hanya berlaku di transaksi ini.
    await client.query("SELECT set_config('app.current_organization_id', $1, true)", [organizationId]);
    // Pindah ke peran yang TIDAK melewati RLS.
    //
    // Tanpa baris ini seluruh kebijakan RLS jadi hiasan: aplikasi tersambung
    // sebagai pemilik database yang biasanya superuser, dan superuser
    // melewati RLS bahkan pada tabel yang sudah FORCE. SET LOCAL otomatis
    // kembali begitu transaksinya selesai, jadi koneksi yang dikembalikan ke
    // pool tidak membawa peran ini.
    await client.query("SET LOCAL ROLE cakapcepat_tenant");
    const hasil = await fn(client);
    await client.query("COMMIT");
    return hasil;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    // Dikembalikan ke pool tanpa membawa sisa konteks: set_config lokal sudah
    // ikut hilang bersama transaksinya.
    client.release();
  }
}

/**
 * Pemeriksaan sekali jalan saat server start: apakah RLS benar-benar menolak
 * baris organisasi lain di dalam transaksi bertenant?
 *
 * Kebijakan yang terpasang tapi tidak berlaku (mis. karena tabelnya belum
 * FORCE, atau perannya melewati RLS) jauh lebih berbahaya daripada tidak ada
 * sama sekali — orang mengira ada jaring pengaman padahal tidak. Jadi status
 * sebenarnya dicetak ke log apa adanya.
 */
export async function periksaRlsSaatStartup(): Promise<void> {
  try {
    const { rows } = await pool.query<{ tabel: string; rls: boolean; force: boolean; kebijakan: number }>(
      `SELECT c.relname AS tabel, c.relrowsecurity AS rls, c.relforcerowsecurity AS force,
              (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS kebijakan
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relrowsecurity = true
       ORDER BY c.relname`
    );
    if (rows.length === 0) {
      console.warn("[rls] Tidak ada tabel dengan Row Level Security aktif.");
      return;
    }
    const tanpaForce = rows.filter((r) => !r.force).map((r) => r.tabel);
    const tanpaKebijakan = rows.filter((r) => r.kebijakan === 0).map((r) => r.tabel);
    console.log(`[rls] Aktif di ${rows.length} tabel.`);
    if (tanpaForce.length) {
      console.warn(`[rls] BELUM FORCE (pemilik tabel masih melewati RLS): ${tanpaForce.join(", ")}`);
    }
    if (tanpaKebijakan.length) {
      console.error(`[rls] AKTIF TAPI TANPA KEBIJAKAN — tabel ini akan menolak semua baris: ${tanpaKebijakan.join(", ")}`);
    }
  } catch (err) {
    console.error("[rls] Gagal memeriksa status RLS:", err);
  }
}
