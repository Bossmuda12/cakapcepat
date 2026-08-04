import { useEffect, useState } from "react";
import { api } from "../api";
import { useAuth } from "../AuthContext";

const emptyForm = { name: "", email: "", password: "", role: "agent" };

export default function Team() {
  const { user } = useAuth();
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const canManage = user?.role === "owner" || user?.role === "admin";

  const load = async () => {
    try {
      setRows(await api.get("/users"));
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
      await api.post("/users", form);
      setForm(emptyForm);
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
          <h1>Tim</h1>
          <p className="page-subtitle">Anggota tim yang bisa masuk ke CakapCepat.</p>
        </div>
        {canManage && (
          <button className="btn" onClick={() => setShowForm((s) => !s)}>
            {showForm ? "Batal" : "+ Tambah Anggota"}
          </button>
        )}
      </div>

      {error && <div className="error-box">{error}</div>}

      {showForm && (
        <form className="panel" onSubmit={onCreate}>
          <h2>Tambah anggota tim baru</h2>
          <div className="inline-form">
            <div className="field">
              <label>Nama</label>
              <input value={form.name} onChange={update("name")} required />
            </div>
            <div className="field">
              <label>Email</label>
              <input type="email" value={form.email} onChange={update("email")} required />
            </div>
          </div>
          <div className="inline-form">
            <div className="field">
              <label>Password sementara (min. 8 karakter)</label>
              <input
                type="password"
                value={form.password}
                onChange={update("password")}
                minLength={8}
                required
              />
            </div>
            <div className="field">
              <label>Peran</label>
              <select value={form.role} onChange={update("role")}>
                <option value="agent">Agent (CS)</option>
                <option value="admin">Admin</option>
                <option value="owner">Owner</option>
              </select>
            </div>
          </div>
          <button className="btn" type="submit" disabled={busy}>
            {busy ? "Menyimpan..." : "Simpan"}
          </button>
        </form>
      )}

      <div className="panel">
        {rows === null ? (
          <div className="loading-block">Memuat...</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Nama</th>
                <th>Email</th>
                <th>Peran</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.name || "—"}</td>
                  <td>{r.email}</td>
                  <td>
                    <span className="badge">{r.role}</span>
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
