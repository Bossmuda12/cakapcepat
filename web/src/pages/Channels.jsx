import { useEffect, useState } from "react";
import { api } from "../api";
import Modal from "../components/Modal";

const emptyForm = {
  label: "",
  phoneNumberId: "",
  accessToken: "",
  displayPhoneNumber: "",
  ownerUserId: "",
  productId: "",
  departmentId: "",
};

export default function Channels() {
  const [rows, setRows] = useState(null);
  const [users, setUsers] = useState([]);
  const [products, setProducts] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const load = async () => {
    try {
      const [channels, u, p, d] = await Promise.all([
        api.get("/channels"),
        api.get("/users"),
        api.get("/products"),
        api.get("/departments"),
      ]);
      setRows(channels);
      setUsers(u);
      setProducts(p);
      setDepartments(d);
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
      const payload = {
        phoneNumberId: form.phoneNumberId,
        accessToken: form.accessToken,
        label: form.label || undefined,
        displayPhoneNumber: form.displayPhoneNumber || undefined,
        ownerUserId: form.ownerUserId || undefined,
        productId: form.productId || undefined,
        departmentId: form.departmentId || undefined,
      };
      await api.post("/channels", payload);
      setForm(emptyForm);
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const statusBadge = (status) => {
    if (status === "connected") return <span className="badge green">Terhubung</span>;
    if (status === "disconnected") return <span className="badge red">Terputus</span>;
    return <span className="badge yellow">Menunggu</span>;
  };

  return (
    <div>
      <div className="toolbar">
        <div>
          <h1>Nomor WhatsApp</h1>
          <p className="page-subtitle">Setiap CS bisa punya nomor sendiri; produk baru bisa dapat nomor baru.</p>
        </div>
        <button className="btn" onClick={() => setShowForm(true)}>
          + Daftarkan Nomor
        </button>
      </div>

      {error && !showForm && <div className="error-box">{error}</div>}

      <Modal open={showForm} onClose={() => setShowForm(false)} title="Daftarkan nomor WhatsApp baru" width={560}>
        <form onSubmit={onCreate}>
          {error && <div className="error-box">{error}</div>}
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: -4, marginBottom: 16 }}>
            Phone Number ID &amp; Access Token didapat dari Meta Business Manager setelah nomor
            ditambahkan ke WhatsApp Business Account kamu — bukan nomor teleponnya sendiri.
          </p>
          <div className="inline-form">
            <div className="field">
              <label>Label</label>
              <input value={form.label} onChange={update("label")} placeholder="mis. CS Budi - Skincare" />
            </div>
            <div className="field">
              <label>Nomor tampilan</label>
              <input
                value={form.displayPhoneNumber}
                onChange={update("displayPhoneNumber")}
                placeholder="62812xxxxxxx"
              />
            </div>
          </div>
          <div className="inline-form">
            <div className="field">
              <label>Phone Number ID (dari Meta) *</label>
              <input value={form.phoneNumberId} onChange={update("phoneNumberId")} required />
            </div>
            <div className="field">
              <label>Access Token (dari Meta) *</label>
              <input value={form.accessToken} onChange={update("accessToken")} required />
            </div>
          </div>
          <div className="inline-form">
            <div className="field">
              <label>Pemilik (CS)</label>
              <select value={form.ownerUserId} onChange={update("ownerUserId")}>
                <option value="">— tidak ditentukan —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name || u.email}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Produk</label>
              <select value={form.productId} onChange={update("productId")}>
                <option value="">— tidak ditentukan —</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Departemen</label>
              <select value={form.departmentId} onChange={update("departmentId")}>
                <option value="">— tidak ditentukan —</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <button className="btn block" type="submit" disabled={busy}>
            {busy ? "Menyimpan..." : "Simpan Nomor"}
          </button>
        </form>
      </Modal>

      <div className="panel">
        {rows === null ? (
          <div className="loading-block">Memuat...</div>
        ) : rows.length === 0 ? (
          <div className="empty-state">Belum ada nomor WhatsApp terdaftar.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Label</th>
                <th>Nomor</th>
                <th>Status</th>
                <th>Pemilik</th>
                <th>Produk</th>
                <th>Departemen</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.label || "—"}</td>
                  <td>{r.display_phone_number || "—"}</td>
                  <td>{statusBadge(r.status)}</td>
                  <td>{r.owner_name || "—"}</td>
                  <td>{r.product_name || "—"}</td>
                  <td>{r.department_name || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
