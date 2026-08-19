import { useEffect, useRef, useState, useCallback } from "react";
import { api } from "../api";
import { useRealtime } from "../useRealtime";

function formatTime(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function Conversations() {
  const [rows, setRows] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [sendError, setSendError] = useState("");
  const [sending, setSending] = useState(false);
  const [teamMembers, setTeamMembers] = useState([]);
  const [ownerFilter, setOwnerFilter] = useState(""); // "" = semua tim; klik nama -> hanya obrolan nomor dia
  const scrollRef = useRef(null);

  useEffect(() => {
    api
      .get("/users")
      .then(setTeamMembers)
      .catch(() => {}); // gagal load daftar tim tidak boleh menghalangi halaman utama
  }, []);

  const loadConversations = useCallback(async (ownerUserId) => {
    try {
      const query = ownerUserId ? `?ownerUserId=${ownerUserId}` : "";
      const data = await api.get(`/conversations${query}`);
      setRows(data);
      return data;
    } catch (err) {
      setError(err.message);
      return [];
    }
  }, []);

  const loadMessages = useCallback(async (id) => {
    if (!id) return;
    try {
      const data = await api.get(`/conversations/${id}/messages`);
      setMessages(data);
    } catch (err) {
      setSendError(err.message);
    }
  }, []);

  useEffect(() => {
    // Ganti filter tim -> daftar percakapan lama sudah tidak relevan, dan
    // percakapan yang lagi dibuka bisa jadi bukan milik tim yang baru dipilih.
    setSelectedId(null);
    loadConversations(ownerFilter).then((data) => {
      if (data.length > 0) setSelectedId(data[0].id);
    });
    // Polling tetap dipertahankan sebagai fallback kalau koneksi WebSocket putus.
    const interval = setInterval(() => loadConversations(ownerFilter), 8000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerFilter]);

  // Push real-time: begitu ada pesan/percakapan baru di server, langsung
  // refetch daftar percakapan dan (kalau relevan) thread pesan yang lagi dibuka.
  useRealtime(() => {
    loadConversations(ownerFilter);
    if (selectedId) loadMessages(selectedId);
  });

  useEffect(() => {
    if (!selectedId) return;
    loadMessages(selectedId);
    const interval = setInterval(() => loadMessages(selectedId), 5000);
    return () => clearInterval(interval);
  }, [selectedId, loadMessages]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const selected = rows?.find((r) => r.id === selectedId);

  const onSend = async (e) => {
    e.preventDefault();
    if (!draft.trim() || !selectedId) return;
    setSending(true);
    setSendError("");
    try {
      await api.post(`/conversations/${selectedId}/messages`, { body: draft });
      setDraft("");
      await loadMessages(selectedId);
      await loadConversations(ownerFilter);
    } catch (err) {
      setSendError(err.message);
    } finally {
      setSending(false);
    }
  };

  const markClosingWon = async () => {
    if (!selectedId) return;
    try {
      await api.post(`/conversations/${selectedId}/pipeline`, { stage: "closing_won" });
      await loadConversations(ownerFilter);
    } catch (err) {
      setSendError(err.message);
    }
  };

  const statusBadge = (status) => {
    if (status === "open") return <span className="badge green">Terbuka</span>;
    if (status === "pending") return <span className="badge yellow">Pending</span>;
    return <span className="badge gray">Tertutup</span>;
  };

  return (
    <div>
      <h1>Percakapan</h1>
      <p className="page-subtitle">
        Inbox WhatsApp semua nomor tim. Klik nama anggota tim di bawah untuk lihat obrolan nomor dia saja.
      </p>

      {teamMembers.length > 0 && (
        <div className="team-filter-row">
          <button
            type="button"
            className={`team-filter-chip ${ownerFilter === "" ? "active" : ""}`}
            onClick={() => setOwnerFilter("")}
          >
            Semua Tim
          </button>
          {teamMembers.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`team-filter-chip ${ownerFilter === m.id ? "active" : ""}`}
              onClick={() => setOwnerFilter(m.id)}
            >
              {m.name || m.email}
            </button>
          ))}
        </div>
      )}

      {error && <div className="error-box">{error}</div>}

      <div className="inbox-shell">
        <div className="inbox-list">
          {rows === null ? (
            <div className="loading-block">Memuat...</div>
          ) : rows.length === 0 ? (
            <div className="empty-state">
              {ownerFilter ? "Belum ada percakapan lewat nomor anggota tim ini." : "Belum ada percakapan."}
            </div>
          ) : (
            rows.map((r) => (
              <button
                key={r.id}
                className={`inbox-list-item ${r.id === selectedId ? "active" : ""}`}
                onClick={() => setSelectedId(r.id)}
              >
                <div className="inbox-list-item-top">
                  <span className="name">{r.contact_name || r.wa_number}</span>
                  {r.ctwa_clid && <span className="badge yellow">Iklan</span>}
                </div>
                <div className="inbox-list-item-bottom">
                  <span>{r.wa_number}</span>
                  <span>{formatTime(r.last_message_at)}</span>
                </div>
                {r.channel_label && <div className="inbox-list-item-channel">{r.channel_label}</div>}
              </button>
            ))
          )}
        </div>

        <div className="inbox-thread">
          {!selected ? (
            <div className="empty-state">Pilih percakapan di sebelah kiri.</div>
          ) : (
            <>
              <div className="inbox-thread-header">
                <div>
                  <div className="name">{selected.contact_name || selected.wa_number}</div>
                  <div className="meta">
                    {selected.wa_number} · {statusBadge(selected.status)}
                    {selected.ctwa_clid && <span className="badge yellow"> Dari iklan CTWA</span>}
                  </div>
                </div>
                <button className="btn secondary" onClick={markClosingWon}>
                  Tandai Closing
                </button>
              </div>

              <div className="inbox-messages" ref={scrollRef}>
                {messages.length === 0 ? (
                  <div className="empty-state">Belum ada pesan.</div>
                ) : (
                  messages.map((m) => (
                    <div key={m.id} className={`bubble ${m.direction === "outbound" ? "out" : "in"}`}>
                      <div className="bubble-text">{m.content?.body}</div>
                      <div className="bubble-meta">
                        {m.sender_type === "ai" ? "AI · " : ""}
                        {formatTime(m.created_at)}
                      </div>
                    </div>
                  ))
                )}
              </div>

              {sendError && <div className="error-box">{sendError}</div>}
              <form className="inbox-composer" onSubmit={onSend}>
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Tulis balasan..."
                />
                <button className="btn" type="submit" disabled={sending}>
                  Kirim
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
