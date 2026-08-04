import { useEffect, useState } from "react";
import { api } from "../api";

export default function Conversations() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .get("/conversations")
      .then(setRows)
      .catch((err) => setError(err.message));
  }, []);

  const statusBadge = (status) => {
    if (status === "open") return <span className="badge green">Terbuka</span>;
    if (status === "pending") return <span className="badge yellow">Pending</span>;
    return <span className="badge gray">Tertutup</span>;
  };

  return (
    <div>
      <h1>Percakapan</h1>
      <p className="page-subtitle">
        Inbox semua chat WhatsApp masuk. Kirim/terima pesan real-time perlu nomor WA yang sudah
        terhubung ke Meta.
      </p>

      {error && <div className="error-box">{error}</div>}

      <div className="panel">
        {rows === null ? (
          <div className="loading-block">Memuat...</div>
        ) : rows.length === 0 ? (
          <div className="empty-state">
            Belum ada percakapan. Percakapan akan muncul otomatis begitu ada pesan masuk dari nomor
            WhatsApp yang sudah terhubung.
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Kontak</th>
                <th>Nomor WA</th>
                <th>Status</th>
                <th>Tahap</th>
                <th>Pesan terakhir</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.contact_name || "—"}</td>
                  <td>{r.wa_number}</td>
                  <td>{statusBadge(r.status)}</td>
                  <td>{r.pipeline_stage}</td>
                  <td>{r.last_message_at ? new Date(r.last_message_at).toLocaleString("id-ID") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
