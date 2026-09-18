import { useId, useState } from "react";

/**
 * Kotak isian password dengan tombol perlihatkan/sembunyikan.
 *
 * Tanpa ini pengguna mengetik kata sandi sepenuhnya buta — penyebab paling
 * umum "password salah" padahal cuma salah ketik satu huruf, dan paling terasa
 * di HP. Tombolnya punya nama yang bisa dibaca pembaca layar dan status
 * aria-pressed, bukan sekadar ikon.
 */
export default function PasswordInput({
  value,
  onChange,
  autoComplete = "current-password",
  placeholder,
  minLength,
  required,
  name,
  id,
  disabled,
  ...rest
}) {
  const [shown, setShown] = useState(false);
  const generatedId = useId();
  const inputId = id || generatedId;

  return (
    <div className="password-field">
      <input
        {...rest}
        id={inputId}
        name={name}
        type={shown ? "text" : "password"}
        value={value}
        onChange={onChange}
        autoComplete={autoComplete}
        placeholder={placeholder}
        minLength={minLength}
        required={required}
        disabled={disabled}
      />
      <button
        type="button"
        className="password-toggle"
        onClick={() => setShown((v) => !v)}
        aria-pressed={shown}
        aria-controls={inputId}
        aria-label={shown ? "Sembunyikan password" : "Perlihatkan password"}
        title={shown ? "Sembunyikan password" : "Perlihatkan password"}
        disabled={disabled}
      >
        {shown ? (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 3l18 18M10.6 10.7a2 2 0 0 0 2.8 2.8" />
            <path d="M9.4 5.2A9.5 9.5 0 0 1 12 4.9c5 0 9 4.4 10 7.1a13 13 0 0 1-3 4.2M6.2 7.1A13.7 13.7 0 0 0 2 12c1 2.7 5 7.1 10 7.1 1.4 0 2.7-.3 3.9-.9" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M2 12s3.8-7.1 10-7.1S22 12 22 12s-3.8 7.1-10 7.1S2 12 2 12Z" />
            <circle cx="12" cy="12" r="2.6" />
          </svg>
        )}
      </button>
    </div>
  );
}
