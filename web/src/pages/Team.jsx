import { useEffect, useState } from "react";
import { api } from "../api";
import { useAuth } from "../AuthContext";
import Modal from "../components/Modal";

const emptyForm = { name: "", email: "", password: "", role: "agent" };

const ROLE_LABELS = { owner: "Owner", admin: "Admin", agent: "Agent (CS)" };

const AVATAR_COLORS = ["#2563eb", "#7c3aed", "#0891b2", "#16a34a", "#d97706", "#db2777", "#4f46e5"];

function colorForName(name) {
  const str = name || "?";
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function initialsForName(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase();
}

const RING_RADIUS = 26;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function PerformanceRing({ percent }) {
  const offset = RING_CIRCUMFERENCE * (1 - percent / 100);
  return (
    <div className="team-ring-wrap">
      <svg viewBox="0 0 64 64" className="team-ring">
        <circle cx="32" cy="32" r={RING_RADIUS} className="team-ring-track" />
        <circle
          cx="32"
          cy="32"
          r={RING_RADIUS}
          className="team-ring-progress"
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="team-ring-label">{percent}%</div>
    </div>
  );
}

export default function Team() {
  const { user } = useAuth();
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const canManage = user?.role === "owner" || user?.role === "admin";

  const load = async () => {
    try {
      setRows(await api.get("/team/performance"));
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
    setBusy(true);
    setError("");
    try {
      await api.post("/users", form);
      setForm(emptyForm);
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="toolbar">
        <div>
          <h1>Tim</h1>
          <p className="page-subtitle">Performa harian tiap anggota tim CakapCepat.</p>
        </div>
        {canManage && (
          <button className="btn" onClick={() => setShowForm((s) => !s)}>
            {showForm ? "Batal" : "+ Tambah Anggota"}
          </button>
        )}
      </div>

      {error && !showForm && <div className="error-box">{error}</div>}

      <Modal open={showForm} onClose={() => setShowForm(false)} title="Tambah anggota tim baru">
        <form onSubmit={onCreate}>
          {error && <div className="error-box">{error}</div>}
          <div className="field">
            <label>Nama</label>
            <input value={form.name} onChange={update("name")} required />
          </div>
          <div className="field">
            <label>Email</label>
            <input type="email" value={form.email} onChange={update("email")} required />
          </div>
          <div className="field">
            <label>Password sementara (min. 8 karakter)</label>
            <input
              type="password"
              value={form.password}
              onChange={update("password")}
              minLength={8}
              required
            />
          </div>
          <div className="field">
            <label>Peran</label>
            <select value={form.role} onChange={update("role")}>
              <option value="agent">Agent (CS)</option>
              <option value="admin">Admin</option>
              <option value="owner">Owner</option>
            </select>
          </div>
          <button className="btn block" type="submit" disabled={busy}>
            {busy ? "Menyimpan..." : "Simpan"}
          </button>
        </form>
      </Modal>

      {rows === null ? (
        <div className="loading-block">Memuat...</div>
      ) : rows.length === 0 ? (
        <div className="panel">Belum ada anggota tim.</div>
      ) : (
        <div className="team-grid">
          {rows.map((r) => (
            <div className="team-card panel" key={r.id}>
              <div className="team-card-top">
                <div className="team-avatar" style={{ background: colorForName(r.name) }}>
                  {initialsForName(r.name)}
                  <span
                    className={`team-status-dot ${r.isActiveToday ? "active" : "inactive"}`}
                    title={r.isActiveToday ? "Aktif hari ini" : "Belum ada aktivitas hari ini"}
                  />
                </div>
                <PerformanceRing percent={r.performancePercent} />
              </div>
              <div className="team-card-name">{r.name || "—"}</div>
              <div className="team-card-email">{r.email}</div>
              <div className="team-tags">
                <span className="badge">{ROLE_LABELS[r.role] || r.role}</span>
                {r.departments.map((d) => (
                  <span className="badge gray" key={d}>
                    {d}
                  </span>
                ))}
              </div>
              <div className="team-card-stats">
                <div>
                  <div className="team-stat-value">{r.messagesToday}</div>
                  <div className="team-stat-label">Pesan hari ini</div>
                </div>
                <div>
                  <div className="team-stat-value">{r.openConversations}</div>
                  <div className="team-stat-label">Percakapan terbuka</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
