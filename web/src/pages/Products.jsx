import { useEffect, useState } from "react";
import { api } from "../api";

export default function Products() {
  const [rows, setRows] = useState(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      setRows(await api.get("/products"));
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
      await api.post("/products", { name });
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
      <h1>Produk</h1>
      <p className="page-subtitle">Lini bisnis/produk — tiap produk baru biasanya dapat nomor WA & CS sendiri.</p>

      {error && <div className="error-box">{error}</div>}

      <form className="inline-form" onSubmit={onCreate}>
        <div className="field">
          <label>Nama produk baru</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="mis. Skincare Line" />
        </div>
        <button className="btn" type="submit" disabled={busy}>
          Tambah
        </button>
      </form>

      <div className="panel">
        {rows === null ? (
          <div className="loading-block">Memuat...</div>
        ) : rows.length === 0 ? (
          <div className="empty-state">Belum ada produk.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Nama</th>
                <th>Status</th>
                <th>Jumlah Nomor WA</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td>
                    <span className={`badge ${r.is_active ? "green" : "gray"}`}>
                      {r.is_active ? "Aktif" : "Nonaktif"}
                    </span>
                  </td>
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
