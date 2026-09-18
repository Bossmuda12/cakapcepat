import { Fragment, useEffect, useState } from "react";
import { api } from "../api";
import Modal from "../components/Modal";
import ActionBtn from "../components/ActionBtn";

// Harga selalu disimpan backend dalam *Cents (sen) — lihat catatan endpoint
// produk. Ditampilkan/diterima di sini dalam RM supaya owner tidak perlu
// mengonversi manual.
function formatRM(cents) {
  if (cents === null || cents === undefined) return "—";
  return `RM ${(Number(cents) / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function centsToRmInput(cents) {
  if (cents === null || cents === undefined) return "";
  return String(Number(cents) / 100);
}
function rmInputToCents(value) {
  if (value === "" || value === null || value === undefined) return undefined;
  const n = Number(value);
  if (Number.isNaN(n)) return undefined;
  return Math.round(n * 100);
}

const emptyCategoryForm = { name: "", description: "" };
const emptyProductForm = { name: "", categoryId: "", description: "", priceRm: "", sku: "", imageUrl: "" };
const emptyVariantForm = { name: "", priceRm: "", sku: "", stock: "" };

export default function Products() {
  const [categories, setCategories] = useState(null);
  const [products, setProducts] = useState(null);
  const [error, setError] = useState("");

  // --- Kategori ---
  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState(null);
  const [categoryForm, setCategoryForm] = useState(emptyCategoryForm);
  const [categoryBusy, setCategoryBusy] = useState(false);
  const [categoryError, setCategoryError] = useState("");
  const [deletingCategory, setDeletingCategory] = useState(null);
  const [deleteCategoryBusy, setDeleteCategoryBusy] = useState(false);
  const [deleteCategoryError, setDeleteCategoryError] = useState("");

  // --- Produk ---
  const [showProductForm, setShowProductForm] = useState(false);
  const [editingProductId, setEditingProductId] = useState(null);
  const [productForm, setProductForm] = useState(emptyProductForm);
  const [productBusy, setProductBusy] = useState(false);
  const [productError, setProductError] = useState("");
  const [deletingProduct, setDeletingProduct] = useState(null);
  const [deleteProductBusy, setDeleteProductBusy] = useState(false);
  const [deleteProductError, setDeleteProductError] = useState("");

  // --- Varian (per produk yang lagi dibuka) ---
  const [expandedProductId, setExpandedProductId] = useState(null);
  const [variantForm, setVariantForm] = useState(emptyVariantForm);
  const [variantBusy, setVariantBusy] = useState(false);
  const [variantError, setVariantError] = useState("");
  const [editingVariant, setEditingVariant] = useState(null); // { id, name, priceRm, sku, stock }
  const [deletingVariant, setDeletingVariant] = useState(null);
  const [deleteVariantBusy, setDeleteVariantBusy] = useState(false);
  const [deleteVariantError, setDeleteVariantError] = useState("");

  const load = async () => {
    try {
      const [c, p] = await Promise.all([api.get("/categories"), api.get("/products")]);
      setCategories(c);
      setProducts(p);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const categoryName = (id) => categories?.find((c) => c.id === id)?.name || "— Tanpa kategori —";

  // ===== Kategori =====
  const openCreateCategory = () => {
    setEditingCategoryId(null);
    setCategoryForm(emptyCategoryForm);
    setCategoryError("");
    setShowCategoryForm(true);
  };
  const openEditCategory = (c) => {
    setEditingCategoryId(c.id);
    setCategoryForm({ name: c.name || "", description: c.description || "" });
    setCategoryError("");
    setShowCategoryForm(true);
  };
  const submitCategory = async (e) => {
    e.preventDefault();
    setCategoryBusy(true);
    setCategoryError("");
    try {
      const payload = { name: categoryForm.name, description: categoryForm.description || undefined };
      if (editingCategoryId) await api.patch(`/categories/${editingCategoryId}`, payload);
      else await api.post("/categories", payload);
      setShowCategoryForm(false);
      await load();
    } catch (err) {
      setCategoryError(err.message);
    } finally {
      setCategoryBusy(false);
    }
  };
  const toggleCategoryActive = async (c) => {
    try {
      await api.patch(`/categories/${c.id}`, { isActive: !c.is_active });
      await load();
    } catch (err) {
      setError(err.message);
    }
  };
  const confirmDeleteCategory = async () => {
    if (!deletingCategory) return;
    setDeleteCategoryBusy(true);
    setDeleteCategoryError("");
    try {
      await api.del(`/categories/${deletingCategory.id}`);
      setDeletingCategory(null);
      await load();
    } catch (err) {
      setDeleteCategoryError(err.message);
    } finally {
      setDeleteCategoryBusy(false);
    }
  };

  // ===== Produk =====
  const openCreateProduct = () => {
    setEditingProductId(null);
    setProductForm(emptyProductForm);
    setProductError("");
    setShowProductForm(true);
  };
  const openEditProduct = (p) => {
    setEditingProductId(p.id);
    setProductForm({
      name: p.name || "",
      categoryId: p.category_id || "",
      description: p.description || "",
      priceRm: centsToRmInput(p.price_cents),
      sku: p.sku || "",
      imageUrl: p.image_url || "",
    });
    setProductError("");
    setShowProductForm(true);
  };
  const submitProduct = async (e) => {
    e.preventDefault();
    setProductBusy(true);
    setProductError("");
    try {
      const payload = {
        name: productForm.name,
        categoryId: productForm.categoryId || undefined,
        description: productForm.description || undefined,
        priceCents: rmInputToCents(productForm.priceRm),
        sku: productForm.sku || undefined,
        imageUrl: productForm.imageUrl || undefined,
      };
      if (editingProductId) await api.patch(`/products/${editingProductId}`, payload);
      else await api.post("/products", payload);
      setShowProductForm(false);
      await load();
    } catch (err) {
      setProductError(err.message);
    } finally {
      setProductBusy(false);
    }
  };
  const toggleProductActive = async (p) => {
    try {
      await api.patch(`/products/${p.id}`, { isActive: !p.is_active });
      await load();
    } catch (err) {
      setError(err.message);
    }
  };
  const confirmDeleteProduct = async () => {
    if (!deletingProduct) return;
    setDeleteProductBusy(true);
    setDeleteProductError("");
    try {
      await api.del(`/products/${deletingProduct.id}`);
      setDeletingProduct(null);
      await load();
    } catch (err) {
      setDeleteProductError(err.message);
    } finally {
      setDeleteProductBusy(false);
    }
  };

  // ===== Varian =====
  const toggleExpand = (productId) => {
    setExpandedProductId((cur) => (cur === productId ? null : productId));
    setVariantForm(emptyVariantForm);
    setVariantError("");
    setEditingVariant(null);
  };

  const submitNewVariant = async (e, productId) => {
    e.preventDefault();
    setVariantBusy(true);
    setVariantError("");
    try {
      await api.post("/variants", {
        productId,
        name: variantForm.name,
        priceCents: rmInputToCents(variantForm.priceRm),
        sku: variantForm.sku || undefined,
        stock: variantForm.stock === "" ? undefined : Number(variantForm.stock),
      });
      setVariantForm(emptyVariantForm);
      await load();
    } catch (err) {
      setVariantError(err.message);
    } finally {
      setVariantBusy(false);
    }
  };

  const startEditVariant = (v) => {
    setEditingVariant({
      id: v.id,
      name: v.name || "",
      priceRm: centsToRmInput(v.priceCents),
      sku: v.sku || "",
      stock: v.stock ?? "",
    });
    setVariantError("");
  };

  const submitEditVariant = async (e) => {
    e.preventDefault();
    if (!editingVariant) return;
    setVariantBusy(true);
    setVariantError("");
    try {
      await api.patch(`/variants/${editingVariant.id}`, {
        name: editingVariant.name,
        priceCents: rmInputToCents(editingVariant.priceRm),
        sku: editingVariant.sku || undefined,
        stock: editingVariant.stock === "" ? undefined : Number(editingVariant.stock),
      });
      setEditingVariant(null);
      await load();
    } catch (err) {
      setVariantError(err.message);
    } finally {
      setVariantBusy(false);
    }
  };

  const toggleVariantActive = async (v) => {
    try {
      await api.patch(`/variants/${v.id}`, { isActive: !v.isActive });
      await load();
    } catch (err) {
      setVariantError(err.message);
    }
  };

  const confirmDeleteVariant = async () => {
    if (!deletingVariant) return;
    setDeleteVariantBusy(true);
    setDeleteVariantError("");
    try {
      await api.del(`/variants/${deletingVariant.id}`);
      setDeletingVariant(null);
      await load();
    } catch (err) {
      setDeleteVariantError(err.message);
    } finally {
      setDeleteVariantBusy(false);
    }
  };

  return (
    <div>
      <div className="toolbar">
        <div>
          <h1>Produk</h1>
          <p className="page-subtitle">
            Kategori &gt; Produk &gt; Varian — tiap produk baru biasanya dapat nomor WA &amp; CS sendiri.
          </p>
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}

      {/* ===================== KATEGORI ===================== */}
      <div className="panel">
        <div className="toolbar" style={{ marginBottom: 14 }}>
          <h2 style={{ margin: 0 }}>Kategori</h2>
          <button className="btn secondary" type="button" onClick={openCreateCategory}>
            + Tambah Kategori
          </button>
        </div>
        {categories === null ? (
          <div className="loading-block">Memuat...</div>
        ) : categories.length === 0 ? (
          <div className="empty-state">Belum ada kategori. Produk tanpa kategori tetap bisa dibuat.</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Nama</th>
                  <th>Keterangan</th>
                  <th>Jumlah Produk</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {categories.map((c) => (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td className="text-muted">{c.description || "—"}</td>
                    <td>{c.product_count}</td>
                    <td>
                      <button className="btn secondary" type="button" onClick={() => toggleCategoryActive(c)}>
                        {c.is_active ? "Aktif" : "Nonaktif"}
                      </button>
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <ActionBtn kind="edit" onClick={() => openEditCategory(c)}>
                        Edit
                      </ActionBtn>
                      <ActionBtn
                        kind="hapus"
                        onClick={() => {
                          setDeleteCategoryError("");
                          setDeletingCategory(c);
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
      </div>

      {/* ===================== PRODUK ===================== */}
      <div className="panel">
        <div className="toolbar" style={{ marginBottom: 14 }}>
          <h2 style={{ margin: 0 }}>Produk</h2>
          <button className="btn" type="button" onClick={openCreateProduct}>
            + Tambah Produk
          </button>
        </div>
        {products === null ? (
          <div className="loading-block">Memuat...</div>
        ) : products.length === 0 ? (
          <div className="empty-state">Belum ada produk.</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th></th>
                  <th>Nama</th>
                  <th>Kategori</th>
                  <th>Harga</th>
                  <th>SKU</th>
                  <th>Status</th>
                  <th>Nomor WA</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <Fragment key={p.id}>
                    <tr>
                      <td>
                        <button
                          type="button"
                          className="btn-link"
                          onClick={() => toggleExpand(p.id)}
                          title="Lihat varian"
                        >
                          {expandedProductId === p.id ? "▾" : "▸"} {(p.variants || []).length}
                        </button>
                      </td>
                      <td>
                        {p.image_url && (
                          <img
                            src={p.image_url}
                            alt=""
                            style={{ width: 28, height: 28, borderRadius: 6, objectFit: "cover", marginRight: 8, verticalAlign: "middle" }}
                          />
                        )}
                        {p.name}
                      </td>
                      <td>{p.category_name || categoryName(p.category_id)}</td>
                      <td>{formatRM(p.price_cents)}</td>
                      <td className="text-muted">{p.sku || "—"}</td>
                      <td>
                        <button className="btn secondary" type="button" onClick={() => toggleProductActive(p)}>
                          {p.is_active ? "Aktif" : "Nonaktif"}
                        </button>
                      </td>
                      <td>{p.channel_count}</td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <ActionBtn kind="edit" onClick={() => openEditProduct(p)}>
                          Edit
                        </ActionBtn>
                        <ActionBtn
                          kind="hapus"
                          onClick={() => {
                            setDeleteProductError("");
                            setDeletingProduct(p);
                          }}
                        >
                          Hapus
                        </ActionBtn>
                      </td>
                    </tr>
                    {expandedProductId === p.id && (
                      <tr>
                        <td colSpan={8} style={{ background: "var(--bg)" }}>
                          <div style={{ padding: "10px 6px" }}>
                            <h3 style={{ fontSize: 13, margin: "0 0 10px" }}>Varian — {p.name}</h3>
                            {variantError && <div className="error-box">{variantError}</div>}
                            {(p.variants || []).length === 0 ? (
                              <p className="text-muted" style={{ fontSize: 12.5, margin: "0 0 10px" }}>
                                Belum ada varian untuk produk ini.
                              </p>
                            ) : (
                              <table style={{ marginBottom: 10 }}>
                                <thead>
                                  <tr>
                                    <th>Nama</th>
                                    <th>Harga</th>
                                    <th>SKU</th>
                                    <th>Stok</th>
                                    <th>Status</th>
                                    <th></th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {(p.variants || []).map((v) =>
                                    editingVariant?.id === v.id ? (
                                      <tr key={v.id}>
                                        <td colSpan={6}>
                                          <form
                                            onSubmit={submitEditVariant}
                                            style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}
                                          >
                                            <div className="field" style={{ marginBottom: 0 }}>
                                              <label>Nama</label>
                                              <input
                                                value={editingVariant.name}
                                                onChange={(e) => setEditingVariant((f) => ({ ...f, name: e.target.value }))}
                                                required
                                              />
                                            </div>
                                            <div className="field" style={{ marginBottom: 0 }}>
                                              <label>Harga (RM)</label>
                                              <input
                                                type="number"
                                                step="0.01"
                                                value={editingVariant.priceRm}
                                                onChange={(e) => setEditingVariant((f) => ({ ...f, priceRm: e.target.value }))}
                                              />
                                            </div>
                                            <div className="field" style={{ marginBottom: 0 }}>
                                              <label>SKU</label>
                                              <input
                                                value={editingVariant.sku}
                                                onChange={(e) => setEditingVariant((f) => ({ ...f, sku: e.target.value }))}
                                              />
                                            </div>
                                            <div className="field" style={{ marginBottom: 0 }}>
                                              <label>Stok</label>
                                              <input
                                                type="number"
                                                min="0"
                                                value={editingVariant.stock}
                                                onChange={(e) => setEditingVariant((f) => ({ ...f, stock: e.target.value }))}
                                              />
                                            </div>
                                            <button className="btn" type="submit" disabled={variantBusy}>
                                              {variantBusy ? "..." : "Simpan"}
                                            </button>
                                            <button
                                              type="button"
                                              className="btn secondary"
                                              onClick={() => setEditingVariant(null)}
                                              disabled={variantBusy}
                                            >
                                              Batal
                                            </button>
                                          </form>
                                        </td>
                                      </tr>
                                    ) : (
                                      <tr key={v.id}>
                                        <td>{v.name}</td>
                                        <td>{formatRM(v.priceCents)}</td>
                                        <td className="text-muted">{v.sku || "—"}</td>
                                        <td>{v.stock ?? "—"}</td>
                                        <td>
                                          <button className="btn secondary" type="button" onClick={() => toggleVariantActive(v)}>
                                            {v.isActive ? "Aktif" : "Nonaktif"}
                                          </button>
                                        </td>
                                        <td style={{ whiteSpace: "nowrap" }}>
                                          <ActionBtn kind="edit" onClick={() => startEditVariant(v)}>
                                            Edit
                                          </ActionBtn>
                                          <ActionBtn
                                            kind="hapus"
                                            onClick={() => {
                                              setDeleteVariantError("");
                                              setDeletingVariant(v);
                                            }}
                                          >
                                            Hapus
                                          </ActionBtn>
                                        </td>
                                      </tr>
                                    )
                                  )}
                                </tbody>
                              </table>
                            )}
                            <form
                              onSubmit={(e) => submitNewVariant(e, p.id)}
                              style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}
                            >
                              <div className="field" style={{ marginBottom: 0 }}>
                                <label>Nama varian baru</label>
                                <input
                                  value={variantForm.name}
                                  onChange={(e) => setVariantForm((f) => ({ ...f, name: e.target.value }))}
                                  placeholder="mis. 100ml"
                                  required
                                />
                              </div>
                              <div className="field" style={{ marginBottom: 0 }}>
                                <label>Harga (RM)</label>
                                <input
                                  type="number"
                                  step="0.01"
                                  value={variantForm.priceRm}
                                  onChange={(e) => setVariantForm((f) => ({ ...f, priceRm: e.target.value }))}
                                />
                              </div>
                              <div className="field" style={{ marginBottom: 0 }}>
                                <label>SKU</label>
                                <input
                                  value={variantForm.sku}
                                  onChange={(e) => setVariantForm((f) => ({ ...f, sku: e.target.value }))}
                                />
                              </div>
                              <div className="field" style={{ marginBottom: 0 }}>
                                <label>Stok</label>
                                <input
                                  type="number"
                                  min="0"
                                  value={variantForm.stock}
                                  onChange={(e) => setVariantForm((f) => ({ ...f, stock: e.target.value }))}
                                />
                              </div>
                              <button className="btn secondary" type="submit" disabled={variantBusy}>
                                {variantBusy ? "..." : "+ Tambah Varian"}
                              </button>
                            </form>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ===================== MODAL: Kategori ===================== */}
      <Modal
        open={showCategoryForm}
        onClose={() => setShowCategoryForm(false)}
        title={editingCategoryId ? "Edit kategori" : "Tambah kategori baru"}
        width={480}
      >
        <form onSubmit={submitCategory}>
          {categoryError && <div className="error-box">{categoryError}</div>}
          <div className="field">
            <label>Nama kategori</label>
            <input
              value={categoryForm.name}
              onChange={(e) => setCategoryForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="mis. Skincare"
              autoFocus
              required
            />
          </div>
          <div className="field">
            <label>Keterangan (opsional)</label>
            <textarea
              rows={2}
              value={categoryForm.description}
              onChange={(e) => setCategoryForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>
          <button className="btn block" type="submit" disabled={categoryBusy}>
            {categoryBusy ? "Menyimpan..." : "Simpan"}
          </button>
        </form>
      </Modal>

      {/* ===================== MODAL: Produk ===================== */}
      <Modal
        open={showProductForm}
        onClose={() => setShowProductForm(false)}
        title={editingProductId ? "Edit produk" : "Tambah produk baru"}
        width={560}
      >
        <form onSubmit={submitProduct}>
          {productError && <div className="error-box">{productError}</div>}
          <div className="inline-form">
            <div className="field">
              <label>Nama produk</label>
              <input
                value={productForm.name}
                onChange={(e) => setProductForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="mis. Serum Vitamin C"
                required
              />
            </div>
            <div className="field">
              <label>Kategori</label>
              <select
                value={productForm.categoryId}
                onChange={(e) => setProductForm((f) => ({ ...f, categoryId: e.target.value }))}
              >
                <option value="">— tidak ditentukan —</option>
                {(categories || []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="field">
            <label>Keterangan</label>
            <textarea
              rows={2}
              value={productForm.description}
              onChange={(e) => setProductForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>
          <div className="inline-form">
            <div className="field">
              <label>Harga (RM)</label>
              <input
                type="number"
                step="0.01"
                value={productForm.priceRm}
                onChange={(e) => setProductForm((f) => ({ ...f, priceRm: e.target.value }))}
                placeholder="189.00"
              />
            </div>
            <div className="field">
              <label>SKU</label>
              <input value={productForm.sku} onChange={(e) => setProductForm((f) => ({ ...f, sku: e.target.value }))} />
            </div>
          </div>
          <div className="field">
            <label>URL Gambar</label>
            <input
              value={productForm.imageUrl}
              onChange={(e) => setProductForm((f) => ({ ...f, imageUrl: e.target.value }))}
              placeholder="https://..."
            />
          </div>
          <button className="btn block" type="submit" disabled={productBusy}>
            {productBusy ? "Menyimpan..." : editingProductId ? "Simpan Perubahan" : "Simpan Produk"}
          </button>
        </form>
      </Modal>

      {/* ===================== MODAL konfirmasi hapus ===================== */}
      <Modal open={!!deletingCategory} onClose={() => setDeletingCategory(null)} title="Hapus kategori?" width={440}>
        {deletingCategory && (
          <div>
            {deleteCategoryError && <div className="error-box">{deleteCategoryError}</div>}
            <p style={{ fontSize: 14 }}>
              Yakin mau menghapus kategori <strong>{deletingCategory.name}</strong>? Produk yang memakai
              kategori ini TIDAK ikut terhapus — cuma jadi tidak berkategori.
            </p>
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button
                type="button"
                className="btn secondary"
                style={{ flex: 1 }}
                onClick={() => setDeletingCategory(null)}
                disabled={deleteCategoryBusy}
              >
                Batal
              </button>
              <button
                type="button"
                className="btn danger"
                style={{ flex: 1 }}
                onClick={confirmDeleteCategory}
                disabled={deleteCategoryBusy}
              >
                {deleteCategoryBusy ? "Menghapus..." : "Ya, Hapus"}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!deletingProduct} onClose={() => setDeletingProduct(null)} title="Hapus produk?" width={440}>
        {deletingProduct && (
          <div>
            {deleteProductError && <div className="error-box">{deleteProductError}</div>}
            <p style={{ fontSize: 14 }}>
              Yakin mau menghapus produk <strong>{deletingProduct.name}</strong>? Semua variannya ikut
              terhapus. Nomor WA/pesanan yang menempel ke produk ini TIDAK ikut terhapus (cuma jadi
              tidak berproduk). Tindakan ini tidak bisa dibatalkan.
            </p>
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button
                type="button"
                className="btn secondary"
                style={{ flex: 1 }}
                onClick={() => setDeletingProduct(null)}
                disabled={deleteProductBusy}
              >
                Batal
              </button>
              <button
                type="button"
                className="btn danger"
                style={{ flex: 1 }}
                onClick={confirmDeleteProduct}
                disabled={deleteProductBusy}
              >
                {deleteProductBusy ? "Menghapus..." : "Ya, Hapus"}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!deletingVariant} onClose={() => setDeletingVariant(null)} title="Hapus varian?" width={420}>
        {deletingVariant && (
          <div>
            {deleteVariantError && <div className="error-box">{deleteVariantError}</div>}
            <p style={{ fontSize: 14 }}>
              Yakin mau menghapus varian <strong>{deletingVariant.name}</strong>? Tindakan ini tidak bisa
              dibatalkan.
            </p>
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button
                type="button"
                className="btn secondary"
                style={{ flex: 1 }}
                onClick={() => setDeletingVariant(null)}
                disabled={deleteVariantBusy}
              >
                Batal
              </button>
              <button
                type="button"
                className="btn danger"
                style={{ flex: 1 }}
                onClick={confirmDeleteVariant}
                disabled={deleteVariantBusy}
              >
                {deleteVariantBusy ? "Menghapus..." : "Ya, Hapus"}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
