import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import Modal from "../components/Modal";
import ActionBtn from "../components/ActionBtn";

const PAGE_SIZE = 20;

const STATUS_OPTIONS = [
  { value: "", label: "Semua" },
  { value: "scheduled", label: "Terjadwal", tone: "yellow" },
  { value: "sent", label: "Terkirim", tone: "green" },
  { value: "cancelled", label: "Dibatalkan", tone: "gray" },
  { value: "failed", label: "Gagal", tone: "red" },
];

function toneOf(status) {
  return STATUS_OPTIONS.find((s) => s.value === status)?.tone || "gray";
}
function labelOf(status) {
  return STATUS_OPTIONS.find((s) => s.value === status)?.label || status;
}

function formatDateTime(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function FollowUps() {
  const [statusFilter, setStatusFilter] = useState("");
  const [rows, setRows] = useState(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState("");

  const [cancellingRow, setCancellingRow] = useState(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState("");

  useEffect(() => {
    setOffset(0);
  }, [statusFilter]);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(offset));
      if (statusFilter) params.set("status", statusFilter);
      const data = await api.get(`/followups?${params.toString()}`);
      setRows(data.items || []);
      setTotal(data.total || 0);
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }, [statusFilter, offset]);

  useEffect(() => {
    load();
  }, [load]);

  const confirmCancel = async () => {
    if (!cancellingRow) return;
    setCancelBusy(true);
    setCancelError("");
    try {
      await api.post(`/followups/${cancellingRow.id}/cancel`, {});
      setCancellingRow(null);
      await load();
    } catch (err) {
      setCancelError(err.message);
    } finally {
      setCancelBusy(false);
    }
  };

  const rangeStart = total === 0 ? 0 : offset + 1;
  const rangeEnd = Math.min(offset + (rows?.length || 0), total);

  return (
    <div>
      <div className="toolbar">
        <div>
          <h1>Follow-up</h1>
          <p className="page-subtitle">
            Follow-up berjadwal ke pelanggan yang belum membalas (H+1, H+3, H+7, dst) — bisa dibatalkan
            kalau CS sudah menghubungi manual.
          </p>
        </div>
      </div>

      <div className="toolbar" style={{ marginBottom: 14 }}>
        <div className="field" style={{ marginBottom: 0, minWidth: 200 }}>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="panel">
        {rows === null ? (
          <div className="loading-block">Memuat...</div>
        ) : rows.length === 0 ? (
          <div className="empty-state">Belum ada follow-up pada filter ini.</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Kontak</th>
                  <th>Nomor WA</th>
                  <th>Produk</th>
                  <th>Nomor Pengirim</th>
                  <th>Percobaan</th>
                  <th>Terjadwal</th>
                  <th>Status</th>
                  <th>Pesan</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((f) => (
                  <tr key={f.id}>
                    <td>{f.contact_name || "—"}</td>
                    <td>{f.contact_wa_number}</td>
                    <td className="text-muted">{f.product_name || "—"}</td>
                    <td className="text-muted">{f.channel_label || "—"}</td>
                    <td>#{f.attempt}</td>
                    <td>{formatDateTime(f.scheduled_at)}</td>
                    <td>
                      <span className={`badge ${toneOf(f.status)}`}>{labelOf(f.status)}</span>
                      {f.status === "cancelled" && f.cancel_reason && (
                        <div className="text-muted" style={{ fontSize: 11 }}>
                          {f.cancel_reason}
                        </div>
                      )}
                    </td>
                    <td style={{ maxWidth: 240 }} className="text-muted">
                      {f.message_text || "—"}
                    </td>
                    <td>
                      {f.status === "scheduled" && (
                        <ActionBtn
                          kind="hapus"
                          onClick={() => {
                            setCancelError("");
                            setCancellingRow(f);
                          }}
                        >
                          Batalkan
                        </ActionBtn>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {rows !== null && total > 0 && (
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
      </div>

      <Modal open={!!cancellingRow} onClose={() => setCancellingRow(null)} title="Batalkan follow-up ini?" width={440}>
        {cancellingRow && (
          <div>
            {cancelError && <div className="error-box">{cancelError}</div>}
            <p style={{ fontSize: 14 }}>
              Yakin mau membatalkan follow-up percobaan #{cancellingRow.attempt} untuk{" "}
              <strong>{cancellingRow.contact_name || cancellingRow.contact_wa_number}</strong>? Pesan
              follow-up ini tidak akan dikirim.
            </p>
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button
                type="button"
                className="btn secondary"
                style={{ flex: 1 }}
                onClick={() => setCancellingRow(null)}
                disabled={cancelBusy}
              >
                Batal
              </button>
              <button type="button" className="btn danger" style={{ flex: 1 }} onClick={confirmCancel} disabled={cancelBusy}>
                {cancelBusy ? "Memproses..." : "Ya, Batalkan"}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
