import { useState } from "react";
import Icon from "../components/Icon";
import PasswordInput from "../components/PasswordInput";
import { platformApi } from "./api";

/**
 * Ganti password panel sendiri.
 *
 * Halaman ini terbuka untuk SEMUA peran — hak mengelola staf lain tidak ada
 * hubungannya dengan hak mengganti password sendiri.
 */
export default function PlatformAkun({ me }) {
  const [lama, setLama] = useState("");
  const [baru, setBaru] = useState("");
  const [ulang, setUlang] = useState("");
  const [error, setError] = useState("");
  const [sukses, setSukses] = useState("");
  const [busy, setBusy] = useState(false);

  const kirim = async (e) => {
    e.preventDefault();
    setError("");
    setSukses("");
    if (baru !== ulang) {
      setError("Konfirmasi password baru tidak cocok.");
      return;
    }
    setBusy(true);
    try {
      const r = await platformApi.post("/me/password", { currentPassword: lama, newPassword: baru });
      setSukses(r.message);
      setLama("");
      setBaru("");
      setUlang("");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <header className="plat-head">
        <div>
          <h1>Akun Saya</h1>
          <p className="page-subtitle">
            {me.email} &middot; peran <b>{me.role}</b>
          </p>
        </div>
      </header>

      <section className="panel" style={{ maxWidth: 520 }}>
        <h2>Ganti password panel</h2>

        <div className="plat-setup-note" style={{ marginTop: 4 }}>
          <strong>Kalau password ini dibuat lewat variabel hosting, ganti sekarang.</strong>
          <p>
            Password yang diisi lewat <code>PLATFORM_BOOTSTRAP_PASSWORD</code> sempat tersimpan
            sebagai teks biasa di dashboard hosting, dan mungkin juga tercatat di tempat lain saat
            dituliskan. Menggantinya di sini membuat nilai lama itu tidak berlaku lagi.
          </p>
          <p>Setelah itu, hapus kedua variabel bootstrap dari pengaturan hosting.</p>
        </div>

        {error && <div className="error-box">{error}</div>}
        {sukses && <div className="success-box">{sukses}</div>}

        <form onSubmit={kirim}>
          <div className="field">
            <label htmlFor="pw-lama">Password sekarang</label>
            <PasswordInput
              id="pw-lama"
              value={lama}
              onChange={(e) => setLama(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="pw-baru">Password baru</label>
            <PasswordInput
              id="pw-baru"
              value={baru}
              onChange={(e) => setBaru(e.target.value)}
              autoComplete="new-password"
              required
            />
            <small className="field-hint">
              Minimal 12 karakter. Jangan pakai password yang sama dengan akun lain — akun ini bisa
              menyentuh semua penjual sekaligus.
            </small>
          </div>
          <div className="field">
            <label htmlFor="pw-ulang">Ulangi password baru</label>
            <PasswordInput
              id="pw-ulang"
              value={ulang}
              onChange={(e) => setUlang(e.target.value)}
              autoComplete="new-password"
              required
            />
          </div>
          <button className="btn" type="submit" disabled={busy || baru.length < 12}>
            {busy ? "Menyimpan..." : "Ganti password"}
          </button>
        </form>

        <p className="field-hint" style={{ marginTop: 14 }}>
          <Icon name="peringatan" size={14} /> Password sekarang tetap diminta walaupun kamu sudah
          masuk — supaya sesi yang tertinggal terbuka di perangkat orang lain tidak bisa dipakai
          mengunci kamu keluar dari panelmu sendiri.
        </p>
      </section>
    </>
  );
}
