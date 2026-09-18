import { useEffect, useState } from "react";
import { api, getToken } from "../api";
import Modal from "../components/Modal";
import DateRangeFilter from "../components/DateRangeFilter";
import { defaultRange } from "../dateRangePresets";
import SearchField from "../components/SearchField";
import ActionBtn from "../components/ActionBtn";

const PAGE_SIZE = 50;

export default function Contacts() {
  const [range, setRange] = useState(defaultRange());
  const [rows, setRows] = useState(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [q, setQ] = useState("");
  const [labelFilter, setLabelFilter] = useState("");
  const [labelOptions, setLabelOptions] = useState([]);
  const [form, setForm] = useState({ waNumber: "", name: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [deletingRow, setDeletingRow] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [downloading, setDownloading] = useState(false);

  // F-29: kontak yang lagi diedit label-nya di modal ("Label untuk ...").
  const [editingLabelsRow, setEditingLabelsRow] = useState(null);
  const [labelDraft, setLabelDraft] = useState([]);
  const [labelInput, setLabelInput] = useState("");
  const [labelBusy, setLabelBusy] = useState(false);
  const [labelError, setLabelError] = useState("");

  // Debounce kotak pencarian ~300ms.
  useEffect(() => {
    const t = setTimeout(() => setQ(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Ganti filter apa pun -> mulai lagi dari halaman pertama.
  useEffect(() => {
    setOffset(0);
  }, [q, range.from, range.to, labelFilter]);

  const loadLabelOptions = async () => {
    try {
      const data = await api.get("/contacts/labels");
      setLabelOptions(data?.items || []);
    } catch {
      // Dropdown & saran label bukan hal kritis — diamkan kalau gagal.
    }
  };

  useEffect(() => {
    loadLabelOptions();
  }, []);

  const load = async () => {
    try {
      const params = new URLSearchParams();
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(offset));
      if (range.from) params.set("from", range.from);
      if (range.to) params.set("to", range.to);
      if (q) params.set("q", q);
      if (labelFilter) params.set("label", labelFilter);
      const data = await api.get(`/contacts?${params.toString()}`);
      // Bertahan terhadap dua bentuk respons: array polos (lama) atau {items,total,...} (baru).
      const items = Array.isArray(data) ? data : data?.items || [];
      const totalCount = Array.isArray(data) ? items.length : data?.total ?? items.length;
      setRows(items);
      setTotal(totalCount);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset, q, range.from, range.to, labelFilter]);

  const onCreate = async (e) => {
    e.preventDefault();
    if (!form.waNumber.trim()) return;
    setBusy(true);
    setError("");
    try {
      await api.post("/contacts", { waNumber: form.waNumber, name: form.name || undefined });
      setForm({ waNumber: "", name: "" });
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!deletingRow) return;
    setDeleteBusy(true);
    setDeleteError("");
    try {
      await api.del(`/contacts/${deletingRow.id}`);
      setDeletingRow(null);
      await load();
    } catch (err) {
      setDeleteError(err.message);
    } finally {
      setDeleteBusy(false);
    }
  };

  const openLabelEditor = (row) => {
    setEditingLabelsRow(row);
    setLabelDraft(Array.isArray(row.labels) ? [...row.labels] : []);
    setLabelInput("");
    setLabelError("");
  };

  const addLabelToDraft = (value) => {
    const v = value.trim();
    if (!v) return;
    setLabelDraft((prev) => (prev.includes(v) ? prev : [...prev, v]));
    setLabelInput("");
  };

  const removeLabelFromDraft = (value) => {
    setLabelDraft((prev) => prev.filter((l) => l !== value));
  };

  const saveLabels = async () => {
    if (!editingLabelsRow) return;
    setLabelBusy(true);
    setLabelError("");
    try {
      const updated = await api.patch(`/contacts/${editingLabelsRow.id}/labels`, { labels: labelDraft });
      setRows((prev) => (prev ? prev.map((r) => (r.id === updated.id ? updated : r)) : prev));
      setEditingLabelsRow(null);
      await loadLabelOptions();
    } catch (err) {
      setLabelError(err.message);
    } finally {
      setLabelBusy(false);
    }
  };

  const download = async () => {
    setDownloading(true);
    setError("");
    try {
      const res = await fetch("/api/contacts/export.csv", {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (res.status === 401) {
        throw new Error("Sesi login sudah habis. Silakan login ulang.");
      }
      if (!res.ok) throw new Error(`Gagal download kontak (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "kontak-cakapcepat.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    } finally {
      setDownloading(false);
    }
  };

  const stageBadge = (stage) => {
    const map = {
      new: "gray",
      contacted: "yellow",
      qualified: "yellow",
      closing_won: "green",
      closing_lost: "red",
    };
    return <span className={`badge ${map[stage] || "gray"}`}>{stage}</span>;
  };

  const rangeStart = total === 0 ? 0 : offset + 1;
  const rangeEnd = Math.min(offset + (rows?.length || 0), total);
  const suggestionOptions = labelOptions.filter((l) => !labelDraft.includes(l));

  return (
    <div>
      <div className="toolbar">
        <div>
          <h1>Kontak</h1>
          <p className="page-subtitle">Daftar lead/pembeli yang pernah dihubungi lewat WhatsApp.</p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn secondary" type="button" disabled={downloading} onClick={download}>
            {downloading ? "Menyiapkan..." : "Ekspor CSV"}
          </button>
          <button className="btn" onClick={() => setShowForm(true)}>
            + Tambah Kontak
          </button>
        </div>
      </div>

      <div className="toolbar" style={{ margin: "10px 0 14px" }}>
        <SearchField
          placeholder="Cari nama atau nomor..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          style={{ maxWidth: 260 }}
        />
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <select value={labelFilter} onChange={(e) => setLabelFilter(e.target.value)} style={{ maxWidth: 200 }}>
            <option value="">Semua Label</option>
            {labelOptions.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
          <DateRangeFilter value={range} onChange={setRange} />
        </div>
      </div>

      {error && !showForm && <div className="error-box">{error}</div>}

      <Modal open={showForm} onClose={() => setShowForm(false)} title="Tambah kontak baru">
        <form onSubmit={onCreate}>
          {error && <div className="error-box">{error}</div>}
          <div className="field">
            <label>Nomor WhatsApp</label>
            <input
              value={form.waNumber}
              onChange={(e) => setForm((f) => ({ ...f, waNumber: e.target.value }))}
              placeholder="62812xxxxxxx"
              autoFocus
              required
            />
          </div>
          <div className="field">
            <label>Nama (opsional)</label>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>
          <button className="btn block" type="submit" disabled={busy}>
            {busy ? "Menyimpan..." : "Simpan"}
          </button>
        </form>
      </Modal>

      <Modal open={!!deletingRow} onClose={() => setDeletingRow(null)} title="Hapus kontak?" width={440}>
        {deletingRow && (
          <div>
            {deleteError && <div className="error-box">{deleteError}</div>}
            <p style={{ fontSize: 14 }}>
              Yakin mau menghapus kontak <strong>{deletingRow.name || deletingRow.wa_number}</strong>? Tindakan
              ini tidak bisa dibatalkan.
            </p>
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button
                type="button"
                className="btn secondary"
                style={{ flex: 1 }}
                onClick={() => setDeletingRow(null)}
                disabled={deleteBusy}
              >
                Batal
              </button>
              <button
                type="button"
                className="btn danger"
                style={{ flex: 1 }}
                onClick={confirmDelete}
                disabled={deleteBusy}
              >
                {deleteBusy ? "Menghapus..." : "Ya, Hapus"}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={!!editingLabelsRow}
        onClose={() => setEditingLabelsRow(null)}
        title={`Label untuk ${editingLabelsRow?.name || editingLabelsRow?.wa_number || ""}`}
        width={440}
      >
        {editingLabelsRow && (
          <div>
            {labelError && <div className="error-box">{labelError}</div>}

            {labelDraft.length === 0 ? (
              <div className="label-empty-hint">Belum ada label untuk kontak ini.</div>
            ) : (
              <div className="label-chip-row">
                {labelDraft.map((l) => (
                  <span className="label-chip" key={l}>
                    {l}
                    <button type="button" onClick={() => removeLabelFromDraft(l)} aria-label={`Hapus label ${l}`}>
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="field">
              <label>Tambah label</label>
              <div className="label-add-row">
                <input
                  value={labelInput}
                  onChange={(e) => setLabelInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addLabelToDraft(labelInput);
                    }
                  }}
                  placeholder="mis. pernah closing, minat parfum"
                  list="contact-label-suggestions"
                  autoFocus
                />
                <button type="button" className="btn secondary" onClick={() => addLabelToDraft(labelInput)}>
                  Tambah
                </button>
              </div>
              <datalist id="contact-label-suggestions">
                {suggestionOptions.map((l) => (
                  <option key={l} value={l} />
                ))}
              </datalist>
              {suggestionOptions.length > 0 && (
                <span className="field-hint">
                  Label yang sudah dipakai: {suggestionOptions.join(", ")}
                </span>
              )}
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button
                type="button"
                className="btn secondary"
                style={{ flex: 1 }}
                onClick={() => setEditingLabelsRow(null)}
                disabled={labelBusy}
              >
                Batal
              </button>
              <button type="button" className="btn" style={{ flex: 1 }} onClick={saveLabels} disabled={labelBusy}>
                {labelBusy ? "Menyimpan..." : "Simpan Label"}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <div className="panel">
        {rows === null ? (
          <div className="loading-block">Memuat...</div>
        ) : rows.length === 0 ? (
          <div className="empty-state">
            {q || labelFilter ? "Tidak ada kontak yang cocok dengan filter ini." : "Belum ada kontak."}
          </div>
        ) : (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Nama</th>
                    <th>Nomor WA</th>
                    <th>Tahap</th>
                    <th>Label</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td>{r.name || "—"}</td>
                      <td>{r.wa_number}</td>
                      <td>{stageBadge(r.pipeline_stage)}</td>
                      <td>
                        {Array.isArray(r.labels) && r.labels.length > 0 ? (
                          <div className="label-badge-row">
                            {r.labels.map((l) => (
                              <span className="label-badge" key={l}>
                                {l}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 12 }}>
                          <ActionBtn kind="edit" onClick={() => openLabelEditor(r)}>
                            Label
                          </ActionBtn>
                          <ActionBtn
                            kind="hapus"
                            onClick={() => setDeletingRow(r)}
                          >
                            Hapus
                          </ActionBtn>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {total > 0 && (
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
          </>
        )}
      </div>
    </div>
  );
}
