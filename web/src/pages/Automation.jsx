import { useEffect, useState } from "react";
import { api } from "../api";
import Check from "../components/Check";

function centsToRmInput(cents) {
  if (cents === null || cents === undefined) return "";
  return String(Number(cents) / 100);
}
function rmInputToCents(value) {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  if (Number.isNaN(n)) return null;
  return Math.round(n * 100);
}

export default function Automation() {
  const [settings, setSettings] = useState(null);
  const [channels, setChannels] = useState([]);
  const [error, setError] = useState("");

  // --- Grup closingan ---
  const [groupChannelId, setGroupChannelId] = useState("");
  const [groups, setGroups] = useState(null);
  const [groupsError, setGroupsError] = useState("");
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [selectedGroupJid, setSelectedGroupJid] = useState("");
  const [savingGroup, setSavingGroup] = useState(false);
  const [groupSaved, setGroupSaved] = useState(false);

  // --- Form pengaturan otomasi ---
  const [form, setForm] = useState({
    groupReportEnabled: false,
    groupDailySummaryEnabled: false,
    dailyReportChannelId: "",
    followupEnabled: false,
    followupMaxAttempts: "3",
    aiDailyBudgetRm: "",
    aiModelSmall: "",
  });
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saved, setSaved] = useState(false);

  const load = async () => {
    try {
      const [s, c] = await Promise.all([api.get("/settings"), api.get("/channels")]);
      setSettings(s);
      setChannels(c);
      setForm({
        groupReportEnabled: Boolean(s.closingGroup?.reportEnabled),
        groupDailySummaryEnabled: Boolean(s.closingGroup?.dailySummaryEnabled),
        dailyReportChannelId: s.dailyReport?.channelId || "",
        followupEnabled: Boolean(s.followup?.enabled),
        followupMaxAttempts: String(s.followup?.maxAttempts ?? 3),
        aiDailyBudgetRm: centsToRmInput(s.ai?.dailyBudgetCents),
        aiModelSmall: s.ai?.modelSmall || "",
      });
      setGroupChannelId(s.closingGroup?.channelId || "");
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const qrChannels = channels.filter((c) => c.connection_type === "qr_session");
  const channelLabel = (id) => channels.find((c) => c.id === id)?.label || channels.find((c) => c.id === id)?.display_phone_number || "—";

  const loadGroups = async () => {
    if (!groupChannelId) return;
    setGroupsLoading(true);
    setGroupsError("");
    setGroups(null);
    try {
      const data = await api.get(`/groups/${groupChannelId}`);
      setGroups(data.items || []);
    } catch (err) {
      // Tampilkan pesan error apa adanya (mis. 501 "fitur belum tersedia...")
      setGroupsError(err.message);
    } finally {
      setGroupsLoading(false);
    }
  };

  const saveGroup = async () => {
    const group = groups?.find((g) => g.jid === selectedGroupJid);
    if (!group || !groupChannelId) return;
    setSavingGroup(true);
    setGroupsError("");
    setGroupSaved(false);
    try {
      await api.post("/groups/select", { channelId: groupChannelId, jid: group.jid, name: group.name });
      setGroupSaved(true);
      await load();
    } catch (err) {
      setGroupsError(err.message);
    } finally {
      setSavingGroup(false);
    }
  };

  const saveAutomation = async (e) => {
    e.preventDefault();
    setSaveBusy(true);
    setSaveError("");
    setSaved(false);
    try {
      await api.patch("/settings/automation", {
        groupReportEnabled: form.groupReportEnabled,
        groupDailySummaryEnabled: form.groupDailySummaryEnabled,
        dailyReportChannelId: form.dailyReportChannelId || null,
        followupEnabled: form.followupEnabled,
        followupMaxAttempts: Number(form.followupMaxAttempts) || 3,
        aiDailyBudgetCents: rmInputToCents(form.aiDailyBudgetRm),
        aiModelSmall: form.aiModelSmall || null,
      });
      setSaved(true);
      await load();
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaveBusy(false);
    }
  };

  if (!settings) {
    return (
      <div>
        <h1>Otomatisasi AI</h1>
        {error ? <div className="error-box">{error}</div> : <div className="loading-block">Memuat...</div>}
      </div>
    );
  }

  return (
    <div>
      <h1>Otomatisasi AI</h1>
      <p className="page-subtitle">
        Grup closingan, laporan harian, follow-up otomatis, dan batas biaya AI — semua di satu tempat.
      </p>

      {error && <div className="error-box">{error}</div>}

      {/* ===================== Grup Closingan ===================== */}
      <div className="panel">
        <h2>Grup Closingan WhatsApp</h2>
        <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: -8, marginBottom: 16 }}>
          Hanya nomor jalur QR/pairing yang bisa dipakai (grup bukan konsep yang didukung WhatsApp
          Cloud API resmi).
          {settings.closingGroup?.name && (
            <>
              {" "}
              Grup tersimpan saat ini: <strong>{settings.closingGroup.name}</strong> (via{" "}
              {channelLabel(settings.closingGroup.channelId)}).
            </>
          )}
        </p>
        {qrChannels.length === 0 ? (
          <div className="empty-state">
            Belum ada nomor jalur QR/pairing. Sambungkan salah satu di halaman Nomor WhatsApp dulu.
          </div>
        ) : (
          <>
            <div className="inline-form">
              <div className="field">
                <label>Nomor WhatsApp</label>
                <select
                  value={groupChannelId}
                  onChange={(e) => {
                    setGroupChannelId(e.target.value);
                    setGroups(null);
                    setGroupsError("");
                    setSelectedGroupJid("");
                  }}
                >
                  <option value="">Pilih nomor...</option>
                  {qrChannels.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label || c.display_phone_number || c.id}
                    </option>
                  ))}
                </select>
              </div>
              <button className="btn secondary" type="button" disabled={!groupChannelId || groupsLoading} onClick={loadGroups}>
                {groupsLoading ? "Memuat..." : "Muat Daftar Grup"}
              </button>
            </div>

            {groupsError && <div className="error-box">{groupsError}</div>}

            {groups && (
              groups.length === 0 ? (
                <div className="empty-state">Nomor ini belum tergabung di grup WhatsApp mana pun.</div>
              ) : (
                <div className="group-picker">
                  {groups.map((g) => (
                    <label key={g.jid} className="group-picker-item">
                      <input
                        type="radio"
                        name="closing-group"
                        value={g.jid}
                        checked={selectedGroupJid === g.jid}
                        onChange={() => setSelectedGroupJid(g.jid)}
                      />
                      {g.name}
                    </label>
                  ))}
                </div>
              )
            )}

            {groups && groups.length > 0 && (
              <button className="btn" type="button" disabled={!selectedGroupJid || savingGroup} onClick={saveGroup} style={{ marginTop: 10 }}>
                {savingGroup ? "Menyimpan..." : "Simpan Grup Closingan"}
              </button>
            )}
            {groupSaved && <div className="success-box" style={{ marginTop: 10 }}>Grup closingan tersimpan.</div>}
          </>
        )}
      </div>

      {/* ===================== Form pengaturan otomasi ===================== */}
      <form className="panel" onSubmit={saveAutomation}>
        <h2>Pengaturan Otomasi</h2>
        {saveError && <div className="error-box">{saveError}</div>}
        {saved && <div className="success-box">Pengaturan tersimpan.</div>}

        <div className="field">
          <Check
            checked={form.groupReportEnabled}
            onChange={(e) => setForm((f) => ({ ...f, groupReportEnabled: e.target.checked }))}
            label="Kirim rekap closing ke grup"
          />
          <small className="field-hint">
            Kalau dinyalakan, setiap pesanan berstatus "Closing" otomatis diposting ke grup closingan
            yang dipilih di atas.
          </small>
        </div>

        <div className="field">
          <Check
            checked={form.groupDailySummaryEnabled}
            onChange={(e) => setForm((f) => ({ ...f, groupDailySummaryEnabled: e.target.checked }))}
            label="Kirim ringkasan harian ke grup"
          />
          <small className="field-hint">
            Kalau dinyalakan, grup closingan akan menerima ringkasan performa hari itu (jumlah closing,
            retur, dll) sekali sehari.
          </small>
        </div>

        <div className="field">
          <label>Nomor pengirim laporan harian</label>
          <select
            value={form.dailyReportChannelId}
            onChange={(e) => setForm((f) => ({ ...f, dailyReportChannelId: e.target.value }))}
          >
            <option value="">— nomor pertama yang terhubung (default) —</option>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label || c.display_phone_number || c.id}
              </option>
            ))}
          </select>
          <small className="field-hint">Nomor WhatsApp yang dipakai untuk mengirim laporan harian ke owner.</small>
        </div>

        <div className="field">
          <Check
            checked={form.followupEnabled}
            onChange={(e) => setForm((f) => ({ ...f, followupEnabled: e.target.checked }))}
            label="Aktifkan follow-up otomatis"
          />
          <small className="field-hint">
            Kalau dinyalakan, pelanggan yang tidak membalas akan otomatis di-follow-up ulang secara
            berjadwal (H+1, H+3, H+7, dst) sampai batas percobaan di bawah.
          </small>
        </div>

        <div className="field" style={{ maxWidth: 220 }}>
          <label>Batas percobaan follow-up</label>
          <input
            type="number"
            min="1"
            max="10"
            value={form.followupMaxAttempts}
            onChange={(e) => setForm((f) => ({ ...f, followupMaxAttempts: e.target.value }))}
          />
          <small className="field-hint">Maksimal berapa kali follow-up dikirim sebelum berhenti otomatis.</small>
        </div>

        <div className="inline-form">
          <div className="field">
            <label>Batas biaya AI harian (RM)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={form.aiDailyBudgetRm}
              onChange={(e) => setForm((f) => ({ ...f, aiDailyBudgetRm: e.target.value }))}
              placeholder="Kosongkan = tanpa batas"
            />
          </div>
          <div className="field">
            <label>Model kecil (untuk tugas ringan/murah)</label>
            <input
              value={form.aiModelSmall}
              onChange={(e) => setForm((f) => ({ ...f, aiModelSmall: e.target.value }))}
              placeholder="claude-haiku-4-5-20251001"
            />
          </div>
        </div>
        <small className="field-hint" style={{ display: "block", marginTop: -8, marginBottom: 14 }}>
          Kalau batas biaya harian tercapai, AI otomatis pindah memakai model kecil di atas (lebih
          murah) sampai keesokan harinya, supaya tagihan tidak jebol.
        </small>

        <button className="btn" type="submit" disabled={saveBusy}>
          {saveBusy ? "Menyimpan..." : "Simpan Pengaturan"}
        </button>
      </form>
    </div>
  );
}
