import { useEffect, useState } from "react";
import { api } from "../api";
import Modal from "../components/Modal";
import DateRangeFilter from "../components/DateRangeFilter";
import { defaultRange } from "../dateRangePresets";

function statusBadge(status) {
  if (status === "done") return <span className="badge green">Selesai</span>;
  if (status === "failed") return <span className="badge red">Gagal</span>;
  if (status === "sending") return <span className="badge yellow">Mengirim</span>;
  return <span className="badge gray">{status}</span>;
}

export default function Broadcasts() {
  const [channels, setChannels] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [range, setRange] = useState(defaultRange());
  const [history, setHistory] = useState(null);
  const [form, setForm] = useState({
    channelId: "",
    name: "",
    templateName: "",
    targetLabel: "",
  });

  const loadHistory = () => {
    api
      .get(`/broadcasts?from=${range.from}&to=${range.to}`)
      .then(setHistory)
      .catch((err) => setError(err.message));
  };

  useEffect(() => {
    api
      .get("/channels")
      .then(setChannels)
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from, range.to]);

  const update = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const onSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.post("/broadcasts", {
        channelId: form.channelId,
        name: form.name,
        templateName: form.templateName,
        targetLabel: form.targetLabel || undefined,
      });
      setForm({ channelId: "", name: "", templateName: "", targetLabel: "" });
      setShowForm(false);
      loadHistory();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="toolbar">
        <div>
          <h1>Broadcast</h1>
          <p className="page-subtitle">
            Kirim pesan massal pakai WhatsApp message template lewat salah satu nomor terdaftar.
          </p>
        </div>
        <button className="btn" onClick={() => setShowForm(true)}>
          + Buat Broadcast
        </button>
      </div>

      {error && !showForm && <div className="error-box">{error}</div>}

      <Modal open={showForm} onClose={() => setShowForm(false)} title="Buat broadcast baru">
        <form onSubmit={onSubmit}>
          {error && <div className="error-box">{error}</div>}
          <div className="field">
            <label>Nama campaign</label>
            <input value={form.name} onChange={update("name")} required />
          </div>
          <div className="field">
            <label>Kirim dari nomor</label>
            <select value={form.channelId} onChange={update("channelId")} required>
              <option value="">Pilih nomor WA...</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label || c.display_phone_number || c.id}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Nama template WhatsApp</label>
            <input
              value={form.templateName}
              onChange={update("templateName")}
              placeholder="mis. promo_agustus"
              required
            />
          </div>
          <div className="field">
            <label>Target label kontak (opsional)</label>
            <input value={form.targetLabel} onChange={update("targetLabel")} placeholder="mis. vip" />
          </div>
          <button className="btn block" type="submit" disabled={busy}>
            {busy ? "Membuat..." : "Buat & Kirim Broadcast"}
          </button>
        </form>
      </Modal>

      <div className="panel">
        <div className="toolbar" style={{ marginBottom: 14 }}>
          <h2 style={{ margin: 0 }}>Riwayat Broadcast</h2>
          <DateRangeFilter value={range} onChange={setRange} />
        </div>
        {!history ? (
          <div className="loading-block">Memuat...</div>
        ) : history.length === 0 ? (
          <div className="empty-state">Belum ada broadcast pada rentang tanggal ini.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Nama</th>
                <th>Nomor Pengirim</th>
                <th>Template</th>
                <th>Status</th>
                <th>Terkirim / Total</th>
                <th>Dibuat</th>
              </tr>
            </thead>
            <tbody>
              {history.map((b) => (
                <tr key={b.id}>
                  <td>{b.name}</td>
                  <td>{b.channel_label || b.display_phone_number || "—"}</td>
                  <td>{b.template_name}</td>
                  <td>{statusBadge(b.status)}</td>
                  <td>
                    {b.sent_count}/{b.total_count}
                    {Number(b.failed_count) > 0 && (
                      <span className="badge red" style={{ marginLeft: 6 }}>
                        {b.failed_count} gagal
                      </span>
                    )}
                  </td>
                  <td>{new Date(b.created_at).toLocaleString("id-ID")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
