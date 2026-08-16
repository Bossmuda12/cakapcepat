import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await api.post("/auth/forgot-password", { email });
      setDone(res);
    } catch (err) {
      setError(err.message || "Gagal mengirim link reset");
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
          <h1>Lupa password? Nggak masalah.</h1>
          <p className="lead">
            Masukkan email akun kamu, kami kirim link untuk bikin password baru.
          </p>
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
              <h1>Lupa password</h1>
              <p className="subtitle">Masukkan email akun CakapCepat kamu</p>
              {error && <div className="error-box">{error}</div>}
              <form onSubmit={onSubmit}>
                <div className="field">
                  <label>Email</label>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                </div>
                <button className="btn block" type="submit" disabled={busy}>
                  {busy ? "Mengirim..." : "Kirim Link Reset"}
                </button>
              </form>
              <div className="auth-links">
                <Link to="/">Kembali ke halaman masuk</Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
