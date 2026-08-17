import { useState } from "react";
import { api } from "../api";
import { useAuth } from "../AuthContext";

/**
 * Wajib dilewati sekali oleh user yang baru pertama kali daftar lewat
 * Google/Facebook. Saat itu akun dibuat dengan password acak (needs_onboarding
 * = true) — halaman ini minta mereka pastikan nama & username, lalu bikin
 * password asli, seperti alur onboarding website profesional pada umumnya.
 * Gate (App.jsx) yang menahan user di sini sampai selesai.
 */
export default function CompleteProfile() {
  const { user, setUser } = useAuth();
  const [form, setForm] = useState({
    name: user?.name || "",
    username: user?.username || "",
    phone: "",
    password: "",
    confirmPassword: "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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
      const updated = await api.post("/auth/complete-profile", {
        name: form.name,
        username: form.username,
        phone: form.phone,
        password: form.password,
      });
      setUser(updated);
    } catch (err) {
      setError(err.message || "Gagal menyimpan profil");
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
          <h1>Satu langkah lagi sebelum mulai</h1>
          <p className="lead">
            Akun kamu berhasil dibuat lewat {user?.email ? user.email : "akun sosial"}. Lengkapi
            data diri dan buat password sendiri supaya akun kamu lebih aman dan bisa dipakai
            login manual kapan pun.
          </p>
        </div>
      </div>

      <div className="auth-form-side">
        <div className="auth-form-card">
          <div className="auth-logo-mobile">
            <img src="/logo.png" alt="CakapCepat" />
          </div>
          <h1>Lengkapi profil kamu</h1>
          <p className="subtitle">Data ini bisa diubah lagi nanti lewat Pengaturan</p>
          {error && <div className="error-box">{error}</div>}
          <form onSubmit={onSubmit}>
            <div className="field">
              <label>Nama Lengkap</label>
              <input value={form.name} onChange={update("name")} required />
            </div>
            <div className="field">
              <label>Email</label>
              <input value={user?.email || ""} disabled />
            </div>
            <div className="field">
              <label>Username</label>
              <input
                value={form.username}
                onChange={update("username")}
                placeholder="cth: budi_store"
              />
            </div>
            <div className="field">
              <label>No HP (opsional)</label>
              <input
                type="tel"
                value={form.phone}
                onChange={update("phone")}
                placeholder="08xxxxxxxxxx"
              />
            </div>
            <div className="field">
              <label>Buat Password (min. 8 karakter)</label>
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
              {busy ? "Menyimpan..." : "Selesai & Masuk Dashboard"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
