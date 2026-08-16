import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";

const FEATURES = [
  "Setup dalam hitungan menit, langsung bisa dipakai tim kamu",
  "Cocok untuk bisnis kecil sampai yang punya banyak nomor WhatsApp",
  "Data organisasi kamu terpisah & aman dari pengguna lain",
  "Verifikasi email sekali, akun kamu langsung siap dipakai",
];

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export default function Register() {
  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  const update = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (form.password !== form.confirmPassword) {
      setError("Konfirmasi password tidak cocok");
      return;
    }
    setBusy(true);
    try {
      const res = await api.post("/auth/register", form);
      setDone(res);
    } catch (err) {
      setError(err.message || "Gagal mendaftar");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-split">
      <div className="auth-visual">
        <div className="auth-visual-content">
          <div className="auth-visual-logo">
            <span className="auth-visual-logo-chip">
              <img src="/logo.png" alt="CakapCepat" />
            </span>
          </div>
          <h1>Mulai otomasi WhatsApp bisnismu hari ini</h1>
          <p className="lead">
            Daftar gratis, verifikasi email, dan dashboard CakapCepat kamu langsung siap dipakai.
          </p>
          <ul className="auth-feature-list">
            {FEATURES.map((f) => (
              <li key={f}>
                <span className="auth-feature-check">
                  <CheckIcon />
                </span>
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="auth-form-side">
        <div className="auth-form-card">
          <div className="auth-logo-mobile">
            <img src="/logo.png" alt="CakapCepat" />
          </div>

          {done ? (
            <>
              <div className="auth-result-icon success">
                <svg viewBox="0 0 24 24">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <h1 style={{ textAlign: "center" }}>Cek email kamu</h1>
              <p className="subtitle" style={{ textAlign: "center" }}>{done.message}</p>
              <div className="auth-links">
                <Link to="/">Kembali ke halaman masuk</Link>
              </div>
            </>
          ) : (
            <>
              <h1>Buat akun CakapCepat</h1>
              <p className="subtitle">Gratis untuk mulai, tanpa kartu kredit</p>
              {error && <div className="error-box">{error}</div>}
              <form onSubmit={onSubmit}>
                <div className="field">
                  <label>Nama</label>
                  <input value={form.name} onChange={update("name")} required />
                </div>
                <div className="field">
                  <label>No HP</label>
                  <input
                    type="tel"
                    value={form.phone}
                    onChange={update("phone")}
                    placeholder="08xxxxxxxxxx"
                    required
                  />
                </div>
                <div className="field">
                  <label>Gmail</label>
                  <input type="email" value={form.email} onChange={update("email")} required />
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
                <div className="field">
                  <label>Konfirmasi Password</label>
                  <input
                    type="password"
                    value={form.confirmPassword}
                    onChange={update("confirmPassword")}
                    minLength={8}
                    required
                  />
                </div>
                <button className="btn block" type="submit" disabled={busy}>
                  {busy ? "Memproses..." : "Daftar"}
                </button>
              </form>
              <div className="auth-links">
                Sudah punya akun? <Link to="/">Masuk di sini</Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
