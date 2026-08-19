import { useEffect, useState } from "react";
import { api } from "../api";
import Modal from "../components/Modal";
import QrConnectModal from "../components/QrConnectModal";

const emptyForm = {
  label: "",
  phoneNumberId: "",
  accessToken: "",
  displayPhoneNumber: "",
  ownerUserId: "",
  productId: "",
  departmentId: "",
};

const emptyQrForm = {
  label: "",
  ownerUserId: "",
  productId: "",
  departmentId: "",
};

export default function Channels() {
  const [rows, setRows] = useState(null);
  const [users, setUsers] = useState([]);
  const [products, setProducts] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null); // null = mode "tambah baru"
  const [deletingRow, setDeletingRow] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  // --- Nomor tim via QR/kode pairing (bukan Cloud API resmi) — lihat QrConnectModal ---
  const [showQrCreateForm, setShowQrCreateForm] = useState(false);
  const [qrForm, setQrForm] = useState(emptyQrForm);
  const [qrCreateError, setQrCreateError] = useState("");
  const [qrCreateBusy, setQrCreateBusy] = useState(false);
  const [connectingChannel, setConnectingChannel] = useState(null); // channel yg lagi dibuka modal QR/pairing-nya
  const [disconnectingId, setDisconnectingId] = useState(null);

  const load = async () => {
    try {
      const [channels, u, p, d] = await Promise.all([
        api.get("/channels"),
        api.get("/users"),
        api.get("/products"),
        api.get("/departments"),
      ]);
      setRows(channels);
      setUsers(u);
      setProducts(p);
      setDepartments(d);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const update = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setError("");
    setShowForm(true);
  };

  const openEdit = (row) => {
    setEditingId(row.id);
    setForm({
      label: row.label || "",
      phoneNumberId: "", // tidak ditampilkan balik demi keamanan; kosong = tidak diganti
      accessToken: "",
      displayPhoneNumber: row.display_phone_number || "",
      ownerUserId: row.owner_user_id || "",
      productId: row.product_id || "",
      departmentId: row.department_id || "",
    });
    setError("");
    setShowForm(true);
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (editingId) {
        const payload = {
          label: form.label,
          displayPhoneNumber: form.displayPhoneNumber,
          ownerUserId: form.ownerUserId || null,
          productId: form.productId || null,
          departmentId: form.departmentId || null,
        };
        // Phone Number ID / Access Token cuma dikirim kalau user benar-benar
        // mengisinya ulang — kosong berarti "biarkan seperti semula".
        if (form.phoneNumberId) payload.phoneNumberId = form.phoneNumberId;
        if (form.accessToken) payload.accessToken = form.accessToken;
        await api.patch(`/channels/${editingId}`, payload);
      } else {
        const payload = {
          phoneNumberId: form.phoneNumberId,
          accessToken: form.accessToken,
          label: form.label || undefined,
          displayPhoneNumber: form.displayPhoneNumber || undefined,
          ownerUserId: form.ownerUserId || undefined,
          productId: form.productId || undefined,
          departmentId: form.departmentId || undefined,
        };
        await api.post("/channels", payload);
      }
      setForm(emptyForm);
      setShowForm(false);
      setEditingId(null);
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
      await api.del(`/channels/${deletingRow.id}`);
      setDeletingRow(null);
      await load();
    } catch (err) {
      setDeleteError(err.message);
    } finally {
      setDeleteBusy(false);
    }
  };

  const statusBadge = (row) => {
    if (row.connection_type === "qr_session") {
      const state = row.connection_state;
      if (state === "connected") return <span className="badge green">Terhubung (QR)</span>;
      if (state === "qr_pending") return <span className="badge yellow">Menunggu Scan QR</span>;
      if (state === "pairing_pending") return <span className="badge yellow">Menunggu Kode Pairing</span>;
      if (state === "reconnecting") return <span className="badge yellow">Menyambung Ulang...</span>;
      if (state === "logged_out") return <span className="badge red">Logout — Sambung Ulang</span>;
      return <span className="badge gray">Belum Disambungkan</span>;
    }
    if (row.status === "connected") return <span className="badge green">Terhubung</span>;
    if (row.status === "disconnected") return <span className="badge red">Terputus</span>;
    return <span className="badge yellow">Menunggu</span>;
  };

  const updateQrForm = (key) => (e) => setQrForm((f) => ({ ...f, [key]: e.target.value }));

  const openQrCreate = () => {
    setQrForm(emptyQrForm);
    setQrCreateError("");
    setShowQrCreateForm(true);
  };

  const onQrCreateSubmit = async (e) => {
    e.preventDefault();
    setQrCreateBusy(true);
    setQrCreateError("");
    try {
      const created = await api.post("/channels/qr", {
        label: qrForm.label || undefined,
        ownerUserId: qrForm.ownerUserId || undefined,
        productId: qrForm.productId || undefined,
        departmentId: qrForm.departmentId || undefined,
      });
      setShowQrCreateForm(false);
      await load();
      setConnectingChannel(created);
    } catch (err) {
      setQrCreateError(err.message);
    } finally {
      setQrCreateBusy(false);
    }
  };

  const disconnectQr = async (row) => {
    setDisconnectingId(row.id);
    try {
      await api.post(`/channels/${row.id}/qr/disconnect`, {});
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setDisconnectingId(null);
    }
  };

  return (
    <div>
      <div className="toolbar">
        <div>
          <h1>Nomor WhatsApp</h1>
          <p className="page-subtitle">Setiap CS bisa punya nomor sendiri; produk baru bisa dapat nomor baru.</p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn secondary" onClick={openQrCreate}>
            + Sambungkan Nomor Tim (QR)
          </button>
          <button className="btn" onClick={openCreate}>
            + Daftarkan Nomor (Cloud API)
          </button>
        </div>
      </div>

      {error && !showForm && !showQrCreateForm && <div className="error-box">{error}</div>}

      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title={editingId ? "Edit nomor WhatsApp" : "Daftarkan nomor WhatsApp baru"}
        width={560}
      >
        <form onSubmit={onSubmit}>
          {error && <div className="error-box">{error}</div>}
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: -4, marginBottom: 16 }}>
            Phone Number ID &amp; Access Token didapat dari Meta Business Manager setelah nomor
            ditambahkan ke WhatsApp Business Account kamu — bukan nomor teleponnya sendiri.
          </p>
          <div className="inline-form">
            <div className="field">
              <label>Label</label>
              <input value={form.label} onChange={update("label")} placeholder="mis. CS Budi - Skincare" />
            </div>
            <div className="field">
              <label>Nomor tampilan</label>
              <input
                value={form.displayPhoneNumber}
                onChange={update("displayPhoneNumber")}
                placeholder="62812xxxxxxx"
              />
            </div>
          </div>
          <div className="inline-form">
            <div className="field">
              <label>Phone Number ID (dari Meta) {editingId ? "" : "*"}</label>
              <input
                value={form.phoneNumberId}
                onChange={update("phoneNumberId")}
                placeholder={editingId ? "Kosongkan jika tidak diganti" : ""}
                required={!editingId}
              />
            </div>
            <div className="field">
              <label>Access Token (dari Meta) {editingId ? "" : "*"}</label>
              <input
                value={form.accessToken}
                onChange={update("accessToken")}
                placeholder={editingId ? "Kosongkan jika tidak diganti" : ""}
                required={!editingId}
              />
            </div>
          </div>
          <div className="inline-form">
            <div className="field">
              <label>Pemilik (CS)</label>
              <select value={form.ownerUserId} onChange={update("ownerUserId")}>
                <option value="">— tidak ditentukan —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name || u.email}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Produk</label>
              <select value={form.productId} onChange={update("productId")}>
                <option value="">— tidak ditentukan —</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Departemen</label>
              <select value={form.departmentId} onChange={update("departmentId")}>
                <option value="">— tidak ditentukan —</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <button className="btn block" type="submit" disabled={busy}>
            {busy ? "Menyimpan..." : editingId ? "Simpan Perubahan" : "Simpan Nomor"}
          </button>
        </form>
      </Modal>

      <Modal
        open={showQrCreateForm}
        onClose={() => setShowQrCreateForm(false)}
        title="Sambungkan nomor tim via QR/Kode Pairing"
        width={480}
      >
        <form onSubmit={onQrCreateSubmit}>
          {qrCreateError && <div className="error-box">{qrCreateError}</div>}
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: -4, marginBottom: 16 }}>
            Untuk nomor tim yang BELUM bisa dapat akses WhatsApp Cloud API resmi dari Meta. Nomor
            tersambung langsung dari HP CS (seperti WhatsApp Web) — tidak butuh Phone Number ID / Access
            Token dari Meta.
          </p>
          <div className="field" style={{ marginBottom: 12 }}>
            <label>Label</label>
            <input value={qrForm.label} onChange={updateQrForm("label")} placeholder="mis. CS Sari - Tim 2" />
          </div>
          <div className="inline-form">
            <div className="field">
              <label>Pemilik (CS)</label>
              <select value={qrForm.ownerUserId} onChange={updateQrForm("ownerUserId")}>
                <option value="">— tidak ditentukan —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name || u.email}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Produk</label>
              <select value={qrForm.productId} onChange={updateQrForm("productId")}>
                <option value="">— tidak ditentukan —</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Departemen</label>
              <select value={qrForm.departmentId} onChange={updateQrForm("departmentId")}>
                <option value="">— tidak ditentukan —</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <button className="btn block" type="submit" disabled={qrCreateBusy}>
            {qrCreateBusy ? "Menyimpan..." : "Lanjut ke Sambungkan"}
          </button>
        </form>
      </Modal>

      {connectingChannel && (
        <QrConnectModal
          channel={connectingChannel}
          onClose={() => {
            setConnectingChannel(null);
            load();
          }}
          onConnected={load}
        />
      )}

      <Modal open={!!deletingRow} onClose={() => setDeletingRow(null)} title="Hapus nomor WhatsApp?" width={460}>
        {deletingRow && (
          <div>
            {deleteError && <div className="error-box">{deleteError}</div>}
            <p style={{ fontSize: 14 }}>
              Yakin mau menghapus <strong>{deletingRow.label || deletingRow.display_phone_number || "nomor ini"}</strong>?
              Semua percakapan, pesan, dan riwayat broadcast yang terikat ke nomor ini akan ikut terhapus
              permanen. Tindakan ini tidak bisa dibatalkan.
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
          <div className="empty-state">Belum ada nomor WhatsApp terdaftar.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Label</th>
                <th>Nomor</th>
                <th>Status</th>
                <th>Pemilik</th>
                <th>Produk</th>
                <th>Departemen</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.label || "—"}
                    {r.connection_type === "qr_session" && (
                      <span className="badge gray" style={{ marginLeft: 6, fontSize: 10 }}>
                        QR
                      </span>
                    )}
                  </td>
                  <td>{r.display_phone_number || "—"}</td>
                  <td>{statusBadge(r)}</td>
                  <td>{r.owner_name || "—"}</td>
                  <td>{r.product_name || "—"}</td>
                  <td>{r.department_name || "—"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {r.connection_type === "qr_session" && r.connection_state !== "connected" && (
                      <>
                        <button type="button" className="btn-link" onClick={() => setConnectingChannel(r)}>
                          Sambungkan
                        </button>
                        {" · "}
                      </>
                    )}
                    {r.connection_type === "qr_session" && r.connection_state === "connected" && (
                      <>
                        <button
                          type="button"
                          className="btn-link"
                          style={{ color: "var(--danger)" }}
                          disabled={disconnectingId === r.id}
                          onClick={() => disconnectQr(r)}
                        >
                          {disconnectingId === r.id ? "Memutus..." : "Putuskan"}
                        </button>
                        {" · "}
                      </>
                    )}
                    {r.connection_type !== "qr_session" && (
                      <>
                        <button type="button" className="btn-link" onClick={() => openEdit(r)}>
                          Edit
                        </button>
                        {" · "}
                      </>
                    )}
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
        )}
      </div>
    </div>
  );
}
