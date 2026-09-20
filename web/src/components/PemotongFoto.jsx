import { useCallback, useEffect, useRef, useState } from "react";
import Modal from "./Modal";
import Icon from "./Icon";

/**
 * Penyesuai foto profil: geser dan perbesar sebelum disimpan.
 *
 * DUA MASALAH YANG DIPECAHKAN
 *
 * 1. Foto terpotong sendiri. Sebelumnya gambar diperkecil dengan menjaga
 *    rasio aslinya, lalu lingkaran avatar memotongnya dengan `object-fit:
 *    cover` — SELALU dari tengah. Foto potret jadi terpotong dahi dan dagu,
 *    foto lanskap kehilangan kiri-kanannya, dan pemiliknya tidak punya cara
 *    apa pun untuk mengatur bagian mana yang dipakai.
 *
 * 2. Memilih berkas langsung mengunggah. Tidak ada satu pun kesempatan untuk
 *    melihat hasilnya dulu, apalagi memperbaikinya.
 *
 * Keduanya hilang dengan satu jawaban yang sama: keluarannya dibuat BUJUR
 * SANGKAR dan bingkainya dipilih sendiri oleh pemiliknya. Karena hasilnya
 * sudah bujur sangkar, lingkaran avatar di mana pun tidak punya apa pun lagi
 * untuk dipotong — persis yang dilihat di sini, itu yang muncul nanti.
 *
 * Dibuat untuk jari sekaligus tetikus: seret, cubit dua jari, roda tetikus,
 * dan penggeser — karena foto profil hampir selalu diganti dari ponsel.
 */

const KELUARAN = 320; // sisi gambar akhir, piksel
const ZOOM_MIN = 1;
const ZOOM_MAKS = 4;

export default function PemotongFoto({ open, file, onSelesai, onBatal }) {
  const [gambar, setGambar] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [geser, setGeser] = useState({ x: 0, y: 0 });
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState("");

  const panggungRef = useRef(null);
  const seretRef = useRef(null);
  const cubitRef = useRef(null);

  /* Muat berkas jadi objek Image. Dibaca sebagai data URL, bukan object URL,
     supaya tidak ada URL yang perlu dicabut belakangan dan bocor kalau
     komponennya dilepas di tengah jalan. */
  useEffect(() => {
    if (!open || !file) return undefined;
    let batal = false;
    setGalat("");
    setGambar(null);
    setZoom(1);
    setGeser({ x: 0, y: 0 });

    const pembaca = new FileReader();
    pembaca.onerror = () => !batal && setGalat("Gagal membaca berkas.");
    pembaca.onload = () => {
      const img = new Image();
      img.onerror = () => !batal && setGalat("Berkas ini bukan gambar yang bisa dibaca.");
      img.onload = () => !batal && setGambar(img);
      img.src = pembaca.result;
    };
    pembaca.readAsDataURL(file);
    return () => {
      batal = true;
    };
  }, [open, file]);

  /** Sisi terpendek gambar dipaskan ke lingkaran — itu zoom 1. */
  const skalaDasar = gambar ? KELUARAN / Math.min(gambar.width, gambar.height) : 1;

  /* Jaga supaya gambar tidak bisa digeser sampai meninggalkan lubang
     lingkaran. Tanpa ini orang bisa menyeret fotonya keluar dan menyimpan
     avatar yang setengahnya kosong. */
  const batasi = useCallback(
    (g, z) => {
      if (!gambar) return g;
      const lebar = gambar.width * skalaDasar * z;
      const tinggi = gambar.height * skalaDasar * z;
      const maksX = Math.max(0, (lebar - KELUARAN) / 2);
      const maksY = Math.max(0, (tinggi - KELUARAN) / 2);
      return {
        x: Math.min(maksX, Math.max(-maksX, g.x)),
        y: Math.min(maksY, Math.max(-maksY, g.y)),
      };
    },
    [gambar, skalaDasar]
  );

  useEffect(() => {
    setGeser((g) => batasi(g, zoom));
  }, [zoom, batasi]);

  /* --- Seret & cubit ---------------------------------------------------
     Memakai Pointer Events, bukan mouse + touch terpisah.

     Versi pertama memakai onMouseMove/onMouseLeave di elemen panggung, dan
     ketahuan saat diuji: begitu kursor keluar dari kotak 320px itu —
     yang terjadi setelah menyeret ~160px — event-nya berhenti sampai dan
     seretannya mati di tengah jalan. Menyeret foto lebar sampai ujungnya
     jadi mustahil.

     setPointerCapture membuat seluruh gerakan tetap dikirim ke elemen ini
     sampai jari/tombol dilepas, sejauh apa pun kursornya pergi. Sekaligus
     menyatukan tetikus, jari, dan pena dalam satu jalur kode. */
  const pointerRef = useRef(new Map());

  function saatPointerTurun(e) {
    if (!gambar) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pointerRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointerRef.current.size === 1) {
      seretRef.current = { x: e.clientX, y: e.clientY, awal: geser };
      cubitRef.current = null;
    } else if (pointerRef.current.size === 2) {
      const [a, b] = [...pointerRef.current.values()];
      cubitRef.current = { jarak: Math.hypot(a.x - b.x, a.y - b.y), zoom };
      seretRef.current = null;
    }
  }

  function saatPointerGerak(e) {
    if (!pointerRef.current.has(e.pointerId)) return;
    pointerRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // Dua jari: cubit untuk memperbesar.
    if (pointerRef.current.size >= 2 && cubitRef.current) {
      const [a, b] = [...pointerRef.current.values()];
      const jarak = Math.hypot(a.x - b.x, a.y - b.y);
      const rasio = jarak / cubitRef.current.jarak;
      setZoom(Math.min(ZOOM_MAKS, Math.max(ZOOM_MIN, cubitRef.current.zoom * rasio)));
      return;
    }

    if (!seretRef.current) return;
    setGeser(
      batasi(
        {
          x: seretRef.current.awal.x + (e.clientX - seretRef.current.x),
          y: seretRef.current.awal.y + (e.clientY - seretRef.current.y),
        },
        zoom
      )
    );
  }

  function saatPointerLepas(e) {
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    pointerRef.current.delete(e.pointerId);
    if (pointerRef.current.size < 2) cubitRef.current = null;
    if (pointerRef.current.size === 0) {
      seretRef.current = null;
    } else {
      // Satu jari masih menempel: lanjutkan sebagai geseran dari posisi kini.
      const [sisa] = [...pointerRef.current.values()];
      seretRef.current = { x: sisa.x, y: sisa.y, awal: geser };
    }
  }

  function saatRoda(e) {
    if (!gambar) return;
    const langkah = e.deltaY > 0 ? -0.12 : 0.12;
    setZoom((z) => Math.min(ZOOM_MAKS, Math.max(ZOOM_MIN, z + langkah)));
  }

  /* --- Hasilkan gambar akhir --- */
  function simpan() {
    if (!gambar) return;
    setSibuk(true);
    try {
      const kanvas = document.createElement("canvas");
      kanvas.width = KELUARAN;
      kanvas.height = KELUARAN;
      const ctx = kanvas.getContext("2d");

      /* Latar putih: JPEG tidak punya alfa, dan tanpa ini bagian transparan
         PNG berubah jadi hitam pekat. */
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, KELUARAN, KELUARAN);
      ctx.imageSmoothingQuality = "high";

      const s = skalaDasar * zoom;
      const lebar = gambar.width * s;
      const tinggi = gambar.height * s;
      // Titik yang sama dengan yang dipakai pratinjau, supaya hasilnya persis
      // seperti yang barusan dilihat.
      const kiri = (KELUARAN - lebar) / 2 + geser.x;
      const atas = (KELUARAN - tinggi) / 2 + geser.y;
      ctx.drawImage(gambar, kiri, atas, lebar, tinggi);

      onSelesai(kanvas.toDataURL("image/jpeg", 0.88));
    } catch (e) {
      setGalat("Gagal memproses gambar. Coba foto lain.");
    } finally {
      setSibuk(false);
    }
  }

  const s = skalaDasar * zoom;

  return (
    <Modal open={open} onClose={onBatal} title="Sesuaikan foto profil" width={420}>
      {galat && <div className="error-box">{galat}</div>}

      <p className="pfoto-petunjuk">
        Seret untuk menggeser, putar roda atau cubit untuk memperbesar. Bagian di dalam lingkaran
        itulah yang akan tersimpan.
      </p>

      <div
        ref={panggungRef}
        className="pfoto-panggung"
        onPointerDown={saatPointerTurun}
        onPointerMove={saatPointerGerak}
        onPointerUp={saatPointerLepas}
        onPointerCancel={saatPointerLepas}
        onWheel={saatRoda}
      >
        {gambar ? (
          <img
            className="pfoto-gambar"
            src={gambar.src}
            alt=""
            draggable="false"
            style={{
              width: gambar.width * s,
              height: gambar.height * s,
              left: (KELUARAN - gambar.width * s) / 2 + geser.x,
              top: (KELUARAN - gambar.height * s) / 2 + geser.y,
            }}
          />
        ) : (
          <div className="pfoto-memuat">Memuat gambar...</div>
        )}
        <div className="pfoto-topeng" aria-hidden="true" />
      </div>

      <div className="pfoto-zoom">
        <Icon name="cari" size={15} />
        <input
          type="range"
          min={ZOOM_MIN}
          max={ZOOM_MAKS}
          step="0.01"
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          aria-label="Perbesar foto"
          disabled={!gambar}
        />
        <span className="pfoto-zoom-nilai">{zoom.toFixed(1)}×</span>
      </div>

      <div className="pfoto-aksi">
        <button type="button" className="btn secondary" onClick={onBatal}>
          Batal
        </button>
        <button type="button" className="btn" onClick={simpan} disabled={!gambar || sibuk}>
          {sibuk ? "Memproses..." : "Pakai foto ini"}
        </button>
      </div>
    </Modal>
  );
}
