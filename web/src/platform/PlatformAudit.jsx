import { useEffect, useState } from "react";
import { platformApi } from "./api";

const PAGE = 100;

function waktu(iso) {
  return new Date(iso).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "medium" });
}

export default function PlatformAudit() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    setError("");
    platformApi
      .get(`/audit?limit=${PAGE}&offset=${offset}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [offset]);

  return (
    <>
      <header className="plat-head">
        <div>
          <h1>Catatan Audit</h1>
          <p className="page-subtitle">
            Hanya bisa ditambah. Tidak ada satu pun rute di aplikasi ini yang bisa mengubah atau
            menghapus baris di sini — termasuk oleh platform_owner.
          </p>
        </div>
      </header>

      {error && <div className="error-box">{error}</div>}
      {!data && !error && <div className="loading-block">Memuat catatan...</div>}

      {data && (
        <section className="panel">
          {data.items.length === 0 ? (
            <p className="empty-state">Belum ada catatan.</p>
          ) : (
            <>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Waktu</th>
                      <th>Tindakan</th>
                      <th>Oleh</th>
                      <th>Sasaran</th>
                      <th>Kode</th>
                      <th>Alasan</th>
                      <th>IP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((a) => (
                      <tr key={a.id}>
                        <td className="plat-dim">{waktu(a.created_at)}</td>
                        <td>
                          <span className="plat-action">{a.action}</span>
                        </td>
                        <td>{a.actor_email ?? "-"}</td>
                        <td>{a.target_name ?? a.target_type ?? "-"}</td>
                        <td>{a.reason_code ?? "-"}</td>
                        <td className="plat-reason">{a.reason_text ?? "-"}</td>
                        <td className="plat-dim">{a.ip ?? "-"}</td>
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
