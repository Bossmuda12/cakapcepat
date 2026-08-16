import { useEffect, useState } from "react";
import { api } from "../api";
import ModernClock from "../components/ModernClock";
import DateRangeFilter from "../components/DateRangeFilter";
import { defaultRange } from "../dateRangePresets";

function Icon({ path }) {
  return (
    <svg viewBox="0 0 24 24" className="kpi-icon">
      <path d={path} />
    </svg>
  );
}

const ICONS = {
  channels: "M3 5a2 2 0 0 1 2-2h3.28a1 1 0 0 1 .95.68l1.5 4.5a1 1 0 0 1-.29 1.05L8.5 10.5a11 11 0 0 0 5 5l1.27-1.94a1 1 0 0 1 1.05-.29l4.5 1.5a1 1 0 0 1 .68.95V19a2 2 0 0 1-2 2h-1C10.4 21 3 13.6 3 4Z",
  conversations: "M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z",
  contacts: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  products: "M20 7 12 3 4 7m16 0-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4",
  departments: "M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6M9 9h.01M15 9h.01M9 12h.01M15 12h.01",
  messages: "M4 4h16v12H7l-3 3V4Z",
};

export default function Overview() {
  const [range, setRange] = useState(defaultRange());
  const [stats, setStats] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setError("");
      try {
        const data = await api.get(`/stats/overview?from=${range.from}&to=${range.to}`);
        if (!cancelled) setStats(data);
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [range.from, range.to]);

  return (
    <div>
      <div className="overview-header">
        <div>
          <h1>Overview</h1>
          <p className="page-subtitle">Ringkasan CakapCepat — data langsung dari database.</p>
        </div>
        <ModernClock />
      </div>

      <div className="toolbar" style={{ marginBottom: 18 }}>
        <div />
        <DateRangeFilter value={range} onChange={setRange} />
      </div>

      {error && <div className="error-box">{error}</div>}
      {!stats && !error && <div className="loading-block">Memuat data...</div>}

      {stats && (
        <div className="kpi-grid">
          <div className="kpi-card">
            <Icon path={ICONS.channels} />
            <div className="label">Nomor WhatsApp</div>
            <div className="value">{stats.channels}</div>
            <div className="label">{stats.channelsConnected} terhubung</div>
          </div>
          <div className="kpi-card">
            <Icon path={ICONS.conversations} />
            <div className="label">Percakapan ({range.preset === "custom" ? "custom" : range.preset === "today" ? "hari ini" : range.preset === "yesterday" ? "kemarin" : range.preset === "week" ? "minggu ini" : "bulan ini"})</div>
            <div className="value">{stats.conversations}</div>
            <div className="label">{stats.openConversations} masih terbuka</div>
          </div>
          <div className="kpi-card">
            <Icon path={ICONS.messages} />
            <div className="label">Pesan Terkirim</div>
            <div className="value">{stats.messagesSent}</div>
          </div>
          <div className="kpi-card">
            <Icon path={ICONS.contacts} />
            <div className="label">Kontak Baru</div>
            <div className="value">{stats.contacts}</div>
          </div>
          <div className="kpi-card">
            <Icon path={ICONS.products} />
            <div className="label">Produk</div>
            <div className="value">{stats.products}</div>
          </div>
          <div className="kpi-card">
            <Icon path={ICONS.departments} />
            <div className="label">Departemen</div>
            <div className="value">{stats.departments}</div>
          </div>
        </div>
      )}

      <div className="panel">
        <h2>Langkah selanjutnya</h2>
        <p style={{ fontSize: 13.5, color: "var(--text-muted)", lineHeight: 1.6 }}>
          Isi kredensial WhatsApp Business API (Phone Number ID &amp; Access Token dari Meta) lalu
          daftarkan nomor pertama kamu di halaman <b>Nomor WhatsApp</b> supaya percakapan &amp;
          broadcast bisa mulai berjalan.
        </p>
      </div>
    </div>
  );
}
