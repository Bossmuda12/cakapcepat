/**
 * Gambar-gambar halaman depan.
 *
 * Semuanya digambar sendiri dengan SVG inline + CSS. Tidak ada berkas gambar
 * eksternal dan tidak ada skrip dari CDN — Content-Security-Policy kita
 * mengunci `script-src 'self'`, dan halaman ini juga dirender jadi HTML statis
 * saat build (lihat scripts/prerender.mjs) supaya Google membaca teksnya tanpa
 * menunggu JavaScript. Karena itu tidak boleh ada visual yang bergantung pada
 * `window`, `document`, atau state waktu-jalan.
 */

/* ------------------------------------------------------------------ *
 * Latar: aurora lembut + kisi perspektif. Murni dekoratif.
 * ------------------------------------------------------------------ */
export function HeroAurora() {
  return (
    <div className="lv-aurora" aria-hidden="true">
      <span className="lv-aurora-blob lv-aurora-1" />
      <span className="lv-aurora-blob lv-aurora-2" />
      <span className="lv-aurora-blob lv-aurora-3" />
      <span className="lv-grid" />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Mockup percakapan WhatsApp di dalam bingkai ponsel.
 * Inilah "produknya" — pengunjung harus langsung melihat seperti apa
 * balasan AI itu sebelum membaca satu paragraf pun.
 * ------------------------------------------------------------------ */
const PERCAKAPAN = [
  { dari: "pembeli", teks: "Bu ini gamis yg di iklan masih ada? warna sage" },
  { dari: "ai", teks: "Masih ada kak 😊 Sage ready M, L, XL. 189rb sudah termasuk ongkir." },
  { dari: "pembeli", teks: "Bisa COD?" },
  { dari: "ai", teks: "Bisa kak, bayar waktu paket sampai. Boleh kirim nama, no HP, dan alamatnya?" },
  { dari: "pembeli", teks: "Siti Rahayu / 0812xxxx / Jl. Melati 12, Sleman" },
  { dari: "ai", teks: "Sudah dicatat ya kak 🙌 Gamis sage L, COD 189rb. Dikemas hari ini." },
];

export function MockupChat() {
  return (
    <div className="lv-phone" role="img" aria-label="Contoh percakapan: pelanggan bertanya soal stok gamis, CakapCepat menjawab harga dan ongkir, lalu mencatat pesanan COD lengkap dengan nama dan alamat.">
      <div className="lv-phone-notch" aria-hidden="true" />
      <div className="lv-phone-screen">
        <div className="lv-chat-head">
          <span className="lv-chat-ava" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.4A10 10 0 1 0 12 2Z" />
            </svg>
          </span>
          <span className="lv-chat-head-text">
            <strong>Toko Melati</strong>
            <em>dijawab otomatis · online</em>
          </span>
          <span className="lv-chat-live" aria-hidden="true" />
        </div>

        <div className="lv-chat-body">
          {PERCAKAPAN.map((b, i) => (
            <p key={i} className={b.dari === "ai" ? "lv-bubble lv-bubble-ai" : "lv-bubble lv-bubble-in"}>
              {b.teks}
            </p>
          ))}
          <span className="lv-typing" aria-hidden="true">
            <i /><i /><i />
          </span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Kartu melayang di samping ponsel: bukti bahwa percakapan di atas
 * berubah jadi catatan, bukan cuma balasan.
 * ------------------------------------------------------------------ */
export function KartuMelayang() {
  return (
    <>
      <div className="lv-float lv-float-order" aria-hidden="true">
        <span className="lv-float-ico lv-float-ico-green">
          <svg viewBox="0 0 24 24"><path d="m4 12 5 5L20 6" /></svg>
        </span>
        <span>
          <strong>Closing tercatat</strong>
          <em>Siti Rahayu · COD Rp189.000</em>
        </span>
      </div>

      <div className="lv-float lv-float-track" aria-hidden="true">
        <span className="lv-float-ico lv-float-ico-cyan">
          <svg viewBox="0 0 24 24">
            <path d="M1 3h15v13H1zM16 8h4l3 3v5h-7z" />
            <circle cx="5.5" cy="18.5" r="2.5" />
            <circle cx="18.5" cy="18.5" r="2.5" />
          </svg>
        </span>
        <span>
          <strong>Resi dipantau</strong>
          <em>JNE · dalam perjalanan</em>
        </span>
      </div>

      <div className="lv-float lv-float-report" aria-hidden="true">
        <span className="lv-float-ico lv-float-ico-violet">
          <svg viewBox="0 0 24 24"><path d="M3 20h18M6 20V10M11 20V4M16 20v-8M21 20v-5" /></svg>
        </span>
        <span>
          <strong>Laporan harian</strong>
          <em>142 chat · 38 closing</em>
        </span>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Pratinjau dasbor: KPI, grafik batang, dan daftar pesanan.
 * Angkanya contoh — ditulis sebagai gambar (role="img") supaya tidak
 * terbaca mesin pencari sebagai klaim performa kami.
 * ------------------------------------------------------------------ */
const BATANG = [34, 52, 41, 68, 59, 77, 64];
const HARI = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];

export function PratinjauDasbor() {
  const maks = Math.max(...BATANG);
  return (
    <div className="lv-dash" role="img" aria-label="Pratinjau dasbor CakapCepat: kartu ringkasan chat masuk, closing, paket bermasalah, dan retur; grafik closing tujuh hari; serta daftar pesanan terbaru.">
      <div className="lv-dash-bar" aria-hidden="true">
        <i /><i /><i />
        <span>cakapcepat.com/dashboard</span>
      </div>

      <div className="lv-dash-body">
        <aside className="lv-dash-side" aria-hidden="true">
          <span className="lv-dash-logo" />
          <span className="lv-dash-nav lv-dash-nav-on" />
          <span className="lv-dash-nav" />
          <span className="lv-dash-nav" />
          <span className="lv-dash-nav" />
          <span className="lv-dash-nav" />
        </aside>

        <div className="lv-dash-main">
          <div className="lv-kpis">
            <div className="lv-kpi"><em>Chat masuk</em><strong>142</strong><span className="lv-kpi-up">+18%</span></div>
            <div className="lv-kpi"><em>Closing</em><strong>38</strong><span className="lv-kpi-up">+9%</span></div>
            <div className="lv-kpi"><em>Paket bermasalah</em><strong>3</strong><span className="lv-kpi-warn">perlu cek</span></div>
            <div className="lv-kpi"><em>Retur</em><strong>1</strong><span className="lv-kpi-flat">stabil</span></div>
          </div>

          <div className="lv-dash-row">
            <div className="lv-chart">
              <span className="lv-chart-title">Closing 7 hari</span>
              <div className="lv-bars">
                {BATANG.map((v, i) => (
                  <span key={i} className="lv-bar-wrap">
                    <span className="lv-bar" style={{ height: `${Math.round((v / maks) * 100)}%` }} />
                    <em>{HARI[i]}</em>
                  </span>
                ))}
              </div>
            </div>

            <div className="lv-list">
              <span className="lv-chart-title">Pesanan terbaru</span>
              <ul>
                <li><i className="lv-dot lv-dot-green" />Siti R. · Gamis sage L<em>COD</em></li>
                <li><i className="lv-dot lv-dot-cyan" />Andi P. · Sepatu 42<em>Kirim</em></li>
                <li><i className="lv-dot lv-dot-amber" />Rina W. · Tas kulit<em>Tertahan</em></li>
                <li><i className="lv-dot lv-dot-green" />Budi S. · Jaket XL<em>COD</em></li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Ilustrasi kecil untuk empat langkah pemasangan.
 * ------------------------------------------------------------------ */
export function IlustrasiLangkah({ nama }) {
  const gambar = {
    qr: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <path d="M14 14h3v3h-3zM20 14h1M14 20h3M20 18v3" />
      </>
    ),
    katalog: (
      <>
        <path d="M20 7 12 3 4 7l8 4 8-4Z" />
        <path d="M4 7v10l8 4 8-4V7" />
        <path d="M12 11v10" />
      </>
    ),
    atur: (
      <>
        <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
        <circle cx="16" cy="7" r="2.4" />
        <circle cx="10" cy="17" r="2.4" />
      </>
    ),
    pantau: (
      <>
        <rect x="2.5" y="4" width="19" height="13" rx="2" />
        <path d="M8 21h8M12 17v4M6.5 13l3-3.5 2.5 2.5 4-5" />
      </>
    ),
  };
  return (
    <svg viewBox="0 0 24 24" className="lv-step-art" aria-hidden="true">
      {gambar[nama]}
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * Pita alur: chat masuk -> AI -> catatan -> laporan.
 * Menjelaskan produk dalam satu tarikan mata.
 * ------------------------------------------------------------------ */
export function PitaAlur() {
  const simpul = [
    { label: "Chat masuk", ikon: "M21 11.5a8.4 8.4 0 0 1-12.3 7.6L3 21l1.9-5.7A8.5 8.5 0 1 1 21 11.5Z" },
    { label: "Dijawab AI", ikon: "M12 3v3M12 18v3M4.2 7.5l2.6 1.5M17.2 15l2.6 1.5M4.2 16.5l2.6-1.5M17.2 9l2.6-1.5M12 8.5A3.5 3.5 0 1 1 12 15.5a3.5 3.5 0 0 1 0-7Z" },
    { label: "Pesanan dicatat", ikon: "M9 3h6v3H9zM6 6h12v15H6zM9.5 12h5M9.5 16h5" },
    { label: "Resi dipantau", ikon: "M1 4h14v11H1zM15 8h4l3 3v4h-7zM4.5 18.5a2 2 0 1 0 4 0 2 2 0 1 0-4 0M16.5 18.5a2 2 0 1 0 4 0 2 2 0 1 0-4 0" },
    { label: "Laporan harian", ikon: "M3 20h18M6.5 20v-7M11.5 20V5M16.5 20v-10" },
  ];
  return (
    <div className="lv-alur" role="img" aria-label="Alur kerja CakapCepat: chat masuk, dijawab AI, pesanan dicatat, resi dipantau, laporan harian dikirim.">
      {simpul.map((s, i) => (
        <div className="lv-alur-item" key={s.label}>
          <span className="lv-alur-ring">
            <svg viewBox="0 0 24 24"><path d={s.ikon} /></svg>
          </span>
          <span className="lv-alur-label">{s.label}</span>
          {i < simpul.length - 1 && <span className="lv-alur-garis" aria-hidden="true" />}
        </div>
      ))}
    </div>
  );
}
