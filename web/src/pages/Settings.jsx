import { useRef, useState } from "react";
import { useAuth } from "../AuthContext";
import { api } from "../api";

// Resize + kompres gambar di browser sebelum dikirim ke server, supaya foto
// profil dari kamera HP (bisa 5-10MB) tidak membebani body request. Hasil
// akhir data URL JPEG max 320x320, jadi selalu jauh di bawah batas 1.4MB
// yang dicek backend.
function resizeImageToDataUrl(file, maxSize = 320, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Gagal membaca file"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("File bukan gambar yang valid"));
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export default function Settings() {
  const { user, refresh } = useAuth();
  const [name, setName] = useState(user?.name || "");
  const [username, setUsername] = useState(user?.username || "");
  const [email, setEmail] = useState(user?.email || "");
  const [avatarPreview, setAvatarPreview] = useState(user?.avatar_url || "");
  const [avatarDataUrl, setAvatarDataUrl] = useState(null); // null = tak berubah
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [profileSuccess, setProfileSuccess] = useState("");
  const fileInputRef = useRef(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState("");

  const initials = (name || user?.email || "?").trim().charAt(0).toUpperCase();

  const onPickAvatar = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setProfileError("");
    if (!file.type.startsWith("image/")) {
      setProfileError("File harus berupa gambar (JPG, PNG, dll).");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setProfileError("Ukuran file maksimal 8MB.");
      return;
    }
    try {
      const dataUrl = await resizeImageToDataUrl(file);
      setAvatarDataUrl(dataUrl);
      setAvatarPreview(dataUrl);
    } catch (err) {
      setProfileError(err.message || "Gagal memproses gambar");
    }
  };

  const onRemoveAvatar = () => {
    setAvatarDataUrl("");
    setAvatarPreview("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const onSaveProfile = async (e) => {
    e.preventDefault();
    setProfileError("");
    setProfileSuccess("");
    setProfileBusy(true);
    try {
      const payload = { name, email, username: username || "" };
      if (avatarDataUrl !== null) payload.avatarDataUrl = avatarDataUrl;
      await api.patch("/me", payload);
      await refresh();
      setAvatarDataUrl(null);
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
      <p className="page-subtitle">Ubah foto, nama, username, email, dan password akun kamu sendiri.</p>

      <div className="settings-grid">
        <div className="panel">
          <h2>Profil</h2>
          {profileError && <div className="error-box">{profileError}</div>}
          {profileSuccess && <div className="success-box">{profileSuccess}</div>}
          <form onSubmit={onSaveProfile}>
            <div className="field">
              <label>Foto Profil</label>
              <div className="avatar-edit-row">
                <div className="avatar-preview">
                  {avatarPreview ? (
                    <img src={avatarPreview} alt="Foto profil" />
                  ) : (
                    <span>{initials}</span>
                  )}
                </div>
                <div className="avatar-edit-actions">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={onPickAvatar}
                    style={{ display: "none" }}
                    id="avatar-input"
                  />
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Pilih Foto
                  </button>
                  {avatarPreview && (
                    <button type="button" className="btn-link" onClick={onRemoveAvatar}>
                      Hapus Foto
                    </button>
                  )}
                </div>
              </div>
            </div>
            <div className="field">
              <label>Nama</label>
              <input value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="field">
              <label>Username</label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="mis. ilyas_taha"
                pattern="[a-zA-Z0-9_.]{3,30}"
                title="3-30 karakter: huruf, angka, underscore, atau titik"
              />
              <small className="field-hint">
                Identitas tampilan kamu, terpisah dari email. Boleh dikosongkan.
              </small>
            </div>
            <div className="field">
              <label>Email (dipakai untuk login)</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
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
