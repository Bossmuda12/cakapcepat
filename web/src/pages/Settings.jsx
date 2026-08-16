import { useState } from "react";
import { useAuth } from "../AuthContext";
import { api } from "../api";

export default function Settings() {
  const { user, refresh } = useAuth();
  const [name, setName] = useState(user?.name || "");
  const [email, setEmail] = useState(user?.email || "");
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [profileSuccess, setProfileSuccess] = useState("");

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState("");

  const onSaveProfile = async (e) => {
    e.preventDefault();
    setProfileError("");
    setProfileSuccess("");
    setProfileBusy(true);
    try {
      await api.patch("/me", { name, email });
      await refresh();
      setProfileSuccess("Profil berhasil diperbarui.");
    } catch (err) {
      setProfileError(err.message || "Gagal menyimpan profil");
    } finally {
      setProfileBusy(false);
    }
  };

  const onChangePassword = async (e) => {
    e.preventDefault();
    setPasswordError("");
    setPasswordSuccess("");
    if (newPassword !== confirmPassword) {
      setPasswordError("Konfirmasi password baru tidak sama.");
      return;
    }
    setPasswordBusy(true);
    try {
      await api.post("/me/password", { currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordSuccess("Password berhasil diganti.");
    } catch (err) {
      setPasswordError(err.message || "Gagal mengganti password");
    } finally {
      setPasswordBusy(false);
    }
  };

  return (
    <div>
      <h1>Pengaturan Akun</h1>
      <p className="page-subtitle">Ubah nama, email, dan password akun kamu sendiri.</p>

      <div className="settings-grid">
        <div className="panel">
          <h2>Profil</h2>
          {profileError && <div className="error-box">{profileError}</div>}
          {profileSuccess && <div className="success-box">{profileSuccess}</div>}
          <form onSubmit={onSaveProfile}>
            <div className="field">
              <label>Nama</label>
              <input value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="field">
              <label>Email (Username)</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              <small className="field-hint">
                Sistem ini login memakai email, jadi email berperan sebagai username kamu.
              </small>
            </div>
            <button className="btn" type="submit" disabled={profileBusy}>
              {profileBusy ? "Menyimpan..." : "Simpan Profil"}
            </button>
          </form>
        </div>

        <div className="panel">
          <h2>Ganti Password</h2>
          {passwordError && <div className="error-box">{passwordError}</div>}
          {passwordSuccess && <div className="success-box">{passwordSuccess}</div>}
          <form onSubmit={onChangePassword}>
            <div className="field">
              <label>Password Saat Ini</label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label>Password Baru</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                minLength={8}
                required
              />
            </div>
            <div className="field">
              <label>Konfirmasi Password Baru</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                minLength={8}
                required
              />
            </div>
            <button className="btn" type="submit" disabled={passwordBusy}>
              {passwordBusy ? "Memproses..." : "Ganti Password"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
