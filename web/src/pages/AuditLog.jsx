import { useEffect, useState } from "react";
import { api } from "../api";
import Pilih from "../components/Pilih";

const PAGE_SIZE = 50;

// F-41: Catatan aktivitas. Daftar action yang saat ini ditulis backend
// (lihat src/routes/orders.ts) — kalau ada action baru yang belum masuk di
// sini, tetap ditampilkan apa adanya (fallback di actionLabel()).
const ACTION_OPTIONS = [
  { value: "order.shipping_changed", label: "Ubah status pengiriman pesanan" },
  { value: "order.cod_changed", label: "Tandai COD" },
  { value: "order.deleted", label: "Hapus pesanan" },
];

const SHIPPING_STATUS_LABEL = {
  pending: "Menunggu",
  packed: "Dikemas",
  handed_to_courier: "Diserahkan ke Kurir",
  in_transit: "Dalam Perjalanan",
  problem: "Bermasalah",
  rescheduled: "Dijadwalkan Ulang",
  delivered: "Terkirim",
  returned: "Retur",
};

function actionLabel(action) {
  return ACTION_OPTIONS.find((a) => a.value === action)?.label || action;
}

function formatTime(ts) {
  if (!ts) return "-";
  return new Date(ts).toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatRp(cents) {
  return "Rp " + (Number(cents || 0) / 100).toLocaleString("id-ID");
}

// Ubah detail JSON mentah jadi kalimat singkat yang enak dibaca manusia,
// bukan JSON.stringify apa adanya.
function formatDetail(action, detail) {
  if (action === "order.shipping_changed") {
    if (!detail || typeof detail !== "object") return "—";
    const parts = [];
    if (detail.shippingStatus) {
      parts.push(`status pengiriman → ${SHIPPING_STATUS_LABEL[detail.shippingStatus] || detail.shippingStatus}`);
    }
    if (Object.prototype.hasOwnProperty.call(detail, "courier")) {
      parts.push(`kurir → ${detail.courier || "(kosong)"}`);
    }
    if (Object.prototype.hasOwnProperty.call(detail, "trackingNo")) {
      parts.push(`resi → ${detail.trackingNo || "(kosong)"}`);
    }
    if (Object.prototype.hasOwnProperty.call(detail, "hasProblem")) {
      parts.push(detail.hasProblem ? "ditandai bermasalah" : "tanda bermasalah dilepas");
    }
    if (detail.problemReason) parts.push(`alasan: ${detail.problemReason}`);
    return parts.length ? parts.join(", ") : "—";
  }

  if (action === "order.cod_changed") {
    if (!detail || typeof detail !== "object") return "—";
    const parts = [detail.codReceived ? "COD ditandai sudah diterima" : "Tanda COD diterima dilepas"];
    if (detail.codReceived && (detail.codAmountCents ?? null) !== null) {
      parts.push(`sebesar ${formatRp(detail.codAmountCents)}`);
    }
    return parts.join(" ");
  }

  if (action === "order.deleted") {
    return "Pesanan dihapus permanen beserta riwayatnya";
  }

  // Action lain yang belum diterjemahkan — tampilkan ringkasan generik dari detail-nya.
  if (!detail) return "—";
  if (typeof detail === "object") {
    const entries = Object.entries(detail);
    if (entries.length === 0) return "—";
    return entries.map(([k, v]) => `${k}: ${v === null || v === undefined ? "-" : v}`).join(", ");
  }
  return String(detail);
}

export default function AuditLog() {
  const [rows, setRows] = useState(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [actionFilter, setActionFilter] = useState("");
  const [error, setError] = useState("");
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    setOffset(0);
  }, [actionFilter]);

  useEffect(() => {
    const load = async () => {
      setError("");
      setForbidden(false);
      try {
        const params = new URLSearchParams();
        params.set("limit", String(PAGE_SIZE));
        params.set("offset", String(offset));
        if (actionFilter) params.set("action", actionFilter);
        const data = await api.get(`/audit-log?${params.toString()}`);
        setRows(data?.items || []);
        setTotal(data?.total || 0);
      } catch (err) {
        if (err.status === 403) {
          setForbidden(true);
          setRows([]);
        } else {
          setError(err.message);
        }
      }
    };
    load();
  }, [offset, actionFilter]);

  const rangeStart = total === 0 ? 0 : offset + 1;
  const rangeEnd = Math.min(offset + (rows?.length || 0), total);

  return (
    <div>
      <div className="toolbar">
        <div>
          <h1>Catatan Aktivitas</h1>
          <p className="page-subtitle">
            Riwayat siapa mengubah apa — terutama perubahan yang menyangkut uang (status pengiriman, COD,
            penghapusan pesanan).
          </p>
        </div>
      </div>

      {forbidden ? (
        <div className="panel">
          <div className="empty-state">Halaman ini hanya untuk pemilik dan admin.</div>
        </div>
      ) : (
        <>
          <div className="toolbar" style={{ margin: "10px 0 14px" }}>
            <Pilih value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} style={{ maxWidth: 260 }}>
              <option value="">Semua Tindakan</option>
              {ACTION_OPTIONS.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </Pilih>
          </div>

          {error && <div className="error-box">{error}</div>}

          <div className="panel">
            {rows === null ? (
              <div className="loading-block">Memuat...</div>
            ) : rows.length === 0 ? (
              <div className="empty-state">
                {actionFilter ? "Tidak ada catatan untuk tindakan ini." : "Belum ada catatan aktivitas."}
              </div>
            ) : (
              <>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Waktu</th>
                        <th>Pelaku</th>
                        <th>Tindakan</th>
                        <th>Ringkasan</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.id}>
                          <td>{formatTime(r.created_at)}</td>
                          <td>
                            <div className="audit-actor-name">{r.actor_name || "Sistem"}</div>
                            {r.actor_email && <div className="audit-actor-email">{r.actor_email}</div>}
                          </td>
                          <td>
                            <span className="badge gray">{actionLabel(r.action)}</span>
                          </td>
                          <td className="audit-detail">{formatDetail(r.action, r.detail)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {total > 0 && (
                  <div className="pagination-bar">
                    <span>
                      Menampilkan {rangeStart}–{rangeEnd} dari {total}
                    </span>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        type="button"
                        className="btn-link"
                        disabled={offset === 0}
                        onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
                      >
                        Sebelumnya
                      </button>
                      <button
                        type="button"
                        className="btn-link"
                        disabled={offset + PAGE_SIZE >= total}
                        onClick={() => setOffset((o) => o + PAGE_SIZE)}
                      >
                        Berikutnya
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
