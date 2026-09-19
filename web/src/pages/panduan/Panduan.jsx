import { Link, useParams } from "react-router-dom";
import { PANDUAN, PETA_PANDUAN } from "./isi";

/**
 * Halaman panduan — daftar (/panduan) dan artikel (/panduan/<slug>).
 *
 * Ikut prerender (lihat scripts/prerender.mjs), jadi tidak boleh bergantung
 * pada `window`, `document`, atau data yang baru ada setelah permintaan API.
 */

function BarMerek() {
  return (
    <header className="pnd-bar">
      <Link className="pnd-bar-merek" to="/">
        <img src="/logo-light.png" alt="CakapCepat" />
      </Link>
      <nav className="pnd-bar-nav">
        <Link to="/panduan">Panduan</Link>
        <Link className="landing-nav-cta" to="/masuk">
          Masuk
        </Link>
      </nav>
    </header>
  );
}

function Kepala({ judul, ringkas, breadcrumb }) {
  return (
    <header className="pnd-head">
      <nav className="pnd-crumb" aria-label="Remah roti">
        <Link to="/">Beranda</Link>
        <span aria-hidden="true">/</span>
        {breadcrumb ? (
          <>
            <Link to="/panduan">Panduan</Link>
            <span aria-hidden="true">/</span>
            <span>{breadcrumb}</span>
          </>
        ) : (
          <span>Panduan</span>
        )}
      </nav>
      <h1>{judul}</h1>
      {ringkas && <p className="pnd-ringkas">{ringkas}</p>}
    </header>
  );
}

function Kaki({ diIndeks }) {
  return (
    <footer className="pnd-kaki">
      <p>
        CakapCepat adalah layanan otomatisasi WhatsApp berbasis AI dari Taha Group untuk penjual
        yang beriklan di Meta Ads dan berjualan dengan sistem COD.
      </p>
      <div className="pnd-kaki-aksi">
        <Link className="landing-btn-primary" to="/masuk">
          Masuk ke dasbor
        </Link>
        {!diIndeks && (
          <Link className="landing-btn-ghost" to="/panduan">
            Panduan lainnya
          </Link>
        )}
      </div>
      <p className="pnd-kaki-kecil">
        <a
          className="pnd-sosial"
          href="https://www.facebook.com/people/Cakapcepatcom/61594199026128/"
          target="_blank"
          rel="noopener"
        >
          CakapCepat di Facebook
        </a>
      </p>
      <p className="pnd-kaki-kecil">
        CakapCepat bukan produk resmi WhatsApp dan tidak berafiliasi dengan Meta Platforms, Inc.
      </p>
    </footer>
  );
}

/** Daftar seluruh panduan: /panduan */
export function PanduanIndeks() {
  return (
    <div className="pnd">
      <div className="pnd-inner">
        <BarMerek />
        <Kepala
          judul="Panduan otomatisasi WhatsApp untuk penjual"
          ringkas="Catatan kerja tentang membalas chat, mencatat pesanan, menindaklanjuti pembeli, dan memantau pengiriman — ditulis dari yang benar-benar kami jalankan sehari-hari, termasuk bagian yang sebaiknya tidak diotomatiskan."
        />
        <ul className="pnd-daftar">
          {PANDUAN.map((a) => (
            <li key={a.slug}>
              <Link to={`/panduan/${a.slug}`}>
                <h2>{a.judul}</h2>
                <p>{a.ringkas}</p>
                <span className="pnd-baca">Baca panduan</span>
              </Link>
            </li>
          ))}
        </ul>
        <Kaki diIndeks />
      </div>
    </div>
  );
}

/** Satu artikel: /panduan/<slug> */
export function PanduanArtikel({ slug: slugProp }) {
  const params = useParams();
  const slug = slugProp || params.slug;
  const artikel = PETA_PANDUAN[slug];

  if (!artikel) {
    return (
      <div className="pnd">
        <div className="pnd-inner">
          <BarMerek />
          <Kepala judul="Panduan tidak ditemukan" />
          <p>
            Halaman yang Anda cari tidak ada. Lihat <Link to="/panduan">daftar panduan</Link>.
          </p>
        </div>
      </div>
    );
  }

  const lain = PANDUAN.filter((a) => a.slug !== slug).slice(0, 3);

  return (
    <div className="pnd">
      <div className="pnd-inner">
        <BarMerek />
        <Kepala judul={artikel.judul} ringkas={artikel.ringkas} breadcrumb="Artikel" />
        <p className="pnd-tanggal">Diperbarui {artikel.diperbarui}</p>

        <article className="pnd-isi">
          {artikel.isi.map((bagian, i) => (
            <section key={i}>
              {bagian.h && <h2>{bagian.h}</h2>}
              {bagian.p?.map((t, j) => (
                <p key={`p${j}`}>{t}</p>
              ))}
              {bagian.ul && (
                <ul>
                  {bagian.ul.map((t, j) => (
                    <li key={`u${j}`}>{t}</li>
                  ))}
                </ul>
              )}
              {bagian.ol && (
                <ol>
                  {bagian.ol.map((t, j) => (
                    <li key={`o${j}`}>{t}</li>
                  ))}
                </ol>
              )}
              {bagian.p2?.map((t, j) => (
                <p key={`q${j}`}>{t}</p>
              ))}
            </section>
          ))}
        </article>

        <aside className="pnd-lain" aria-label="Panduan lainnya">
          <h2>Panduan lainnya</h2>
          <ul>
            {lain.map((a) => (
              <li key={a.slug}>
                <Link to={`/panduan/${a.slug}`}>{a.judul}</Link>
              </li>
            ))}
          </ul>
        </aside>

        <Kaki />
      </div>
    </div>
  );
}
