import { useEffect, useState } from "react";
import { api, getToken } from "../api";
import DateRangeFilter from "../components/DateRangeFilter";
import { defaultRange } from "../dateRangePresets";

const STATUS_OPTIONS = [
  { value: "qualified_cod", label: "Qualified COD", badge: "yellow" },
  { value: "closing", label: "Closing", badge: "green" },
  { value: "no_response", label: "Tidak Respon", badge: "gray" },
  { value: "cs_blocked", label: "CS Diblokir", badge: "red" },
  { value: "spam", label: "Spam", badge: "gray" },
  { value: "cancelled", label: "Cancelled", badge: "gray" },
  { value: "returned", label: "Returned", badge: "red" },
];

function statusLabel(status) {
  return STATUS_OPTIONS.find((s) => s.value === status)?.label || status || "-";
}
function statusBadge(status) {
  return STATUS_OPTIONS.find((s) => s.value === status)?.badge || "gray";
}
function formatRp(n) {
  return "Rp " + Number(n || 0).toLocaleString("id-ID");
}

function OrderRow({ order, onUpdated }) {
  const [status, setStatus] = useState(order.order_status || "qualified_cod");
  const [value, setValue] = useState(order.order_value ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    setBusy(true);
    setErr("");
    try {
      await api.post(`/conversations/${order.conversation_id}/order-status`, {
        status,
        value: value === "" ? undefined : Number(value),
        note: note || undefined,
      });
      setNote("");
      onUpdated();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <tr>
      <td>{order.contact_name || order.wa_number}</td>
      <td>{order.wa_number}</td>
      <td>
        <span className={`badge ${statusBadge(order.order_status)}`}>{statusLabel(order.order_status)}</span>
      </td>
      <td>{order.order_value ? formatRp(order.order_value) : "—"}</td>
      <td>
        <span className={`badge ${order.ctwa_clid ? "green" : "gray"}`}>{order.ctwa_clid ? "Iklan" : "Organik"}</span>
      </td>
      <td>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ minWidth: 130 }}>
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <input
            type="number"
            placeholder="Nilai (Rp)"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            style={{ width: 100 }}
          />
          <input
            type="text"
            placeholder="Catatan"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            style={{ width: 120 }}
          />
          <button className="btn" type="button" disabled={busy} onClick={submit}>
            {busy ? "..." : "Update"}
          </button>
        </div>
        {err && <div style={{ color: "var(--danger, #dc2626)", fontSize: 12, marginTop: 4 }}>{err}</div>}
      </td>
    </tr>
  );
}

export default function Orders() {
  const [range, setRange] = useState(defaultRange());
  const [summary, setSummary] = useState(null);
  const [orders, setOrders] = useState(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState(false);

  const load = async () => {
    try {
      const [s, o] = await Promise.all([
        api.get(`/orders/summary?from=${range.from}&to=${range.to}`),
        api.get(`/orders?from=${range.from}&to=${range.to}${statusFilter ? `&status=${statusFilter}` : ""}`),
      ]);
      setSummary(s);
      setOrders(o);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from, range.to, statusFilter]);

  const download = async () => {
    setDownloading(true);
    setError("");
    try {
      const res = await fetch(`/api/orders/export.csv?from=${range.from}&to=${range.to}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) throw new Error(`Gagal download laporan (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `laporan-order-cakapcepat-${range.from}-${range.to}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div>
      <h1>Laporan Order COD</h1>
      <p className="page-subtitle">
        Tandai tiap chat sebagai qualified COD / closing / spam / cancel / return — otomatis tercatat di
        sini, sebagian dilaporkan ke Meta CAPI (lihat halaman CTWA &amp; Iklan untuk log pelaporannya), dan
        bisa didownload sebagai spreadsheet kapan saja.
      </p>

      <div className="toolbar" style={{ marginBottom: 18 }}>
        <div />
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <DateRangeFilter value={range} onChange={setRange} />
          <button className="btn" type="button" disabled={downloading} onClick={download}>
            {downloading ? "Menyiapkan..." : "Download Laporan (CSV)"}
          </button>
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}

      {summary && (
        <div className="kpi-grid" style={{ marginBottom: 18 }}>
          {STATUS_OPTIONS.map((s) => (
            <div
              key={s.value}
              className="kpi-card"
              style={{ cursor: "pointer", outline: statusFilter === s.value ? "2px solid var(--accent, #2563eb)" : "none" }}
              onClick={() => setStatusFilter(statusFilter === s.value ? "" : s.value)}
            >
              <div className="label">{s.label}</div>
              <div className="value">{summary[s.value]?.total ?? 0}</div>
              {s.value === "closing" && (
                <div className="label">{formatRp(summary[s.value]?.totalValue ?? 0)}</div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="panel">
        <div className="toolbar" style={{ marginBottom: 14 }}>
          <h2 style={{ margin: 0 }}>Daftar Order</h2>
          {statusFilter && (
            <button className="btn-link" type="button" onClick={() => setStatusFilter("")}>
              Hapus filter ({statusLabel(statusFilter)})
            </button>
          )}
        </div>
        {orders === null ? (
          <div className="loading-block">Memuat...</div>
        ) : orders.length === 0 ? (
          <div className="empty-state">
            Belum ada order yang ditandai di rentang tanggal ini. Buka halaman Percakapan, lalu tandai
            status order dari sini setelah CS menandainya di sana, atau langsung lewat tabel di bawah.
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Kontak</th>
                <th>No WhatsApp</th>
                <th>Status</th>
                <th>Nilai</th>
                <th>Sumber</th>
                <th>Update Status</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <OrderRow key={o.conversation_id} order={o} onUpdated={load} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
