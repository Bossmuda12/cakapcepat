import { useState } from "react";
import { useAuth } from "../AuthContext";

export default function Bootstrap() {
  const { bootstrap } = useAuth();
  const [form, setForm] = useState({
    organizationName: "",
    ownerName: "",
    ownerEmail: "",
    password: "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const update = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await bootstrap(form);
    } catch (err) {
      setError(err.message || "Gagal setup awal");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <h1>Setup Awal CakapCepat</h1>
        <p className="subtitle">
          Ini baru pertama kali dijalankan. Buat organization &amp; akun owner kamu.
        </p>
        {error && <div className="error-box">{error}</div>}
        <form onSubmit={onSubmit}>
          <div className="field">
            <label>Nama Organisasi / Tim</label>
            <input value={form.organizationName} onChange={update("organizationName")} required />
          </div>
          <div className="field">
            <label>Nama Kamu</label>
            <input value={form.ownerName} onChange={update("ownerName")} required />
          </div>
          <div className="field">
            <label>Email</label>
            <input type="email" value={form.ownerEmail} onChange={update("ownerEmail")} required />
          </div>
          <div className="field">
            <label>Password (min. 8 karakter)</label>
            <input
              type="password"
              value={form.password}
              onChange={update("password")}
              minLength={8}
              required
            />
          </div>
          <button className="btn block" type="submit" disabled={busy}>
            {busy ? "Memproses..." : "Buat Akun & Masuk"}
          </button>
        </form>
      </div>
    </div>
  );
}
