import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import Icon from "./Icon";

/**
 * Dropdown bertema — pengganti <select> bawaan.
 *
 * KENAPA ADA
 * <select> bawaan menggambar daftar pilihannya dengan widget SISTEM OPERASI,
 * bukan CSS kita. Di macOS ia muncul sebagai panel abu-abu bergaya Mac, di
 * Android sebagai lembar bawaan Android. Akibatnya satu-satunya bagian
 * aplikasi yang terlihat "bukan milik kita" justru muncul tepat saat pengguna
 * sedang memilih sesuatu. Tidak ada properti CSS yang bisa menembusnya —
 * satu-satunya jalan adalah menggambar sendiri daftarnya.
 *
 * DIBUAT SEBAGAI PENGGANTI LANGSUNG
 * Menerima anak <option> persis seperti <select>, dan memanggil onChange
 * dengan bentuk yang sama ({ target: { value } }). Jadi mengganti sebuah
 * <select> cukup dengan menukar nama tagnya — tidak ada logika pemanggil yang
 * perlu diubah. Itu disengaja: ada 34 tempat yang harus diganti, dan
 * perubahan yang menyentuh logika di 34 tempat pasti melahirkan bug.
 *
 * YANG TETAP DIJAGA DARI <select> BAWAAN
 * Orang sudah terbiasa dengan perilakunya, dan menghilangkannya terasa rusak:
 *   - Panah atas/bawah memindah sorotan, Enter memilih, Esc menutup.
 *   - Home/End lompat ke ujung.
 *   - Mengetik huruf melompat ke pilihan yang diawali huruf itu.
 *   - Klik di luar menutup.
 *   - Bisa dijangkau keyboard dan dibaca pembaca layar (role="listbox").
 *
 * DI PONSEL panelnya jadi lembar bawah selebar layar. Panel melayang selebar
 * pemicunya tidak terpakai di layar sempit: daftar panjang jadi tidak
 * terbaca, dan posisinya sering tertutup papan ketik.
 */

/** Ambil daftar pilihan dari anak <option>/<optgroup>, seperti <select>. */
function bacaPilihan(children) {
  const keluar = [];
  const telusuri = (simpul, grup) => {
    if (simpul === null || simpul === undefined || simpul === false) return;
    if (Array.isArray(simpul)) return simpul.forEach((s) => telusuri(s, grup));
    if (typeof simpul !== "object" || !simpul.props) return;

    if (simpul.type === "optgroup") {
      return telusuri(simpul.props.children, simpul.props.label);
    }
    if (simpul.type === "option") {
      const isi = simpul.props.children;
      const label = Array.isArray(isi) ? isi.filter((x) => typeof x !== "object").join("") : String(isi ?? "");
      keluar.push({
        value: String(simpul.props.value ?? label),
        label,
        nonaktif: Boolean(simpul.props.disabled),
        grup,
      });
      return;
    }
    // Fragment dan pembungkus lain: telusuri isinya.
    telusuri(simpul.props.children, grup);
  };
  telusuri(children, undefined);
  return keluar;
}

export default function Pilih({
  value,
  onChange,
  children,
  disabled = false,
  className = "",
  placeholder = "Pilih...",
  id,
  style,
  "aria-label": ariaLabel,
  ...rest
}) {
  const pilihan = useMemo(() => bacaPilihan(children), [children]);
  const [buka, setBuka] = useState(false);
  const [sorot, setSorot] = useState(-1);
  const [keAtas, setKeAtas] = useState(false);
  const bungkusRef = useRef(null);
  const pemicuRef = useRef(null);
  const panelRef = useRef(null);
  const ketikRef = useRef({ teks: "", waktu: 0 });
  const idOtomatis = useId();
  const idPanel = `${id || idOtomatis}-panel`;

  const terpilih = pilihan.find((p) => p.value === String(value ?? ""));
  const indeksTerpilih = pilihan.findIndex((p) => p.value === String(value ?? ""));

  /* Tutup saat klik di luar atau saat jendela digulir/diubah ukurannya —
     panel melayang yang tertinggal di tempat lamanya terlihat seperti bug.

     Escape dipasang di DOKUMEN, bukan cuma di tombol pemicu. Ketahuan saat
     diuji: begitu pengguna mengklik apa pun di dalam panel (termasuk opsi
     nonaktif yang tidak menutup panel), fokus lepas dari pemicu dan Escape
     tidak lagi sampai ke mana-mana — panelnya terjebak terbuka. */
  useEffect(() => {
    if (!buka) return undefined;
    const klikLuar = (e) => {
      if (bungkusRef.current && !bungkusRef.current.contains(e.target)) setBuka(false);
    };
    const tekanEsc = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setBuka(false);
        pemicuRef.current?.focus();
      }
    };
    const tutup = () => setBuka(false);
    document.addEventListener("keydown", tekanEsc);
    document.addEventListener("mousedown", klikLuar);
    window.addEventListener("resize", tutup);
    // `true` supaya gulir di dalam wadah mana pun ikut tertangkap.
    window.addEventListener("scroll", tutup, true);
    return () => {
      document.removeEventListener("keydown", tekanEsc);
      document.removeEventListener("mousedown", klikLuar);
      window.removeEventListener("resize", tutup);
      window.removeEventListener("scroll", tutup, true);
    };
  }, [buka]);

  /* Kalau ruang di bawah tidak cukup, panel dibalik ke atas. Tanpa ini,
     dropdown di baris terbawah tabel selalu terpotong tepi layar. */
  useLayoutEffect(() => {
    if (!buka || !bungkusRef.current) return;
    const kotak = bungkusRef.current.getBoundingClientRect();
    const ruangBawah = window.innerHeight - kotak.bottom;
    setKeAtas(ruangBawah < 240 && kotak.top > ruangBawah);
  }, [buka]);

  /* Saat dibuka, sorot pilihan yang sedang aktif dan bawa ke dalam pandangan. */
  useEffect(() => {
    if (!buka) return;
    setSorot(indeksTerpilih >= 0 ? indeksTerpilih : 0);
  }, [buka, indeksTerpilih]);

  useEffect(() => {
    if (!buka || sorot < 0 || !panelRef.current) return;
    const baris = panelRef.current.querySelector(`[data-i="${sorot}"]`);
    if (baris) baris.scrollIntoView({ block: "nearest" });
  }, [buka, sorot]);

  function pilihIndeks(i) {
    const p = pilihan[i];
    if (!p || p.nonaktif) return;
    setBuka(false);
    pemicuRef.current?.focus();
    if (p.value !== String(value ?? "")) onChange?.({ target: { value: p.value } });
  }

  function majuSorot(langkah) {
    setSorot((s) => {
      let i = s;
      for (let n = 0; n < pilihan.length; n++) {
        i = (i + langkah + pilihan.length) % pilihan.length;
        if (!pilihan[i].nonaktif) return i;
      }
      return s;
    });
  }

  function saatTombol(e) {
    if (disabled) return;

    if (!buka) {
      if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(e.key)) {
        e.preventDefault();
        setBuka(true);
      }
      return;
    }

    switch (e.key) {
      case "Escape":
        e.preventDefault();
        setBuka(false);
        return;
      case "ArrowDown":
        e.preventDefault();
        return majuSorot(1);
      case "ArrowUp":
        e.preventDefault();
        return majuSorot(-1);
      case "Home":
        e.preventDefault();
        return setSorot(pilihan.findIndex((p) => !p.nonaktif));
      case "End": {
        e.preventDefault();
        for (let i = pilihan.length - 1; i >= 0; i--) {
          if (!pilihan[i].nonaktif) return setSorot(i);
        }
        return;
      }
      case "Enter":
      case " ":
        e.preventDefault();
        return pilihIndeks(sorot);
      case "Tab":
        setBuka(false);
        return;
      default:
        break;
    }

    // Ketik-untuk-melompat: huruf yang diketik beruntun digabung jadi satu kata.
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const kini = Date.now();
      const k = ketikRef.current;
      k.teks = kini - k.waktu > 900 ? e.key : k.teks + e.key;
      k.waktu = kini;
      const cari = k.teks.toLowerCase();
      const i = pilihan.findIndex((p) => !p.nonaktif && p.label.toLowerCase().startsWith(cari));
      if (i >= 0) setSorot(i);
    }
  }

  return (
    <div
      ref={bungkusRef}
      className={`pilih ${buka ? "pilih-buka" : ""} ${disabled ? "pilih-mati" : ""} ${className}`.trim()}
      style={style}
    >
      <button
        type="button"
        ref={pemicuRef}
        id={id}
        className="pilih-pemicu"
        onClick={() => !disabled && setBuka((b) => !b)}
        onKeyDown={saatTombol}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={buka}
        aria-controls={buka ? idPanel : undefined}
        aria-label={ariaLabel}
        {...rest}
      >
        <span className={terpilih ? "pilih-nilai" : "pilih-nilai pilih-kosong"}>
          {terpilih ? terpilih.label : placeholder}
        </span>
        <Icon name="panah" size={15} className="pilih-panah" />
      </button>

      {buka && (
        <>
          {/* Latar gelap HANYA muncul di ponsel (diatur CSS). Di sana panelnya
              lembar bawah, dan tanpa latar ini isi di belakangnya masih
              terlihat bisa ditekan padahal tidak. */}
          <div className="pilih-tirai" onClick={() => setBuka(false)} aria-hidden="true" />
          <div
            ref={panelRef}
            id={idPanel}
            className={`pilih-panel ${keAtas ? "pilih-panel-atas" : ""}`.trim()}
            /* Mencegah klik di panel memindahkan fokus dari pemicu. Tanpa ini,
               sekali mengklik isi panel semua pintasan papan ketik mati. */
            onMouseDown={(e) => e.preventDefault()}
            role="listbox"
            aria-activedescendant={sorot >= 0 ? `${idPanel}-${sorot}` : undefined}
            tabIndex={-1}
          >
            {pilihan.map((p, i) => {
              const judulGrup = p.grup && (i === 0 || pilihan[i - 1].grup !== p.grup);
              return (
                <div key={`${p.value}-${i}`}>
                  {judulGrup && <div className="pilih-grup">{p.grup}</div>}
                  <div
                    id={`${idPanel}-${i}`}
                    data-i={i}
                    role="option"
                    aria-selected={p.value === String(value ?? "")}
                    aria-disabled={p.nonaktif || undefined}
                    className={[
                      "pilih-opsi",
                      i === sorot ? "pilih-opsi-sorot" : "",
                      p.value === String(value ?? "") ? "pilih-opsi-aktif" : "",
                      p.nonaktif ? "pilih-opsi-mati" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onMouseEnter={() => !p.nonaktif && setSorot(i)}
                    onClick={() => pilihIndeks(i)}
                  >
                    <span>{p.label}</span>
                    {p.value === String(value ?? "") && <Icon name="centang" size={15} strokeWidth={2.4} />}
                  </div>
                </div>
              );
            })}
            {pilihan.length === 0 && <div className="pilih-kosong-panel">Tidak ada pilihan</div>}
          </div>
        </>
      )}
    </div>
  );
}
