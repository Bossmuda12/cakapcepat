import { useEffect, useState } from "react";
import { api } from "../api";
import Modal from "../components/Modal";
import DateRangeFilter from "../components/DateRangeFilter";
import { defaultRange } from "../dateRangePresets";

const PAGE_SIZE = 50;

export default function Contacts() {
  const [range, setRange] = useState(defaultRange());
  const [rows, setRows] = useState(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [q, setQ] = useState("");
  const [form, setForm] = useState({ waNumber: "", name: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [deletingRow, setDeletingRow] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  // Debounce kotak pencarian ~300ms.
  useEffect(() => {
    const t = setTimeout(() => setQ(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Ganti filter apa pun -> mulai lagi dari halaman pertama.
  useEffect(() => {
    setOffset(0);
  }, [q, range.from, range.to]);

  const load = async () => {
    try {
      const params = new URLSearchParams();
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(offset));
      if (range.from) params.set("from", range.from);
      if (range.to) params.set("to", range.to);
      if (q) params.set("q", q);
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
  }, [offset, q, range.from, range.to]);

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

  return (
    <div>
      <div className="toolbar">
        <div>
          <h1>Kontak</h1>
          <p className="page-subtitle">Daftar lead/pembeli yang pernah dihubungi lewat WhatsApp.</p>
        </div>
        <button className="btn" onClick={() => setShowForm(true)}>
          + Tambah Kontak
        </button>
      </div>

      <div className="toolbar" style={{ margin: "10px 0 14px" }}>
        <input
          type="text"
          placeholder="Cari nama atau nomor..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          style={{ maxWidth: 260 }}
        />
        <DateRangeFilter value={range} onChange={setRange} />
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

      <div className="panel">
        {rows === null ? (
          <div className="loading-block">Memuat...</div>
        ) : rows.length === 0 ? (
          <div className="empty-state">{q ? "Tidak ada kontak yang cocok dengan pencarian ini." : "Belum ada kontak."}</div>
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <th>Nama</th>
                  <th>Nomor WA</th>
                  <th>Tahap</th>
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
                      <button
                        type="button"
                        className="btn-link"
                        style={{ color: "var(--danger)" }}
                        onClick={() => setDeletingRow(r)}
                      >
                        Hapus
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
