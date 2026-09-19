import { useCallback, useEffect, useState } from "react";
import Icon from "../components/Icon";
import { platformApi } from "./api";

const SARING = [
  { key: "pending", label: "Menunggu" },
  { key: "approved", label: "Disetujui" },
  { key: "rejected", label: "Ditolak" },
  { key: "expired", label: "Kedaluwarsa" },
  { key: "semua", label: "Semua" },
];

function waktu(iso) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}

function sisaWaktu(iso) {
  const ms = new Date(iso) - Date.now();
  if (ms <= 0) return "kedaluwarsa";
  const jam = Math.floor(ms / 3.6e6);
  if (jam >= 1) return `${jam} jam lagi`;
  return `${Math.max(1, Math.floor(ms / 60000))} menit lagi`;
}

export default function PlatformApprovals() {
  const [status, setStatus] = useState("pending");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [sukses, setSukses] = useState("");
  const [buka, setBuka] = useState(null); // { id, keputusan }
  const [alasan, setAlasan] = useState("");
  const [busy, setBusy] = useState(false);

  const muat = useCallback(() => {
    setError("");
    platformApi.get(`/approvals?status=${status}`).then(setData).catch((e) => setError(e.message));
  }, [status]);
  useEffect(muat, [muat]);

  const putuskan = async (e) => {
    e.preventDefault();
    setError(""); setSukses(""); setBusy(true);
    try {
      const r = await platformApi.post(`/approvals/${buka.id}/decision`, {
        decision: buka.keputusan,
        reason: alasan.trim(),
      });
      setSukses(r.message);
      setBuka(null); setAlasan("");
      muat();
    } catch (err) {
      setError(err.message);
      muat();
    } finally { setBusy(false); }
  };

  const batalkan = async (id) => {
    setError(""); setSukses("");
    try {
      const r = await platformApi.post(`/approvals/${id}/cancel`, {});
      setSukses(r.message);
      muat();
    } catch (err) { setError(err.message); }
  };

  return (
    <>
      <header className="plat-head">
        <div>
          <h1>Persetujuan</h1>
          <p className="page-subtitle">
            Tindakan yang paling sulit dibatalkan tidak bisa dijalankan sendirian. Yang mengajukan
            dan yang menyetujui harus orang berbeda — diperiksa di server, bukan dengan
            menyembunyikan tombolnya.
          </p>
        </div>
      </header>

      <div className="plat-chiprow" style={{ marginBottom: 16 }}>
        {SARING.map((s) => (
          <button
            key={s.key}
            type="button"
            className={`plat-filter-chip ${status === s.key ? "active" : ""}`}
            onClick={() => setStatus(s.key)}
          >
            {s.label}
          </button>
        ))}
      </div>

      {error && <div className="error-box">{error}</div>}
      {sukses && <div className="success-box">{sukses}</div>}
      {!data && !error && <div className="loading-block">Memuat...</div>}

      {data && data.items.length === 0 && (
        <section className="panel">
          <p className="empty-state">
            {status === "pending"
              ? "Tidak ada permintaan yang menunggu persetujuan."
              : "Tidak ada permintaan dengan status ini."}
          </p>
        </section>
      )}

      {data &&
        data.items.map((a) => (
          <section className="panel plat-approval" key={a.id}>
            <div className="plat-approval-head">
              <div>
                <span className={`plat-status plat-status-${a.status === "pending" ? "restricted" : a.status === "approved" ? "active" : "disabled"}`}>
                  {a.status === "pending" ? "Menunggu" : a.status === "approved" ? "Disetujui" : a.status === "rejected" ? "Ditolak" : a.status}
                </span>
                <h2 style={{ margin: "9px 0 3px" }}>{a.judul}</h2>
                <p className="plat-dim" style={{ margin: 0, fontSize: 13 }}>
                  Sasaran: <b>{a.target_label ?? a.target_id}</b>
                </p>
              </div>
              {a.status === "pending" && (
                <span className="plat-chip">
                  <Icon name="muat" size={13} /> {sisaWaktu(a.expires_at)}
                </span>
              )}
            </div>

            <dl className="plat-approval-fakta">
              <div><dt>Diajukan oleh</dt><dd>{a.requested_email}{a.diajukanOlehSaya && <span className="plat-you"> (kamu)</span>}</dd></div>
              <div><dt>Waktu</dt><dd>{waktu(a.created_at)}</dd></div>
              <div><dt>Kode alasan</dt><dd>{a.reason_code}</dd></div>
              {a.decided_email && <div><dt>Diputuskan oleh</dt><dd>{a.decided_email}</dd></div>}
              {a.decided_at && <div><dt>Waktu keputusan</dt><dd>{waktu(a.decided_at)}</dd></div>}
            </dl>

            <p className="plat-approval-alasan">{a.reason_text}</p>
            {a.decision_reason && (
              <p className="plat-approval-alasan plat-dim">Alasan keputusan: {a.decision_reason}</p>
            )}

            <details className="plat-approval-rencana">
              <summary>Rencana tindakan yang akan dijalankan</summary>
              <pre>{JSON.stringify(a.payload, null, 2)}</pre>
              <small className="field-hint">
                Yang disetujui adalah isi ini, bukan judulnya — supaya tidak mungkin berbeda dari
                apa yang benar-benar dijalankan.
              </small>
            </details>

            {a.status === "pending" && (
              <div className="plat-approval-aksi">
                {a.diajukanOlehSaya ? (
                  <>
                    <p className="plat-approval-blokir">
                      <Icon name="peringatan" size={15} />
                      Kamu yang mengajukan ini. Persetujuan harus datang dari staf platform lain —
                      itulah gunanya dua-mata.
                    </p>
                    <button type="button" className="act-btn" onClick={() => batalkan(a.id)}>
                      Batalkan permintaan saya
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" className="btn" onClick={() => { setBuka({ id: a.id, keputusan: "approve" }); setAlasan(""); }}>
                      Setujui
                    </button>
                    <button type="button" className="act-btn act-danger" onClick={() => { setBuka({ id: a.id, keputusan: "reject" }); setAlasan(""); }}>
                      Tolak
                    </button>
                  </>
                )}
              </div>
            )}

            {buka?.id === a.id && (
              <form className="plat-confirm" onSubmit={putuskan}>
                <div className="plat-confirm-head">
                  <Icon name="peringatan" size={16} />
                  <span>
                    {buka.keputusan === "approve"
                      ? "Menyetujui berarti tindakan di atas langsung dijalankan."
                      : "Menolak menutup permintaan ini; pemohon harus mengajukan ulang kalau masih perlu."}
                  </span>
                </div>
                <div className="field">
                  <label htmlFor={`al-${a.id}`}>Alasan keputusan (minimal 10 karakter)</label>
                  <textarea
                    id={`al-${a.id}`}
                    rows={3}
                    value={alasan}
                    onChange={(e) => setAlasan(e.target.value)}
                    placeholder="Apa yang kamu periksa sebelum memutuskan ini?"
                    required
                  />
                  <small className="field-hint">Tersimpan permanen bersama namamu di catatan audit.</small>
                </div>
                <div className="plat-confirm-actions">
                  <button className={buka.keputusan === "approve" ? "btn" : "btn danger"} type="submit" disabled={busy || alasan.trim().length < 10}>
                    {busy ? "Memproses..." : buka.keputusan === "approve" ? "Ya, setujui" : "Ya, tolak"}
                  </button>
                  <button type="button" className="btn secondary" onClick={() => setBuka(null)}>Batal</button>
                </div>
              </form>
            )}
          </section>
        ))}
    </>
  );
}
