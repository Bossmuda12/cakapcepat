import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../AuthContext";
import ModernClock from "../components/ModernClock";
import DateRangeFilter from "../components/DateRangeFilter";
import { defaultRange, presetLabel } from "../dateRangePresets";

const ICONS = {
  channels:
    "M3 5a2 2 0 0 1 2-2h3.28a1 1 0 0 1 .95.68l1.5 4.5a1 1 0 0 1-.29 1.05L8.5 10.5a11 11 0 0 0 5 5l1.27-1.94a1 1 0 0 1 1.05-.29l4.5 1.5a1 1 0 0 1 .68.95V19a2 2 0 0 1-2 2h-1C10.4 21 3 13.6 3 4Z",
  conversations:
    "M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z",
  contacts:
    "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  products: "M20 7 12 3 4 7m16 0-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4",
  departments:
    "M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6M9 9h.01M15 9h.01M9 12h.01M15 12h.01",
  messages: "M4 4h16v12H7l-3 3V4Z",
};

function Icon({ path }) {
  return (
    <span className="kpi-icon-chip" aria-hidden="true">
      <svg viewBox="0 0 24 24" className="kpi-icon">
        <path d={path} />
      </svg>
    </span>
  );
}

/**
 * Cincin progres murni SVG — tanpa pustaka grafik dan tanpa berkas dari luar,
 * supaya lolos Content-Security-Policy yang hanya mengizinkan sumber sendiri.
 * Angkanya SELALU dari database; kalau penyebutnya nol, cincin ditampilkan
 * kosong dan diberi keterangan, bukan diisi angka karangan.
 */
function ProgressRing({ value, total, label, caption, tone = "cyan" }) {
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const ratio = total > 0 ? Math.min(1, Math.max(0, value / total)) : 0;
  const percent = total > 0 ? Math.round(ratio * 100) : null;

  return (
    <div className={`ring-stat tone-${tone}`}>
      <svg viewBox="0 0 130 130" className="ring-svg" role="img" aria-label={`${label}: ${value} dari ${total}`}>
        <circle className="ring-track" cx="65" cy="65" r={radius} />
        <circle
          className="ring-value"
          cx="65"
          cy="65"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - ratio)}
        />
      </svg>
      <div className="ring-center">
        <strong>{percent === null ? "–" : `${percent}%`}</strong>
        <span>{label}</span>
      </div>
      <p className="ring-caption">{caption}</p>
    </div>
  );
}

/**
 * Batang perbandingan dari data nyata. Panjang batang relatif terhadap nilai
 * terbesar di daftar — bukan skala yang dikarang. Kalau semua nol, batangnya
 * kosong dan ada keterangan jelas.
 */
function CompareBars({ items }) {
  const max = Math.max(1, ...items.map((i) => Number(i.value) || 0));
  const semuaNol = items.every((i) => !Number(i.value));
  return (
    <div className="compare-bars">
      {items.map((i, index) => (
        <div className="compare-row" key={i.label}>
          <span className="compare-label">{i.label}</span>
          <span className="compare-track">
            <span
              className={`compare-fill tone-${i.tone}`}
              style={{ width: `${((Number(i.value) || 0) / max) * 100}%`, animationDelay: `${index * 70}ms` }}
            />
          </span>
          <span className="compare-value">{i.value}</span>
        </div>
      ))}
      {semuaNol && (
        <p className="compare-empty">
          Belum ada data pada periode ini — batang akan terisi sendiri begitu percakapan masuk.
        </p>
      )}
    </div>
  );
}

/**
 * Kalau satu angka tidak ikut terkirim (versi API lebih lama, atau field baru
 * belum ada), tampilkan 0 — bukan tulisan "undefined" di tengah dashboard,
 * yang terbaca seperti aplikasi rusak padahal cuma satu field kosong.
 */
const STAT_KEYS = [
  "channels",
  "channelsConnected",
  "conversations",
  "openConversations",
  "messagesSent",
  "contacts",
  "products",
  "departments",
];

function normalizeStats(data) {
  const out = { ...(data || {}) };
  for (const k of STAT_KEYS) {
    const n = Number(out[k]);
    out[k] = Number.isFinite(n) ? n : 0;
  }
  return out;
}

export default function Overview() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [range, setRange] = useState(defaultRange());
  const [stats, setStats] = useState(null);
  const [error, setError] = useState("");
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setError("");
      try {
        const data = await api.get(`/stats/overview?from=${range.from}&to=${range.to}`);
        if (!cancelled) setStats(normalizeStats(data));
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [range.from, range.to, reloadTick]);

  const namaSapaan = (user?.username || user?.name || user?.email || "").split(" ")[0] || "";
  const jam = new Date().getHours();
  const salam = jam < 11 ? "Selamat pagi" : jam < 15 ? "Selamat siang" : jam < 19 ? "Selamat sore" : "Selamat malam";

  const kpis = useMemo(
    () =>
      stats
        ? [
            { tone: "cyan", to: "/channels", icon: ICONS.channels, label: "Nomor WhatsApp", value: stats.channels, sub: `${stats.channelsConnected} terhubung` },
            { tone: "violet", to: "/conversations", icon: ICONS.conversations, label: `Percakapan (${presetLabel(range.preset)})`, value: stats.conversations, sub: `${stats.openConversations} masih terbuka` },
            { tone: "blue", to: "/conversations", icon: ICONS.messages, label: "Pesan Terkirim", value: stats.messagesSent },
            { tone: "green", to: "/contacts", icon: ICONS.contacts, label: "Kontak Baru", value: stats.contacts },
            { tone: "amber", to: "/products", icon: ICONS.products, label: "Produk", value: stats.products },
            { tone: "pink", to: "/departments", icon: ICONS.departments, label: "Departemen", value: stats.departments },
          ]
        : [],
    [stats, range.preset]
  );

  return (
    <div className="overview-page">
      {/* ---------- Pita hero: satu-satunya tempat animasi besar ---------- */}
      <section className="dash-hero">
        <div className="dash-hero-aurora" aria-hidden="true">
          <span className="aurora a1" />
          <span className="aurora a2" />
          <span className="aurora a3" />
        </div>
        <div className="dash-hero-grid" aria-hidden="true" />
        <div className="dash-hero-orbits" aria-hidden="true">
          <span className="orbit o1" />
          <span className="orbit o2" />
          <span className="orbit o3" />
        </div>

        <div className="dash-hero-inner">
          <div className="dash-hero-text">
            <span className="dash-pill">
              <span className="dash-pill-dot" aria-hidden="true" />
              Ringkasan langsung dari database
            </span>
            <h1>
              {salam}
              {namaSapaan ? `, ${namaSapaan}` : ""}.
            </h1>
            <p>
              Semua nomor, percakapan, dan pesanan Anda dalam satu layar. Angka di bawah mengikuti
              rentang waktu yang Anda pilih.
            </p>
          </div>

          <div className="dash-hero-side">
            <ModernClock />
          </div>
        </div>

      </section>

      {/* Kartu kaca yang menumpuk di tepi bawah pita — sengaja DI LUAR <section>
          supaya tidak terpotong overflow:hidden milik pita. */}
      {stats && (
        <div className="dash-float-row">
            <button type="button" className="dash-float-card" onClick={() => navigate("/conversations")}>
              <span className="dash-float-label">Percakapan {presetLabel(range.preset)}</span>
              <strong className="dash-float-value">{stats.conversations}</strong>
              <span className="dash-float-sub">{stats.openConversations} masih terbuka</span>
              <span className="dash-float-spark" aria-hidden="true">
                <i /><i /><i /><i /><i />
              </span>
            </button>
            <button type="button" className="dash-float-card" onClick={() => navigate("/channels")}>
              <span className="dash-float-label">Nomor terhubung</span>
              <strong className="dash-float-value">
                {stats.channelsConnected}
                <small>/{stats.channels}</small>
              </strong>
              <span className="dash-float-sub">
                {stats.channels === 0
                  ? "Belum ada nomor terdaftar"
                  : stats.channelsConnected === stats.channels
                    ? "Semua nomor aktif"
                    : "Ada nomor yang perlu disambungkan"}
              </span>
              <span className={`dash-float-status ${stats.channels > 0 && stats.channelsConnected === stats.channels ? "ok" : "warn"}`} aria-hidden="true" />
            </button>
            <button type="button" className="dash-float-card" onClick={() => navigate("/orders-list")}>
              <span className="dash-float-label">Pesan terkirim</span>
              <strong className="dash-float-value">{stats.messagesSent}</strong>
              <span className="dash-float-sub">Balasan manusia &amp; AI digabung</span>
              <span className="dash-float-wave" aria-hidden="true" />
            </button>
          </div>
        )}

      <div className="toolbar dash-toolbar">
        <div />
        <DateRangeFilter value={range} onChange={setRange} />
      </div>

      {error && (
        <div className="error-box" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <span>{error}</span>
          <button className="btn secondary" type="button" onClick={() => setReloadTick((t) => t + 1)}>
            Coba lagi
          </button>
        </div>
      )}
      {!stats && !error && <div className="loading-block">Memuat data...</div>}

      {stats && (
        <>
          <div className="kpi-grid">
            {kpis.map((k) => (
              <button type="button" key={k.label} className={`kpi-card clickable tone-${k.tone}`} onClick={() => navigate(k.to)}>
                <span className="kpi-live-dot" title="Data langsung" aria-hidden="true" />
                <Icon path={k.icon} />
                <div className="label">{k.label}</div>
                <div className="value">{k.value}</div>
                <div className="label sub">{k.sub || " "}</div>
              </button>
            ))}
          </div>

          <div className="dash-insight-grid">
            <div className="panel dash-panel">
              <h2>Seberapa banyak yang masih terbuka</h2>
              <p className="dash-panel-lead">
                Bagian percakapan yang belum ditutup pada rentang waktu ini. Angkanya dihitung dari
                tabel percakapan, bukan perkiraan.
              </p>
              <ProgressRing
                value={stats.openConversations}
                total={stats.conversations}
                label="masih terbuka"
                tone="cyan"
                caption={
                  stats.conversations === 0
                    ? "Belum ada percakapan pada rentang ini."
                    : `${stats.openConversations} dari ${stats.conversations} percakapan belum ditutup.`
                }
              />
            </div>

            <div className="panel dash-panel">
              <h2>Perbandingan isi akun</h2>
              <p className="dash-panel-lead">
                Panjang batang dibandingkan terhadap angka terbesar di daftar ini.
              </p>
              <CompareBars
                items={[
                  { label: "Percakapan", value: stats.conversations, tone: "violet" },
                  { label: "Pesan terkirim", value: stats.messagesSent, tone: "blue" },
                  { label: "Kontak", value: stats.contacts, tone: "green" },
                  { label: "Produk", value: stats.products, tone: "amber" },
                  { label: "Nomor WhatsApp", value: stats.channels, tone: "cyan" },
                ]}
              />
            </div>
          </div>
        </>
      )}

      {stats && !stats.channels && (
        <div className="panel">
          <h2>Langkah selanjutnya</h2>
          <p style={{ fontSize: 13.5, color: "var(--text-muted)", lineHeight: 1.6 }}>
            Isi kredensial WhatsApp Business API (Phone Number ID &amp; Access Token dari Meta) lalu
            daftarkan nomor pertama kamu di halaman <b>Nomor WhatsApp</b> supaya percakapan &amp;
            broadcast bisa mulai berjalan.
          </p>
        </div>
      )}
    </div>
  );
}
