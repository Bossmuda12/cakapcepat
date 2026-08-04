import { useEffect, useState } from "react";
import { api } from "../api";

export default function Overview() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [departments, products, channels, contacts, conversations] = await Promise.all([
          api.get("/departments"),
          api.get("/products"),
          api.get("/channels"),
          api.get("/contacts"),
          api.get("/conversations"),
        ]);
        if (cancelled) return;
        setStats({
          departments: departments.length,
          products: products.length,
          channels: channels.length,
          channelsConnected: channels.filter((c) => c.status === "connected").length,
          contacts: contacts.length,
          conversations: conversations.length,
          openConversations: conversations.filter((c) => c.status === "open").length,
        });
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <h1>Overview</h1>
      <p className="page-subtitle">Ringkasan CakapCepat — data langsung dari database.</p>

      {error && <div className="error-box">{error}</div>}
      {!stats && !error && <div className="loading-block">Memuat data...</div>}

      {stats && (
        <div className="kpi-grid">
          <div className="kpi-card">
            <div className="label">Nomor WhatsApp</div>
            <div className="value">{stats.channels}</div>
            <div className="label">{stats.channelsConnected} terhubung</div>
          </div>
          <div className="kpi-card">
            <div className="label">Percakapan</div>
            <div className="value">{stats.conversations}</div>
            <div className="label">{stats.openConversations} masih terbuka</div>
          </div>
          <div className="kpi-card">
            <div className="label">Kontak</div>
            <div className="value">{stats.contacts}</div>
          </div>
          <div className="kpi-card">
            <div className="label">Produk</div>
            <div className="value">{stats.products}</div>
          </div>
          <div className="kpi-card">
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
