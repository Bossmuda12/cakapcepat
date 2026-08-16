import { useEffect, useState } from "react";

const DAY_NAMES = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const MONTH_NAMES = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

function pad2(n) {
  return String(n).padStart(2, "0");
}

/**
 * Jam analog bergaya klasik (bezel bulat, angka Romawi, jarum hitam & merah)
 * ditambah tanggal/waktu digital di bawahnya. Update tiap detik lewat
 * setInterval — cukup ringan karena cuma re-render satu komponen kecil.
 */
export default function ClassicClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const hours = now.getHours() % 12;
  const minutes = now.getMinutes();
  const seconds = now.getSeconds();

  const hourAngle = hours * 30 + minutes * 0.5;
  const minuteAngle = minutes * 6 + seconds * 0.1;
  const secondAngle = seconds * 6;

  const romanNumerals = ["XII", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI"];

  return (
    <div className="classic-clock panel">
      <div className="classic-clock-face-wrap">
        <svg viewBox="0 0 200 200" className="classic-clock-face">
          <circle cx="100" cy="100" r="96" className="clock-rim-outer" />
          <circle cx="100" cy="100" r="88" className="clock-rim-inner" />
          {romanNumerals.map((label, i) => {
            const angle = (i * 30 * Math.PI) / 180;
            const x = 100 + 70 * Math.sin(angle);
            const y = 100 - 70 * Math.cos(angle);
            return (
              <text key={label} x={x} y={y} className="clock-numeral" textAnchor="middle" dominantBaseline="middle">
                {label}
              </text>
            );
          })}
          {Array.from({ length: 60 }).map((_, i) => {
            const angle = (i * 6 * Math.PI) / 180;
            const isHour = i % 5 === 0;
            const outer = 82;
            const inner = isHour ? 74 : 78;
            const x1 = 100 + outer * Math.sin(angle);
            const y1 = 100 - outer * Math.cos(angle);
            const x2 = 100 + inner * Math.sin(angle);
            const y2 = 100 - inner * Math.cos(angle);
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} className={isHour ? "clock-tick-hour" : "clock-tick-minute"} />;
          })}
          <line
            x1="100" y1="100"
            x2={100 + 45 * Math.sin((hourAngle * Math.PI) / 180)}
            y2={100 - 45 * Math.cos((hourAngle * Math.PI) / 180)}
            className="clock-hand-hour"
          />
          <line
            x1="100" y1="100"
            x2={100 + 62 * Math.sin((minuteAngle * Math.PI) / 180)}
            y2={100 - 62 * Math.cos((minuteAngle * Math.PI) / 180)}
            className="clock-hand-minute"
          />
          <line
            x1="100" y1="100"
            x2={100 + 68 * Math.sin((secondAngle * Math.PI) / 180)}
            y2={100 - 68 * Math.cos((secondAngle * Math.PI) / 180)}
            className="clock-hand-second"
          />
          <circle cx="100" cy="100" r="4.5" className="clock-center-pin" />
        </svg>
      </div>
      <div className="classic-clock-digital">
        <div className="classic-clock-time">
          {pad2(now.getHours())}:{pad2(minutes)}:{pad2(seconds)}
        </div>
        <div className="classic-clock-date">
          {DAY_NAMES[now.getDay()]}, {now.getDate()} {MONTH_NAMES[now.getMonth()]} {now.getFullYear()}
        </div>
      </div>
    </div>
  );
}
