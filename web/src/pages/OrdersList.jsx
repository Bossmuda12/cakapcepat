import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import Modal from "../components/Modal";
import DateRangeFilter from "../components/DateRangeFilter";
import { defaultRange } from "../dateRangePresets";
import OrdersStats from "./OrdersStats";
import Check from "../components/Check";
import ActionBtn from "../components/ActionBtn";

const PAGE_SIZE = 20;

// Label A (hasil chat) — lihat SALES_STATUSES di routes/orders.ts
const SALES_STATUS_OPTIONS = [
  { value: "qualified_cod", label: "Qualified COD", tone: "yellow" },
  { value: "closing", label: "Closing", tone: "green" },
  { value: "cancelled", label: "Batal", tone: "gray" },
  { value: "spam", label: "Spam", tone: "gray" },
  { value: "no_response", label: "Tidak Respon", tone: "gray" },
  { value: "cs_blocked", label: "CS Diblokir", tone: "red" },
];

// Label B (hasil pengiriman) — lihat SHIPPING_STATUSES di routes/orders.ts
const SHIPPING_STATUS_OPTIONS = [
  { value: "pending", label: "Menunggu", tone: "gray" },
  { value: "packed", label: "Dikemas", tone: "yellow" },
  { value: "handed_to_courier", label: "Diserahkan ke Kurir", tone: "yellow" },
  { value: "in_transit", label: "Dalam Perjalanan", tone: "yellow" },
  { value: "problem", label: "Bermasalah", tone: "red" },
  { value: "rescheduled", label: "Dijadwalkan Ulang", tone: "yellow" },
  { value: "delivered", label: "Terkirim", tone: "green" },
  { value: "returned", label: "Retur", tone: "red" },
];

function optionOf(list, value) {
  return list.find((o) => o.value === value);
}
function salesLabel(v) {
  return optionOf(SALES_STATUS_OPTIONS, v)?.label || v || "-";
}
function salesTone(v) {
  return optionOf(SALES_STATUS_OPTIONS, v)?.tone || "gray";
}
function shippingLabel(v) {
  return optionOf(SHIPPING_STATUS_OPTIONS, v)?.label || v || "-";
}
function shippingTone(v) {
  return optionOf(SHIPPING_STATUS_OPTIONS, v)?.tone || "gray";
}

function formatMoney(cents, currency) {
  if (cents === null || cents === undefined) return "—";
  return `${currency || "RM"} ${(Number(cents) / 100).toLocaleString("en-MY", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDateTime(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Input harga ditampilkan dalam RM (bukan sen) — konversi di sini supaya
// backend tetap konsisten menyimpan *Cents (lihat catatan endpoint di prompt tugas).
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

const emptyCreateForm = {
  customerName: "",
  customerPhone: "",
  addressLine: "",
  postcode: "",
  city: "",
  state: "",
  productId: "",
  variantId: "",
  quantity: "1",
  unitPriceRm: "",
  totalRm: "",
  salesStatus: "qualified_cod",
  notes: "",
};

const emptyEditForm = {
  customerName: "",
  customerPhone: "",
  addressLine: "",
  postcode: "",
  city: "",
  state: "",
  productId: "",
  variantId: "",
  quantity: "1",
  unitPriceRm: "",
  totalRm: "",
  notes: "",
};

const emptyShippingForm = {
  shippingStatus: "pending",
  courier: "",
  trackingNo: "",
  hasProblem: false,
  problemReason: "",
};

export default function OrdersList() {
  const [range, setRange] = useState(defaultRange());
  const [searchInput, setSearchInput] = useState("");
  const [q, setQ] = useState("");
  const [salesStatusFilter, setSalesStatusFilter] = useState("");
  const [shippingStatusFilter, setShippingStatusFilter] = useState("");
  const [problemOnly, setProblemOnly] = useState(false);
  const [productFilter, setProductFilter] = useState("");
  const [products, setProducts] = useState([]);

  const [rows, setRows] = useState(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState("");

  const [showStats, setShowStats] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState(emptyCreateForm);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState("");

  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState("");
  const [importResult, setImportResult] = useState(null);

  const [editingRow, setEditingRow] = useState(null);
  const [editForm, setEditForm] = useState(emptyEditForm);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState("");

  const [shippingRow, setShippingRow] = useState(null);
  const [shippingForm, setShippingForm] = useState(emptyShippingForm);
  const [shippingBusy, setShippingBusy] = useState(false);
  const [shippingError, setShippingError] = useState("");

  const [deletingRow, setDeletingRow] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const [codBusyId, setCodBusyId] = useState(null);

  useEffect(() => {
    api
      .get("/products")
      .then((data) => setProducts(Array.isArray(data) ? data : data?.items || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setQ(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    setOffset(0);
  }, [q, salesStatusFilter, shippingStatusFilter, problemOnly, productFilter, range.from, range.to]);

  const loadOrders = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(offset));
      if (range.from) params.set("from", range.from);
      if (range.to) params.set("to", range.to);
      if (q) params.set("q", q);
      if (salesStatusFilter) params.set("salesStatus", salesStatusFilter);
      if (shippingStatusFilter) params.set("shippingStatus", shippingStatusFilter);
      if (problemOnly) params.set("hasProblem", "true");
      if (productFilter) params.set("productId", productFilter);
      const data = await api.get(`/orders/list?${params.toString()}`);
      setRows(data.items || []);
      setTotal(data.total || 0);
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }, [offset, range.from, range.to, q, salesStatusFilter, shippingStatusFilter, problemOnly, productFilter]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  const productVariants = (productId) => products.find((p) => p.id === productId)?.variants || [];

  // --- Tambah pesanan manual ---
  const openCreate = () => {
    setCreateForm(emptyCreateForm);
    setCreateError("");
    setShowCreate(true);
  };

  const onCreateProductChange = (productId) => {
    const product = products.find((p) => p.id === productId);
    setCreateForm((f) => ({
      ...f,
      productId,
      variantId: "",
      unitPriceRm: product?.price_cents != null ? centsToRmInput(product.price_cents) : f.unitPriceRm,
    }));
  };

  const submitCreate = async (e) => {
    e.preventDefault();
    setCreateBusy(true);
    setCreateError("");
    try {
      const qty = Number(createForm.quantity) || 1;
      const unitPriceCents = rmInputToCents(createForm.unitPriceRm);
      const totalCents = createForm.totalRm !== "" ? rmInputToCents(createForm.totalRm) : unitPriceCents !== null ? unitPriceCents * qty : null;
      await api.post("/orders", {
        customerName: createForm.customerName || undefined,
        customerPhone: createForm.customerPhone || undefined,
        addressLine: createForm.addressLine || undefined,
        postcode: createForm.postcode || undefined,
        city: createForm.city || undefined,
        state: createForm.state || undefined,
        productId: createForm.productId || undefined,
        variantId: createForm.variantId || undefined,
        quantity: qty,
        unitPriceCents: unitPriceCents ?? undefined,
        totalCents: totalCents ?? undefined,
        currency: "MYR",
        salesStatus: createForm.salesStatus,
        notes: createForm.notes || undefined,
      });
      setShowCreate(false);
      await loadOrders();
    } catch (err) {
      setCreateError(err.message);
    } finally {
      setCreateBusy(false);
    }
  };

  // --- Impor resi CSV ---
  const submitImport = async (e) => {
    e.preventDefault();
    setImportBusy(true);
    setImportError("");
    setImportResult(null);
    try {
      const rowsInput = importText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [trackingNo, customerPhone, courier] = line.split(",").map((v) => (v || "").trim());
          return { trackingNo, customerPhone: customerPhone || undefined, courier: courier || undefined };
        })
        .filter((r) => r.trackingNo);

      if (rowsInput.length === 0) {
        setImportError("Tidak ada baris valid untuk diimpor. Format tiap baris: resi,telefon,kurir");
        return;
      }

      const result = await api.post("/orders/import-tracking", rowsInput);
      setImportResult(result);
      await loadOrders();
    } catch (err) {
      setImportError(err.message);
    } finally {
      setImportBusy(false);
    }
  };

  // --- Sunting data pembeli/alamat/produk ---
  const openEdit = (row) => {
    setEditingRow(row);
    setEditForm({
      customerName: row.customer_name || "",
      customerPhone: row.customer_phone || "",
      addressLine: row.address_line || "",
      postcode: row.postcode || "",
      city: row.city || "",
      state: row.state || "",
      productId: row.product_id || "",
      variantId: row.variant_id || "",
      quantity: String(row.quantity ?? 1),
      unitPriceRm: centsToRmInput(row.unit_price_cents),
      totalRm: centsToRmInput(row.total_cents),
      notes: row.notes || "",
    });
    setEditError("");
  };

  const submitEdit = async (e) => {
    e.preventDefault();
    if (!editingRow) return;
    setEditBusy(true);
    setEditError("");
    try {
      await api.patch(`/orders/${editingRow.id}`, {
        customerName: editForm.customerName || undefined,
        customerPhone: editForm.customerPhone || undefined,
        addressLine: editForm.addressLine || null,
        postcode: editForm.postcode || null,
        city: editForm.city || null,
        state: editForm.state || null,
        productId: editForm.productId || null,
        variantId: editForm.variantId || null,
        quantity: Number(editForm.quantity) || 1,
        unitPriceCents: rmInputToCents(editForm.unitPriceRm),
        totalCents: rmInputToCents(editForm.totalRm),
        notes: editForm.notes || null,
      });
      setEditingRow(null);
      await loadOrders();
    } catch (err) {
      setEditError(err.message);
    } finally {
      setEditBusy(false);
    }
  };

  // --- Ubah status pengiriman ---
  const openShipping = (row) => {
    setShippingRow(row);
    setShippingForm({
      shippingStatus: row.shipping_status || "pending",
      courier: row.courier || "",
      trackingNo: row.tracking_no || "",
      hasProblem: Boolean(row.has_problem),
      problemReason: row.problem_reason || "",
    });
    setShippingError("");
  };

  const submitShipping = async (e) => {
    e.preventDefault();
    if (!shippingRow) return;
    setShippingBusy(true);
    setShippingError("");
    try {
      await api.patch(`/orders/${shippingRow.id}/shipping`, {
        shippingStatus: shippingForm.shippingStatus,
        courier: shippingForm.courier || null,
        trackingNo: shippingForm.trackingNo || null,
        hasProblem: shippingForm.hasProblem,
        problemReason: shippingForm.hasProblem ? shippingForm.problemReason || null : null,
      });
      setShippingRow(null);
      await loadOrders();
    } catch (err) {
      setShippingError(err.message);
    } finally {
      setShippingBusy(false);
    }
  };

  // --- COD ---
  const toggleCod = async (row) => {
    setCodBusyId(row.id);
    try {
      await api.patch(`/orders/${row.id}/cod`, { codReceived: !row.cod_received });
      await loadOrders();
    } catch (err) {
      setError(err.message);
    } finally {
      setCodBusyId(null);
    }
  };

  // --- Hapus ---
  const confirmDelete = async () => {
    if (!deletingRow) return;
    setDeleteBusy(true);
    setDeleteError("");
    try {
      await api.del(`/orders/${deletingRow.id}`);
      setDeletingRow(null);
      await loadOrders();
    } catch (err) {
      setDeleteError(err.message);
    } finally {
      setDeleteBusy(false);
    }
  };

  const rangeStart = total === 0 ? 0 : offset + 1;
  const rangeEnd = Math.min(offset + (rows?.length || 0), total);

  return (
    <div>
      <div className="toolbar">
        <div>
          <h1>Pesanan</h1>
          <p className="page-subtitle">
            Data pesanan sungguhan (pembeli, alamat, produk, kurir &amp; resi) — terpisah dari "Laporan
            Order" lama, dan bisa dicocokkan otomatis ke email kurir.
          </p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn secondary" type="button" onClick={() => setShowImport(true)}>
            Impor Resi
          </button>
          <button className="btn" type="button" onClick={openCreate}>
            + Tambah Pesanan
          </button>
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="panel">
        <div className="toolbar" style={{ marginBottom: 14 }}>
          <h2 style={{ margin: 0 }}>Laporan Tingkat Retur</h2>
          <button type="button" className="btn-link" onClick={() => setShowStats((v) => !v)}>
            {showStats ? "Sembunyikan" : "Tampilkan"}
          </button>
        </div>
        {showStats && <OrdersStats from={range.from} to={range.to} />}
      </div>

      <div className="panel">
        <div className="inline-form" style={{ marginBottom: 10 }}>
          <div className="field">
            <label>Cari</label>
            <input
              type="text"
              placeholder="Nama, telefon, atau no resi..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
          <div className="field">
            <label>Status Penjualan</label>
            <select value={salesStatusFilter} onChange={(e) => setSalesStatusFilter(e.target.value)}>
              <option value="">Semua</option>
              {SALES_STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Status Pengiriman</label>
            <select value={shippingStatusFilter} onChange={(e) => setShippingStatusFilter(e.target.value)}>
              <option value="">Semua</option>
              {SHIPPING_STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Produk</label>
            <select value={productFilter} onChange={(e) => setProductFilter(e.target.value)}>
              <option value="">Semua Produk</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>&nbsp;</label>
            <div style={{ display: "flex", alignItems: "center", height: 38 }}>
              <Check
                checked={problemOnly}
                onChange={(e) => setProblemOnly(e.target.checked)}
                label="Bermasalah saja"
              />
            </div>
          </div>
        </div>
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <div />
          <DateRangeFilter value={range} onChange={setRange} />
        </div>
      </div>

      <div className="panel">
        {rows === null ? (
          <div className="loading-block">Memuat...</div>
        ) : rows.length === 0 ? (
          <div className="empty-state">Belum ada pesanan yang cocok dengan filter ini.</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Pembeli</th>
                  <th>Alamat</th>
                  <th>Produk</th>
                  <th>Qty</th>
                  <th>Total</th>
                  <th>Status</th>
                  <th>Kurir / Resi</th>
                  <th>COD</th>
                  <th>Tanggal</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{o.customer_name || "—"}</div>
                      <div className="text-muted">{o.customer_phone || "—"}</div>
                    </td>
                    <td style={{ maxWidth: 200 }}>
                      {[o.address_line, o.postcode, o.city, o.state].filter(Boolean).join(", ") || "—"}
                    </td>
                    <td>
                      {o.product_name || "—"}
                      {o.variant_name && <div className="text-muted">{o.variant_name}</div>}
                    </td>
                    <td>{o.quantity}</td>
                    <td>{formatMoney(o.total_cents, o.currency)}</td>
                    <td>
                      <div className="badge-row">
                        <span className={`badge ${salesTone(o.sales_status)}`}>{salesLabel(o.sales_status)}</span>
                        <span className={`badge ${shippingTone(o.shipping_status)}`}>
                          {shippingLabel(o.shipping_status)}
                        </span>
                        {o.has_problem && (
                          <span className="badge-problem" title={o.problem_reason || "Ditandai bermasalah"}>
                            Bermasalah
                          </span>
                        )}
                      </div>
                    </td>
                    <td>
                      {o.courier || "—"}
                      {o.tracking_no && <div className="text-muted">{o.tracking_no}</div>}
                    </td>
                    <td>
                      <button
                        type="button"
                        className={`btn secondary`}
                        disabled={codBusyId === o.id}
                        onClick={() => toggleCod(o)}
                      >
                        {codBusyId === o.id ? "..." : o.cod_received ? "Sudah Diterima" : "Belum Diterima"}
                      </button>
                    </td>
                    <td className="text-muted">{formatDateTime(o.created_at)}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <ActionBtn kind="edit" onClick={() => openEdit(o)}>
                        Sunting
                      </ActionBtn>
                      <ActionBtn kind="lihat" onClick={() => openShipping(o)}>
                        Pengiriman
                      </ActionBtn>
                      <ActionBtn
                        kind="hapus"
                        onClick={() => {
                          setDeleteError("");
                          setDeletingRow(o);
                        }}
                      >
                        Hapus
                      </ActionBtn>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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

      {/* Modal: Tambah Pesanan */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Tambah pesanan manual" width={640}>
        <form onSubmit={submitCreate}>
          {createError && <div className="error-box">{createError}</div>}
          <div className="inline-form">
            <div className="field">
              <label>Nama pembeli</label>
              <input
                value={createForm.customerName}
                onChange={(e) => setCreateForm((f) => ({ ...f, customerName: e.target.value }))}
                required
              />
            </div>
            <div className="field">
              <label>Nomor telefon</label>
              <input
                value={createForm.customerPhone}
                onChange={(e) => setCreateForm((f) => ({ ...f, customerPhone: e.target.value }))}
                placeholder="60123456789"
              />
            </div>
          </div>
          <div className="field">
            <label>Alamat</label>
            <input
              value={createForm.addressLine}
              onChange={(e) => setCreateForm((f) => ({ ...f, addressLine: e.target.value }))}
            />
          </div>
          <div className="inline-form">
            <div className="field">
              <label>Poskod</label>
              <input value={createForm.postcode} onChange={(e) => setCreateForm((f) => ({ ...f, postcode: e.target.value }))} />
            </div>
            <div className="field">
              <label>Bandar</label>
              <input value={createForm.city} onChange={(e) => setCreateForm((f) => ({ ...f, city: e.target.value }))} />
            </div>
            <div className="field">
              <label>Negeri</label>
              <input value={createForm.state} onChange={(e) => setCreateForm((f) => ({ ...f, state: e.target.value }))} />
            </div>
          </div>
          <div className="inline-form">
            <div className="field">
              <label>Produk</label>
              <select value={createForm.productId} onChange={(e) => onCreateProductChange(e.target.value)}>
                <option value="">— tidak ditentukan —</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Varian</label>
              <select
                value={createForm.variantId}
                onChange={(e) => setCreateForm((f) => ({ ...f, variantId: e.target.value }))}
                disabled={!createForm.productId}
              >
                <option value="">— tidak ada —</option>
                {productVariants(createForm.productId).map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Qty</label>
              <input
                type="number"
                min="1"
                value={createForm.quantity}
                onChange={(e) => setCreateForm((f) => ({ ...f, quantity: e.target.value }))}
              />
            </div>
          </div>
          <div className="inline-form">
            <div className="field">
              <label>Harga satuan (RM)</label>
              <input
                type="number"
                step="0.01"
                value={createForm.unitPriceRm}
                onChange={(e) => setCreateForm((f) => ({ ...f, unitPriceRm: e.target.value }))}
              />
            </div>
            <div className="field">
              <label>Total (RM) — kosongkan untuk auto-hitung</label>
              <input
                type="number"
                step="0.01"
                value={createForm.totalRm}
                onChange={(e) => setCreateForm((f) => ({ ...f, totalRm: e.target.value }))}
              />
            </div>
            <div className="field">
              <label>Status Penjualan</label>
              <select
                value={createForm.salesStatus}
                onChange={(e) => setCreateForm((f) => ({ ...f, salesStatus: e.target.value }))}
              >
                {SALES_STATUS_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="field">
            <label>Catatan</label>
            <textarea
              rows={2}
              value={createForm.notes}
              onChange={(e) => setCreateForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </div>
          <button className="btn block" type="submit" disabled={createBusy}>
            {createBusy ? "Menyimpan..." : "Simpan Pesanan"}
          </button>
        </form>
      </Modal>

      {/* Modal: Impor Resi */}
      <Modal open={showImport} onClose={() => setShowImport(false)} title="Impor resi (CSV)" width={560}>
        <form onSubmit={submitImport}>
          {importError && <div className="error-box">{importError}</div>}
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: -4, marginBottom: 12 }}>
            Tempel satu baris per resi, format: <code>resi,telefon,kurir</code> (telefon &amp; kurir
            boleh dikosongkan). Dicocokkan lewat orderId (kalau ada) atau nomor telefon pesanan
            terbaru yang belum punya resi.
          </p>
          <div className="field">
            <textarea
              rows={8}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder={"MYPOST123456,60123456789,J&T\nMYPOST789012,60129876543,Poslaju"}
            />
          </div>
          <button className="btn block" type="submit" disabled={importBusy}>
            {importBusy ? "Mengimpor..." : "Impor"}
          </button>
          {importResult && (
            <div className="panel" style={{ marginTop: 14 }}>
              <p>
                Berhasil memperbarui <strong>{importResult.updated.length}</strong> dari{" "}
                {importResult.totalRows} baris.
              </p>
              {importResult.failed.length > 0 && (
                <>
                  <p style={{ marginBottom: 6 }}>Gagal ({importResult.failed.length}):</p>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5 }}>
                    {importResult.failed.map((f, i) => (
                      <li key={i}>
                        {f.row.trackingNo} — {f.reason}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </form>
      </Modal>

      {/* Modal: Sunting Pesanan */}
      <Modal open={!!editingRow} onClose={() => setEditingRow(null)} title="Sunting pesanan" width={640}>
        {editingRow && (
          <form onSubmit={submitEdit}>
            {editError && <div className="error-box">{editError}</div>}
            <div className="inline-form">
              <div className="field">
                <label>Nama pembeli</label>
                <input
                  value={editForm.customerName}
                  onChange={(e) => setEditForm((f) => ({ ...f, customerName: e.target.value }))}
                />
              </div>
              <div className="field">
                <label>Nomor telefon</label>
                <input
                  value={editForm.customerPhone}
                  onChange={(e) => setEditForm((f) => ({ ...f, customerPhone: e.target.value }))}
                />
              </div>
            </div>
            <div className="field">
              <label>Alamat</label>
              <input
                value={editForm.addressLine}
                onChange={(e) => setEditForm((f) => ({ ...f, addressLine: e.target.value }))}
              />
            </div>
            <div className="inline-form">
              <div className="field">
                <label>Poskod</label>
                <input value={editForm.postcode} onChange={(e) => setEditForm((f) => ({ ...f, postcode: e.target.value }))} />
              </div>
              <div className="field">
                <label>Bandar</label>
                <input value={editForm.city} onChange={(e) => setEditForm((f) => ({ ...f, city: e.target.value }))} />
              </div>
              <div className="field">
                <label>Negeri</label>
                <input value={editForm.state} onChange={(e) => setEditForm((f) => ({ ...f, state: e.target.value }))} />
              </div>
            </div>
            <div className="inline-form">
              <div className="field">
                <label>Produk</label>
                <select
                  value={editForm.productId}
                  onChange={(e) => setEditForm((f) => ({ ...f, productId: e.target.value, variantId: "" }))}
                >
                  <option value="">— tidak ditentukan —</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Varian</label>
                <select
                  value={editForm.variantId}
                  onChange={(e) => setEditForm((f) => ({ ...f, variantId: e.target.value }))}
                  disabled={!editForm.productId}
                >
                  <option value="">— tidak ada —</option>
                  {productVariants(editForm.productId).map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Qty</label>
                <input
                  type="number"
                  min="1"
                  value={editForm.quantity}
                  onChange={(e) => setEditForm((f) => ({ ...f, quantity: e.target.value }))}
                />
              </div>
            </div>
            <div className="inline-form">
              <div className="field">
                <label>Harga satuan (RM)</label>
                <input
                  type="number"
                  step="0.01"
                  value={editForm.unitPriceRm}
                  onChange={(e) => setEditForm((f) => ({ ...f, unitPriceRm: e.target.value }))}
                />
              </div>
              <div className="field">
                <label>Total (RM)</label>
                <input
                  type="number"
                  step="0.01"
                  value={editForm.totalRm}
                  onChange={(e) => setEditForm((f) => ({ ...f, totalRm: e.target.value }))}
                />
              </div>
            </div>
            <div className="field">
              <label>Catatan</label>
              <textarea rows={2} value={editForm.notes} onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
            <button className="btn block" type="submit" disabled={editBusy}>
              {editBusy ? "Menyimpan..." : "Simpan Perubahan"}
            </button>
          </form>
        )}
      </Modal>

      {/* Modal: Ubah Pengiriman */}
      <Modal open={!!shippingRow} onClose={() => setShippingRow(null)} title="Ubah status pengiriman" width={520}>
        {shippingRow && (
          <form onSubmit={submitShipping}>
            {shippingError && <div className="error-box">{shippingError}</div>}
            <div className="inline-form">
              <div className="field">
                <label>Status Pengiriman</label>
                <select
                  value={shippingForm.shippingStatus}
                  onChange={(e) => setShippingForm((f) => ({ ...f, shippingStatus: e.target.value }))}
                >
                  {SHIPPING_STATUS_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Kurir</label>
                <input
                  value={shippingForm.courier}
                  onChange={(e) => setShippingForm((f) => ({ ...f, courier: e.target.value }))}
                  placeholder="mis. J&T, Poslaju"
                />
              </div>
            </div>
            <div className="field">
              <label>Nomor Resi</label>
              <input
                value={shippingForm.trackingNo}
                onChange={(e) => setShippingForm((f) => ({ ...f, trackingNo: e.target.value }))}
              />
            </div>
            <div className="field">
              <Check
                checked={shippingForm.hasProblem}
                onChange={(e) => setShippingForm((f) => ({ ...f, hasProblem: e.target.checked }))}
                label="Tandai bermasalah"
              />
            </div>
            {shippingForm.hasProblem && (
              <div className="field">
                <label>Alasan bermasalah</label>
                <input
                  value={shippingForm.problemReason}
                  onChange={(e) => setShippingForm((f) => ({ ...f, problemReason: e.target.value }))}
                  placeholder="mis. Pelanggan tidak dapat dihubungi, COD ditolak, dst."
                />
              </div>
            )}
            <button className="btn block" type="submit" disabled={shippingBusy}>
              {shippingBusy ? "Menyimpan..." : "Simpan"}
            </button>
          </form>
        )}
      </Modal>

      {/* Modal konfirmasi: Hapus */}
      <Modal open={!!deletingRow} onClose={() => setDeletingRow(null)} title="Hapus pesanan ini?" width={440}>
        {deletingRow && (
          <div>
            {deleteError && <div className="error-box">{deleteError}</div>}
            <p style={{ fontSize: 14 }}>
              Yakin mau menghapus pesanan atas nama <strong>{deletingRow.customer_name || "pesanan ini"}</strong>?
              Tindakan ini tidak bisa dibatalkan.
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
              <button type="button" className="btn danger" style={{ flex: 1 }} onClick={confirmDelete} disabled={deleteBusy}>
                {deleteBusy ? "Menghapus..." : "Ya, Hapus"}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
