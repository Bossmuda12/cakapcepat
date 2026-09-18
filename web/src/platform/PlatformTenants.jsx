import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import SearchField from "../components/SearchField";
import { platformApi } from "./api";

const STATUS = [
  { key: "", label: "Semua" },
  { key: "active", label: "Aktif" },
  { key: "restricted", label: "Dibatasi" },
  { key: "suspended", label: "Ditangguhkan" },
  { key: "disabled", label: "Dinonaktifkan" },
];

export function StatusBadge({ status }) {
  const label =
    { active: "Aktif", restricted: "Dibatasi", suspended: "Ditangguhkan", disabled: "Dinonaktifkan" }[
      status
    ] ?? status;
  return <span className={`plat-status plat-status-${status}`}>{label}</span>;
}

function tanggal(iso) {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("id-ID", { dateStyle: "medium" });
}

const PAGE = 25;

export default function PlatformTenants() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [offset, setOffset] = useState(0);
  const status = params.get("status") ?? "";

  useEffect(() => {
    setError("");
    const sp = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
    if (q.trim()) sp.set("q", q.trim());
    if (status) sp.set("status", status);
    platformApi
      .get(`/tenants?${sp.toString()}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [q, status, offset]);

  return (
    <>
      <header className="plat-head">
        <div>
          <h1>Penjual</h1>
          <p className="page-subtitle">
            Setiap baris adalah satu organisasi. Datanya ringkasan akun — bukan isi percakapan.
          </p>
        </div>
      </header>

      <div className="plat-filter-bar">
        <SearchField
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOffset(0);
          }}
          placeholder="Cari nama organisasi atau email pemilik..."
        />
        <div className="plat-chiprow">
          {STATUS.map((s) => (
            <button
              key={s.key}
              type="button"
              className={`plat-filter-chip ${status === s.key ? "active" : ""}`}
              onClick={() => {
                setOffset(0);
                if (s.key) setParams({ status: s.key });
                else setParams({});
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}
      {!data && !error && <div className="loading-block">Memuat daftar...</div>}

      {data && (
        <section className="panel">
          {data.items.length === 0 ? (
            <p className="empty-state">
              Tidak ada organisasi yang cocok dengan pencarian atau saringan ini.
            </p>
          ) : (
            <>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Organisasi</th>
                      <th>Status</th>
                      <th>Pemilik</th>
                      <th>Pengguna</th>
                      <th>Nomor WA</th>
                      <th>Pesanan</th>
                      <th>Terdaftar</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((t) => (
                      <tr key={t.id}>
                        <td>
                          <Link to={`/superadmin/tenants/${t.id}`} className="plat-link">
                            {t.name}
                          </Link>
                        </td>
                        <td>
                          <StatusBadge status={t.status} />
                        </td>
                        <td className="plat-dim">{t.owner_email ?? "-"}</td>
                        <td>{t.user_count}</td>
                        <td>{t.channel_count}</td>
                        <td>{t.order_count}</td>
                        <td className="plat-dim">{tanggal(t.created_at)}</td>
                        <td>
                          <Link to={`/superadmin/tenants/${t.id}`} className="act-btn">
                            Lihat
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="pagination-bar">
                <span>
                  {offset + 1}–{Math.min(offset + PAGE, data.total)} dari {data.total}
                </span>
                <div>
                  <button
                    type="button"
                    className="act-btn"
                    disabled={offset === 0}
                    onClick={() => setOffset((o) => Math.max(0, o - PAGE))}
                  >
                    Sebelumnya
                  </button>
                  <button
                    type="button"
                    className="act-btn"
                    disabled={offset + PAGE >= data.total}
                    onClick={() => setOffset((o) => o + PAGE)}
                  >
                    Berikutnya
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      )}
    </>
  );
}
