import { useEffect, useState } from "react";
import { api } from "../api";
import Modal from "../components/Modal";
import ActionBtn from "../components/ActionBtn";

export default function Departments() {
  const [rows, setRows] = useState(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const [editingRow, setEditingRow] = useState(null);
  const [editName, setEditName] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState("");

  const [deletingRow, setDeletingRow] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const load = async () => {
    try {
      setRows(await api.get("/departments"));
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const onCreate = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError("");
    try {
      await api.post("/departments", { name });
      setName("");
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const openEdit = (row) => {
    setEditingRow(row);
    setEditName(row.name || "");
    setEditError("");
  };

  const onSaveEdit = async (e) => {
    e.preventDefault();
    if (!editingRow || !editName.trim()) return;
    setEditBusy(true);
    setEditError("");
    try {
      await api.patch(`/departments/${editingRow.id}`, { name: editName });
      setEditingRow(null);
      await load();
    } catch (err) {
      setEditError(err.message);
    } finally {
      setEditBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!deletingRow) return;
    setDeleteBusy(true);
    setDeleteError("");
    try {
      await api.del(`/departments/${deletingRow.id}`);
      setDeletingRow(null);
      await load();
    } catch (err) {
      setDeleteError(err.message);
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div>
      <div className="toolbar">
        <div>
          <h1>Departemen</h1>
          <p className="page-subtitle">Pengelompokan tim, mis. Sales, Customer Service, Marketing.</p>
        </div>
        <button className="btn" onClick={() => setShowForm(true)}>
          + Tambah Departemen
        </button>
      </div>

      {error && !showForm && <div className="error-box">{error}</div>}

      <Modal open={showForm} onClose={() => setShowForm(false)} title="Tambah departemen baru">
        <form onSubmit={onCreate}>
          {error && <div className="error-box">{error}</div>}
          <div className="field">
            <label>Nama departemen</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="mis. Customer Service"
              autoFocus
              required
            />
          </div>
          <button className="btn block" type="submit" disabled={busy}>
            {busy ? "Menyimpan..." : "Simpan"}
          </button>
        </form>
      </Modal>

      <Modal open={!!editingRow} onClose={() => setEditingRow(null)} title="Ubah nama departemen">
        <form onSubmit={onSaveEdit}>
          {editError && <div className="error-box">{editError}</div>}
          <div className="field">
            <label>Nama departemen</label>
            <input value={editName} onChange={(e) => setEditName(e.target.value)} autoFocus required />
          </div>
          <button className="btn block" type="submit" disabled={editBusy}>
            {editBusy ? "Menyimpan..." : "Simpan Perubahan"}
          </button>
        </form>
      </Modal>

      <Modal open={!!deletingRow} onClose={() => setDeletingRow(null)} title="Hapus departemen?" width={440}>
        {deletingRow && (
          <div>
            {deleteError && <div className="error-box">{deleteError}</div>}
            <p style={{ fontSize: 14 }}>
              Yakin mau menghapus departemen <strong>{deletingRow.name}</strong>? Nomor WhatsApp yang
              terhubung ke departemen ini akan jadi tidak punya departemen. Tindakan ini tidak bisa
              dibatalkan.
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
          <div className="empty-state">Belum ada departemen.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Nama</th>
                <th>Jumlah Nomor WA</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td>{r.channel_count}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <ActionBtn kind="edit" onClick={() => openEdit(r)}>
                      Ubah Nama
                    </ActionBtn>
                    <ActionBtn
                      kind="hapus"
                      onClick={() => setDeletingRow(r)}
                    >
                      Hapus
                    </ActionBtn>
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
