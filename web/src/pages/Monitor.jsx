import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { useRealtime } from "../useRealtime";

function formatTime(ts) {
  if (!ts) return "-";
  return new Date(ts).toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function Monitor() {
  const [stats, setStats] = useState(null);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [statsData, convData] = await Promise.all([
        api.get("/conversations/stats"),
        api.get("/conversations"),
      ]);
      setStats(statsData);
      setRows(convData);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, [load]);

  useRealtime(() => load());

  const statusBadge = (status) => {
    if (status === "open") return <span className="badge green">Terbuka</span>;
    if (status === "pending") return <span className="badge yellow">Pending</span>;
    return <span className="badge gray">Tertutup</span>;
  };

  return (
    <div>
      <h1>Monitor Chat</h1>
      <p className="page-subtitle">
        Pantau semua percakapan CS secara real-time — siapa sedang chat dengan siapa, dan performa tiap CS.
      </p>

      {error && <div className="error-box">{error}</div>}

      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="label">Percakapan Terbuka</div>
          <div className="value">{stats ? stats.openConversations : "-"}</div>
        </div>
        <div className="kpi-card">
          <div className="label">Pending</div>
          <div className="value">{stats ? stats.pendingConversations : "-"}</div>
        </div>
        <div className="kpi-card">
          <div className="label">Pesan Hari Ini</div>
          <div className="value">{stats ? stats.messagesToday : "-"}</div>
        </div>
        <div className="kpi-card">
          <div className="label">Total Closing</div>
          <div className="value">{stats ? stats.closingWonTotal : "-"}</div>
        </div>
      </div>

      <div className="panel">
        <h2>Performa per CS</h2>
        {!stats ? (
          <div className="loading-block">Memuat...</div>
        ) : stats.agents.length === 0 ? (
          <div className="empty-state">Belum ada anggota tim.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Nama</th>
                <th>Email</th>
                <th>Chat Terbuka</th>
                <th>Pesan Hari Ini</th>
              </tr>
            </thead>
            <tbody>
              {stats.agents.map((a) => (
                <tr key={a.id}>
                  <td>{a.name || "-"}</td>
                  <td>{a.email}</td>
                  <td>{a.openConversations}</td>
                  <td>{a.messagesToday}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <h2>Semua Percakapan (Live)</h2>
        {rows === null ? (
          <div className="loading-block">Memuat...</div>
        ) : rows.length === 0 ? (
          <div className="empty-state">Belum ada percakapan.</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Kontak</th>
                  <th>Nomor WA</th>
                  <th>Ditangani CS</th>
                  <th>Status</th>
                  <th>Sumber</th>
                  <th>Pesan Terakhir</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.contact_name || "-"}</td>
                    <td>{r.wa_number}</td>
                    <td>{r.assigned_name || <span className="text-muted">Belum di-assign</span>}</td>
                    <td>{statusBadge(r.status)}</td>
                    <td>{r.ctwa_clid ? <span className="badge yellow">Iklan CTWA</span> : "-"}</td>
                    <td>{formatTime(r.last_message_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
