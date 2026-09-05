import { useEffect, useRef, useState, useCallback } from "react";
import { api } from "../api";
import { useRealtime } from "../useRealtime";
import Modal from "../components/Modal";
import DateRangeFilter from "../components/DateRangeFilter";
import { defaultRange } from "../dateRangePresets";

const PAGE_SIZE = 50;

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
  const [range, setRange] = useState(defaultRange());
  const [rows, setRows] = useState(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [sendError, setSendError] = useState("");
  const [sending, setSending] = useState(false);
  const [teamMembers, setTeamMembers] = useState([]);
  const [ownerFilter, setOwnerFilter] = useState(""); // "" = semua tim; klik nama -> hanya obrolan nomor dia
  const [products, setProducts] = useState([]);
  const [productFilter, setProductFilter] = useState(""); // "" = semua produk

  const [archiveBusy, setArchiveBusy] = useState(false);
  const [deletingConversation, setDeletingConversation] = useState(false);
  const [deleteConvBusy, setDeleteConvBusy] = useState(false);
  const [deleteConvError, setDeleteConvError] = useState("");
  const [deletingMessage, setDeletingMessage] = useState(null);
  const [deleteMsgBusy, setDeleteMsgBusy] = useState(false);
  const [deleteMsgError, setDeleteMsgError] = useState("");

  const scrollRef = useRef(null);
  const convReqIdRef = useRef(0);
  const msgReqIdRef = useRef(0);

  useEffect(() => {
    api
      .get("/users")
      .then(setTeamMembers)
      .catch(() => {}); // gagal load daftar tim tidak boleh menghalangi halaman utama
    api
      .get("/products")
      .then((data) => setProducts(Array.isArray(data) ? data : data?.items || []))
      .catch(() => {});
  }, []);

  // Debounce kotak pencarian ~300ms supaya tidak nembak API di tiap ketikan.
  useEffect(() => {
    const t = setTimeout(() => setQ(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Ganti filter apa pun -> mulai lagi dari halaman pertama.
  useEffect(() => {
    setOffset(0);
  }, [ownerFilter, productFilter, q, range.from, range.to]);

  // Hanya respons dari permintaan TERAKHIR yang boleh menulis ke state (request id
  // guard) supaya polling, realtime, dan pergantian filter yang datang berbarengan
  // tidak saling menimpa data satu sama lain.
  const loadConversations = useCallback(async () => {
    const myId = ++convReqIdRef.current;
    try {
      const params = new URLSearchParams();
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(offset));
      if (range.from) params.set("from", range.from);
      if (range.to) params.set("to", range.to);
      if (ownerFilter) params.set("ownerUserId", ownerFilter);
      if (productFilter) params.set("productId", productFilter);
      if (q) params.set("q", q);
      const data = await api.get(`/conversations?${params.toString()}`);
      if (myId !== convReqIdRef.current) return; // ada permintaan lebih baru, buang hasil ini
      // Bertahan terhadap dua bentuk respons: array polos (lama) atau {items,total,...} (baru).
      const items = Array.isArray(data) ? data : data?.items || [];
      const totalCount = Array.isArray(data) ? items.length : data?.total ?? items.length;
      setRows(items);
      setTotal(totalCount);
      setSelectedId((prev) => (prev && items.some((r) => r.id === prev) ? prev : items[0]?.id ?? null));
      setError("");
    } catch (err) {
      if (myId === convReqIdRef.current) setError(err.message);
    }
  }, [offset, range.from, range.to, ownerFilter, productFilter, q]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  const loadMessages = useCallback(async (id) => {
    if (!id) return;
    const myId = ++msgReqIdRef.current;
    try {
      const data = await api.get(`/conversations/${id}/messages`);
      if (myId !== msgReqIdRef.current) return;
      setMessages(Array.isArray(data) ? data : data?.items || []);
    } catch (err) {
      if (myId === msgReqIdRef.current) setSendError(err.message);
    }
  }, []);

  // Push real-time: begitu ada pesan/percakapan baru di server, langsung
  // refetch daftar percakapan dan (kalau relevan) thread pesan yang lagi dibuka.
  useRealtime(() => {
    loadConversations();
    if (selectedId) loadMessages(selectedId);
  });

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      return;
    }
    loadMessages(selectedId);
    // Satu polling saja sebagai fallback kalau koneksi realtime putus — daftar
    // percakapan sudah cukup diperbarui lewat realtime + perubahan filter/halaman.
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
      await loadConversations();
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
      await loadConversations();
    } catch (err) {
      setSendError(err.message);
    }
  };

  const toggleArchive = async () => {
    if (!selected) return;
    setArchiveBusy(true);
    setSendError("");
    try {
      const action = selected.status === "archived" ? "unarchive" : "archive";
      await api.post(`/conversations/${selected.id}/${action}`, {});
      await loadConversations();
    } catch (err) {
      setSendError(err.message);
    } finally {
      setArchiveBusy(false);
    }
  };

  const confirmDeleteConversation = async () => {
    if (!selected) return;
    setDeleteConvBusy(true);
    setDeleteConvError("");
    try {
      await api.del(`/conversations/${selected.id}`);
      setDeletingConversation(false);
      setSelectedId(null);
      await loadConversations();
    } catch (err) {
      setDeleteConvError(err.message);
    } finally {
      setDeleteConvBusy(false);
    }
  };

  const confirmDeleteMessage = async () => {
    if (!deletingMessage || !selectedId) return;
    setDeleteMsgBusy(true);
    setDeleteMsgError("");
    try {
      await api.del(`/conversations/${selectedId}/messages/${deletingMessage.id}`);
      setDeletingMessage(null);
      await loadMessages(selectedId);
    } catch (err) {
      setDeleteMsgError(err.message);
    } finally {
      setDeleteMsgBusy(false);
    }
  };

  const statusBadge = (status) => {
    if (status === "open") return <span className="badge green">Terbuka</span>;
    if (status === "pending") return <span className="badge yellow">Pending</span>;
    if (status === "archived") return <span className="badge gray">Diarsipkan</span>;
    return <span className="badge gray">Tertutup</span>;
  };

  const rangeStart = total === 0 ? 0 : offset + 1;
  const rangeEnd = Math.min(offset + (rows?.length || 0), total);

  return (
    <div>
      <div className="toolbar" style={{ marginBottom: 6 }}>
        <div>
          <h1>Percakapan</h1>
          <p className="page-subtitle">
            Inbox WhatsApp semua nomor tim. Klik nama anggota tim di bawah untuk lihat obrolan nomor dia saja.
          </p>
        </div>
        <DateRangeFilter value={range} onChange={setRange} />
      </div>

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

      <div className="toolbar" style={{ margin: "10px 0 14px" }}>
        <input
          type="text"
          placeholder="Cari nama atau nomor..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          style={{ maxWidth: 260 }}
        />
        <select value={productFilter} onChange={(e) => setProductFilter(e.target.value)} style={{ maxWidth: 220 }}>
          <option value="">Semua Produk</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="inbox-shell">
        <div className="inbox-list">
          {rows === null ? (
            <div className="loading-block">Memuat...</div>
          ) : rows.length === 0 ? (
            <div className="empty-state">
              {ownerFilter || productFilter || q ? "Tidak ada percakapan yang cocok dengan filter ini." : "Belum ada percakapan."}
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
                  {r.needs_attention && (
                    <span className="badge red" title={r.attention_reason || "Butuh perhatian"}>
                      !
                    </span>
                  )}
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
                    {selected.needs_attention && (
                      <span className="badge red" title={selected.attention_reason || ""}>
                        {" "}
                        Butuh Perhatian{selected.attention_reason ? `: ${selected.attention_reason}` : ""}
                      </span>
                    )}
                    {selected.ai_paused && <span className="badge gray"> AI Dijeda</span>}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn secondary" onClick={markClosingWon}>
                    Tandai Closing
                  </button>
                  <button className="btn secondary" disabled={archiveBusy} onClick={toggleArchive}>
                    {archiveBusy ? "..." : selected.status === "archived" ? "Buka Arsip" : "Arsipkan"}
                  </button>
                  <button
                    className="btn secondary"
                    style={{ color: "var(--danger)" }}
                    onClick={() => {
                      setDeleteConvError("");
                      setDeletingConversation(true);
                    }}
                  >
                    Hapus
                  </button>
                </div>
              </div>

              {selected.ai_summary && (
                <div className="ai-summary-box">
                  <strong>Ringkasan AI:</strong> {selected.ai_summary}
                </div>
              )}

              <div className="inbox-messages" ref={scrollRef}>
                {messages.length === 0 ? (
                  <div className="empty-state">Belum ada pesan.</div>
                ) : (
                  messages.map((m) => (
                    <div key={m.id} className={`bubble-row ${m.direction === "outbound" ? "out" : "in"}`}>
                      {m.direction !== "outbound" && (
                        <button
                          type="button"
                          className="bubble-delete"
                          title="Hapus pesan"
                          onClick={() => {
                            setDeleteMsgError("");
                            setDeletingMessage(m);
                          }}
                        >
                          Hapus
                        </button>
                      )}
                      <div
                        className={`bubble ${m.direction === "outbound" ? "out" : "in"} ${
                          m.status === "draft" ? "draft" : ""
                        }`}
                      >
                        {m.status === "draft" && <div className="bubble-draft-label">Menunggu persetujuan</div>}
                        {m.media_url && (
                          <div className="bubble-media">
                            {m.media_type === "image" || m.media_type === "sticker" ? (
                              <img src={m.media_url} alt="" />
                            ) : m.media_type === "video" ? (
                              <video src={m.media_url} controls />
                            ) : m.media_type === "audio" ? (
                              <audio src={m.media_url} controls />
                            ) : (
                              <a href={m.media_url} target="_blank" rel="noreferrer" className="bubble-media-doc">
                                📎 Lihat/unduh dokumen
                              </a>
                            )}
                            {m.transcript && <div className="bubble-transcript">"{m.transcript}"</div>}
                          </div>
                        )}
                        {m.content?.body && m.content.body !== m.transcript && (
                          <div className="bubble-text">{m.content.body}</div>
                        )}
                        <div className="bubble-meta">
                          {m.sender_type === "ai" ? "AI · " : ""}
                          {formatTime(m.created_at)}
                        </div>
                      </div>
                      {m.direction === "outbound" && (
                        <button
                          type="button"
                          className="bubble-delete"
                          title="Hapus pesan"
                          onClick={() => {
                            setDeleteMsgError("");
                            setDeletingMessage(m);
                          }}
                        >
                          Hapus
                        </button>
                      )}
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

      <Modal
        open={deletingConversation}
        onClose={() => setDeletingConversation(false)}
        title="Hapus percakapan ini?"
        width={460}
      >
        {selected && (
          <div>
            {deleteConvError && <div className="error-box">{deleteConvError}</div>}
            <p style={{ fontSize: 14 }}>
              Yakin mau menghapus percakapan dengan <strong>{selected.contact_name || selected.wa_number}</strong>?
              Seluruh riwayat pesannya ikut terhapus permanen dan tidak bisa dibatalkan.
            </p>
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button
                type="button"
                className="btn secondary"
                style={{ flex: 1 }}
                onClick={() => setDeletingConversation(false)}
                disabled={deleteConvBusy}
              >
                Batal
              </button>
              <button
                type="button"
                className="btn danger"
                style={{ flex: 1 }}
                onClick={confirmDeleteConversation}
                disabled={deleteConvBusy}
              >
                {deleteConvBusy ? "Menghapus..." : "Ya, Hapus"}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!deletingMessage} onClose={() => setDeletingMessage(null)} title="Hapus pesan ini?" width={420}>
        {deletingMessage && (
          <div>
            {deleteMsgError && <div className="error-box">{deleteMsgError}</div>}
            <p style={{ fontSize: 14 }}>Pesan ini akan dihapus permanen dari riwayat percakapan.</p>
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button
                type="button"
                className="btn secondary"
                style={{ flex: 1 }}
                onClick={() => setDeletingMessage(null)}
                disabled={deleteMsgBusy}
              >
                Batal
              </button>
              <button
                type="button"
                className="btn danger"
                style={{ flex: 1 }}
                onClick={confirmDeleteMessage}
                disabled={deleteMsgBusy}
              >
                {deleteMsgBusy ? "Menghapus..." : "Ya, Hapus"}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
