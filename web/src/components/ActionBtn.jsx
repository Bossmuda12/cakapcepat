import Icon from "./Icon";

/**
 * Tombol aksi baris tabel (Edit / Hapus / Lihat / Simpan ...).
 *
 * Dulu semuanya memakai .btn-link — teks biru bergaris bawah tanpa ikon, mirip
 * tautan HTML mentah. Di daftar pesanan atau produk yang panjang, "Edit" dan
 * "Hapus" jadi sulit dibedakan sekilas dan tidak terbaca sebagai bagian dari
 * tema situs. Komponen ini memberi ikon tetap per jenis aksi + warna nada:
 * netral untuk aksi biasa, merah untuk aksi merusak.
 */
const KIND = {
  edit: { icon: "sunting", label: "Edit" },
  hapus: { icon: "hapus", label: "Hapus", tone: "danger" },
  lihat: { icon: "lihat", label: "Lihat" },
  tambah: { icon: "tambah", label: "Tambah" },
  simpan: { icon: "simpan", label: "Simpan" },
  batal: { icon: "tutup", label: "Batal" },
  salin: { icon: "salin", label: "Salin" },
  segar: { icon: "segar", label: "Muat ulang" },
};

export default function ActionBtn({
  kind = "edit",
  children,
  className = "",
  iconOnly = false,
  tone,
  ...rest
}) {
  const spec = KIND[kind] || KIND.edit;
  const label = children ?? spec.label;
  const finalTone = tone || spec.tone || "netral";
  return (
    <button
      type="button"
      className={`act-btn act-${finalTone} ${iconOnly ? "act-icon-only" : ""} ${className}`.trim()}
      aria-label={iconOnly ? (typeof label === "string" ? label : spec.label) : undefined}
      title={iconOnly ? (typeof label === "string" ? label : spec.label) : undefined}
      {...rest}
    >
      <Icon name={spec.icon} size={15} />
      {!iconOnly && <span>{label}</span>}
    </button>
  );
}
