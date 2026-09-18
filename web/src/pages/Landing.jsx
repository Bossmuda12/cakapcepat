import { Link } from "react-router-dom";

/**
 * Halaman profil publik CakapCepat — inilah yang dilihat pengunjung baru dan
 * yang dibaca mesin pencari. Aplikasi sesungguhnya ada di balik login (/masuk),
 * jadi halaman ini yang menjelaskan siapa kami, apa yang kami kerjakan, dan
 * apa yang TIDAK kami janjikan.
 */

const MISI = [
  {
    no: "01",
    judul: "Menjawab pelanggan tanpa membuat mereka menunggu",
    isi: "Setiap chat yang masuk dijawab dalam hitungan detik, dengan jeda mengetik yang wajar supaya terasa seperti dibalas orang, bukan mesin.",
  },
  {
    no: "02",
    judul: "Mencatat setiap pesanan tanpa bergantung pada ingatan admin",
    isi: "Closing, pengiriman, komplain, dan retur tercatat otomatis dari percakapan, lalu direkap ke grup dan laporan harian.",
  },
  {
    no: "03",
    judul: "Menjaga jawaban tetap konsisten di semua produk",
    isi: "Setiap produk punya materi pengetahuannya sendiri, sehingga jawaban soal harga, ongkir, dan garansi tidak berubah-ubah antar admin.",
  },
  {
    no: "04",
    judul: "Membuat pemilik usaha tahu keadaan tokonya setiap hari",
    isi: "Laporan harian berisi jumlah chat masuk, closing, pesanan bermasalah, dan tingkat retur — tanpa perlu menagih laporan ke siapa pun.",
  },
];

const LAYANAN = [
  {
    judul: "Balasan otomatis berbasis AI",
    isi: "AI membaca riwayat percakapan dan materi produk Anda, lalu menjawab dengan bahasa sehari-hari. Jika ragu atau pelanggan minta hal sensitif, percakapan dilempar ke manusia.",
    ikon: "M21 11.5a8.38 8.38 0 0 1-4.7 7.6 8.5 8.5 0 0 1-7.6 0L3 21l1.9-5.7a8.38 8.38 0 0 1 0-7.6 8.5 8.5 0 0 1 7.6-4.7h.5a8.48 8.48 0 0 1 8 8v.5Z",
  },
  {
    judul: "Rekap closing ke grup WhatsApp",
    isi: "Begitu sebuah percakapan dinilai closing, ringkasan pesanan dikirim ke grup closingan Anda. Satu pesanan hanya dilaporkan sekali, tidak pernah dobel.",
    ikon: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  },
  {
    judul: "Follow-up pembeli yang belum membalas",
    isi: "Pelanggan yang menggantung chat dihubungi lagi secara berkala dengan kalimat yang berbeda-beda, bukan template yang sama berulang kali.",
    ikon: "M3 11 20 3l-4 18-6-8-7-2Z",
  },
  {
    judul: "Pelacakan paket & deteksi masalah",
    isi: "Status resi dari kurir dibaca otomatis. Paket yang tertahan, gagal kirim, atau diretur ditandai dan dilaporkan agar bisa ditindaklanjuti lebih cepat.",
    ikon: "M1 3h15v13H1V3ZM16 8h4l3 3v5h-7V8ZM3 18.5a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0ZM16 18.5a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0Z",
  },
  {
    judul: "Katalog produk & materi pengetahuan",
    isi: "Kategori, produk, varian, dan harga tersimpan rapi. Materi pengetahuan bisa dipasang per toko, per kategori, atau per produk.",
    ikon: "M20 7 12 3 4 7m16 0-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4",
  },
  {
    judul: "Laporan harian & catatan aktivitas",
    isi: "Ringkasan harian dikirim otomatis. Setiap tindakan penting di dalam sistem tercatat, jadi jelas siapa mengubah apa dan kapan.",
    ikon: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6ZM14 2v6h6M16 13H8M16 17H8M10 9H8",
  },
];

const LANGKAH = [
  {
    no: "1",
    judul: "Hubungkan nomor WhatsApp",
    isi: "Pindai kode QR atau masukkan kode pemasangan dari ponsel Anda. Nomor lama tetap dipakai, pelanggan tidak perlu menyimpan nomor baru.",
  },
  {
    no: "2",
    judul: "Isi materi produk",
    isi: "Masukkan daftar produk, harga, ongkir, dan jawaban atas pertanyaan yang paling sering muncul. Inilah bahan yang dipakai AI untuk menjawab.",
  },
  {
    no: "3",
    judul: "Atur gaya bicara & aturan aman",
    isi: "Tentukan sapaan, panjang balasan, jam kerja, serta topik yang harus selalu dialihkan ke manusia — misalnya tawar-menawar atau komplain berat.",
  },
  {
    no: "4",
    judul: "Pantau dari satu dasbor",
    isi: "Semua percakapan, pesanan, dan laporan ada di satu tempat. Admin tinggal menangani yang benar-benar butuh manusia.",
  },
];

const BATAS = [
  {
    judul: "Kualitas jawaban mengikuti kualitas materi Anda",
    isi: "AI tidak mengarang harga atau stok. Kalau materi produk kosong atau usang, jawabannya akan seadanya. Materi yang rapi adalah pekerjaan yang tetap harus Anda lakukan.",
  },
  {
    judul: "Manusia tetap dibutuhkan",
    isi: "Tawar-menawar, komplain berat, dan keputusan uang tetap ditangani orang. CakapCepat dirancang untuk mengurangi beban admin, bukan menghapus peran mereka.",
  },
  {
    judul: "Kami tidak menjanjikan kenaikan penjualan",
    isi: "Yang kami janjikan adalah kecepatan balasan, pencatatan yang rapi, dan follow-up yang tidak terlewat. Penjualan ditentukan produk, harga, dan iklan Anda sendiri.",
  },
];

export default function Landing() {
  return (
    <div className="landing">
      <div className="landing-bg" aria-hidden="true" />

      <header className="landing-nav">
        <div className="landing-brand">
          <img src="/logo-light.png" alt="CakapCepat" />
        </div>
        <nav className="landing-nav-links">
          <a href="#visi">Visi &amp; Misi</a>
          <a href="#layanan">Layanan</a>
          <a href="#cara-kerja">Cara Kerja</a>
          <a href="#tentang">Tentang</a>
        </nav>
        <Link className="landing-nav-cta" to="/masuk">
          Masuk
        </Link>
      </header>

      <main className="landing-main">
        <section className="landing-hero">
          <h1>
            Chat pelanggan dibalas otomatis.
            <br />
            Closing tercatat sendiri.
          </h1>
          <p className="landing-lead">
            CakapCepat adalah layanan otomatisasi WhatsApp berbasis AI untuk penjual yang beriklan di
            Meta Ads dan berjualan dengan sistem COD. AI menjawab pertanyaan pelanggan dengan gaya
            manusia, mencatat siapa yang closing, merekap pesanan ke grup, memantau paket bermasalah,
            lalu mengirim laporan harian — supaya tim Anda bisa fokus pada hal yang benar-benar butuh
            manusia.
          </p>
          <div className="landing-actions">
            <Link className="landing-btn-primary" to="/masuk">
              Masuk ke dasbor
            </Link>
            <a className="landing-btn-ghost" href="#layanan">
              Lihat layanan kami
            </a>
          </div>
        </section>

        <section className="landing-pillars" aria-label="Ringkasan layanan">
          <div>
            <strong>Balas dalam hitungan detik</strong>
            <span>Dengan jeda mengetik yang wajar, bukan balasan instan yang terasa robot.</span>
          </div>
          <div>
            <strong>Catat tanpa lupa</strong>
            <span>Closing, pengiriman, komplain, dan retur tercatat dari percakapan itu sendiri.</span>
          </div>
          <div>
            <strong>Satu dasbor</strong>
            <span>Semua nomor, percakapan, pesanan, dan laporan berada di satu tempat.</span>
          </div>
        </section>

        <section className="landing-section" id="visi">
          <p className="landing-kicker">Visi &amp; Misi</p>
          <h2 className="landing-h2">
            Penjual kecil seharusnya tidak kalah cepat hanya karena timnya sedikit.
          </h2>
          <p className="landing-section-lead">
            Visi kami sederhana: membuat toko dengan satu-dua admin bisa melayani pelanggan
            secepat toko yang punya belasan CS — tanpa memaksa pemiliknya begadang membalas chat.
            Untuk sampai ke sana, kami menetapkan empat misi kerja berikut.
          </p>
          <ol className="landing-misi">
            {MISI.map((m) => (
              <li key={m.no}>
                <span className="landing-misi-no">{m.no}</span>
                <div>
                  <h3>{m.judul}</h3>
                  <p>{m.isi}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="landing-section" id="layanan">
          <p className="landing-kicker">Layanan</p>
          <h2 className="landing-h2">Apa yang dikerjakan CakapCepat setiap hari</h2>
          <div className="landing-features">
            {LAYANAN.map((l) => (
              <article key={l.judul}>
                <svg viewBox="0 0 24 24" className="landing-feature-icon" aria-hidden="true">
                  <path d={l.ikon} />
                </svg>
                <h3>{l.judul}</h3>
                <p>{l.isi}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-section" id="cara-kerja">
          <p className="landing-kicker">Cara Kerja</p>
          <h2 className="landing-h2">Empat langkah, tanpa ganti nomor</h2>
          <ol className="landing-steps">
            {LANGKAH.map((s) => (
              <li key={s.no}>
                <span className="landing-step-no">{s.no}</span>
                <h3>{s.judul}</h3>
                <p>{s.isi}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="landing-section landing-limits" id="batas">
          <p className="landing-kicker">Yang perlu Anda tahu</p>
          <h2 className="landing-h2">Batas kemampuan kami</h2>
          <p className="landing-section-lead">
            Kami lebih suka Anda tahu batasnya sejak awal daripada kecewa di tengah jalan.
          </p>
          <div className="landing-limit-grid">
            {BATAS.map((b) => (
              <article key={b.judul}>
                <h3>{b.judul}</h3>
                <p>{b.isi}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-section" id="tentang">
          <p className="landing-kicker">Tentang</p>
          <h2 className="landing-h2">Dibangun oleh Taha Group</h2>
          <p className="landing-section-lead">
            CakapCepat dikembangkan oleh Taha Group, tim yang sehari-hari menjalankan penjualan
            produk COD lewat iklan Meta di Indonesia dan Malaysia. Setiap fitur di sini lahir dari
            masalah yang kami alami sendiri: chat menumpuk saat iklan jalan, closing yang lupa
            dicatat, dan paket bermasalah yang baru ketahuan setelah pelanggan marah.
          </p>
          <p className="landing-section-lead">
            Karena itu kami membangunnya sebagai alat kerja, bukan etalase. Kalau ada yang belum
            bisa dilakukan sistem ini, kami lebih memilih menuliskannya terang-terangan seperti di
            bagian di atas.
          </p>
          <div className="landing-actions">
            <Link className="landing-btn-primary" to="/masuk">
              Masuk ke dasbor
            </Link>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="landing-footer-inner">
          <div>
            <strong>CakapCepat</strong>
            <span>Otomatisasi WhatsApp berbasis AI — produk Taha Group.</span>
          </div>
          <nav className="landing-footer-links">
            <Link to="/masuk">Masuk</Link>
            <Link to="/register">Daftar</Link>
            <Link to="/privacy-policy">Kebijakan Privasi</Link>
            <Link to="/data-deletion">Penghapusan Data</Link>
          </nav>
        </div>
        <p className="landing-copyright">
          © {new Date().getFullYear()} Taha Group. CakapCepat bukan produk resmi WhatsApp dan tidak
          berafiliasi dengan Meta Platforms, Inc.
        </p>
      </footer>
    </div>
  );
}
