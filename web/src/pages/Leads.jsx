import { useEffect, useState } from "react";
import { api } from "../api";
import DateRangeFilter from "../components/DateRangeFilter";
import { defaultRange } from "../dateRangePresets";

function formatRupiah(value) {
  if (value === null || value === undefined) return "—";
  return `Rp${Number(value).toLocaleString("id-ID")}`;
}

function LeadTable({ title, icon, leads, emptyText, tone }) {
  return (
    <div className="panel">
      <h2>
        {icon} {title} ({leads.length})
      </h2>
      {leads.length === 0 ? (
        <div className="empty-state">{emptyText}</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Kontak</th>
              <th>Nomor WA</th>
              <th>Peran</th>
              <th>Alasan</th>
              <th>Langkah selanjutnya</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((l, i) => (
              <tr key={i}>
                <td>{l.contactName}</td>
                <td>{l.waNumber}</td>
                <td>{l.role || "—"}</td>
                <td>{l.reason}</td>
                <td>
                  <span className={`badge ${tone}`}>{l.nextStep}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function Leads() {
  const [report, setReport] = useState(null);
  const [settings, setSettings] = useState(null);
  const [form, setForm] = useState({ waNumber: "", enabled: false, hour: 8 });
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [historyRange, setHistoryRange] = useState(defaultRange());
  const [history, setHistory] = useState(null);

  const load = async () => {
    try {
      const [latest, s] = await Promise.all([api.get("/leads/latest"), api.get("/settings")]);
      setReport(latest);
      setSettings(s);
      setForm({
        waNumber: s.dailyReport?.waNumber || "",
        enabled: Boolean(s.dailyReport?.enabled),
        hour: s.dailyReport?.hour ?? 8,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .get(`/leads/history?from=${historyRange.from}&to=${historyRange.to}`)
      .then((data) => {
        if (!cancelled) setHistory(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [historyRange.from, historyRange.to]);

  const runAnalysis = async () => {
    setAnalyzing(true);
    setError("");
    try {
      const result = await api.post("/leads/analyze", {});
      setReport(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setAnalyzing(false);
    }
  };

  const saveDailyReportSettings = async (e) => {
    e.preventDefault();
    setSavingSettings(true);
    setError("");
    setSaved(false);
    try {
      await api.put("/settings/daily-report", {
        waNumber: form.waNumber || undefined,
        enabled: form.enabled,
        hour: Number(form.hour),
      });
      setSaved(true);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingSettings(false);
    }
  };

  if (loading) return <div className="loading-block">Memuat...</div>;

  const hot = report?.hot_leads ?? [];
  const warm = report?.warm_leads ?? [];
  const drop = report?.drop_leads ?? [];
  const flags = report?.flags ?? [];

  return (
    <div>
      <div className="overview-header">
        <div>
          <h1>Leads AI</h1>
          <p className="page-subtitle">
            AI membaca percakapan WhatsApp terbaru, mengelompokkan kontak jadi hot / warm / drop
            leads, memberi estimasi potensi konversi, dan menandai chat yang perlu perhatian —
            mirip laporan yang dikirim tiap pagi.
          </p>
        </div>
        <button className="btn" onClick={runAnalysis} disabled={analyzing}>
          {analyzing ? "Menganalisis..." : "Jalankan analisis sekarang"}
        </button>
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="panel">
        <h2>Ringkasan</h2>
        {report ? (
          <>
            <p>{report.summary}</p>
            <div className="kpi-inline">
              <div>
                <span className="kpi-inline-label">Estimasi potensi konversi</span>
                <span className="kpi-inline-value">{formatRupiah(report.estimated_value)}</span>
              </div>
              <div>
                <span className="kpi-inline-label">Terakhir dianalisis</span>
                <span className="kpi-inline-value">
                  {report.created_at ? new Date(report.created_at).toLocaleString("id-ID") : "—"}
                </span>
              </div>
            </div>
          </>
        ) : (
          <div className="empty-state">
            Belum pernah dianalisis. Klik "Jalankan analisis sekarang" untuk mulai.
          </div>
        )}
      </div>

      <LeadTable
        title="Hot Leads"
        icon="🔥"
        leads={hot}
        tone="green"
        emptyText="Belum ada hot leads terdeteksi."
      />
      <LeadTable
        title="Warm Leads"
        icon="🌤️"
        leads={warm}
        tone="gray"
        emptyText="Belum ada warm leads terdeteksi."
      />
      <LeadTable
        title="Drop Leads"
        icon="❄️"
        leads={drop}
        tone="red"
        emptyText="Belum ada drop leads terdeteksi."
      />

      <div className="panel">
        <div className="toolbar" style={{ marginBottom: 14 }}>
          <h2 style={{ margin: 0 }}>Riwayat Analisis</h2>
          <DateRangeFilter value={historyRange} onChange={setHistoryRange} />
        </div>
        {!history ? (
          <div className="loading-block">Memuat...</div>
        ) : history.length === 0 ? (
          <div className="empty-state">Belum ada analisis pada rentang tanggal ini.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Tanggal</th>
                <th>Hot</th>
                <th>Warm</th>
                <th>Drop</th>
                <th>Estimasi Potensi</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td>{new Date(h.created_at).toLocaleString("id-ID")}</td>
                  <td>{(h.hot_leads ?? []).length}</td>
                  <td>{(h.warm_leads ?? []).length}</td>
                  <td>{(h.drop_leads ?? []).length}</td>
                  <td>{formatRupiah(h.estimated_value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <h2>⚠️ Perlu perhatian (SOP &amp; fraud check ringan)</h2>
        {flags.length === 0 ? (
          <div className="empty-state">Tidak ada percakapan yang ditandai bermasalah.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Kontak</th>
                <th>Masalah</th>
                <th>Tingkat</th>
              </tr>
            </thead>
            <tbody>
              {flags.map((f, i) => (
                <tr key={i}>
                  <td>{f.contactName}</td>
                  <td>{f.issue}</td>
                  <td>
                    <span
                      className={`badge ${
                        f.severity === "high" ? "red" : f.severity === "medium" ? "gray" : "green"
                      }`}
                    >
                      {f.severity}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <form className="panel" onSubmit={saveDailyReportSettings}>
        <h2>Laporan AI harian via WhatsApp</h2>
        <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: -8, marginBottom: 16 }}>
          Kalau diaktifkan, CakapCepat otomatis menganalisis leads tiap hari dan mengirim
          ringkasannya ke nomor WhatsApp di bawah ini.
        </p>
        {saved && (
          <div
            className="panel"
            style={{ borderColor: "#bbf7d0", background: "#f0fdf4", padding: 10, marginBottom: 14 }}
          >
            Tersimpan.
          </div>
        )}
        <div className="inline-form">
          <div className="field">
            <label>Nomor WhatsApp penerima</label>
            <input
              value={form.waNumber}
              onChange={(e) => setForm((f) => ({ ...f, waNumber: e.target.value }))}
              placeholder="62812xxxxxxx"
            />
          </div>
          <div className="field">
            <label>Jam kirim (0–23)</label>
            <input
              type="number"
              min="0"
              max="23"
              value={form.hour}
              onChange={(e) => setForm((f) => ({ ...f, hour: e.target.value }))}
            />
          </div>
          <div className="field">
            <label>Status</label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 400 }}>
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
              />
              Aktifkan laporan harian
            </label>
          </div>
        </div>
        <button className="btn" type="submit" disabled={savingSettings}>
          {savingSettings ? "Menyimpan..." : "Simpan"}
        </button>
        {settings?.dailyReport?.lastSentAt && (
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 12 }}>
            Terakhir terkirim: {new Date(settings.dailyReport.lastSentAt).toLocaleString("id-ID")}
          </p>
        )}
      </form>
    </div>
  );
}
