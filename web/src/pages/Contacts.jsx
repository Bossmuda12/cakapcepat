import { useEffect, useState } from "react";
import { api } from "../api";

export default function Contacts() {
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState({ waNumber: "", name: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      setRows(await api.get("/contacts"));
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const onCreate = async (e) => {
    e.preventDefault();
    if (!form.waNumber.trim()) return;
    setBusy(true);
    setError("");
    try {
      await api.post("/contacts", { waNumber: form.waNumber, name: form.name || undefined });
      setForm({ waNumber: "", name: "" });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const stageBadge = (stage) => {
    const map = {
      new: "gray",
      contacted: "yellow",
      qualified: "yellow",
      closing_won: "green",
      closing_lost: "red",
    };
    return <span className={`badge ${map[stage] || "gray"}`}>{stage}</span>;
  };

  return (
    <div>
      <h1>Kontak</h1>
      <p className="page-subtitle">Daftar lead/pembeli yang pernah dihubungi lewat WhatsApp.</p>

      {error && <div className="error-box">{error}</div>}

      <form className="inline-form" onSubmit={onCreate}>
        <div className="field">
          <label>Nomor WhatsApp</label>
          <input
            value={form.waNumber}
            onChange={(e) => setForm((f) => ({ ...f, waNumber: e.target.value }))}
            placeholder="62812xxxxxxx"
          />
        </div>
        <div className="field">
          <label>Nama (opsional)</label>
          <input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
        </div>
        <button className="btn" type="submit" disabled={busy}>
          Tambah
        </button>
      </form>

      <div className="panel">
        {rows === null ? (
          <div className="loading-block">Memuat...</div>
        ) : rows.length === 0 ? (
          <div className="empty-state">Belum ada kontak.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Nama</th>
                <th>Nomor WA</th>
                <th>Tahap</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.name || "—"}</td>
                  <td>{r.wa_number}</td>
                  <td>{stageBadge(r.pipeline_stage)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
