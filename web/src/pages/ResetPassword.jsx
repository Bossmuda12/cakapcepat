import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (password !== confirmPassword) {
      setError("Konfirmasi password tidak cocok");
      return;
    }
    setBusy(true);
    try {
      await api.post("/auth/reset-password", { token, password, confirmPassword });
      setDone(true);
    } catch (err) {
      setError(err.message || "Gagal reset password");
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
          <h1>Buat password baru</h1>
          <p className="lead">Pastikan password barumu kuat dan mudah kamu ingat.</p>
        </div>
      </div>

      <div className="auth-form-side">
        <div className="auth-form-card">
          <div className="auth-logo-mobile">
            <img src="/logo.png" alt="CakapCepat" />
          </div>

          {!token ? (
            <>
              <div className="auth-result-icon error">
                <svg viewBox="0 0 24 24">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </div>
              <h1 style={{ textAlign: "center" }}>Link tidak valid</h1>
              <p className="subtitle" style={{ textAlign: "center" }}>
                Link reset password tidak ditemukan. Minta link baru lewat halaman lupa password.
              </p>
              <div className="auth-links">
                <Link to="/forgot-password">Minta link reset baru</Link>
              </div>
            </>
          ) : done ? (
            <>
              <div className="auth-result-icon success">
                <svg viewBox="0 0 24 24">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <h1 style={{ textAlign: "center" }}>Password berhasil diganti</h1>
              <p className="subtitle" style={{ textAlign: "center" }}>
                Silakan masuk dengan password baru kamu.
              </p>
              <div className="auth-links">
                <Link to="/">Ke halaman masuk</Link>
              </div>
            </>
          ) : (
            <>
              <h1>Buat password baru</h1>
              <p className="subtitle">Minimal 8 karakter</p>
              {error && <div className="error-box">{error}</div>}
              <form onSubmit={onSubmit}>
                <div className="field">
                  <label>Password baru</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    minLength={8}
                    required
                  />
                </div>
                <div className="field">
                  <label>Konfirmasi password baru</label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    minLength={8}
                    required
                  />
                </div>
                <button className="btn block" type="submit" disabled={busy}>
                  {busy ? "Memproses..." : "Simpan Password Baru"}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
