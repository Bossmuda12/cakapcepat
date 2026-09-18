import { useEffect, useState } from "react";

/**
 * Tema terang/gelap dipakai di dua tempat sekaligus: sakelar lama di menu
 * samping dan sakelar baru di dasbor utama. Tanpa satu sumber kebenaran,
 * menekan yang satu membuat yang lain menampilkan status yang salah. Kunci
 * penyimpanannya tetap sama seperti sebelumnya supaya pilihan pengguna lama
 * tidak hilang.
 */
const THEME_KEY = "cakapcepat_theme";
const THEME_EVENT = "cakapcepat:theme";

export function readTheme() {
  try {
    return localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* mode privat: tema tetap berlaku untuk sesi ini */
  }
  window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: theme }));
}

export function useTheme() {
  const [theme, setThemeState] = useState(readTheme);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    const onChange = (e) => setThemeState(e.detail === "dark" ? "dark" : "light");
    window.addEventListener(THEME_EVENT, onChange);
    return () => window.removeEventListener(THEME_EVENT, onChange);
  }, []);

  const toggleTheme = () => setTheme(theme === "light" ? "dark" : "light");

  return { theme, toggleTheme };
}
