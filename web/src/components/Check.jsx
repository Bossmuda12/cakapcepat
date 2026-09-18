import { useId } from "react";
import Icon from "./Icon";

/**
 * Kotak centang bertema.
 *
 * <input type="checkbox"> bawaan browser digambar oleh sistem operasi — biru
 * macOS di satu perangkat, abu-abu Windows di perangkat lain — jadi tidak
 * pernah cocok dengan tema situs dan langsung terbaca "template mentah".
 * Di sini input aslinya disembunyikan (tetap ada demi keyboard & pembaca
 * layar), lalu kotaknya digambar sendiri dengan centang SVG milik kita.
 */
export default function Check({ checked, onChange, label, disabled = false, id, ...rest }) {
  const auto = useId();
  const inputId = id || auto;
  return (
    <span className={`chk ${disabled ? "chk-disabled" : ""}`.trim()}>
      <input
        id={inputId}
        type="checkbox"
        className="chk-input"
        checked={Boolean(checked)}
        onChange={onChange}
        disabled={disabled}
        {...rest}
      />
      <label htmlFor={inputId} className="chk-label">
        <span className="chk-box" aria-hidden="true">
          <Icon name="centang" size={13} strokeWidth={2.6} />
        </span>
        {label != null && <span className="chk-text">{label}</span>}
      </label>
    </span>
  );
}
