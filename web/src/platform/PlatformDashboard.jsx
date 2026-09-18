import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Icon from "../components/Icon";
import { platformApi } from "./api";

const LABEL_STATUS = {
  active: "Aktif",
  restricted: "Dibatasi",
  suspended: "Ditangguhkan",
  disabled: "Dinonaktifkan",
};

function waktu(iso) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}

export default function PlatformDashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    platformApi.get("/dashboard").then(setData).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="error-box">{error}</div>;
  if (!data) return <div className="loading-block">Memuat ringkasan...</div>;

  const tenantCards = ["active", "restricted", "suspended", "disabled"].map((s) => ({
    key: s,
    label: LABEL_STATUS[s],
    value: data.tenants[s] ?? 0,
  }));

  return (
    <>
      <header className="plat-head">
        <div>
          <h1>Ringkasan Platform</h1>
          <p className="page-subtitle">
            Semua angka di halaman ini dihitung langsung dari database saat halaman dimuat
            ({waktu(data.generatedAt)}).
          </p>
        </div>
      </header>

      <div className="plat-kpi-grid">
        <Link to="/superadmin/tenants" className="plat-kpi plat-kpi-total">
          <span className="plat-kpi-label">Total penjual</span>
          <strong className="plat-kpi-value">{data.tenantsTotal}</strong>
          <span className="plat-kpi-sub">organisasi terdaftar</span>
        </Link>
        {tenantCards.map((c) => (
          <Link key={c.key} to={`/superadmin/tenants?status=${c.key}`} className={`plat-kpi tone-${c.key}`}>
            <span className="plat-kpi-label">{c.label}</span>
            <strong className="plat-kpi-value">{c.value}</strong>
            <span className="plat-kpi-sub">
              {c.key === "active"
                ? "berjalan normal"
                : c.key === "restricted"
                  ? "masih bisa masuk"
                  : "ditolak di seluruh API"}
            </span>
          </Link>
        ))}
        <div className="plat-kpi">
          <span className="plat-kpi-label">Pesan 24 jam</span>
          <strong className="plat-kpi-value">{data.messages24h.toLocaleString("id-ID")}</strong>
          <span className="plat-kpi-sub">seluruh platform</span>
        </div>
      </div>

      <section className="panel">
        <h2>Nomor WhatsApp seluruh platform</h2>
        {Object.keys(data.channels).length === 0 ? (
          <p className="empty-state">Belum ada nomor WhatsApp terdaftar di platform ini.</p>
        ) : (
          <div className="plat-chip-row">
            {Object.entries(data.channels).map(([status, n]) => (
              <span key={status} className="plat-chip">
                <b>{n}</b> {status}
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Tindakan terakhir di panel ini</h2>
        {data.recentActions.length === 0 ? (
          <p className="empty-state">
            Belum ada tindakan tercatat. Setiap tindakan penegakan akan muncul di sini beserta
            alasannya.
          </p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Waktu</th>
                  <th>Tindakan</th>
                  <th>Oleh</th>
                  <th>Alasan</th>
                </tr>
              </thead>
              <tbody>
                {data.recentActions.map((a, i) => (
                  <tr key={i}>
                    <td>{waktu(a.created_at)}</td>
                    <td>
                      <span className="plat-action">{a.action}</span>
                    </td>
                    <td>{a.actor_email ?? "-"}</td>
                    <td className="plat-reason">{a.reason_text ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel plat-note">
        <h2>
          <Icon name="peringatan" size={16} /> Yang panel ini sengaja TIDAK tampilkan
        </h2>
        <p>
          Isi percakapan, nomor telepon pelanggan, dan kredensial nomor WhatsApp (access token)
          tidak pernah diambil oleh panel ini — bukan disembunyikan di tampilan, tapi memang tidak
          ikut di-query. Panel ini untuk mengurus akun, bukan untuk membaca chat orang.
        </p>
      </section>
    </>
  );
}
