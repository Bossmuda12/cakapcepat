import { useEffect, useState } from "react";
import { api } from "../api";
import Modal from "../components/Modal";

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

const emptyAiForm = { apiKey: "", model: "", systemPrompt: "" };

export default function Automations() {
  const [rows, setRows] = useState(null);
  const [channels, setChannels] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const [settings, setSettings] = useState(null);
  const [aiForm, setAiForm] = useState(emptyAiForm);
  const [aiError, setAiError] = useState("");
  const [aiSaved, setAiSaved] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);

  const load = async () => {
    try {
      const [a, c, s] = await Promise.all([
        api.get("/automations"),
        api.get("/channels"),
        api.get("/settings"),
      ]);
      setRows(a);
      setChannels(c);
      setSettings(s);
      setAiForm((f) => ({ ...f, model: s.ai.model || "", systemPrompt: s.ai.systemPrompt || "" }));
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

  const onSaveAi = async (e) => {
    e.preventDefault();
    setAiBusy(true);
    setAiError("");
    setAiSaved(false);
    try {
      const payload = {
        model: aiForm.model || undefined,
        systemPrompt: aiForm.systemPrompt || undefined,
      };
      if (aiForm.apiKey) payload.apiKey = aiForm.apiKey;
      await api.put("/settings/ai", payload);
      setAiForm((f) => ({ ...f, apiKey: "" }));
      setAiSaved(true);
      await load();
    } catch (err) {
      setAiError(err.message);
    } finally {
      setAiBusy(false);
    }
  };

  return (
    <div>
      <div className="toolbar">
        <div>
          <h1>Otomatisasi</h1>
          <p className="page-subtitle">Auto-reply per nomor WhatsApp: kata kunci, jam kerja, atau fallback ke AI.</p>
        </div>
        <button className="btn" onClick={() => setShowForm(true)}>
          + Tambah Aturan
        </button>
      </div>

      {error && !showForm && <div className="error-box">{error}</div>}

      <form className="panel" onSubmit={onSaveAi}>
        <h2>AI Chatbot (Claude)</h2>
        <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: -8, marginBottom: 16 }}>
          API key didapat dari{" "}
          <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
            console.anthropic.com/settings/keys
          </a>
          . AI hanya menjawab pakai isi Knowledge Base — kalau tidak tahu, dia bilang tidak tahu.
          {settings && (
            <>
              {" "}
              Status saat ini:{" "}
              {settings.ai.configured ? (
                <span className="badge green">Terkonfigurasi</span>
              ) : (
                <span className="badge gray">Belum diisi</span>
              )}
            </>
          )}
        </p>
        {aiError && <div className="error-box">{aiError}</div>}
        {aiSaved && (
          <div className="panel" style={{ borderColor: "#bbf7d0", background: "#f0fdf4", padding: 10, marginBottom: 14 }}>
            Tersimpan.
          </div>
        )}
        <div className="inline-form">
          <div className="field">
            <label>
              Claude API Key {settings?.ai.apiKeyMasked ? `(saat ini: ${settings.ai.apiKeyMasked})` : ""}
            </label>
            <input
              type="password"
              value={aiForm.apiKey}
              onChange={(e) => setAiForm((f) => ({ ...f, apiKey: e.target.value }))}
              placeholder="sk-ant-... (kosongkan kalau tidak diganti)"
            />
          </div>
          <div className="field">
            <label>Model</label>
            <input
              value={aiForm.model}
              onChange={(e) => setAiForm((f) => ({ ...f, model: e.target.value }))}
              placeholder="claude-haiku-4-5-20251001"
            />
          </div>
        </div>
        <div className="field">
          <label>Persona / instruksi tambahan (opsional)</label>
          <textarea
            rows={3}
            value={aiForm.systemPrompt}
            onChange={(e) => setAiForm((f) => ({ ...f, systemPrompt: e.target.value }))}
            placeholder="mis. Kamu adalah CS toko skincare, jawab ramah & singkat, pakai emoji sesekali."
          />
        </div>
        <button className="btn" type="submit" disabled={aiBusy} style={{ marginTop: 4 }}>
          {aiBusy ? "Menyimpan..." : "Simpan Pengaturan AI"}
        </button>
      </form>

      <Modal open={showForm} onClose={() => setShowForm(false)} title="Aturan otomatisasi baru" width={560}>
        <form onSubmit={onCreate}>
          {error && <div className="error-box">{error}</div>}
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
              aturan kata kunci/jam kerja yang cocok, dan kalau pengaturan AI di atas sudah diisi.
            </p>
          )}

          <button className="btn block" type="submit" disabled={busy} style={{ marginTop: 12 }}>
            {busy ? "Menyimpan..." : "Simpan Aturan"}
          </button>
        </form>
      </Modal>

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
