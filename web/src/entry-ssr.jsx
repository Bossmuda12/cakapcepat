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

const HALAMAN = {
  "/": Landing,
  "/privacy-policy": PrivacyPolicy,
  "/data-deletion": DataDeletion,
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

export const RUTE = Object.keys(HALAMAN);
