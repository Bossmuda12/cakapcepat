import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";

export default function VerifyEmail() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const [status, setStatus] = useState("loading"); // loading | ok | error
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setMessage("Link verifikasi tidak ditemukan.");
      return;
    }
    let cancelled = false;
    api
      .post("/auth/verify-email", { token })
      .then((res) => {
        if (cancelled) return;
        setStatus("ok");
        setMessage(res.message);
      })
      .catch((err) => {
        if (cancelled) return;
        setStatus("error");
        setMessage(err.message || "Gagal memverifikasi email");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="auth-split">
      <div className="auth-visual">
        <div className="auth-visual-content">
          <div className="auth-visual-logo">
            <span className="auth-visual-logo-chip">
              <img src="/logo.png" alt="CakapCepat" />
            </span>
          </div>
          <h1>Hampir selesai</h1>
          <p className="lead">Verifikasi email adalah langkah terakhir sebelum kamu bisa masuk.</p>
        </div>
      </div>

      <div className="auth-form-side">
        <div className="auth-form-card">
          <div className="auth-logo-mobile">
            <img src="/logo.png" alt="CakapCepat" />
          </div>

          {status === "loading" && (
            <>
              <h1 style={{ textAlign: "center" }}>Memverifikasi email...</h1>
              <p className="subtitle" style={{ textAlign: "center" }}>Mohon tunggu sebentar.</p>
            </>
          )}

          {status === "ok" && (
            <>
              <div className="auth-result-icon success">
                <svg viewBox="0 0 24 24">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <h1 style={{ textAlign: "center" }}>Email terverifikasi</h1>
              <p className="subtitle" style={{ textAlign: "center" }}>{message}</p>
              <div className="auth-links">
                <Link to="/">Masuk sekarang</Link>
              </div>
            </>
          )}

          {status === "error" && (
            <>
              <div className="auth-result-icon error">
                <svg viewBox="0 0 24 24">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </div>
              <h1 style={{ textAlign: "center" }}>Verifikasi gagal</h1>
              <p className="subtitle" style={{ textAlign: "center" }}>{message}</p>
              <div className="auth-links">
                <Link to="/">Coba masuk untuk kirim ulang link verifikasi</Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
