import { useEffect, useRef, useState } from "react";

/**
 * Ilustrasi bergerak untuk halaman depan — gelombang kedua.
 *
 * ATURAN YANG MENGIKAT SELURUH BERKAS INI
 *
 * 1. Halaman ini dirender jadi HTML statis saat build (scripts/prerender.mjs).
 *    Jadi tidak boleh ada yang menyentuh `window` atau `document` saat render
 *    pertama — semuanya harus di dalam useEffect.
 *
 * 2. Isinya harus TETAP TERBACA tanpa JavaScript. Karena itu semua bagian
 *    mulai dari keadaan terlihat, dan animasi masuk hanya DITAMBAHKAN oleh
 *    JavaScript setelah halaman hidup. Kebalikannya — mulai transparan lalu
 *    dimunculkan JS — akan membuat Googlebot dan siapa pun yang JS-nya gagal
 *    melihat halaman kosong. Itu kesalahan yang persis sedang kita perbaiki.
 *
 * 3. Tidak ada berkas gambar eksternal dan tidak ada skrip CDN: CSP mengunci
 *    `script-src 'self'`. Semua digambar dengan SVG inline + CSS.
 *
 * 4. Semua gerak berhenti di bawah `prefers-reduced-motion`.
 */

/* ------------------------------------------------------------------ *
 * Muncul saat digulir.
 * ------------------------------------------------------------------ */
export function useMunculSaatTampak() {
  const ref = useRef(null);
  const [tampak, setTampak] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    // Peramban tanpa IntersectionObserver (dan mesin perayap) langsung
    // dianggap tampak — isinya tidak boleh bergantung pada fitur ini.
    if (typeof IntersectionObserver === "undefined") {
      setTampak(true);
      return undefined;
    }
    const pengamat = new IntersectionObserver(
      ([masuk]) => {
        if (masuk.isIntersecting) {
          setTampak(true);
          pengamat.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -60px 0px" }
    );
    pengamat.observe(el);
    return () => pengamat.disconnect();
  }, []);

  return [ref, tampak];
}

/** Pembungkus satu bagian yang meluncur masuk saat tergulir ke layar. */
export function Muncul({ children, delay = 0, className = "", as: Tag = "div", ...rest }) {
  const [ref, tampak] = useMunculSaatTampak();
  return (
    <Tag
      ref={ref}
      className={`muncul ${tampak ? "muncul-tampak" : ""} ${className}`.trim()}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/* ------------------------------------------------------------------ *
 * Ilustrasi per misi. Masing-masing menggambarkan misinya, bukan
 * hiasan acak — gambar yang tidak menjelaskan apa-apa hanya menambah
 * berat halaman.
 * ------------------------------------------------------------------ */
export function SeniMisi({ nama }) {
  const gambar = {
    // 01 — dijawab tanpa menunggu: gelembung masuk, lalu balasan menyusul.
    cepat: (
      <g>
        <rect className="sm-gel sm-gel-a" x="6" y="14" width="40" height="18" rx="9" />
        <rect className="sm-gel sm-gel-b" x="34" y="40" width="40" height="18" rx="9" />
        <circle className="sm-titik sm-titik-1" cx="16" cy="23" r="2.4" />
        <circle className="sm-titik sm-titik-2" cx="24" cy="23" r="2.4" />
        <circle className="sm-titik sm-titik-3" cx="32" cy="23" r="2.4" />
        <path className="sm-centang" d="M46 49l5 5 10-10" />
      </g>
    ),
    // 02 — tercatat tanpa ingatan admin: baris-baris yang terisi sendiri.
    catat: (
      <g>
        <rect className="sm-kartu" x="10" y="10" width="60" height="60" rx="8" />
        <path className="sm-baris sm-baris-1" d="M20 26h40" />
        <path className="sm-baris sm-baris-2" d="M20 38h40" />
        <path className="sm-baris sm-baris-3" d="M20 50h26" />
        <circle className="sm-tanda" cx="58" cy="54" r="9" />
        <path className="sm-centang sm-centang-kecil" d="M54 54l3 3 6-6" />
      </g>
    ),
    // 03 — jawaban konsisten: satu sumber, banyak keluaran yang sama.
    konsisten: (
      <g>
        <rect className="sm-sumber" x="30" y="8" width="20" height="20" rx="5" />
        <path className="sm-cabang sm-cabang-1" d="M40 28v12H18v10" />
        <path className="sm-cabang sm-cabang-2" d="M40 28v22" />
        <path className="sm-cabang sm-cabang-3" d="M40 28v12h22v10" />
        <rect className="sm-daun sm-daun-1" x="8" y="50" width="20" height="16" rx="4" />
        <rect className="sm-daun sm-daun-2" x="30" y="50" width="20" height="16" rx="4" />
        <rect className="sm-daun sm-daun-3" x="52" y="50" width="20" height="16" rx="4" />
      </g>
    ),
    // 04 — pemilik tahu keadaan tokonya: batang yang tumbuh tiap hari.
    laporan: (
      <g>
        <path className="sm-sumbu" d="M12 64h56" />
        <rect className="sm-batang sm-batang-1" x="18" y="44" width="9" height="20" rx="3" />
        <rect className="sm-batang sm-batang-2" x="32" y="32" width="9" height="32" rx="3" />
        <rect className="sm-batang sm-batang-3" x="46" y="38" width="9" height="26" rx="3" />
        <rect className="sm-batang sm-batang-4" x="60" y="22" width="9" height="42" rx="3" />
        <path className="sm-garis-tren" d="M22 40 L36 28 L50 34 L64 18" />
        <circle className="sm-denyut" cx="64" cy="18" r="4" />
      </g>
    ),
  };

  return (
    <svg viewBox="0 0 80 80" className="seni-misi" aria-hidden="true">
      {gambar[nama]}
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * Ilustrasi untuk "batas kemampuan". Sengaja bernada tenang — bagian
 * ini memang tentang menurunkan harapan, bukan menaikkannya.
 * ------------------------------------------------------------------ */
export function SeniBatas({ nama }) {
  const gambar = {
    materi: (
      <g>
        <path className="sb-garis" d="M14 18h36M14 30h36M14 42h22" pathLength="1" />
        <rect className="sb-bingkai" x="6" y="8" width="52" height="48" rx="7" pathLength="1" />
        <circle className="sb-tanya" cx="48" cy="46" r="10" pathLength="1" />
        <path className="sb-tanya-t" d="M45.4 43.2a2.8 2.8 0 1 1 3.4 3.1v1.6" pathLength="1" />
        <circle className="sb-tanya-d" cx="48.4" cy="51" r="1.1" pathLength="1" />
      </g>
    ),
    manusia: (
      <g>
        <circle className="sb-kepala" cx="24" cy="22" r="8" pathLength="1" />
        <path className="sb-badan" d="M11 48c0-7.2 5.8-13 13-13s13 5.8 13 13" pathLength="1" />
        <circle className="sb-mesin" cx="46" cy="26" r="7" pathLength="1" />
        <path className="sb-mesin-b" d="M36 50c0-5.5 4.5-10 10-10s10 4.5 10 10" pathLength="1" />
        <path className="sb-panah" d="M33 34h8" pathLength="1" />
      </g>
    ),
    janji: (
      <g>
        <path className="sb-sumbu" d="M10 50h44" pathLength="1" />
        <path className="sb-datar" d="M14 40h36" pathLength="1" />
        <path className="sb-tanya-naik" d="M14 44 L26 36 L38 40 L50 26" pathLength="1" />
        <circle className="sb-ujung" cx="50" cy="26" r="3.6" pathLength="1" />
      </g>
    ),
  };
  return (
    <svg viewBox="0 0 64 64" className="seni-batas" aria-hidden="true">
      {gambar[nama]}
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * Butir-butir cahaya yang hanyut di hero. Posisinya ditulis pasti,
 * bukan acak — nilai acak membuat HTML hasil prerender berbeda dari
 * yang digambar browser, dan hidrasinya meleset.
 * ------------------------------------------------------------------ */
const BUTIR = [
  { k: 6, a: 22, d: 0, l: 15 }, { k: 18, a: 68, d: 2.4, l: 19 },
  { k: 27, a: 12, d: 4.1, l: 16 }, { k: 39, a: 54, d: 1.2, l: 21 },
  { k: 52, a: 30, d: 5.3, l: 17 }, { k: 63, a: 76, d: 3.1, l: 20 },
  { k: 74, a: 18, d: 6.2, l: 18 }, { k: 88, a: 60, d: 0.8, l: 22 },
];

export function ButirCahaya() {
  return (
    <div className="butir-lapis" aria-hidden="true">
      {BUTIR.map((b, i) => (
        <span
          key={i}
          className="butir"
          style={{ left: `${b.k}%`, top: `${b.a}%`, animationDelay: `${b.d}s`, animationDuration: `${b.l}s` }}
        />
      ))}
    </div>
  );
}
