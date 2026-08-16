import { useEffect, useState } from "react";
import { api } from "../api";
import DateRangeFilter from "../components/DateRangeFilter";
import { defaultRange } from "../dateRangePresets";

export default function Ctwa() {
  const [settings, setSettings] = useState(null);
  const [conversations, setConversations] = useState(null);
  const [events, setEvents] = useState(null);
  const [form, setForm] = useState({ pixelId: "", accessToken: "" });
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [eventsRange, setEventsRange] = useState(defaultRange());

  const load = async () => {
    try {
      const [s, convos] = await Promise.all([
        api.get("/settings"),
        api.get("/conversations?source=ctwa"),
      ]);
      setSettings(s);
      setForm((f) => ({ ...f, pixelId: s.capi.pixelId || "" }));
      setConversations(convos);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    api
      .get(`/ad-events?from=${eventsRange.from}&to=${eventsRange.to}`)
      .then(setEvents)
      .catch((err) => setError(err.message));
  }, [eventsRange.from, eventsRange.to]);

  const onSave = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const payload = { pixelId: form.pixelId || undefined };
      if (form.accessToken) payload.accessToken = form.accessToken;
      await api.put("/settings/capi", payload);
      setForm((f) => ({ ...f, accessToken: "" }));
      setSaved(true);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h1>CTWA &amp; Iklan</h1>
      <p className="page-subtitle">
        Iklan Click-to-WhatsApp dibuat &amp; dikelola di Meta Ads Manager — halaman ini cuma
        menangkap atribusi chat dari iklan itu, dan melapor balik hasil closing lewat Conversions API.
      </p>

      {error && <div className="error-box">{error}</div>}

      <form className="panel" onSubmit={onSave}>
        <h2>Pengaturan Meta Conversions API (CAPI)</h2>
        <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: -8, marginBottom: 16 }}>
          Pixel ID &amp; Access Token didapat dari Events Manager di Meta Business Suite.
          {settings && (
            <>
              {" "}
              Status saat ini:{" "}
              {settings.capi.configured ? (
                <span className="badge green">Terkonfigurasi</span>
              ) : (
                <span className="badge gray">Belum diisi</span>
              )}
            </>
          )}
        </p>
        {saved && <div className="panel" style={{ borderColor: "#bbf7d0", background: "#f0fdf4", padding: 10, marginBottom: 14 }}>Tersimpan.</div>}
        <div className="inline-form">
          <div className="field">
            <label>Pixel ID</label>
            <input
              value={form.pixelId}
              onChange={(e) => setForm((f) => ({ ...f, pixelId: e.target.value }))}
            />
          </div>
          <div className="field">
            <label>
              Access Token {settings?.capi.accessTokenMasked ? `(saat ini: ${settings.capi.accessTokenMasked})` : ""}
            </label>
            <input
              value={form.accessToken}
              onChange={(e) => setForm((f) => ({ ...f, accessToken: e.target.value }))}
              placeholder="Kosongkan kalau tidak diganti"
            />
          </div>
        </div>
        <button className="btn" type="submit" disabled={busy}>
          {busy ? "Menyimpan..." : "Simpan"}
        </button>
      </form>

      <div className="panel">
        <h2>Percakapan dari iklan CTWA</h2>
        {conversations === null ? (
          <div className="loading-block">Memuat...</div>
        ) : conversations.length === 0 ? (
          <div className="empty-state">
            Belum ada chat yang tercatat berasal dari iklan CTWA. Ini otomatis terisi begitu ada
            orang klik iklan lalu chat masuk lewat nomor WA yang terhubung.
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Kontak</th>
                <th>Status</th>
                <th>Sudah lapor konversi?</th>
                <th>Pesan terakhir</th>
              </tr>
            </thead>
            <tbody>
              {conversations.map((c) => (
                <tr key={c.id}>
                  <td>{c.contact_name || c.wa_number}</td>
                  <td>{c.pipeline_stage}</td>
                  <td>
                    <span className={`badge ${c.conversion_reported ? "green" : "gray"}`}>
                      {c.conversion_reported ? "Sudah" : "Belum"}
                    </span>
                  </td>
                  <td>{c.last_message_at ? new Date(c.last_message_at).toLocaleString("id-ID") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <div className="toolbar" style={{ marginBottom: 14 }}>
          <h2 style={{ margin: 0 }}>Log pelaporan ke Meta CAPI</h2>
          <DateRangeFilter value={eventsRange} onChange={setEventsRange} />
        </div>
        {events === null ? (
          <div className="loading-block">Memuat...</div>
        ) : events.length === 0 ? (
          <div className="empty-state">Belum ada event yang dilaporkan.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Kontak</th>
                <th>Event</th>
                <th>Status HTTP</th>
                <th>Waktu</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td>{e.contact_name || e.wa_number}</td>
                  <td>{e.event_name}</td>
                  <td>
                    <span className={`badge ${e.response_status >= 200 && e.response_status < 300 ? "green" : "red"}`}>
                      {e.response_status}
                    </span>
                  </td>
                  <td>{new Date(e.created_at).toLocaleString("id-ID")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
