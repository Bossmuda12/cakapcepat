/**
 * Prerender halaman publik jadi HTML statis, lalu bangkitkan sitemap.xml.
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
 * 2. Tiap rute di HALAMAN_META dirender jadi HTML, lalu disisipkan ke dalam
 *    <div id="root"> pada index.html hasil build klien.
 * 3. Judul, deskripsi, canonical, dan og:* disesuaikan per halaman.
 * 4. sitemap.xml dibangkitkan dari daftar yang sama, jadi tidak mungkin ada
 *    halaman baru yang lupa dimasukkan.
 * 5. Cangkang kosong disimpan sebagai public/app.html untuk semua rute SPA
 *    lain (login, dasbor) — rute itu tidak boleh punya isi statis.
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
const HARI_INI = new Date().toISOString().slice(0, 10);

function ganti(html, pola, baru, label) {
  if (!pola.test(html)) throw new Error(`Prerender gagal: pola ${label} tidak ditemukan di index.html`);
  return html.replace(pola, baru);
}

/** Lolos-kan karakter yang bisa memutus atribut HTML atau XML. */
function aman(teks) {
  return teks.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Structured data tambahan yang HANYA dipasang di halaman depan.
 *
 * Alasannya konkret: Google membetulkan pencarian "cakapcepat" menjadi
 * "cakap cepat" — frasa umum — lalu menampilkan cakap.com. Blok Organization
 * dengan alternateName memberi tahu Google bahwa CakapCepat adalah nama
 * entitas tersendiri, bukan salah ketik. Ini sinyal, bukan sihir; yang paling
 * menentukan tetap tautan dari situs lain.
 */
function schemaMerek() {
  const data = [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      "@id": `${SITUS}/#organisasi`,
      name: "CakapCepat",
      alternateName: ["Cakap Cepat", "CakapCepat.com"],
      url: `${SITUS}/`,
      logo: `${SITUS}/logo.png`,
      description:
        "Layanan otomatisasi WhatsApp berbasis AI untuk penjual yang beriklan di Meta Ads dan berjualan dengan sistem COD.",
      parentOrganization: { "@type": "Organization", name: "Taha Group" },
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      "@id": `${SITUS}/#situs`,
      name: "CakapCepat",
      alternateName: "Cakap Cepat",
      url: `${SITUS}/`,
      inLanguage: "id",
      publisher: { "@id": `${SITUS}/#organisasi` },
    },
  ];
  return `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
}

/** Remah roti untuk halaman panduan — membantu Google memahami strukturnya. */
function schemaRemah(meta) {
  if (!meta.rute.startsWith("/panduan")) return "";
  const butir = [{ name: "Beranda", item: `${SITUS}/` }];
  if (meta.rute !== "/panduan") butir.push({ name: "Panduan", item: `${SITUS}/panduan` });
  butir.push({ name: meta.judul.replace(/ — CakapCepat$/, ""), item: meta.canonical });
  const data = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: butir.map((b, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: b.name,
      item: b.item,
    })),
  };
  return `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
}

function tulisSitemap(daftar) {
  const baris = daftar
    .map(
      (m) => `  <url>
    <loc>${m.canonical}</loc>
    <lastmod>${m.diperbarui || HARI_INI}</lastmod>
    <changefreq>${m.frekuensi}</changefreq>
    <priority>${m.prioritas}</priority>
  </url>`
    )
    .join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${baris}
</urlset>
`;
  fs.writeFileSync(path.join(publicDir, "sitemap.xml"), xml, "utf8");
  console.log(`[prerender] sitemap.xml -> ${daftar.length} URL`);
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

  const daftar = modul.HALAMAN_META;
  if (!Array.isArray(daftar) || daftar.length === 0) {
    throw new Error("HALAMAN_META kosong — tidak ada yang bisa dirender.");
  }

  // Judul kembar membuat halaman saling menenggelamkan di hasil pencarian.
  const judulSet = new Set(daftar.map((m) => m.judul));
  if (judulSet.size !== daftar.length) {
    throw new Error("Ada judul halaman yang kembar — setiap URL harus punya judul sendiri.");
  }

  for (const meta of daftar) {
    const markup = modul.render(meta.rute);
    if (!markup || markup.length < 400) {
      throw new Error(
        `Prerender ${meta.rute} menghasilkan markup terlalu pendek (${markup?.length} karakter)`
      );
    }

    let html = shell;

    // Halaman prerender tidak butuh <noscript>: isinya sudah ada di HTML.
    html = html.replace(/\n?\s*<noscript>[\s\S]*?<\/noscript>/, "");

    html = ganti(html, /<div id="root"><\/div>/, `<div id="root">${markup}</div>`, "#root");
    html = ganti(html, /<title>[\s\S]*?<\/title>/, `<title>${aman(meta.judul)}</title>`, "<title>");
    html = ganti(
      html,
      /<meta\s+name="description"[\s\S]*?\/>/,
      `<meta name="description" content="${aman(meta.deskripsi)}" />`,
      "meta[name=description]"
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
    html = html.replace(
      /<meta property="og:description"[\s\S]*?\/>/,
      `<meta property="og:description" content="${aman(meta.deskripsi)}" />`
    );

    const tambahan = (meta.rute === "/" ? schemaMerek() : "") + schemaRemah(meta);
    if (tambahan) html = html.replace("</head>", `${tambahan}\n  </head>`);

    const tujuan = path.join(publicDir, meta.berkas);
    fs.mkdirSync(path.dirname(tujuan), { recursive: true });
    fs.writeFileSync(tujuan, html, "utf8");
    console.log(
      `[prerender] ${meta.rute} -> public/${meta.berkas} (${(html.length / 1024).toFixed(1)} KB, markup ${(markup.length / 1024).toFixed(1)} KB)`
    );
  }

  tulisSitemap(daftar);

  fs.rmSync(ssrDir, { recursive: true, force: true });
  console.log("[prerender] Selesai.");
}

jalan().catch((e) => {
  console.error("[prerender] GAGAL:", e.message);
  process.exit(1);
});
