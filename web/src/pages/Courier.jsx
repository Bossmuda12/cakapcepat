import { useEffect, useState } from "react";
import { api } from "../api";

function formatDateTime(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function Courier() {
  const [events, setEvents] = useState(null);
  const [error, setError] = useState("");
  const [polling, setPolling] = useState(false);
  const [pollResult, setPollResult] = useState(null);
  const [pollError, setPollError] = useState("");

  const load = async () => {
    try {
      const data = await api.get("/courier/events?limit=100");
      setEvents(data.items || []);
      setError("");
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const runPoll = async () => {
    setPolling(true);
    setPollError("");
    setPollResult(null);
    try {
      const result = await api.post("/courier/poll", {});
      setPollResult(result);
      await load();
    } catch (err) {
      setPollError(err.message);
    } finally {
      setPolling(false);
    }
  };

  return (
    <div>
      <div className="toolbar">
        <div>
          <h1>Kurir</h1>
          <p className="page-subtitle">
            Pantau email/webhook kurir yang masuk dan cocokkan otomatis ke pesanan lewat nomor resi.
          </p>
        </div>
        <button className="btn" type="button" disabled={polling} onClick={runPoll}>
          {polling ? "Memeriksa..." : "Periksa Email Kurir Sekarang"}
        </button>
      </div>

      {pollError && <div className="error-box">{pollError}</div>}
      {pollResult && (
        <div className="success-box" style={{ marginBottom: 18 }}>
          Selesai: {pollResult.processed} email diproses, {pollResult.matched} cocok ke pesanan,{" "}
          {pollResult.skipped} dilewati.
        </div>
      )}

      {error && <div className="error-box">{error}</div>}

      <div className="panel">
        <h2>Riwayat Event Kurir</h2>
        {events === null ? (
          <div className="loading-block">Memuat...</div>
        ) : events.length === 0 ? (
          <div className="empty-state">Belum ada email/webhook kurir yang tercatat.</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Waktu</th>
                  <th>Kurir</th>
                  <th>No Resi</th>
                  <th>Status Mentah</th>
                  <th>Status Terpetakan</th>
                  <th>Sumber</th>
                  <th>Cocok ke Pesanan</th>
                </tr>
              </thead>
              <tbody>
                {events.map((ev) => (
                  <tr key={ev.id}>
                    <td>{formatDateTime(ev.created_at)}</td>
                    <td>{ev.courier || "—"}</td>
                    <td>{ev.tracking_no}</td>
                    <td className="text-muted">{ev.raw_status || "—"}</td>
                    <td>
                      {ev.mapped_status ? <span className="badge gray">{ev.mapped_status}</span> : "—"}
                    </td>
                    <td className="text-muted">{ev.source}</td>
                    <td>
                      {ev.order_id ? (
                        <span className="badge green">{ev.customer_name || ev.customer_phone || "Cocok"}</span>
                      ) : (
                        <span className="badge gray">Tidak cocok</span>
                      )}
                    </td>
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
