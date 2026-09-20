import { useEffect, useRef } from "react";

/**
 * Modal popup umum — dipakai untuk form "tambah data" di berbagai halaman
 * supaya tampilannya modern (bukan panel inline yang mendorong konten lain).
 *
 * MENUTUP HANYA KALAU KLIKNYA BENAR-BENAR DI LATAR
 *
 * Dulu latarnya menutup pada `onClick` apa pun. Sebuah klik dihitung di
 * elemen LELUHUR TERDEKAT yang sama antara tempat tombol ditekan dan tempat
 * dilepas — jadi menekan di DALAM panel lalu melepas di luarnya tetap
 * menghasilkan klik pada latar, dan dialognya tertutup.
 *
 * Itu bukan kasus langka: menyeret penggeser, menyorot teks, dan menggeser
 * foto di penyesuai avatar semuanya berakhir di luar panel secara wajar.
 * Ketahuan saat menguji penyesuai foto — menyeret foto ke kanan membuang
 * seluruh pekerjaan tanpa peringatan. Sekarang penekanannya harus BERMULA
 * di latar juga.
 */
export default function Modal({ open, onClose, title, children, width }) {
  /* Benar kalau tombol tetikus DITEKAN di latar, bukan di dalam panel. */
  const mulaiDiLatarRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        mulaiDiLatarRef.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && mulaiDiLatarRef.current) onClose();
        mulaiDiLatarRef.current = false;
      }}
    >
      <div
        className="modal-panel"
        style={width ? { maxWidth: width } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>{title}</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Tutup">
            <svg viewBox="0 0 24 24">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
