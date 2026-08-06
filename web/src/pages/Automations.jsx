import { useEffect, useState } from "react";
import { api } from "../api";

const TRIGGER_LABELS = {
  keyword: "Kata kunci",
  office_hours: "Jam kerja",
  fallback_to_ai: "Fallback ke AI",
};

const emptyForm = {
  channelId: "",
  triggerType: "keyword",
  keyword: "",
  reply: "",
  start: "09:00",
  end: "17:00",
  outsideReply: "",
};

export default function Automations() {
  const [rows, setRows] = useState(null);
  const [channels, setChannels] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const load = async () => {
    try {
      const [a, c] = await Promise.all([api.get("/automations"), api.get("/channels")]);
      setRows(a);
      setChannels(c);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const update = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const onCreate = async (e) => {
    e.preventDefault();
    if (!form.channelId) return;
    setBusy(true);
    setError("");
    try {
      let config = {};
      if (form.triggerType === "keyword") config = { keyword: form.keyword, reply: form.reply };
      if (form.triggerType === "office_hours")
        config = { start: form.start, end: form.end, outsideReply: form.outsideReply };

      await api.post("/automations", {
        channelId: form.channelId,
        triggerType: form.triggerType,
        config,
      });
      setForm(emptyForm);
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (automation) => {
    try {
      await api.patch(`/automations/${automation.id}`, { isActive: !automation.is_active });
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const remove = async (id) => {
    try {
      await api.del(`/automations/${id}`);
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const describe = (a) => {
    if (a.trigger_type === "keyword") return `Kalau ada kata "${a.config?.keyword}" → balas "${a.config?.reply}"`;
    if (a.trigger_type === "office_hours")
      return `Di luar jam ${a.config?.start}–${a.config?.end} → balas "${a.config?.outsideReply}"`;
    return "Kalau tidak ada aturan lain yang cocok, biarkan AI chatbot menjawab";
  };

  return (
    <div>
      <div className="toolbar">
        <div>
          <h1>Otomatisasi</h1>
          <p className="page-subtitle">Auto-reply per nomor WhatsApp: kata kunci, jam kerja, atau fallback ke AI.</p>
        </div>
        <button className="btn" onClick={() => setShowForm((s) => !s)}>
          {showForm ? "Batal" : "+ Tambah Aturan"}
        </button>
      </div>

      {error && <div className="error-box">{error}</div>}

      {showForm && (
        <form className="panel" onSubmit={onCreate}>
          <h2>Aturan baru</h2>
          <div className="inline-form">
            <div className="field">
              <label>Nomor WhatsApp</label>
              <select value={form.channelId} onChange={update("channelId")} required>
                <option value="">Pilih nomor...</option>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label || c.display_phone_number || c.id}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Jenis aturan</label>
              <select value={form.triggerType} onChange={update("triggerType")}>
                <option value="keyword">Kata kunci</option>
                <option value="office_hours">Jam kerja</option>
                <option value="fallback_to_ai">Fallback ke AI</option>
              </select>
            </div>
          </div>

          {form.triggerType === "keyword" && (
            <div className="inline-form">
              <div className="field">
                <label>Kata kunci</label>
                <input value={form.keyword} onChange={update("keyword")} placeholder="mis. harga" required />
              </div>
              <div className="field">
                <label>Balasan otomatis</label>
                <input value={form.reply} onChange={update("reply")} required />
              </div>
            </div>
          )}

          {form.triggerType === "office_hours" && (
            <div className="inline-form">
              <div className="field">
                <label>Jam mulai (WIB)</label>
                <input type="time" value={form.start} onChange={update("start")} />
              </div>
              <div className="field">
                <label>Jam selesai (WIB)</label>
                <input type="time" value={form.end} onChange={update("end")} />
              </div>
              <div className="field">
                <label>Balasan di luar jam kerja</label>
                <input value={form.outsideReply} onChange={update("outsideReply")} required />
              </div>
            </div>
          )}

          {form.triggerType === "fallback_to_ai" && (
            <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
              Tidak perlu isian tambahan — AI akan menjawab pakai Knowledge Base kalau tidak ada
              aturan kata kunci/jam kerja yang cocok, dan kalau AI_PROVIDER_API_KEY sudah diisi.
            </p>
          )}

          <button className="btn" type="submit" disabled={busy} style={{ marginTop: 12 }}>
            {busy ? "Menyimpan..." : "Simpan Aturan"}
          </button>
        </form>
      )}

      <div className="panel">
        {rows === null ? (
          <div className="loading-block">Memuat...</div>
        ) : rows.length === 0 ? (
          <div className="empty-state">
            Belum ada aturan otomatisasi. Tanpa aturan, chat masuk otomatis dijawab AI (kalau sudah
            dikonfigurasi) atau menunggu dijawab manual.
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Nomor WA</th>
                <th>Jenis</th>
                <th>Aturan</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td>{a.channel_label || a.display_phone_number}</td>
                  <td>{TRIGGER_LABELS[a.trigger_type]}</td>
                  <td>{describe(a)}</td>
                  <td>
                    <button className="btn secondary" onClick={() => toggleActive(a)}>
                      {a.is_active ? "Aktif" : "Nonaktif"}
                    </button>
                  </td>
                  <td>
                    <button className="btn secondary" onClick={() => remove(a.id)}>
                      Hapus
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
