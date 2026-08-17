import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../AuthContext";
import { setToken } from "../api";

/**
 * Halaman transit setelah user selesai login lewat Google/Facebook.
 * Backend redirect ke sini dengan ?token=... (JWT yang sama seperti hasil
 * /auth/login biasa) — kita simpan ke localStorage lalu refresh AuthContext
 * supaya seluruh app (Layout, Gate, dst) langsung tahu user sudah login,
 * baru pindah ke dashboard.
 */
export default function OAuthCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { refresh } = useAuth();

  useEffect(() => {
    const token = searchParams.get("token");
    if (!token) {
      navigate("/?oauthError=" + encodeURIComponent("Token login tidak ditemukan."));
      return;
    }
    setToken(token);
    refresh().then(() => navigate("/", { replace: true }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="auth-split">
      <div className="auth-form-side" style={{ width: "100%" }}>
        <div className="auth-form-card" style={{ textAlign: "center" }}>
          <p className="subtitle">Menyelesaikan proses masuk...</p>
        </div>
      </div>
    </div>
  );
}
