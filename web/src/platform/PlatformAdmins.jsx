import { useCallback, useEffect, useState } from "react";
import ActionBtn from "../components/ActionBtn";
import PasswordInput from "../components/PasswordInput";
import { platformApi } from "./api";

const PERAN = [
  { key: "platform_owner", label: "Platform Owner", jelas: "Semua izin, termasuk menonaktifkan penjual dan mengelola staf platform." },
  { key: "platform_admin", label: "Platform Admin", jelas: "Boleh membatasi, menangguhkan, dan mengaktifkan kembali. TIDAK boleh menonaktifkan permanen atau mengelola staf." },
  { key: "support_agent", label: "Support Agent", jelas: "Hanya melihat ringkasan dan daftar penjual. Tidak ada tindakan penegakan." },
  { key: "readonly_auditor", label: "Readonly Auditor", jelas: "Hanya membaca, termasuk catatan audit. Tidak bisa mengubah apa pun." },
];

function waktu(iso) {
  if (!iso) return "belum pernah";
  return new Date(iso).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}

export default function PlatformAdmins({ me }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [sukses, setSukses] = useState("");
  const [buka, setBuka] = useState(false);
  const [form, setForm] = useState({ email: "", name: "", password: "", role: "readonly_auditor" });
  const [busy, setBusy] = useState(false);

  const muat = useCallback(() => {
    platformApi
      .get("/admins")
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(muat, [muat]);

  const buat = async (e) => {
    e.preventDefault();
    setError("");
    setSukses("");
    setBusy(true);
    try {
      const r = await platformApi.post("/admins", form);
      setSukses(`Staf platform ${r.email} dibuat dengan peran ${r.role}.`);
      setForm({ email: "", name: "", password: "", role: "readonly_auditor" });
      setBuka(false);
      muat();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const ubah = async (id, patch) => {
    setError("");
    setSukses("");
    try {
      await platformApi.patch(`/admins/${id}`, patch);
      muat();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <>
      <header className="plat-head">
        <div>
          <h1>Staf Platform</h1>
          <p className="page-subtitle">
            Akun di sini bukan akun penjual. Peran menentukan izin, bukan satu tombol
            &ldquo;superadmin&rdquo; — melihat daftar penjual dan menangguhkan penjual adalah dua
            izin berbeda.
          </p>
        </div>
        <button type="button" className="btn" onClick={() => setBuka((v) => !v)}>
          {buka ? "Tutup" : "+ Tambah staf"}
        </button>
      </header>

      {error && <div className="error-box">{error}</div>}
      {sukses && <div className="success-box">{sukses}</div>}

      {buka && (
        <section className="panel">
          <h2>Tambah staf platform</h2>
          <form onSubmit={buat}>
            <div className="settings-grid">
              <div className="field">
                <label htmlFor="ne">Email</label>
                <input
                  id="ne"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="nn">Nama</label>
                <input
                  id="nn"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  required
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="np">Password (minimal 12 karakter)</label>
              <PasswordInput
                id="np"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                autoComplete="new-password"
                required
              />
              <small className="field-hint">
                Lebih panjang dari akun penjual (8) karena satu akun di sini menyentuh semua
                penjual sekaligus.
              </small>
            </div>
            <div className="field">
              <label htmlFor="nr">Peran</label>
              <select
                id="nr"
                value={form.role}
                onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
              >
                {PERAN.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
              <small className="field-hint">
                {PERAN.find((p) => p.key === form.role)?.jelas}
              </small>
            </div>
            <button className="btn" type="submit" disabled={busy}>
              {busy ? "Menyimpan..." : "Buat akun staf"}
            </button>
          </form>
        </section>
      )}

      <section className="panel">
        <h2>Daftar staf</h2>
        {!data ? (
          <div className="loading-block">Memuat...</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Nama</th>
                  <th>Peran</th>
                  <th>Status</th>
                  <th>Masuk terakhir</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((a) => {
                  const sendiri = a.id === me.id;
                  return (
                    <tr key={a.id}>
                      <td>
                        {a.email}
                        {sendiri && <span className="plat-you"> (kamu)</span>}
                      </td>
                      <td>{a.name ?? "-"}</td>
                      <td>
                        <select
                          value={a.role}
                          disabled={sendiri}
                          title={sendiri ? "Tidak bisa mengubah peran akun sendiri" : undefined}
                          onChange={(e) => ubah(a.id, { role: e.target.value })}
                        >
                          {PERAN.map((p) => (
                            <option key={p.key} value={p.key}>
                              {p.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <span className={`plat-status plat-status-${a.is_active ? "active" : "disabled"}`}>
                          {a.is_active ? "Aktif" : "Nonaktif"}
                        </span>
                      </td>
                      <td className="plat-dim">{waktu(a.last_login_at)}</td>
                      <td>
                        <ActionBtn
                          kind={a.is_active ? "hapus" : "simpan"}
                          disabled={sendiri}
                          title={sendiri ? "Tidak bisa menonaktifkan akun sendiri" : undefined}
                          onClick={() => ubah(a.id, { isActive: !a.is_active })}
                        >
                          {a.is_active ? "Nonaktifkan" : "Aktifkan"}
                        </ActionBtn>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="field-hint">
          Akun sendiri sengaja tidak bisa diubah dari sini — mencegah menaikkan peran diri sendiri
          diam-diam, sekaligus mencegah mengunci diri sendiri keluar sampai tidak ada lagi yang
          bisa mengelola platform.
        </p>
      </section>
    </>
  );
}
