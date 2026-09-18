/**
 * Satu set ikon garis buatan sendiri untuk seluruh website.
 *
 * Kenapa bukan pustaka ikon (lucide/heroicons/font-awesome)?
 * Content-Security-Policy situs ini sudah dikunci ke script-src 'self' — tidak
 * ada CDN, tidak ada font ikon dari luar. Jadi ikon digambar langsung sebagai
 * <svg> inline: aman CSP, ikut warna tema lewat currentColor, dan tidak ada
 * berkas tambahan yang harus diunduh pengunjung.
 *
 * Semua ikon dipakai dengan gaya yang sama (stroke 1.75, ujung membulat)
 * supaya tidak terlihat seperti tempelan template mentah.
 */

const PATHS = {
  cari: ["M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z", "m20 20-3.6-3.6"],
  centang: ["m5 12.5 4.5 4.5L19 7"],
  sunting: ["M4 20h4.5L19 9.5a2.1 2.1 0 0 0-3-3L5.5 17 4 20Z", "m14.5 8 3 3"],
  hapus: [
    "M4.5 7h15",
    "M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7",
    "M6.5 7 7.4 19a1.8 1.8 0 0 0 1.8 1.7h5.6a1.8 1.8 0 0 0 1.8-1.7L17.5 7",
    "M10.5 11v5.5M13.5 11v5.5",
  ],
  tambah: ["M12 5v14M5 12h14"],
  tutup: ["m6 6 12 12M18 6 6 18"],
  simpan: ["M5 4h11l3 3v13H5V4Z", "M8.5 4v5h6V4", "M8 13h8v7H8v-7Z"],
  lihat: ["M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z", "M12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6Z"],
  sembunyi: ["M3 3l18 18", "M10.2 10.3a2.8 2.8 0 0 0 3.6 3.9", "M6.2 6.5C3.9 8.2 2.5 12 2.5 12s3.5 6.5 9.5 6.5c1.6 0 3-.4 4.2-1M9.8 5.8A8.9 8.9 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.6 3.5"],
  pengguna: ["M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z", "M4.5 20.5a7.5 7.5 0 0 1 15 0"],
  keluar: ["M14.5 4H6a1.5 1.5 0 0 0-1.5 1.5v13A1.5 1.5 0 0 0 6 20h8.5", "M17 8.5 20.5 12 17 15.5", "M20.5 12H10"],
  gir: [
    "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z",
    "M4.6 14.2a1.6 1.6 0 0 0-1.5-1H3v-2.4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1 1.7-1.7.1.1a1.6 1.6 0 0 0 1.8.3 1.6 1.6 0 0 0 1-1.5V3h2.4v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1 1.7 1.7-.1.1a1.6 1.6 0 0 0-.3 1.8 1.6 1.6 0 0 0 1.5 1H21v2.4h-.1a1.6 1.6 0 0 0-1.5 1 1.6 1.6 0 0 0 .3 1.8l.1.1-1.7 1.7-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21h-2.4v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1-1.7-1.7.1-.1a1.6 1.6 0 0 0 .3-1.8Z",
  ],
  lonceng: ["M12 3.5a5.5 5.5 0 0 0-5.5 5.5c0 4.2-1.5 5.5-1.5 5.5h14s-1.5-1.3-1.5-5.5A5.5 5.5 0 0 0 12 3.5Z", "M10.3 18a1.9 1.9 0 0 0 3.4 0"],
  matahari: ["M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z", "M12 2.5v2M12 19.5v2M4.2 4.2l1.5 1.5M18.3 18.3l1.5 1.5M2.5 12h2M19.5 12h2M4.2 19.8l1.5-1.5M18.3 5.7l1.5-1.5"],
  bulan: ["M20 14.2A8.4 8.4 0 0 1 9.8 4 8.5 8.5 0 1 0 20 14.2Z"],
  panah: ["m9 5 7 7-7 7"],
  menu: ["M4 7h16M4 12h16M4 17h16"],
  saring: ["M4 5h16l-6.2 7.3v5.4L10.2 20v-7.7L4 5Z"],
  muat: ["M12 4v4M12 16v4M4 12h4M16 12h4M6.3 6.3l2.8 2.8M14.9 14.9l2.8 2.8M6.3 17.7l2.8-2.8M14.9 9.1l2.8-2.8"],
  segar: ["M20 12a8 8 0 1 1-2.6-5.9", "M20 4v4h-4"],
  peringatan: ["M12 4 2.8 20h18.4L12 4Z", "M12 10v4.5M12 17.4v.1"],
  salin: ["M9 9h10v11H9V9Z", "M15 9V4H5v11h4"],
};

export default function Icon({ name, size = 18, className = "", strokeWidth = 1.75, ...rest }) {
  const paths = PATHS[name];
  if (!paths) return null;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={`ico ${className}`.trim()}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

export const ICON_NAMES = Object.keys(PATHS);
