import Icon from "./Icon";

/**
 * Kolom pencarian bertema: ikon kaca pembesar milik kita di kiri, tombol
 * bersihkan di kanan yang cuma muncul kalau ada isinya. type="search" bawaan
 * menampilkan tombol silang gaya browser yang berbeda-beda di tiap perangkat —
 * itu yang membuat kolom pencarian terlihat generik, jadi di CSS tombol bawaan
 * itu dimatikan dan diganti tombol ini.
 */
export default function SearchField({ value, onChange, placeholder = "Cari...", className = "", ...rest }) {
  return (
    <div className={`search-field ${className}`.trim()}>
      <Icon name="cari" size={16} className="search-field-ico" />
      <input
        type="search"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        aria-label={placeholder}
        {...rest}
      />
      {value ? (
        <button
          type="button"
          className="search-field-clear"
          onClick={() => onChange({ target: { value: "" } })}
          aria-label="Bersihkan pencarian"
        >
          <Icon name="tutup" size={14} strokeWidth={2.2} />
        </button>
      ) : null}
    </div>
  );
}
