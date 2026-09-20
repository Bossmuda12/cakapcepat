import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

/* Halaman publik (/, /privacy-policy, /data-deletion) sudah berisi HTML hasil
   prerender saat build — lihat scripts/prerender.mjs. Kalau #root sudah ada
   isinya, React cukup "menghidupkan" markup itu (hydrate) alih-alih membuang
   dan menggambar ulang, sehingga tidak ada kedipan saat halaman dibuka. */
/* Penanda bahwa JavaScript benar-benar jalan. Animasi "muncul saat digulir"
   di halaman depan HANYA berlaku sesudah kelas ini ada — tanpanya seluruh isi
   halaman tetap terlihat. Kalau dibalik, halaman yang JS-nya gagal (termasuk
   sebagian perayap) akan tampak kosong. */
document.documentElement.classList.add("js-hidup");

const wadah = document.getElementById("root");
const pohon = (
  <StrictMode>
    <App />
  </StrictMode>
);

if (wadah.hasChildNodes()) {
  hydrateRoot(wadah, pohon);
} else {
  createRoot(wadah).render(pohon);
}
