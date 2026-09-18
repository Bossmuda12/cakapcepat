import { useEffect, useRef, useState } from "react";

/**
 * Pemilih emoji ringkas — sengaja TIDAK memakai pustaka pihak ketiga:
 * paket emoji picker populer berukuran ratusan kilobyte dan banyak yang
 * mengambil gambar dari CDN luar, sementara halaman ini berjalan di bawah
 * Content-Security-Policy yang hanya mengizinkan sumber dari domain sendiri.
 * Daftar di bawah memakai emoji bawaan sistem, jadi nol berkas tambahan.
 */
const GROUPS = [
  {
    nama: "Sering dipakai",
    ikon: "🕒",
    isi: ["🙏", "👍", "😊", "😁", "🙂", "❤️", "🔥", "✅", "🙌", "😍", "😅", "🤝", "💪", "📦", "🚚", "💰", "🎉", "⭐", "📸", "📝"],
  },
  {
    nama: "Wajah",
    ikon: "😀",
    isi: ["😀", "😃", "😄", "😁", "😆", "😅", "😂", "🙂", "🙃", "😉", "😊", "😇", "🥰", "😍", "😘", "😋", "😎", "🤩", "🥳", "🤗", "🤔", "🤨", "😐", "😑", "😶", "🙄", "😏", "😴", "😮", "😯", "😥", "😢", "😭", "😤", "😠", "🤒", "🤧", "😇"],
  },
  {
    nama: "Tangan & orang",
    ikon: "👍",
    isi: ["👍", "👎", "👌", "✌️", "🤞", "🤝", "👏", "🙌", "🙏", "💪", "✍️", "👋", "☝️", "👉", "👈", "🫶", "🤲", "👤", "👥", "🧕", "🧑‍💼", "👩‍💻"],
  },
  {
    nama: "Jualan",
    ikon: "📦",
    isi: ["📦", "🚚", "🛵", "✈️", "🏠", "🏪", "💰", "💵", "💳", "🧾", "🏷️", "🛒", "🎁", "📱", "📲", "📞", "☎️", "📧", "🕐", "📅", "📍", "🗺️", "⭐", "✅", "❌", "⚠️", "🔥", "🎉", "💯", "📝", "📄", "📸", "🔖", "💬"],
  },
  {
    nama: "Lainnya",
    ikon: "❤️",
    isi: ["❤️", "🧡", "💛", "💚", "💙", "💜", "🤍", "🖤", "💔", "✨", "🌟", "🌸", "🌹", "🍀", "☀️", "🌙", "☁️", "🌧️", "🍔", "☕", "🍵", "🧃", "🎯", "🏆", "🔔", "🔒", "🔑", "💡", "♻️", "🆗", "🆕", "🔝"],
  },
];

export default function EmojiPicker({ onPick, onClose }) {
  const [tab, setTab] = useState(0);
  const boxRef = useRef(null);

  useEffect(() => {
    const onDown = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) onClose?.();
    };
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div className="emoji-picker" ref={boxRef} role="dialog" aria-label="Pilih emoji">
      <div className="emoji-tabs">
        {GROUPS.map((g, i) => (
          <button
            key={g.nama}
            type="button"
            className={`emoji-tab ${i === tab ? "active" : ""}`}
            onClick={() => setTab(i)}
            title={g.nama}
            aria-label={g.nama}
            aria-pressed={i === tab}
          >
            {g.ikon}
          </button>
        ))}
      </div>
      <div className="emoji-grid">
        {GROUPS[tab].isi.map((e) => (
          <button key={e} type="button" className="emoji-cell" onClick={() => onPick(e)} aria-label={`Emoji ${e}`}>
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}
