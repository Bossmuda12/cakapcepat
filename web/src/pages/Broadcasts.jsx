import { useEffect, useState } from "react";
import { api } from "../api";

export default function Broadcasts() {
  const [channels, setChannels] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastCreated, setLastCreated] = useState(null);
  const [form, setForm] = useState({
    channelId: "",
    name: "",
    templateName: "",
    targetLabel: "",
  });

  useEffect(() => {
    api
      .get("/channels")
      .then(setChannels)
      .catch((err) => setError(err.message));
  }, []);

  const update = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const onSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    setLastCreated(null);
    try {
      const res = await api.post("/broadcasts", {
        channelId: form.channelId,
        name: form.name,
        templateName: form.templateName,
        targetLabel: form.targetLabel || undefined,
      });
      setLastCreated(res);
      setForm({ channelId: "", name: "", templateName: "", targetLabel: "" });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h1>Broadcast</h1>
      <p className="page-subtitle">
        Kirim pesan massal pakai WhatsApp message template lewat salah satu nomor terdaftar.
      </p>

      {error && <div className="error-box">{error}</div>}
      {lastCreated && (
        <div className="panel" style={{ borderColor: "#bbf7d0", background: "#f0fdf4" }}>
          Broadcast dibuat &amp; masuk antrian (status: {lastCreated.status}). Pengiriman aktual
          butuh nomor WhatsApp yang sudah terhubung ke Meta.
        </div>
      )}

      <form className="panel" onSubmit={onSubmit}>
        <h2>Buat broadcast baru</h2>
        <div className="inline-form">
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
        </div>
        <div className="inline-form">
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
        </div>
        <button className="btn" type="submit" disabled={busy}>
          {busy ? "Membuat..." : "Buat & Kirim Broadcast"}
        </button>
      </form>
    </div>
  );
}
