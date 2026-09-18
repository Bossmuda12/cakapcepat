import { useCallback, useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import Icon from "../components/Icon";
import PasswordInput from "../components/PasswordInput";
import { platformApi, getPlatformToken, setPlatformToken, clearPlatformToken } from "./api";
import PlatformDashboard from "./PlatformDashboard";
import PlatformTenants from "./PlatformTenants";
import PlatformTenantDetail from "./PlatformTenantDetail";
import PlatformAudit from "./PlatformAudit";
import PlatformAdmins from "./PlatformAdmins";

const NAV = [
  { to: "/superadmin", end: true, label: "Ringkasan", icon: "muat", perm: "platform.dashboard.read" },
  { to: "/superadmin/tenants", label: "Penjual", icon: "pengguna", perm: "platform.tenants.read" },
  { to: "/superadmin/audit", label: "Catatan Audit", icon: "salin", perm: "platform.audit.read" },
  { to: "/superadmin/admins", label: "Staf Platform", icon: "gir", perm: "platform.admins.manage" },
];

function PlatformLogin({ onMasuk }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await platformApi.post("/login", { email, password });
      setPlatformToken(res.token);
      onMasuk(res.admin);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="plat-login">
      <form className="plat-login-card" onSubmit={submit}>
        <div className="plat-badge">
          <Icon name="gir" size={16} />
          <span>Control Plane</span>
        </div>
        <h1>Panel Superadmin</h1>
        <p className="plat-login-sub">
          Panel pengelolaan platform CakapCepat. Akun di sini terpisah dari akun penjual — sesi
          dasbor biasa tidak berlaku di halaman ini.
        </p>
        {error && <div className="error-box">{error}</div>}
        <div className="field">
          <label htmlFor="plat-email">Email staf platform</label>
          <input
            id="plat-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
          />
        </div>
        <div className="field">
          <label htmlFor="plat-pass">Password</label>
          <PasswordInput
            id="plat-pass"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>
        <button className="btn block" type="submit" disabled={busy}>
          {busy ? "Memeriksa..." : "Masuk"}
        </button>
        <p className="plat-login-note">
          Akun staf platform hanya dibuat lewat baris perintah di server
          (<code>npm run platform:admin</code>) — tidak ada pendaftaran mandiri di sini.
        </p>
      </form>
    </div>
  );
}

export default function PlatformApp() {
  const [admin, setAdmin] = useState(null);
  const [loading, setLoading] = useState(true);
  const location = useLocation();

  const muat = useCallback(async () => {
    if (!getPlatformToken()) {
      setAdmin(null);
      setLoading(false);
      return;
    }
    try {
      const me = await platformApi.get("/me");
      setAdmin(me);
    } catch {
      clearPlatformToken();
      setAdmin(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    muat();
  }, [muat]);

  if (loading) return <div className="plat-loading">Memuat panel...</div>;
  if (!admin) return <PlatformLogin onMasuk={(a) => setAdmin(a)} />;

  const izin = new Set(admin.permissions || []);
  const keluar = () => {
    clearPlatformToken();
    setAdmin(null);
  };

  return (
    <div className="plat-shell">
      <aside className="plat-side">
        <div className="plat-side-brand">
          <img src="/logo-light.png" alt="CakapCepat" />
          <span className="plat-side-tag">Control Plane</span>
        </div>
        <nav className="plat-nav">
          {NAV.filter((n) => izin.has(n.perm)).map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? "active" : "")}>
              <Icon name={n.icon} size={16} />
              <span>{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="plat-side-foot">
          <div className="plat-who">
            <div className="plat-who-email">{admin.email}</div>
            <div className="plat-who-role">{admin.role}</div>
          </div>
          <button type="button" className="act-btn" onClick={keluar}>
            <Icon name="keluar" size={15} />
            <span>Keluar</span>
          </button>
        </div>
      </aside>

      <main className="plat-main">
        <div className="plat-warn">
          <Icon name="peringatan" size={15} />
          <span>
            Setiap tindakan di panel ini tercatat permanen beserta alasan dan identitas kamu.
          </span>
        </div>
        <Routes location={location}>
          <Route index element={<PlatformDashboard izin={izin} />} />
          <Route path="tenants" element={<PlatformTenants izin={izin} />} />
          <Route path="tenants/:id" element={<PlatformTenantDetail izin={izin} />} />
          <Route path="audit" element={<PlatformAudit />} />
          <Route path="admins" element={<PlatformAdmins me={admin} />} />
          <Route path="*" element={<Navigate to="/superadmin" replace />} />
        </Routes>
      </main>
    </div>
  );
}
