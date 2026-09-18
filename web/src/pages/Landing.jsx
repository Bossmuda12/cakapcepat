import { Link } from "react-router-dom";

/**
 * Halaman publik yang bisa diakses TANPA login — inilah yang dibaca Google.
 *
 * Aplikasi ini dilindungi login, jadi mesin pencari tidak punya apa pun untuk
 * dibaca kecuali ada halaman seperti ini. Isinya sengaja berupa kalimat nyata
 * (bukan sekadar kata kunci) supaya berguna untuk orang yang benar-benar
 * mencari "otomatisasi WhatsApp", "AI customer service", atau "rekap closing COD".
 */
export default function Landing() {
  return (
    <div className="landing">
      <div className="landing-bg" aria-hidden="true" />

      <header className="landing-nav">
        <div className="landing-brand">
          <img src="/logo.png" alt="Logo CakapCepat" />
          <span>CakapCepat</span>
        </div>
        <Link className="landing-nav-cta" to="/">
          Masuk
        </Link>
      </header>

      <main className="landing-main">
        <section className="landing-hero">
          <p className="landing-eyebrow">Oleh Taha Group</p>
          <h1>
            Chat pelanggan dibalas otomatis.
            <br />
            Closing tercatat sendiri.
          </h1>
          <p className="landing-lead">
            CakapCepat adalah alat otomatisasi WhatsApp berbasis AI untuk penjual yang beriklan di
            Meta Ads dan berjualan dengan sistem COD. AI menjawab pertanyaan pelanggan dengan gaya
            manusia, mencatat siapa yang closing, merekap pesanan ke grup, memantau paket yang
            bermasalah, lalu mengirim laporan harian — tanpa perlu tim CS yang besar.
          </p>
          <div className="landing-actions">
            <Link className="landing-btn-primary" to="/">
              Masuk ke Dashboard
            </Link>
            <Link className="landing-btn-ghost" to="/register">
              Daftar Akun
            </Link>
          </div>
        </section>

        <section className="landing-features" aria-label="Kemampuan CakapCepat">
          <article>
            <h2>Balasan AI yang terdengar seperti manusia</h2>
            <p>
              AI membaca seluruh riwayat percakapan, menjawab hanya dari materi produk yang sudah
              Anda tulis, dan tidak pernah mengarang harga. Balasannya diberi jeda mengetik yang
              wajar dan kalimat yang selalu berbeda, sehingga tidak terbaca seperti robot.
            </p>
          </article>
          <article>
            <h2>Rekap closing otomatis ke grup WhatsApp</h2>
            <p>
              Setiap pesanan yang closing langsung disetor ke grup closingan lengkap dengan nama
              pembeli, produk, dan alamat — satu closing hanya dilaporkan sekali, tidak pernah
              dobel.
            </p>
          </article>
          <article>
            <h2>Pantau pengiriman &amp; paket bermasalah</h2>
            <p>
              Status pengiriman dibaca otomatis dari email kurir. Saat paket ditolak atau
              dikembalikan, pembeli dihubungi sendiri dengan pesan yang sopan, dan tingkat retur
              Anda terhitung otomatis per produk.
            </p>
          </article>
          <article>
            <h2>Follow-up yang tahu kapan berhenti</h2>
            <p>
              Pembeli yang belum membalas ditindaklanjuti pada hari ke-1, ke-3, dan ke-7 dengan
              kalimat yang berbeda-beda, lalu berhenti sendiri begitu mereka membalas atau
              pesanannya batal.
            </p>
          </article>
          <article>
            <h2>Satu nomor, banyak produk</h2>
            <p>
              Produk dikenali dari iklan yang diklik pelanggan, lalu dikunci untuk percakapan itu.
              Materi pengetahuan tersusun berlapis: aturan toko, aturan kategori, lalu detail tiap
              produk.
            </p>
          </article>
          <article>
            <h2>Laporan harian langsung ke WhatsApp Anda</h2>
            <p>
              Berapa chat masuk, berapa qualified, berapa closing, berapa yang batal — dikirim tiap
              hari ke nomor pribadi pemilik, beserta peringatan untuk chat yang perlu ditangani
              sendiri.
            </p>
          </article>
        </section>

        <section className="landing-closing">
          <h2>Untuk siapa CakapCepat dibuat</h2>
          <p>
            Untuk pemilik bisnis yang chat masuknya sudah terlalu banyak untuk dibalas satu per
            satu, tapi belum sanggup — atau tidak ingin — menambah tim CS. CakapCepat menangani
            bagian yang berulang, dan hanya memanggil Anda untuk percakapan yang benar-benar butuh
            keputusan manusia.
          </p>
        </section>
      </main>

      <footer className="landing-footer">
        <span>© {new Date().getFullYear()} CakapCepat — Taha Group</span>
        <nav>
          <Link to="/privacy-policy">Kebijakan Privasi</Link>
          <Link to="/data-deletion">Penghapusan Data</Link>
        </nav>
      </footer>
    </div>
  );
}
