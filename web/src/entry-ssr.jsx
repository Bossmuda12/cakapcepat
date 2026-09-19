/**
 * Titik masuk khusus prerender (lihat scripts/prerender.mjs).
 *
 * Halaman publik dirender jadi HTML biasa saat build supaya Googlebot dan
 * pratinjau tautan (WhatsApp, Facebook) langsung membaca teksnya tanpa harus
 * menjalankan JavaScript lebih dulu. Sebelum ini, yang mereka terima hanyalah
 * <div id="root"></div> kosong — itulah sebab situs tidak kunjung terindeks.
 *
 * Hanya halaman TANPA sesi yang boleh masuk sini. Halaman di balik login tidak
 * pernah dirender di sini: isinya milik penjual, tidak boleh ikut ke berkas
 * statis yang disajikan ke siapa pun.
 */
import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";
import Landing from "./pages/Landing";
import PrivacyPolicy from "./pages/PrivacyPolicy";
import DataDeletion from "./pages/DataDeletion";
import { PanduanIndeks, PanduanArtikel } from "./pages/panduan/Panduan";
import { PANDUAN } from "./pages/panduan/isi";

const HALAMAN = {
  "/": Landing,
  "/privacy-policy": PrivacyPolicy,
  "/data-deletion": DataDeletion,
  "/panduan": PanduanIndeks,
  // Tiap artikel panduan punya URL sendiri supaya bisa diindeks terpisah.
  ...Object.fromEntries(
    PANDUAN.map((a) => [`/panduan/${a.slug}`, () => <PanduanArtikel slug={a.slug} />])
  ),
};

export function render(path) {
  const Halaman = HALAMAN[path];
  if (!Halaman) throw new Error(`Rute "${path}" tidak terdaftar untuk prerender`);
  return renderToString(
    <StaticRouter location={path}>
      <Halaman />
    </StaticRouter>
  );
}

const SITUS = "https://www.cakapcepat.com";

/**
 * Satu-satunya sumber kebenaran daftar halaman publik: dipakai prerender untuk
 * menulis berkasnya, dan dipakai untuk membangkitkan sitemap.xml. Judul dan
 * deskripsi HARUS berbeda per URL — halaman yang judulnya kembar saling
 * menenggelamkan di hasil pencarian.
 */
export const HALAMAN_META = [
  {
    rute: "/",
    berkas: "index.html",
    judul: "CakapCepat — Otomatisasi WhatsApp & AI Customer Service untuk Bisnis COD",
    deskripsi:
      "CakapCepat membalas chat pelanggan WhatsApp secara otomatis dengan AI, mencatat closing, merekap pesanan ke grup, memantau status pengiriman COD, dan mengirim laporan harian — tanpa perlu tim CS besar.",
    prioritas: "1.0",
    frekuensi: "weekly",
  },
  {
    rute: "/panduan",
    berkas: "panduan.html",
    judul: "Panduan Otomatisasi WhatsApp untuk Penjual — CakapCepat",
    deskripsi:
      "Catatan kerja CakapCepat tentang membalas chat WhatsApp otomatis, merekap closing, menindaklanjuti pembeli, dan memantau pengiriman COD — termasuk bagian yang sebaiknya tidak diotomatiskan.",
    prioritas: "0.8",
    frekuensi: "monthly",
  },
  ...PANDUAN.map((a) => ({
    rute: `/panduan/${a.slug}`,
    berkas: `panduan/${a.slug}.html`,
    judul: `${a.judul} — CakapCepat`,
    deskripsi: a.deskripsi,
    prioritas: "0.7",
    frekuensi: "monthly",
    diperbarui: a.diperbarui,
  })),
  {
    rute: "/privacy-policy",
    berkas: "privacy-policy.html",
    judul: "Kebijakan Privasi — CakapCepat",
    deskripsi:
      "Data apa saja yang CakapCepat kumpulkan dari pengguna dasbor, untuk apa data itu dipakai, berapa lama disimpan, dan bagaimana pengguna bisa mengendalikannya.",
    prioritas: "0.3",
    frekuensi: "yearly",
  },
  {
    rute: "/data-deletion",
    berkas: "data-deletion.html",
    judul: "Penghapusan Data — CakapCepat",
    deskripsi:
      "Cara meminta penghapusan akun dan seluruh data Anda dari CakapCepat, apa saja yang dihapus, dan berapa lama prosesnya.",
    prioritas: "0.3",
    frekuensi: "yearly",
  },
].map((m) => ({ ...m, canonical: SITUS + (m.rute === "/" ? "/" : m.rute) }));
