import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Icon from "../components/Icon";
import { platformApi } from "./api";
import { StatusBadge } from "./PlatformTenants";

/**
 * Setiap tindakan dijelaskan apa akibatnya SEBELUM diklik, bukan sesudah.
 * "Nonaktifkan" dan "Hapus" adalah dua hal berbeda, dan panel ini tidak
 * menghapus data siapa pun — itu dinyatakan terang-terangan di sini supaya
 * tidak ada yang menekan tombol sambil mengira artinya lain.
 */
const AKSI = [
  {
    key: "restrict",
    label: "Batasi",
    perm: "platform.tenants.restrict",
    dari: ["active", "suspended"],
    dampak: "Penjual MASIH bisa masuk dan melihat datanya. Dipakai untuk kasus yang perlu ditandai tapi belum perlu dihentikan.",
    tone: "warn",
  },
  {
    key: "suspend",
    label: "Tangguhkan",
    perm: "platform.tenants.suspend",
    dari: ["active", "restricted"],
    dampak: "Seluruh API penjual menolak akses: tidak bisa masuk, tidak bisa kirim pesan, otomatisasi berhenti. Data TIDAK dihapus dan bisa dibuka lagi kapan saja.",
    tone: "danger",
  },
  {
    key: "disable",
    label: "Nonaktifkan",
    perm: "platform.tenants.disable",
    dari: ["suspended", "restricted", "active"],
    dampak: "Sama seperti penangguhan, tapi ditandai permanen untuk akun yang tidak akan dipakai lagi. Tetap TIDAK menghapus data apa pun.",
    tone: "danger",
  },
  {
    key: "reactivate",
    label: "Aktifkan kembali",
    perm: "platform.tenants.reactivate",
    dari: ["restricted", "suspended", "disabled"],
    dampak: "Mengembalikan akses penuh. Penjual bisa langsung masuk lagi pada permintaan berikutnya.",
    tone: "ok",
  },
];

function waktu(iso) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}

export default function PlatformTenantDetail({ izin }) {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [aksi, setAksi] = useState(null);
  const [reasonCode, setReasonCode] = useState("");
  const [reasonText, setReasonText] = useState("");
  const [busy, setBusy] = useState(false);
  const [sukses, setSukses] = useState("");

  const muat = useCallback(() => {
    setError("");
    platformApi
      .get(`/tenants/${id}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [id]);

  useEffect(muat, [muat]);

  const jalankan = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await platformApi.post(`/tenants/${id}/enforcement`, {
        action: aksi.key,
        reasonCode: reasonCode.trim(),
        reasonText: reasonText.trim(),
        expectedStatus: data.organization.status,
      });
      setSukses(res.message);
      setAksi(null);
      setReasonCode("");
      setReasonText("");
      muat();
    } catch (err) {
      setError(err.message);
      if (err.status === 409) muat();
    } finally {
      setBusy(false);
    }
  };

  if (error && !data) return <div className="error-box">{error}</div>;
  if (!data) return <div className="loading-block">Memuat data organisasi...</div>;

  const org = data.organization;
  const tersedia = AKSI.filter((a) => izin.has(a.perm) && a.dari.includes(org.status));

  return (
    <>
      <header className="plat-head">
        <div>
          <Link to="/superadmin/tenants" className="plat-back">
            &larr; Semua penjual
          </Link>
          <h1>{org.name}</h1>
          <p className="page-subtitle">
            <StatusBadge status={org.status} />
            {org.status !== "active" && org.status_reason && (
              <span className="plat-status-reason"> — {org.status_reason}</span>
            )}
            {org.status_changed_at && (
              <span className="plat-dim"> (sejak {waktu(org.status_changed_at)})</span>
            )}
          </p>
        </div>
      </header>

      {sukses && <div className="success-box">{sukses}</div>}
      {error && <div className="error-box">{error}</div>}

      <div className="plat-kpi-grid">
        {[
          ["Kontak", data.counts.contacts],
          ["Percakapan", data.counts.conversations],
          ["Pesan", data.counts.messages],
          ["Pesanan", data.counts.orders],
          ["Produk", data.counts.products],
        ].map(([label, value]) => (
          <div key={label} className="plat-kpi">
            <span className="plat-kpi-label">{label}</span>
            <strong className="plat-kpi-value">{Number(value).toLocaleString("id-ID")}</strong>
          </div>
        ))}
      </div>

      <section className="panel">
        <h2>Tindakan</h2>
        {tersedia.length === 0 ? (
          <p className="empty-state">
            Peran kamu ({izin.size} izin) tidak mengizinkan tindakan apa pun pada organisasi dengan
            status &ldquo;{org.status}&rdquo;.
          </p>
        ) : (
          <div className="plat-action-grid">
            {tersedia.map((a) => (
              <button
                key={a.key}
                type="button"
                className={`plat-action-card tone-${a.tone} ${aksi?.key === a.key ? "picked" : ""}`}
                onClick={() => {
                  setSukses("");
                  setAksi(aksi?.key === a.key ? null : a);
                }}
              >
                <strong>{a.label}</strong>
                <span>{a.dampak}</span>
              </button>
            ))}
          </div>
        )}

        {aksi && (
          <form className="plat-confirm" onSubmit={jalankan}>
            <div className="plat-confirm-head">
              <Icon name="peringatan" size={16} />
              <span>
                <b>{aksi.label}</b> &rarr; <code>{org.name}</code>. {aksi.dampak}
              </span>
            </div>
            <div className="field">
              <label htmlFor="rc">Kode alasan</label>
              <input
                id="rc"
                value={reasonCode}
                onChange={(e) => setReasonCode(e.target.value)}
                placeholder="mis. spam, permintaan-pemilik, tunggakan"
                required
              />
            </div>
            <div className="field">
              <label htmlFor="rt">Penjelasan (minimal 10 karakter)</label>
              <textarea
                id="rt"
                rows={3}
                value={reasonText}
                onChange={(e) => setReasonText(e.target.value)}
                placeholder="Tulis supaya orang lain enam bulan lagi bisa paham kenapa ini dilakukan."
                required
              />
              <small className="field-hint">
                Alasan ini tersimpan permanen di catatan audit bersama email kamu dan tidak bisa
                diubah atau dihapus.
              </small>
            </div>
            <div className="plat-confirm-actions">
              <button type="submit" className="btn danger" disabled={busy || reasonText.trim().length < 10}>
                {busy ? "Menjalankan..." : `Ya, ${aksi.label.toLowerCase()} sekarang`}
              </button>
              <button type="button" className="btn secondary" onClick={() => setAksi(null)}>
                Batal
              </button>
            </div>
          </form>
        )}
      </section>

      <AksesDukungan orgId={id} orgNama={org.name} />

      <section className="panel">
        <h2>Pengguna ({data.users.length})</h2>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>Nama</th>
                <th>Peran</th>
                <th>Bergabung</th>
              </tr>
            </thead>
            <tbody>
              {data.users.map((u) => (
                <tr key={u.id}>
                  <td>{u.email}</td>
                  <td>{u.name ?? "-"}</td>
                  <td>{u.role}</td>
                  <td className="plat-dim">{waktu(u.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <h2>Nomor WhatsApp ({data.channels.length})</h2>
        {data.channels.length === 0 ? (
          <p className="empty-state">Organisasi ini belum menyambungkan nomor WhatsApp.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Jenis</th>
                  <th>Nomor</th>
                  <th>Status</th>
                  <th>AI</th>
                </tr>
              </thead>
              <tbody>
                {data.channels.map((c) => (
                  <tr key={c.id}>
                    <td>{c.label}</td>
                    <td>{c.connection_type}</td>
                    <td className="plat-dim">{c.display_phone_number ?? "-"}</td>
                    <td>{c.status}</td>
                    <td>{c.ai_enabled ? "aktif" : "mati"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="field-hint">
          Access token nomor tidak ikut diambil oleh panel ini — bukan disembunyikan di tampilan,
          memang tidak di-query.
        </p>
      </section>

      <section className="panel">
        <h2>Riwayat tindakan pada organisasi ini</h2>
        {data.history.length === 0 ? (
          <p className="empty-state">Belum pernah ada tindakan platform pada organisasi ini.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Waktu</th>
                  <th>Tindakan</th>
                  <th>Oleh</th>
                  <th>Kode</th>
                  <th>Alasan</th>
                </tr>
              </thead>
              <tbody>
                {data.history.map((h, i) => (
                  <tr key={i}>
                    <td className="plat-dim">{waktu(h.created_at)}</td>
                    <td>
                      <span className="plat-action">{h.action}</span>
                    </td>
                    <td>{h.actor_email ?? "-"}</td>
                    <td>{h.reason_code ?? "-"}</td>
                    <td className="plat-reason">{h.reason_text ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}


/**
 * Membaca isi percakapan penjual butuh izin yang masih berlaku, disetujui
 * staf lain, dan mati sendiri. Bagian ini menyatukan permintaannya dengan
 * pembacanya, supaya jelas bahwa yang satu memang syarat bagi yang lain.
 */
function AksesDukungan({ orgId, orgNama }) {
  const [izin, setIzin] = useState(null);
  const [form, setForm] = useState({ ticketRef: "", purpose: "", hours: 2 });
  const [bukaForm, setBukaForm] = useState(false);
  const [percakapan, setPercakapan] = useState(null);
  const [pesan, setPesan] = useState(null);
  const [error, setError] = useState("");
  const [sukses, setSukses] = useState("");
  const [busy, setBusy] = useState(false);

  const muatIzin = useCallback(() => {
    platformApi
      .get("/my-access")
      .then((r) => setIzin((r.aktif || []).find((g) => g.organization_id === orgId) || null))
      .catch(() => setIzin(null));
  }, [orgId]);
  useEffect(muatIzin, [muatIzin]);

  const ajukan = async (e) => {
    e.preventDefault();
    setError(""); setSukses(""); setBusy(true);
    try {
      const r = await platformApi.post(`/tenants/${orgId}/access-request`, form);
      setSukses(r.message);
      setBukaForm(false);
      setForm({ ticketRef: "", purpose: "", hours: 2 });
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const bukaPercakapan = async () => {
    setError(""); setPesan(null);
    try {
      const r = await platformApi.get(`/tenants/${orgId}/conversations`);
      setPercakapan(r.items);
    } catch (err) { setError(err.message); muatIzin(); }
  };

  const bukaPesan = async (convId) => {
    setError("");
    try {
      const r = await platformApi.get(`/tenants/${orgId}/conversations/${convId}/messages`);
      setPesan({ convId, items: r.items });
    } catch (err) { setError(err.message); muatIzin(); }
  };

  const cabut = async () => {
    try {
      await platformApi.post(`/access-grants/${izin.id}/revoke`, {});
      setIzin(null); setPercakapan(null); setPesan(null);
      setSukses("Izin dicabut.");
    } catch (err) { setError(err.message); }
  };

  return (
    <section className="panel">
      <h2>Akses dukungan</h2>
      {error && <div className="error-box">{error}</div>}
      {sukses && <div className="success-box">{sukses}</div>}

      {!izin ? (
        <>
          <p className="field-hint" style={{ marginTop: 0 }}>
            Panel ini tidak bisa membaca percakapan penjual. Kalau perlu melihatnya untuk menangani
            laporan, ajukan izin: harus punya nomor tiket dan tujuan, disetujui staf platform lain,
            berlaku maksimal 8 jam, dan setiap percakapan yang dibuka dicatat satu per satu.
          </p>
          <button type="button" className="act-btn" onClick={() => setBukaForm((v) => !v)}>
            {bukaForm ? "Tutup" : "Ajukan izin akses"}
          </button>

          {bukaForm && (
            <form className="plat-confirm" onSubmit={ajukan} style={{ borderColor: "rgba(125,211,252,0.34)", background: "rgba(125,211,252,0.05)" }}>
              <div className="field">
                <label htmlFor="tk">Nomor tiket / laporan</label>
                <input id="tk" value={form.ticketRef} onChange={(e) => setForm((f) => ({ ...f, ticketRef: e.target.value }))} placeholder="mis. WA-2291" required />
              </div>
              <div className="field">
                <label htmlFor="tj">Tujuan (minimal 15 karakter)</label>
                <textarea id="tj" rows={3} value={form.purpose} onChange={(e) => setForm((f) => ({ ...f, purpose: e.target.value }))}
                  placeholder="Apa yang perlu diperiksa, dan kenapa harus melihat isi chatnya?" required />
              </div>
              <div className="field" style={{ maxWidth: 200 }}>
                <label htmlFor="jm">Berlaku berapa jam</label>
                <select id="jm" value={form.hours} onChange={(e) => setForm((f) => ({ ...f, hours: Number(e.target.value) }))}>
                  {[1, 2, 4, 8].map((h) => <option key={h} value={h}>{h} jam</option>)}
                </select>
                <small className="field-hint">Maksimal 8 jam — izin berhari-hari praktis sama dengan akses permanen.</small>
              </div>
              <button className="btn" type="submit" disabled={busy || form.purpose.trim().length < 15}>
                {busy ? "Mengirim..." : "Ajukan untuk disetujui staf lain"}
              </button>
            </form>
          )}
        </>
      ) : (
        <>
          <div className="plat-akses-aktif" style={{ marginBottom: 14 }}>
            <Icon name="lihat" size={16} />
            <span>
              Izin aktif untuk <b>{orgNama}</b> — tiket {izin.ticket_ref}, berlaku sampai{" "}
              {new Date(izin.expires_at).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" })}.
              Sudah {izin.reads_count} kali membuka data.
            </span>
          </div>
          <div className="plat-approval-aksi">
            <button type="button" className="act-btn" onClick={bukaPercakapan}>Lihat percakapan</button>
            <button type="button" className="act-btn act-danger" onClick={cabut}>Cabut izin sekarang</button>
          </div>

          {percakapan && (
            <div className="table-scroll" style={{ marginTop: 16 }}>
              {percakapan.length === 0 ? (
                <p className="empty-state">Penjual ini belum punya percakapan.</p>
              ) : (
                <table>
                  <thead><tr><th>Kontak</th><th>Nomor</th><th>Status</th><th>Pesan terakhir</th><th></th></tr></thead>
                  <tbody>
                    {percakapan.map((c) => (
                      <tr key={c.id}>
                        <td>{c.contact_name ?? "-"}</td>
                        <td className="plat-dim">{c.channel_label ?? "-"}</td>
                        <td>{c.status}{c.needs_attention ? " · perlu perhatian" : ""}</td>
                        <td className="plat-dim">{c.last_message_at ? new Date(c.last_message_at).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" }) : "-"}</td>
                        <td><button type="button" className="act-btn" onClick={() => bukaPesan(c.id)}>Buka</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {pesan && (
            <div className="plat-chat" style={{ marginTop: 16 }}>
              {pesan.items.map((m) => (
                <div key={m.id} className={`plat-bubble ${m.direction === "inbound" ? "masuk" : "keluar"}`}>
                  <span className="plat-bubble-meta">
                    {m.direction === "inbound" ? "Pelanggan" : m.sender_type === "ai" ? "AI" : "CS"} ·{" "}
                    {new Date(m.created_at).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" })}
                  </span>
                  <div>{m.content?.body ?? `(${m.content_type})`}</div>
                </div>
              ))}
              {pesan.items.length === 0 && <p className="empty-state">Belum ada pesan.</p>}
            </div>
          )}
        </>
      )}
    </section>
  );
}
