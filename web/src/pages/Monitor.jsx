import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, getToken } from "../api";
import { useRealtime } from "../useRealtime";
import DateRangeFilter from "../components/DateRangeFilter";
import { defaultRange } from "../dateRangePresets";

// Batas aman jumlah percakapan yang diambil buat dihitung di sisi klien
// (label channel per CS & jumlah "butuh perhatian") — /conversations/stats
// tidak menyediakan breakdown ini, jadi dihitung sendiri dari daftar
// percakapan terbaru. Kalau total percakapan lebih besar dari ini, angka
// "butuh perhatian" & "AI dijeda" di kartu ringkasan hanya mewakili yang
// termuat, bukan seluruh riwayat.
const CONVERSATIONS_SAMPLE_LIMIT = 200;

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
  const [conversations, setConversations] = useState(null);
  const [channels, setChannels] = useState([]);
  const [closingToday, setClosingToday] = useState(null);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState(false);
  // Rentang tanggal — keluhan pemilik: Monitor tidak bisa dibatasi periodenya.
  // Backend /conversations sekarang benar-benar menyaring lewat from/to.
  const [range, setRange] = useState(defaultRange);

  const load = useCallback(async () => {
    try {
      const today = new Date();
      const y = today.getFullYear();
      const m = String(today.getMonth() + 1).padStart(2, "0");
      const d = String(today.getDate()).padStart(2, "0");
      const todayStr = `${y}-${m}-${d}`;

      const [statsData, convData, channelsData, summaryData] = await Promise.all([
        api.get("/conversations/stats"),
        api.get(
          `/conversations?limit=${CONVERSATIONS_SAMPLE_LIMIT}` +
            (range.from && range.to ? `&from=${range.from}&to=${range.to}` : "")
        ),
        api.get("/channels"),
        api.get(`/orders/summary?from=${todayStr}&to=${todayStr}`),
      ]);
      setStats(statsData);
      setConversations(Array.isArray(convData) ? convData : convData?.items || []);
      setChannels(Array.isArray(channelsData) ? channelsData : channelsData?.items || []);
      setClosingToday(summaryData?.closing?.total ?? 0);
    } catch (err) {
      setError(err.message);
    }
  }, [range.from, range.to]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, [load]);

  useRealtime(() => load());

  const download = async () => {
    setDownloading(true);
    setError("");
    try {
      const res = await fetch("/api/conversations/export.csv", {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (res.status === 401) {
        throw new Error("Sesi login sudah habis. Silakan login ulang.");
      }
      if (!res.ok) throw new Error(`Gagal download percakapan (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "percakapan-cakapcepat.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    } finally {
      setDownloading(false);
    }
  };

  const statusBadge = (status) => {
    if (status === "open") return <span className="badge green">Terbuka</span>;
    if (status === "pending") return <span className="badge yellow">Pending</span>;
    return <span className="badge gray">Tertutup</span>;
  };

  // Nomor WA yang dipegang tiap anggota tim (dari /channels, bukan tebakan).
  const channelLabelsByOwner = {};
  for (const c of channels) {
    if (!c.owner_user_id) continue;
    const label = c.label || c.display_phone_number || "-";
    if (!channelLabelsByOwner[c.owner_user_id]) channelLabelsByOwner[c.owner_user_id] = [];
    channelLabelsByOwner[c.owner_user_id].push(label);
  }

  const attentionRows = (conversations || []).filter((c) => c.needs_attention);
  const aiPausedCount = (conversations || []).filter((c) => c.ai_paused).length;

  const attentionCountByAgent = {};
  for (const c of attentionRows) {
    if (!c.assigned_to) continue;
    attentionCountByAgent[c.assigned_to] = (attentionCountByAgent[c.assigned_to] || 0) + 1;
  }

  const conversationsTotalKnown = conversations !== null;
  const conversationsCapped =
    conversationsTotalKnown && conversations.length >= CONVERSATIONS_SAMPLE_LIMIT;

  return (
    <div>
      <div className="toolbar" style={{ marginBottom: 6 }}>
        <div>
          <h1>Monitor Chat</h1>
          <p className="page-subtitle">
            Pantau semua percakapan CS secara real-time — siapa sedang chat dengan siapa, dan performa tiap CS.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <DateRangeFilter value={range} onChange={setRange} />
          <button className="btn secondary" type="button" disabled={downloading} onClick={download}>
            {downloading ? "Menyiapkan..." : "Ekspor CSV"}
          </button>
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="label">Percakapan Terbuka</div>
          <div className="value">{stats ? stats.openConversations : "-"}</div>
        </div>
        <div className="kpi-card">
          <div className="label">Butuh Perhatian</div>
          <div className="value">{conversations ? attentionRows.length : "-"}</div>
        </div>
        <div className="kpi-card">
          <div className="label">AI Dijeda</div>
          <div className="value">{conversations ? aiPausedCount : "-"}</div>
        </div>
        <div className="kpi-card">
          <div className="label">Closing Hari Ini</div>
          <div className="value">{closingToday === null ? "-" : closingToday}</div>
        </div>
      </div>

      <div className="panel">
        <h2>Performa per Nomor WhatsApp / CS</h2>
        {!stats ? (
          <div className="loading-block">Memuat...</div>
        ) : stats.agents.length === 0 ? (
          <div className="empty-state">Belum ada anggota tim.</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Nama</th>
                  <th>Nomor / Label WhatsApp</th>
                  <th>Chat Terbuka</th>
                  <th>Pesan Hari Ini</th>
                  <th>Butuh Perhatian</th>
                </tr>
              </thead>
              <tbody>
                {stats.agents.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <div>{a.name || "-"}</div>
                      <div className="text-muted" style={{ fontSize: 12 }}>
                        {a.email}
                      </div>
                    </td>
                    <td>
                      {channelLabelsByOwner[a.id] && channelLabelsByOwner[a.id].length > 0 ? (
                        <div className="label-badge-row">
                          {channelLabelsByOwner[a.id].map((label, i) => (
                            <span className="label-badge" key={`${a.id}-${i}`}>
                              {label}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-muted">Belum pegang nomor</span>
                      )}
                    </td>
                    <td>{a.openConversations}</td>
                    <td>{a.messagesToday}</td>
                    <td>{attentionCountByAgent[a.id] || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel">
        <div className="toolbar" style={{ marginBottom: 14 }}>
          <h2 style={{ margin: 0 }}>Chat Butuh Perhatian</h2>
          <Link to="/conversations" className="btn-link">
            Buka halaman Percakapan
          </Link>
        </div>
        {conversations === null ? (
          <div className="loading-block">Memuat...</div>
        ) : attentionRows.length === 0 ? (
          <div className="empty-state">Tidak ada chat yang butuh perhatian saat ini.</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Kontak</th>
                  <th>Nomor WA</th>
                  <th>Ditangani CS</th>
                  <th>Alasan</th>
                  <th>Pesan Terakhir</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {attentionRows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.contact_name || "-"}</td>
                    <td>{r.wa_number}</td>
                    <td>{r.assigned_name || <span className="text-muted">Belum di-assign</span>}</td>
                    <td>{r.attention_reason || <span className="text-muted">-</span>}</td>
                    <td>{formatTime(r.last_message_at)}</td>
                    <td>
                      <Link to="/conversations" className="btn-link">
                        Buka
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {conversationsCapped && (
          <div className="field-hint" style={{ marginTop: 10 }}>
            Data di atas dihitung dari {CONVERSATIONS_SAMPLE_LIMIT} percakapan paling baru (bukan seluruh
            riwayat) — buka halaman Percakapan untuk melihat semuanya.
          </div>
        )}
      </div>

      <div className="panel">
        <h2>Semua Percakapan (Live)</h2>
        {conversations === null ? (
          <div className="loading-block">Memuat...</div>
        ) : conversations.length === 0 ? (
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
                {conversations.map((r) => (
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
