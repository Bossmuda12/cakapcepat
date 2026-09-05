import { useEffect, useState } from "react";
import { api } from "../api";

// Komponen laporan "tingkat retur per produk" (F-24) — dipakai sebagai panel
// di halaman Pesanan (bukan halaman/rute terpisah), supaya owner bisa
// langsung lihat produk mana yang tingkat returnya tinggi tanpa pindah menu.
// Tingkat retur dihitung backend sebagai returned / closing (lihat komentar
// GET /orders/stats di routes/orders.ts).

function returnRateTone(rate) {
  if (rate === null || rate === undefined) return "gray";
  if (rate < 0.1) return "green";
  if (rate <= 0.2) return "yellow";
  return "red";
}

function formatPercent(rate) {
  if (rate === null || rate === undefined) return "—";
  return `${(rate * 100).toFixed(1)}%`;
}

export default function OrdersStats({ from, to }) {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    api
      .get(`/orders/stats?from=${from}&to=${to}`)
      .then((data) => {
        if (!cancelled) setStats(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [from, to]);

  if (error) return <div className="error-box">{error}</div>;
  if (!stats) return <div className="loading-block">Memuat laporan...</div>;

  const { overall, byProduct } = stats;

  return (
    <div>
      <div className="kpi-grid" style={{ marginBottom: 18 }}>
        <div className="kpi-card">
          <div className="label">Total Pesanan</div>
          <div className="value">{overall.totalOrders}</div>
        </div>
        <div className="kpi-card">
          <div className="label">Closing</div>
          <div className="value">{overall.closingCount}</div>
        </div>
        <div className="kpi-card">
          <div className="label">Terkirim (Delivered)</div>
          <div className="value">{overall.deliveredCount}</div>
        </div>
        <div className="kpi-card">
          <div className="label">Retur</div>
          <div className="value">{overall.returnedCount}</div>
        </div>
        <div className="kpi-card">
          <div className="label">Tingkat Retur</div>
          <div className="value">
            <span className={`badge ${returnRateTone(overall.returnRate)}`} style={{ fontSize: 15 }}>
              {formatPercent(overall.returnRate)}
            </span>
          </div>
        </div>
      </div>

      {byProduct.length === 0 ? (
        <div className="empty-state">Belum ada pesanan pada rentang tanggal ini.</div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Produk</th>
                <th>Total Pesanan</th>
                <th>Closing</th>
                <th>Terkirim</th>
                <th>Retur</th>
                <th>Tingkat Retur</th>
              </tr>
            </thead>
            <tbody>
              {byProduct.map((p) => (
                <tr key={p.productId || "tanpa-produk"}>
                  <td>{p.productName}</td>
                  <td>{p.totalOrders}</td>
                  <td>{p.closingCount}</td>
                  <td>{p.deliveredCount}</td>
                  <td>{p.returnedCount}</td>
                  <td>
                    <span className={`badge ${returnRateTone(p.returnRate)}`}>{formatPercent(p.returnRate)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
