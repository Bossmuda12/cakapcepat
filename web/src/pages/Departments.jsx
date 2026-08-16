import { useEffect, useState } from "react";
import { api } from "../api";
import Modal from "../components/Modal";

export default function Departments() {
  const [rows, setRows] = useState(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);

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
      setShowForm(false);
      await load();
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
          <h1>Departemen</h1>
          <p className="page-subtitle">Pengelompokan tim, mis. Sales, Customer Service, Marketing.</p>
        </div>
        <button className="btn" onClick={() => setShowForm(true)}>
          + Tambah Departemen
        </button>
      </div>

      {error && !showForm && <div className="error-box">{error}</div>}

      <Modal open={showForm} onClose={() => setShowForm(false)} title="Tambah departemen baru">
        <form onSubmit={onCreate}>
          {error && <div className="error-box">{error}</div>}
          <div className="field">
            <label>Nama departemen</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="mis. Customer Service"
              autoFocus
              required
            />
          </div>
          <button className="btn block" type="submit" disabled={busy}>
            {busy ? "Menyimpan..." : "Simpan"}
          </button>
        </form>
      </Modal>

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
