import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../AuthContext";
import { api } from "../api";

const FEATURES = [
  "Balas & kelola semua percakapan WhatsApp dalam satu dashboard",
  "AI Hot Leads otomatis pilah calon pembeli paling potensial",
  "Laporan harian otomatis lewat WhatsApp, tiap pagi tanpa kamu minta",
  "Broadcast, tim, dan produk — semua rapi dalam satu tempat",
];

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path fill="#4285F4" d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.63h6.47a5.53 5.53 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.57-5.17 3.57-8.81Z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.95-2.92l-3.88-3c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.26v3.1A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.27 14.27a7.2 7.2 0 0 1 0-4.54v-3.1H1.26a12 12 0 0 0 0 10.74l4.01-3.1Z" />
      <path fill="#EA4335" d="M12 4.75c1.76 0 3.34.6 4.58 1.79l3.44-3.44C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.69 1.26 6.63l4.01 3.1C6.22 6.86 8.87 4.75 12 4.75Z" />
    </svg>
  );
}

function FacebookIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path fill="#1877F2" d="M24 12.07C24 5.68 18.63.5 12 .5S0 5.68 0 12.07c0 5.77 4.39 10.56 10.13 11.43v-8.09H7.08v-3.34h3.05V9.41c0-3 1.8-4.67 4.55-4.67 1.32 0 2.7.23 2.7.23v2.94h-1.52c-1.5 0-1.97.92-1.97 1.87v2.24h3.36l-.54 3.34h-2.82v8.09C19.61 22.63 24 17.84 24 12.07Z" />
    </svg>
  );
}

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [needsVerification, setNeedsVerification] = useState(false);
  const [resendMessage, setResendMessage] = useState("");
  const [resending, setResending] = useState(false);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setNeedsVerification(false);
    setBusy(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err.message || "Gagal login");
      if (err.status === 403) setNeedsVerification(true);
    } finally {
      setBusy(false);
    }
  };

  const onResend = async () => {
    setResending(true);
    setResendMessage("");
    try {
      const res = await api.post("/auth/resend-verification", { email });
      setResendMessage(res.message);
    } catch (err) {
      setResendMessage(err.message || "Gagal mengirim ulang");
    } finally {
      setResending(false);
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
          <h1>Otomasi WhatsApp yang bikin bisnis kamu jalan sendiri</h1>
          <p className="lead">
            Satu dashboard untuk percakapan, broadcast, tim, dan laporan AI harian —
            dipakai bisnis dari berbagai ukuran, siap dipakai siapa saja.
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
          <h1>Masuk ke CakapCepat</h1>
          <p className="subtitle">Otomasi WhatsApp untuk tim kamu</p>

          {error && (
            <div className="error-box">
              {error}
              {needsVerification && (
                <>
                  {" "}
                  <button
                    type="button"
                    onClick={onResend}
                    disabled={resending}
                    style={{ background: "none", border: "none", padding: 0, color: "inherit", textDecoration: "underline", cursor: "pointer", fontSize: "inherit" }}
                  >
                    {resending ? "Mengirim..." : "Kirim ulang verifikasi?"}
                  </button>
                </>
              )}
            </div>
          )}
          {resendMessage && <div className="notice-box">{resendMessage}</div>}

          <form onSubmit={onSubmit}>
            <div className="field">
              <label>Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="field">
              <label>Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <button className="btn block" type="submit" disabled={busy}>
              {busy ? "Memproses..." : "Masuk"}
            </button>
          </form>

          <div className="auth-links">
            <Link to="/forgot-password">Lupa password?</Link>
          </div>
          <div className="auth-links">
            Belum punya akun? <Link to="/register">Daftar di sini</Link>
          </div>

          <div className="auth-divider">atau masuk dengan</div>
          <div className="oauth-buttons">
            <button type="button" className="oauth-btn" disabled title="Segera hadir">
              <GoogleIcon />
              Google
              <span className="oauth-soon">Segera</span>
            </button>
            <button type="button" className="oauth-btn" disabled title="Segera hadir">
              <FacebookIcon />
              Facebook
              <span className="oauth-soon">Segera</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
