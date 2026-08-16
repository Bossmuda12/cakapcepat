import { useEffect, useState } from "react";
import { api } from "../api";
import Modal from "../components/Modal";

export default function Products() {
  const [rows, setRows] = useState(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);

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
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (product) => {
    try {
      await api.patch(`/products/${product.id}`, { isActive: !product.is_active });
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div>
      <div className="toolbar">
        <div>
          <h1>Produk</h1>
          <p className="page-subtitle">Lini bisnis/produk — tiap produk baru biasanya dapat nomor WA & CS sendiri.</p>
        </div>
        <button className="btn" onClick={() => setShowForm(true)}>
          + Tambah Produk
        </button>
      </div>

      {error && !showForm && <div className="error-box">{error}</div>}

      <Modal open={showForm} onClose={() => setShowForm(false)} title="Tambah produk baru">
        <form onSubmit={onCreate}>
          {error && <div className="error-box">{error}</div>}
          <div className="field">
            <label>Nama produk</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="mis. Skincare Line"
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
          <div className="empty-state">Belum ada produk.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Nama</th>
                <th>Status</th>
                <th>Jumlah Nomor WA</th>
                <th></th>
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
                  <td>
                    <button className="btn secondary" onClick={() => toggleActive(r)}>
                      {r.is_active ? "Nonaktifkan" : "Aktifkan"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
