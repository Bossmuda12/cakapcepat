import { useEffect, useState } from "react";
import { api } from "../api";

export default function Departments() {
  const [rows, setRows] = useState(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      setRows(await api.get("/departments"));
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const onCreate = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError("");
    try {
      await api.post("/departments", { name });
      setName("");
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h1>Departemen</h1>
      <p className="page-subtitle">Pengelompokan tim, mis. Sales, Customer Service, Marketing.</p>

      {error && <div className="error-box">{error}</div>}

      <form className="inline-form" onSubmit={onCreate}>
        <div className="field">
          <label>Nama departemen baru</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="mis. Customer Service" />
        </div>
        <button className="btn" type="submit" disabled={busy}>
          Tambah
        </button>
      </form>

      <div className="panel">
        {rows === null ? (
          <div className="loading-block">Memuat...</div>
        ) : rows.length === 0 ? (
          <div className="empty-state">Belum ada departemen.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Nama</th>
                <th>Jumlah Nomor WA</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td>{r.channel_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
