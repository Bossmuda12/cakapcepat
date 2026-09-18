import { useEffect, useRef, useState, useCallback } from "react";
import { api } from "../api";
import { useRealtime } from "../useRealtime";
import Modal from "../components/Modal";
import DateRangeFilter from "../components/DateRangeFilter";
import EmojiPicker from "../components/EmojiPicker";
import { defaultRange } from "../dateRangePresets";

const PAGE_SIZE = 50;

/* Inisial + warna tetap per kontak — daftar inbox jauh lebih cepat dipindai
   dengan avatar daripada dengan blok teks seragam. */
const AVATAR_TONES = ["#6d5dfb", "#0891b2", "#059669", "#d97706", "#db2777", "#2563eb"];

function Avatar({ name, number, small, large }) {
  const label = (name || number || "?").trim();
  const initial = label.charAt(0).toUpperCase();
  let hash = 0;
  for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) % 997;
  const tone = AVATAR_TONES[hash % AVATAR_TONES.length];
  const cls = `chat-avatar${small ? " small" : ""}${large ? " large" : ""}`;
  return (
    <span className={cls} style={{ background: tone }} aria-hidden="true">
      {initial}
    </span>
  );
}

/* Cuplikan pesan terakhir: teks apa adanya, atau keterangan jenis media. */
function previewOf(row) {
  if (row.last_message_body && row.last_message_body.trim()) {
    const prefix = row.last_message_direction === "outbound" ? (row.last_message_sender_type === "ai" ? "AI: " : "Kita: ") : "";
    return prefix + row.last_message_body.replace(/\s+/g, " ").slice(0, 90);
  }
  if (row.last_message_media_type) {
    const jenis = { image: "Foto", video: "Video", audio: "Pesan suara", sticker: "Stiker" };
    return jenis[row.last_message_media_type] || "Dokumen";
  }
  return "Belum ada pesan";
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function shortTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  const kemarin = new Date(now);
  kemarin.setDate(now.getDate() - 1);
  if (d.toDateString() === kemarin.toDateString()) return "Kemarin";
  return d.toLocaleDateString("id-ID", { day: "2-digit", month: "short" });
}

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
  const [detailOpen, setDetailOpen] = useState(true); // panel kanan (detail pelanggan)
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [attachment, setAttachment] = useState(null); // { file, previewUrl }
  const [uploading, setUploading] = useState(false);

  const [archiveBusy, setArchiveBusy] = useState(false);
  const [deletingConversation, setDeletingConversation] = useState(false);
  const [deleteConvBusy, setDeleteConvBusy] = useState(false);
  const [deleteConvError, setDeleteConvError] = useState("");
  const [deletingMessage, setDeletingMessage] = useState(null);
  const [deleteMsgBusy, setDeleteMsgBusy] = useState(false);
  const [deleteMsgError, setDeleteMsgError] = useState("");

  const scrollRef = useRef(null);
  const fileRef = useRef(null);
  const draftRef = useRef(null);
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

  const clearAttachment = () => {
    setAttachment((a) => {
      if (a?.previewUrl) URL.revokeObjectURL(a.previewUrl);
      return null;
    });
    if (fileRef.current) fileRef.current.value = "";
  };

  const onPickFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSendError("");
    const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
    setAttachment({ file, previewUrl });
  };

  const onSend = async (e) => {
    e.preventDefault();
    if (!selectedId) return;
    if (!attachment && !draft.trim()) return;

    setSendError("");
    if (attachment) {
      // Lampiran dikirim bersama teks yang sudah diketik sebagai caption —
      // persis seperti WhatsApp Business: satu foto + satu keterangan.
      setUploading(true);
      try {
        await api.upload(
          `/conversations/${selectedId}/attachments`,
          attachment.file,
          draft.trim() ? { caption: draft.trim() } : {}
        );
        clearAttachment();
        setDraft("");
        await loadMessages(selectedId);
        await loadConversations();
      } catch (err) {
        setSendError(err.message);
      } finally {
        setUploading(false);
      }
      return;
    }

    setSending(true);
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

  const insertEmoji = (emoji) => {
    setDraft((d) => d + emoji);
    draftRef.current?.focus();
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
    <div className="chat-page">
      <div className="chat-page-head">
        <div>
          <h1>Percakapan</h1>
          <p className="page-subtitle">
            Inbox WhatsApp semua nomor tim. Klik nama anggota tim untuk melihat obrolan nomor dia saja.
          </p>
        </div>
        <DateRangeFilter value={range} onChange={setRange} />
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="chat-shell">
        {/* ---------- Panel 1: daftar percakapan ---------- */}
        <aside className="chat-list">
          <div className="chat-list-head">
            <div className="chat-search">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input
                type="search"
                placeholder="Cari nama atau nomor..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                aria-label="Cari percakapan"
              />
            </div>
            <select
              className="chat-filter"
              value={productFilter}
              onChange={(e) => setProductFilter(e.target.value)}
              aria-label="Saring menurut produk"
            >
              <option value="">Semua produk</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {teamMembers.length > 0 && (
              <div className="chat-chiprow">
                <button
                  type="button"
                  className={`chat-chip ${ownerFilter === "" ? "active" : ""}`}
                  onClick={() => setOwnerFilter("")}
                >
                  Semua tim
                </button>
                {teamMembers.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className={`chat-chip ${ownerFilter === m.id ? "active" : ""}`}
                    onClick={() => setOwnerFilter(m.id)}
                  >
                    {m.name || m.email}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="chat-list-scroll">
            {rows === null ? (
              <div className="loading-block">Memuat...</div>
            ) : rows.length === 0 ? (
              <div className="empty-state">
                {ownerFilter || productFilter || q
                  ? "Tidak ada percakapan yang cocok dengan filter ini."
                  : "Belum ada percakapan."}
              </div>
            ) : (
              rows.map((r) => (
                <button
                  key={r.id}
                  className={`chat-list-item ${r.id === selectedId ? "active" : ""}`}
                  onClick={() => setSelectedId(r.id)}
                >
                  <Avatar name={r.contact_name} number={r.wa_number} />
                  <div className="chat-list-item-body">
                    <div className="chat-list-item-top">
                      <span className="name">{r.contact_name || r.wa_number}</span>
                      <span className="time">{shortTime(r.last_message_at)}</span>
                    </div>
                    <div className="chat-list-item-bottom">
                      <span className="preview">{previewOf(r)}</span>
                      {r.needs_attention && (
                        <span className="dot-alert" title={r.attention_reason || "Butuh perhatian"} />
                      )}
                    </div>
                    <div className="chat-list-item-tags">
                      {r.ctwa_clid && <span className="tag tag-ad">Iklan</span>}
                      {r.ai_paused && <span className="tag tag-mute">AI dijeda</span>}
                      {r.channel_label && <span className="tag">{r.channel_label}</span>}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>

          {rows !== null && total > 0 && (
            <div className="chat-list-foot">
              <span>
                {rangeStart}–{rangeEnd} dari {total}
              </span>
              <div className="chat-list-foot-btns">
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
        </aside>

        {/* ---------- Panel 2: percakapan terpilih ---------- */}
        <section className="chat-thread">
          {!selected ? (
            <div className="empty-state">Pilih percakapan di sebelah kiri.</div>
          ) : (
            <>
              <header className="chat-thread-head">
                <Avatar name={selected.contact_name} number={selected.wa_number} />
                <div className="chat-thread-head-id">
                  <div className="name">{selected.contact_name || selected.wa_number}</div>
                  <div className="meta">
                    {selected.wa_number}
                    {selected.channel_label ? ` · ${selected.channel_label}` : ""}
                  </div>
                </div>
                <div className="chat-thread-head-actions">
                  {statusBadge(selected.status)}
                  <button
                    type="button"
                    className="chat-detail-toggle"
                    onClick={() => setDetailOpen((v) => !v)}
                    aria-expanded={detailOpen}
                    title={detailOpen ? "Sembunyikan detail" : "Tampilkan detail"}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <circle cx="12" cy="12" r="9" />
                      <path d="M12 16v-4M12 8h.01" />
                    </svg>
                  </button>
                </div>
              </header>

              {selected.needs_attention && (
                <div className="chat-alert">
                  Butuh perhatian{selected.attention_reason ? `: ${selected.attention_reason}` : ""}
                </div>
              )}

              <div className="chat-messages" ref={scrollRef}>
                {messages.length === 0 ? (
                  <div className="empty-state">Belum ada pesan.</div>
                ) : (
                  messages.map((m) => (
                    <div key={m.id} className={`bubble-row ${m.direction === "outbound" ? "out" : "in"}`}>
                      {m.direction !== "outbound" && (
                        <Avatar name={selected.contact_name} number={selected.wa_number} small />
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
                                Lihat/unduh dokumen
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
                      <button
                        type="button"
                        className="bubble-delete"
                        title="Hapus pesan"
                        aria-label="Hapus pesan"
                        onClick={() => {
                          setDeleteMsgError("");
                          setDeletingMessage(m);
                        }}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6" />
                        </svg>
                      </button>
                    </div>
                  ))
                )}
              </div>

              {sendError && <div className="error-box">{sendError}</div>}
              {attachment && (
                <div className="chat-attach-preview">
                  {attachment.previewUrl ? (
                    <img src={attachment.previewUrl} alt="" />
                  ) : (
                    <span className="chat-attach-icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6ZM14 2v6h6" />
                      </svg>
                    </span>
                  )}
                  <div className="chat-attach-info">
                    <strong>{attachment.file.name}</strong>
                    <span>{formatBytes(attachment.file.size)}</span>
                  </div>
                  <button type="button" className="chat-attach-remove" onClick={clearAttachment} aria-label="Batalkan lampiran">
                    &times;
                  </button>
                </div>
              )}

              <form className="chat-composer" onSubmit={onSend}>
                <input
                  ref={fileRef}
                  type="file"
                  hidden
                  onChange={onPickFile}
                  accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,audio/mpeg,audio/ogg,audio/mp4,application/pdf,.doc,.docx,.xls,.xlsx,.txt"
                />
                <button
                  type="button"
                  className="chat-composer-btn"
                  onClick={() => fileRef.current?.click()}
                  aria-label="Lampirkan berkas"
                  title="Lampirkan foto, video, audio, atau dokumen"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M21.4 11.05 12.25 20.2a5.5 5.5 0 0 1-7.78-7.78l9.2-9.2a3.67 3.67 0 1 1 5.18 5.18l-9.2 9.2a1.83 1.83 0 1 1-2.6-2.6l8.5-8.48" />
                  </svg>
                </button>
                <div className="chat-emoji-wrap">
                  <button
                    type="button"
                    className={`chat-composer-btn ${emojiOpen ? "active" : ""}`}
                    onClick={() => setEmojiOpen((v) => !v)}
                    aria-label="Sisipkan emoji"
                    aria-expanded={emojiOpen}
                    title="Emoji"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <circle cx="12" cy="12" r="9" />
                      <path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01" />
                    </svg>
                  </button>
                  {emojiOpen && <EmojiPicker onPick={insertEmoji} onClose={() => setEmojiOpen(false)} />}
                </div>
                <input
                  ref={draftRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={attachment ? "Tambahkan keterangan (boleh dikosongkan)..." : "Tulis balasan..."}
                  aria-label="Tulis balasan"
                />
                <button
                  className="chat-send"
                  type="submit"
                  disabled={sending || uploading || (!attachment && !draft.trim())}
                  aria-label="Kirim"
                >
                  {uploading ? (
                    <span className="chat-send-spinner" aria-hidden="true" />
                  ) : (
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M3 11 20 3l-4 18-6-8-7-2Z" />
                    </svg>
                  )}
                </button>
              </form>
            </>
          )}
        </section>

        {/* ---------- Panel 3: detail pelanggan ---------- */}
        {selected && detailOpen && (
          <aside className="chat-detail">
            <div className="chat-detail-hero">
              <Avatar name={selected.contact_name} number={selected.wa_number} large />
              <div className="chat-detail-name">{selected.contact_name || selected.wa_number}</div>
              <div className="chat-detail-sub">{selected.wa_number}</div>
              <div className="chat-detail-badges">
                {statusBadge(selected.status)}
                {selected.ai_paused && <span className="badge gray">AI dijeda</span>}
                {selected.ctwa_clid && <span className="badge yellow">Dari iklan</span>}
              </div>
            </div>

            {selected.ai_summary && (
              <div className="chat-detail-block">
                <h3>Ringkasan AI</h3>
                <p>{selected.ai_summary}</p>
              </div>
            )}

            <div className="chat-detail-block">
              <h3>Informasi</h3>
              <dl className="chat-detail-list">
                <div>
                  <dt>Nomor WhatsApp kita</dt>
                  <dd>{selected.channel_label || "-"}</dd>
                </div>
                <div>
                  <dt>Produk</dt>
                  <dd>{selected.product_name || "Belum terdeteksi"}</dd>
                </div>
                <div>
                  <dt>Ditangani</dt>
                  <dd>{selected.assigned_name || "Belum ditugaskan"}</dd>
                </div>
                <div>
                  <dt>Tahap</dt>
                  <dd>{selected.pipeline_stage || "-"}</dd>
                </div>
                <div>
                  <dt>Pesan terakhir</dt>
                  <dd>{formatTime(selected.last_message_at) || "-"}</dd>
                </div>
              </dl>
            </div>

            <div className="chat-detail-block">
              <h3>Tindakan</h3>
              <div className="chat-detail-actions">
                <button className="btn secondary" onClick={markClosingWon}>
                  Tandai closing
                </button>
                <button className="btn secondary" disabled={archiveBusy} onClick={toggleArchive}>
                  {archiveBusy ? "..." : selected.status === "archived" ? "Buka arsip" : "Arsipkan"}
                </button>
                <button
                  className="btn secondary danger-text"
                  onClick={() => {
                    setDeleteConvError("");
                    setDeletingConversation(true);
                  }}
                >
                  Hapus percakapan
                </button>
              </div>
            </div>
          </aside>
        )}
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
