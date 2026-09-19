/**
 * Prerender halaman publik jadi HTML statis.
 *
 * MASALAH YANG DIPECAHKAN
 * Aplikasi ini React murni di sisi klien. Sebelum skrip ini ada, `curl` ke
 * https://www.cakapcepat.com/ hanya mengembalikan 4,6 KB berisi
 * <div id="root"></div>. Googlebot memang bisa menjalankan JavaScript, tapi
 * itu antrean terpisah yang lambat dan diprioritaskan belakangan untuk domain
 * baru — akibatnya halaman tidak kunjung muncul di hasil pencarian.
 *
 * CARA KERJA
 * 1. `vite build --ssr` membundel web/src/entry-ssr.jsx ke .prerender/.
 * 2. Tiap rute publik dirender jadi HTML, lalu disisipkan ke dalam
 *    <div id="root"> pada index.html hasil build klien.
 * 3. Judul, deskripsi, dan canonical disesuaikan per halaman.
 * 4. Cangkang kosong tetap disimpan sebagai public/app.html untuk semua rute
 *    SPA lain (login, dasbor) — rute itu tidak boleh punya isi statis.
 *
 * Di browser, main.jsx memakai hydrateRoot bila #root sudah berisi markup,
 * jadi HTML statis ini langsung "dihidupkan" tanpa render ulang.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const akar = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(akar, "public");
const ssrDir = path.join(akar, ".prerender");

const SITUS = "https://www.cakapcepat.com";

/** Meta per halaman. Judul & deskripsi yang berbeda per URL penting untuk hasil pencarian. */
const META = {
  "/": {
    berkas: "index.html",
    judul: "CakapCepat — Otomatisasi WhatsApp & AI Customer Service untuk Bisnis COD",
    deskripsi:
      "CakapCepat membalas chat pelanggan WhatsApp secara otomatis dengan AI, mencatat closing, merekap pesanan ke grup, memantau status pengiriman COD, dan mengirim laporan harian — tanpa perlu tim CS besar.",
    canonical: `${SITUS}/`,
  },
  "/privacy-policy": {
    berkas: "privacy-policy.html",
    judul: "Kebijakan Privasi — CakapCepat",
    deskripsi:
      "Data apa saja yang CakapCepat kumpulkan dari pengguna dasbor, untuk apa data itu dipakai, berapa lama disimpan, dan bagaimana pengguna bisa mengendalikannya.",
    canonical: `${SITUS}/privacy-policy`,
  },
  "/data-deletion": {
    berkas: "data-deletion.html",
    judul: "Penghapusan Data — CakapCepat",
    deskripsi:
      "Cara meminta penghapusan akun dan seluruh data Anda dari CakapCepat, apa saja yang dihapus, dan berapa lama prosesnya.",
    canonical: `${SITUS}/data-deletion`,
  },
};

function ganti(html, pola, baru, label) {
  if (!pola.test(html)) throw new Error(`Prerender gagal: pola ${label} tidak ditemukan di index.html`);
  return html.replace(pola, baru);
}

/** Lolos-kan karakter yang bisa memutus atribut HTML. */
function aman(teks) {
  return teks.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function jalan() {
  const shellPath = path.join(publicDir, "index.html");
  if (!fs.existsSync(shellPath)) {
    throw new Error("public/index.html belum ada — jalankan `vite build` lebih dulu.");
  }
  const shell = fs.readFileSync(shellPath, "utf8");

  // Cangkang kosong untuk seluruh rute SPA lain. Blok <noscript> hanya berguna
  // di sini; halaman yang sudah prerender punya isi sungguhan.
  fs.writeFileSync(path.join(publicDir, "app.html"), shell, "utf8");

  console.log("[prerender] Membangun bundel SSR...");
  execFileSync(
    process.execPath,
    [
      path.join(akar, "node_modules", "vite", "bin", "vite.js"),
      "build",
      "--ssr",
      "src/entry-ssr.jsx",
      "--outDir",
      path.relative(path.join(akar, "web"), ssrDir),
      "--logLevel",
      "warn",
    ],
    { cwd: akar, stdio: "inherit" }
  );

  // Vite menamai keluaran SSR .mjs atau .js tergantung "type" di package.json.
  const kandidat = ["entry-ssr.mjs", "entry-ssr.js"]
    .map((n) => path.join(ssrDir, n))
    .find((f) => fs.existsSync(f));
  if (!kandidat) throw new Error(`Bundel SSR tidak ditemukan di ${ssrDir}`);
  const modul = await import(pathToFileURL(kandidat).href);

  for (const [rute, meta] of Object.entries(META)) {
    const markup = modul.render(rute);
    if (!markup || markup.length < 400) {
      throw new Error(`Prerender ${rute} menghasilkan markup terlalu pendek (${markup?.length} karakter)`);
    }

    let html = shell;

    // Halaman prerender tidak butuh <noscript>: isinya sudah ada di HTML.
    html = html.replace(/\n?\s*<noscript>[\s\S]*?<\/noscript>/, "");

    html = ganti(
      html,
      /<div id="root"><\/div>/,
      `<div id="root">${markup}</div>`,
      "#root"
    );
    html = ganti(html, /<title>[\s\S]*?<\/title>/, `<title>${aman(meta.judul)}</title>`, "<title>");
    html = ganti(
      html,
      /<meta\s+name="description"[\s\S]*?\/>/,
      `<meta name="description" content="${aman(meta.deskripsi)}" />`,
      'meta[name=description]'
    );
    html = ganti(
      html,
      /<link rel="canonical"[^>]*\/>/,
      `<link rel="canonical" href="${meta.canonical}" />`,
      "link[rel=canonical]"
    );
    html = html.replace(
      /<meta property="og:url"[^>]*\/>/,
      `<meta property="og:url" content="${meta.canonical}" />`
    );
    html = html.replace(
      /<meta property="og:title"[^>]*\/>/,
      `<meta property="og:title" content="${aman(meta.judul)}" />`
    );

    fs.writeFileSync(path.join(publicDir, meta.berkas), html, "utf8");
    console.log(
      `[prerender] ${rute} -> public/${meta.berkas} (${(html.length / 1024).toFixed(1)} KB, markup ${(markup.length / 1024).toFixed(1)} KB)`
    );
  }

  fs.rmSync(ssrDir, { recursive: true, force: true });
  console.log("[prerender] Selesai.");
}

jalan().catch((e) => {
  console.error("[prerender] GAGAL:", e.message);
  process.exit(1);
});
