import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

/* Halaman publik (/, /privacy-policy, /data-deletion) sudah berisi HTML hasil
   prerender saat build — lihat scripts/prerender.mjs. Kalau #root sudah ada
   isinya, React cukup "menghidupkan" markup itu (hydrate) alih-alih membuang
   dan menggambar ulang, sehingga tidak ada kedipan saat halaman dibuka. */
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
