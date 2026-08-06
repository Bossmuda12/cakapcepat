import { useEffect, useState } from "react";
import { api } from "../api";

const emptyForm = { title: "", content: "", productId: "" };

export default function KnowledgeBase() {
  const [rows, setRows] = useState(null);
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const load = async () => {
    try {
      const [kb, p] = await Promise.all([api.get("/knowledge-base"), api.get("/products")]);
      setRows(kb);
      setProducts(p);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const update = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const onCreate = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.post("/knowledge-base", {
        title: form.title,
        content: form.content,
        productId: form.productId || undefined,
      });
      setForm(emptyForm);
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id) => {
    try {
      await api.del(`/knowledge-base/${id}`);
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div>
      <div className="toolbar">
        <div>
          <h1>Knowledge Base</h1>
          <p className="page-subtitle">
            Materi yang dipakai AI chatbot untuk menjawab chat otomatis (aktifkan lewat aturan
            "Fallback ke AI" di halaman Otomatisasi).
          </p>
        </div>
        <button className="btn" onClick={() => setShowForm((s) => !s)}>
          {showForm ? "Batal" : "+ Tambah Materi"}
        </button>
      </div>

      {error && <div className="error-box">{error}</div>}

      {showForm && (
        <form className="panel" onSubmit={onCreate}>
          <h2>Materi baru</h2>
          <div className="inline-form">
            <div className="field">
              <label>Judul</label>
              <input value={form.title} onChange={update("title")} placeholder="mis. Kebijakan Retur" required />
            </div>
            <div className="field">
              <label>Produk (opsional)</label>
              <select value={form.productId} onChange={update("productId")}>
                <option value="">Umum — semua produk</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="field">
            <label>Isi</label>
            <textarea rows={5} value={form.content} onChange={update("content")} required />
          </div>
          <button className="btn" type="submit" disabled={busy}>
            {busy ? "Menyimpan..." : "Simpan"}
          </button>
        </form>
      )}

      <div className="panel">
        {rows === null ? (
          <div className="loading-block">Memuat...</div>
        ) : rows.length === 0 ? (
          <div className="empty-state">Belum ada materi knowledge base.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Judul</th>
                <th>Produk</th>
                <th>Isi</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.title}</td>
                  <td>{r.product_name || "Umum"}</td>
                  <td style={{ maxWidth: 360, color: "var(--text-muted)" }}>
                    {r.content.length > 140 ? r.content.slice(0, 140) + "…" : r.content}
                  </td>
                  <td>
                    <button className="btn secondary" onClick={() => remove(r.id)}>
                      Hapus
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
