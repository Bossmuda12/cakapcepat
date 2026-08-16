import { useEffect, useState } from "react";

const DAY_NAMES = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const MONTH_NAMES = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

function pad2(n) {
  return String(n).padStart(2, "0");
}

const RADIUS = 34;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * Jam dashboard versi modern & minimalis: cincin progres tipis untuk detik,
 * plus waktu digital besar di sebelahnya. Menggantikan versi "classic"
 * (angka Romawi) sebelumnya — lebih bersih dan pas untuk tampilan SaaS modern.
 */
export default function ModernClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const hours24 = now.getHours();
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const minutes = now.getMinutes();
  const seconds = now.getSeconds();

  const secondsProgress = seconds / 60;
  const dashOffset = CIRCUMFERENCE * (1 - secondsProgress);

  return (
    <div className="modern-clock panel">
      <div className="modern-clock-ring-wrap">
        <svg viewBox="0 0 80 80" className="modern-clock-ring">
          <circle cx="40" cy="40" r={RADIUS} className="modern-clock-ring-track" />
          <circle
            cx="40"
            cy="40"
            r={RADIUS}
            className="modern-clock-ring-progress"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={dashOffset}
          />
        </svg>
        <div className="modern-clock-ring-label">{pad2(hours12)}</div>
      </div>
      <div className="modern-clock-digital">
        <div className="modern-clock-time">
          {pad2(hours24)}
          <span className="modern-clock-colon">:</span>
          {pad2(minutes)}
          <span className="modern-clock-seconds">:{pad2(seconds)}</span>
        </div>
        <div className="modern-clock-date">
          {DAY_NAMES[now.getDay()]}, {now.getDate()} {MONTH_NAMES[now.getMonth()]} {now.getFullYear()}
        </div>
      </div>
    </div>
  );
}
