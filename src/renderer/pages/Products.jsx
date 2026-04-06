import React, { useEffect, useMemo, useState } from "react";
import { usePOS } from "../App";

function ConfirmDialog({
  open,
  title = "Confirm delete",
  message = "Are you sure?",
  confirmText = "Delete",
  cancelText = "Cancel",
  busy = false,
  onConfirm,
  onCancel,
}) {
  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.62)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10000,
        padding: 16,
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel?.();
      }}
    >
      <div
        style={{
          width: 460,
          maxWidth: "100%",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 18,
          boxShadow: "var(--shadow)",
          padding: 18,
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 18, fontWeight: 900, color: "var(--text)" }}>{title}</div>
        <div style={{ marginTop: 10, color: "var(--text2)", lineHeight: 1.55, whiteSpace: "pre-line" }}>
          {message}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}>
          <button
            onClick={onCancel}
            disabled={busy}
            style={{
              padding: "10px 14px",
              borderRadius: 12,
              border: "1px solid var(--border)",
              background: "rgba(255,255,255,0.03)",
              color: "var(--text)",
              fontWeight: 800,
              cursor: busy ? "not-allowed" : "pointer",
              opacity: busy ? 0.7 : 1,
            }}
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            style={{
              padding: "10px 14px",
              borderRadius: 12,
              border: "1px solid rgba(244,63,94,0.35)",
              background: "rgba(244,63,94,0.12)",
              color: "#fecdd3",
              fontWeight: 900,
              cursor: busy ? "not-allowed" : "pointer",
              opacity: busy ? 0.7 : 1,
            }}
          >
            {busy ? "Deleting..." : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

const symMap = { BDT: "৳", USD: "$", GBP: "£", EUR: "€" };

export default function Products() {
  const { api, showToast, me } = usePOS();
  const isAdmin = me?.role === "admin" || me?.role === "superadmin";

  const [loading, setLoading] = useState(false);
  const [currency, setCurrency] = useState("BDT");
  const sym = symMap[currency] || "৳";
  const fmt = (n) => `${sym}${(Number(n) || 0).toFixed(2)}`;

  const [q, setQ] = useState("");
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);

  const [form, setForm] = useState({
    name: "",
    sku: "",
    barcode: "",
    category: "",
    price: "",
    cost: "",
    stock: "",
    low_stock_threshold: "5",
  });

  const [newCat, setNewCat] = useState({ name: "", color: "#6366f1" });

  const [editOpen, setEditOpen] = useState(false);
  const [edit, setEdit] = useState(null);

  const [catEditOpen, setCatEditOpen] = useState(false);
  const [catEdit, setCatEdit] = useState(null);

  const [confirmState, setConfirmState] = useState(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const s = await api.settings.getAll().catch(() => null);
      if (s?.currency) setCurrency(String(s.currency).trim());

      const cats = await api.categories.getAll();
      setCategories(cats || []);

      const list = q.trim()
        ? await api.products.search(q.trim())
        : await api.products.getAll();
      setProducts(list || []);
    } catch (e) {
      console.error(e);
      showToast("Failed to load products", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line
  useEffect(() => {
    const t = setTimeout(() => load(), 250);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line

  const canCreate = useMemo(() => {
    return form.name.trim() && String(form.price).trim() !== "" && String(form.category).trim() !== "";
  }, [form]);

  const canAddCat = useMemo(() => newCat.name.trim().length > 0, [newCat.name]);

  const resetForm = () =>
    setForm({
      name: "",
      sku: "",
      barcode: "",
      category: "",
      price: "",
      cost: "",
      stock: "",
      low_stock_threshold: "5",
    });

  async function createProduct() {
    if (!isAdmin) return showToast("Admin only", "error");
    if (!canCreate) return showToast("Name, category, price required", "warning");

    try {
      const payload = {
        name: form.name.trim(),
        sku: form.sku.trim() || null,
        barcode: form.barcode.trim() || "",
        category: form.category,
        price: Number(form.price || 0),
        cost: Number(form.cost || 0),
        stock: Number(form.stock || 0),
        low_stock_threshold: Number(form.low_stock_threshold || 5),
      };

      const res = await api.products.create(payload);
      if (res?.ok === false) return showToast(res.message || "Create failed", "error");

      showToast("Product created ✅");
      resetForm();
      await load();
    } catch (e) {
      console.error(e);
      showToast("Create failed", "error");
    }
  }

  async function addCategory() {
    if (!isAdmin) return showToast("Admin only", "error");
    if (!canAddCat) return showToast("Category name required", "warning");

    try {
      const res = await api.categories.create({
        name: newCat.name.trim(),
        color: newCat.color,
      });

      if (res?.ok === false) return showToast(res.message || "Create failed", "error");

      showToast("Category created ✅");
      setNewCat({ name: "", color: "#6366f1" });
      await load();
    } catch (e) {
      console.error(e);
      showToast("Create failed", "error");
    }
  }

  function openEdit(p) {
    setEdit({
      id: p.id,
      name: p.name || "",
      sku: p.sku || "",
      barcode: p.barcode || "",
      category: p.category || "",
      price: String(p.price ?? ""),
      cost: String(p.cost ?? ""),
      stock: String(p.stock ?? ""),
      low_stock_threshold: String(p.low_stock_threshold ?? 5),
    });
    setEditOpen(true);
  }

  async function saveEdit() {
    if (!isAdmin) return showToast("Admin only", "error");
    if (!edit?.name?.trim()) return showToast("Name required", "warning");
    if (!edit?.category?.trim()) return showToast("Category required", "warning");

    try {
      const payload = {
        id: edit.id,
        name: edit.name.trim(),
        sku: edit.sku.trim() || null,
        barcode: edit.barcode.trim() || "",
        category: edit.category,
        price: Number(edit.price || 0),
        cost: Number(edit.cost || 0),
        stock: Number(edit.stock || 0),
        low_stock_threshold: Number(edit.low_stock_threshold || 5),
      };

      const res = await api.products.update(payload);
      if (res?.ok === false) return showToast(res.message || "Update failed", "error");

      showToast("Product updated ✅");
      setEditOpen(false);
      setEdit(null);
      await load();
    } catch (e) {
      console.error(e);
      showToast("Update failed", "error");
    }
  }

  function openCategoryEdit(c) {
    setCatEdit({
      id: c.id,
      name: c.name || "",
      color: c.color || "#6366f1",
    });
    setCatEditOpen(true);
  }

  async function saveCategoryEdit() {
    if (!isAdmin) return showToast("Admin only", "error");
    if (!catEdit?.name?.trim()) return showToast("Name required", "warning");

    try {
      const res = await api.categories.update({
        id: catEdit.id,
        name: catEdit.name.trim(),
        color: catEdit.color || "#6366f1",
      });

      if (res?.ok === false) return showToast(res.message || "Update failed", "error");

      showToast("Category updated ✅");
      setCatEditOpen(false);
      setCatEdit(null);
      await load();
    } catch (e) {
      console.error(e);
      showToast("Update failed", "error");
    }
  }

  async function performDeleteProduct(p) {
    setConfirmBusy(true);
    try {
      const res = await api.products.delete(p.id);
      if (res?.ok === false) return showToast(res.message || "Delete failed", "error");
      showToast("Deleted", "warning");
      await load();
      setConfirmState(null);
    } catch (e) {
      console.error(e);
      showToast("Delete failed", "error");
    } finally {
      setConfirmBusy(false);
    }
  }

  async function performDeleteCategory(c) {
    setConfirmBusy(true);
    try {
      const res = await api.categories.delete(c.id);
      if (res?.ok === false) return showToast(res.message || "Delete failed", "error");
      showToast("Category deleted", "warning");
      await load();
      if (form.category === c.name) setForm((prev) => ({ ...prev, category: "" }));
      if (edit?.category === c.name) setEdit((prev) => (prev ? { ...prev, category: "" } : prev));
      setConfirmState(null);
    } catch (e) {
      console.error(e);
      showToast("Delete failed", "error");
    } finally {
      setConfirmBusy(false);
    }
  }

  function del(p) {
    if (!isAdmin) return showToast("Admin only", "error");
    setConfirmState({
      title: "Delete product",
      message: `Delete "${p.name}"?`,
      confirmText: "Delete product",
      onConfirm: () => performDeleteProduct(p),
    });
  }

  function deleteCategory(c) {
    if (!isAdmin) return showToast("Admin only", "error");
    setConfirmState({
      title: "Delete category",
      message: `Delete category "${c.name}"?\n\nProducts using this category will be cleared.`,
      confirmText: "Delete category",
      onConfirm: () => performDeleteCategory(c),
    });
  }

  return (
    <div style={S.page}>
      <div style={S.wrap}>
        <div style={S.header}>
          <div>
            <h1 style={S.title}>Products</h1>
            <div style={S.subtitle}>
              {isAdmin
                ? "Admin can manage products, prices, and product categories here."
                : "Read-only (admin only to edit)."}
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <div style={S.pill}>{currency} ({sym})</div>
            <div style={S.pill}>{loading ? "Loading…" : `${products.length} products`}</div>
            <div style={S.pill}>{`${categories.length} categories`}</div>
          </div>
        </div>

        <div style={S.searchRow}>
          <div style={{ flex: 1, position: "relative" }}>
            <span style={S.searchIcon}>🔎</span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name / SKU / barcode…"
              style={S.search}
            />
          </div>
          <div style={S.pill}>{me ? `👤 ${me.name} (${me.role})` : "Not logged in"}</div>
        </div>

        <div style={S.card}>
          <div style={S.cardTitle}>Add Product {isAdmin ? "(Admin)" : "(Admin only)"}</div>

          <div style={S.grid}>
            <Field label="Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} disabled={!isAdmin} />
            <Field label="SKU (unique)" value={form.sku} onChange={(v) => setForm({ ...form, sku: v })} disabled={!isAdmin} />
            <Field label="Barcode" value={form.barcode} onChange={(v) => setForm({ ...form, barcode: v })} disabled={!isAdmin} />

            <div>
              <div style={S.label}>Category</div>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                style={S.select(!isAdmin)}
                disabled={!isAdmin}
              >
                <option value="">-- Select category --</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.name}>{c.name}</option>
                ))}
              </select>
            </div>

            <Field label="Selling Price" value={form.price} onChange={(v) => setForm({ ...form, price: v })} disabled={!isAdmin} type="number" />
            <Field label="Buying Price (Cost)" value={form.cost} onChange={(v) => setForm({ ...form, cost: v })} disabled={!isAdmin} type="number" />
            <Field label="Stock" value={form.stock} onChange={(v) => setForm({ ...form, stock: v })} disabled={!isAdmin} type="number" />
            <Field label="Low stock alert" value={form.low_stock_threshold} onChange={(v) => setForm({ ...form, low_stock_threshold: v })} disabled={!isAdmin} type="number" />

            <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
              <button style={S.btnPrimary(!isAdmin || !canCreate)} disabled={!isAdmin || !canCreate} onClick={createProduct}>
                Create
              </button>
              <button style={S.btnGhost()} onClick={resetForm}>Clear</button>
            </div>
          </div>
        </div>

        <div style={{ ...S.card, marginTop: 14 }}>
          <div style={S.cardTitle}>Product Categories</div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 220px 110px", gap: 10, marginTop: 12, alignItems: "end" }}>
            <Field
              label="New category name"
              value={newCat.name}
              onChange={(v) => setNewCat({ ...newCat, name: v })}
              disabled={!isAdmin}
              placeholder="e.g. Grocery"
            />

            <div>
              <div style={S.label}>Color</div>
              <input
                type="color"
                value={newCat.color}
                disabled={!isAdmin}
                onChange={(e) => setNewCat({ ...newCat, color: e.target.value })}
                style={S.colorInput(!isAdmin)}
              />
            </div>

            <div style={{ display: "flex", alignItems: "flex-end" }}>
              <button
                onClick={addCategory}
                style={S.btnPrimary(!isAdmin || !canAddCat)}
                disabled={!isAdmin || !canAddCat}
              >
                Add
              </button>
            </div>
          </div>

          <div style={{ marginTop: 12, border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>Name</th>
                  <th style={S.th}>Color</th>
                  <th style={{ ...S.th, width: 220 }} />
                </tr>
              </thead>
              <tbody>
                {categories.map((c, idx) => (
                  <tr key={c.id} style={{ background: idx % 2 ? "rgba(255,255,255,0.02)" : "transparent" }}>
                    <td style={S.td}><b>{c.name}</b></td>
                    <td style={S.td}>
                      <span style={S.colorChipWrap}>
                        <span style={{ ...S.colorDot, background: c.color || "#6366f1" }} />
                        {c.color || "#6366f1"}
                      </span>
                    </td>
                    <td style={{ ...S.td, textAlign: "right" }}>
                      <button style={S.btnGhost()} onClick={() => openCategoryEdit(c)} disabled={!isAdmin}>Edit</button>
                      <button style={{ ...S.btnDanger(), marginLeft: 8 }} onClick={() => deleteCategory(c)} disabled={!isAdmin}>Delete</button>
                    </td>
                  </tr>
                ))}
                {categories.length === 0 && (
                  <tr>
                    <td style={{ ...S.td, padding: 18, color: "var(--text2)" }} colSpan={3}>
                      No categories found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ ...S.card, marginTop: 14, padding: 0, overflow: "hidden" }}>
          <div style={{ padding: 14, borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={S.cardTitle}>Product List</div>
            {!isAdmin && <div style={{ color: "var(--text2)", fontSize: 12, fontWeight: 800 }}>Login as admin to edit</div>}
          </div>

          <div style={S.tableWrap}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>Name</th>
                  <th style={S.th}>SKU</th>
                  <th style={S.th}>Category</th>
                  <th style={{ ...S.th, textAlign: "right" }}>Sell</th>
                  <th style={{ ...S.th, textAlign: "right" }}>Buy</th>
                  <th style={{ ...S.th, textAlign: "right" }}>Stock</th>
                  <th style={{ ...S.th, width: 220 }} />
                </tr>
              </thead>
              <tbody>
                {products.map((p, idx) => (
                  <tr key={p.id} style={{ background: idx % 2 ? "rgba(255,255,255,0.02)" : "transparent" }}>
                    <td style={S.td}>
                      <div style={{ fontWeight: 900 }}>{p.name}</div>
                      <div style={{ color: "var(--text3)", fontSize: 11 }}>{p.barcode || ""}</div>
                    </td>
                    <td style={S.td}>{p.sku || "-"}</td>
                    <td style={S.td}>{p.category || "-"}</td>
                    <td style={{ ...S.td, textAlign: "right" }} className="mono">{fmt(p.price)}</td>
                    <td style={{ ...S.td, textAlign: "right" }} className="mono">{fmt(p.cost)}</td>
                    <td style={{ ...S.td, textAlign: "right" }}>
                      <span style={S.stockPill(p.stock <= p.low_stock_threshold)}>{p.stock}</span>
                    </td>
                    <td style={{ ...S.td, textAlign: "right" }}>
                      <button style={S.btnGhost()} onClick={() => openEdit(p)} disabled={!isAdmin}>Edit</button>
                      <button style={{ ...S.btnDanger(), marginLeft: 8 }} onClick={() => del(p)} disabled={!isAdmin}>Delete</button>
                    </td>
                  </tr>
                ))}
                {products.length === 0 && (
                  <tr>
                    <td style={{ ...S.td, padding: 18, color: "var(--text2)" }} colSpan={7}>
                      No products found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <Modal
          open={editOpen}
          width={760}
          title="Edit product"
          onClose={() => { setEditOpen(false); setEdit(null); }}
        >
          {edit && (
            <>
              <div style={S.gridModal}>
                <Field label="Name" value={edit.name} onChange={(v) => setEdit({ ...edit, name: v })} />
                <Field label="SKU (unique)" value={edit.sku} onChange={(v) => setEdit({ ...edit, sku: v })} />
                <Field label="Barcode" value={edit.barcode} onChange={(v) => setEdit({ ...edit, barcode: v })} />

                <div>
                  <div style={S.label}>Category</div>
                  <select value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })} style={S.select(false)}>
                    <option value="">-- Select category --</option>
                    {categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
                  </select>
                </div>

                <Field label="Selling Price" value={edit.price} onChange={(v) => setEdit({ ...edit, price: v })} type="number" />
                <Field label="Buying Price (Cost)" value={edit.cost} onChange={(v) => setEdit({ ...edit, cost: v })} type="number" />
                <Field label="Stock" value={edit.stock} onChange={(v) => setEdit({ ...edit, stock: v })} type="number" />
                <Field label="Low stock alert" value={edit.low_stock_threshold} onChange={(v) => setEdit({ ...edit, low_stock_threshold: v })} type="number" />
              </div>

              <div style={{ display: "flex", gap: 10, marginTop: 14, justifyContent: "flex-end" }}>
                <button style={S.btnGhost()} onClick={() => { setEditOpen(false); setEdit(null); }}>Cancel</button>
                <button style={S.btnPrimary(false)} onClick={saveEdit}>Save</button>
              </div>
            </>
          )}
        </Modal>

        <Modal
          open={catEditOpen}
          width={520}
          title="Edit category"
          onClose={() => { setCatEditOpen(false); setCatEdit(null); }}
        >
          {catEdit && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 180px", gap: 10 }}>
                <Field label="Name" value={catEdit.name} onChange={(v) => setCatEdit({ ...catEdit, name: v })} />
                <div>
                  <div style={S.label}>Color</div>
                  <input
                    type="color"
                    value={catEdit.color || "#6366f1"}
                    onChange={(e) => setCatEdit({ ...catEdit, color: e.target.value })}
                    style={S.colorInput(false)}
                  />
                </div>
              </div>

              <div style={{ display: "flex", gap: 10, marginTop: 14, justifyContent: "flex-end" }}>
                <button style={S.btnGhost()} onClick={() => { setCatEditOpen(false); setCatEdit(null); }}>Cancel</button>
                <button style={S.btnPrimary(false)} onClick={saveCategoryEdit}>Save</button>
              </div>
            </>
          )}
        </Modal>

        <ConfirmDialog
          open={!!confirmState}
          title={confirmState?.title}
          message={confirmState?.message}
          confirmText={confirmState?.confirmText}
          busy={confirmBusy}
          onCancel={() => {
            if (confirmBusy) return;
            setConfirmState(null);
          }}
          onConfirm={() => confirmState?.onConfirm?.()}
        />
      </div>
    </div>
  );
}

function Field({ label, value, onChange, disabled, type = "text", placeholder }) {
  return (
    <div>
      <div style={S.label}>{label}</div>
      <input
        value={value}
        type={type}
        onChange={(e) => onChange(e.target.value)}
        style={S.input(disabled)}
        disabled={disabled}
        placeholder={placeholder}
      />
    </div>
  );
}

function Modal({ open, title, children, onClose, width = 760 }) {
  if (!open) return null;
  return (
    <div style={S.overlay} onMouseDown={onClose}>
      <div style={{ ...S.modal, width }} onMouseDown={(e) => e.stopPropagation()}>
        <div style={S.modalHeader}>
          <div style={{ fontWeight: 900, fontSize: 16 }}>{title}</div>
          <button style={S.btnGhost()} onClick={onClose}>Close</button>
        </div>
        <div style={{ marginTop: 12 }}>{children}</div>
      </div>
    </div>
  );
}

const S = {
  page: { padding: 20, height: "100%", overflow: "auto" },
  wrap: { maxWidth: 1200, margin: "0 auto" },

  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, marginBottom: 12 },
  title: { margin: 0, fontSize: 30, fontWeight: 900, color: "var(--text)" },
  subtitle: { marginTop: 6, color: "var(--text2)", fontSize: 13 },

  searchRow: { display: "flex", gap: 10, alignItems: "center", marginBottom: 12 },
  searchIcon: { position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text3)", fontSize: 16 },
  search: {
    width: "100%",
    padding: "10px 12px 10px 38px",
    borderRadius: 14,
    border: "1px solid var(--border)",
    background: "rgba(0,0,0,0.25)",
    color: "var(--text)",
    outline: "none",
    fontWeight: 800,
  },

  card: {
    background: "rgba(255,255,255,0.04)",
    border: "1px solid var(--border)",
    borderRadius: 16,
    padding: 14,
    boxShadow: "var(--shadow)",
  },
  cardTitle: { fontSize: 14, fontWeight: 900, color: "var(--text2)", letterSpacing: "0.02em" },

  grid: { display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 10, marginTop: 12 },
  gridModal: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 },

  label: { fontSize: 12, color: "var(--text2)", marginBottom: 6, fontWeight: 900 },
  input: (disabled) => ({
    width: "100%",
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid var(--border)",
    background: disabled ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.25)",
    color: "var(--text)",
    outline: "none",
    opacity: disabled ? 0.65 : 1,
    fontWeight: 800,
  }),
  select: (disabled) => ({
    width: "100%",
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid var(--border)",
    background: disabled ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.25)",
    color: "var(--text)",
    outline: "none",
    opacity: disabled ? 0.65 : 1,
    fontWeight: 800,
  }),
  colorInput: (disabled) => ({
    width: "100%",
    height: 42,
    borderRadius: 12,
    border: "1px solid var(--border)",
    background: "transparent",
    padding: 6,
    opacity: disabled ? 0.65 : 1,
  }),

  tableWrap: { overflow: "auto" },
  table: { width: "100%", borderCollapse: "separate", borderSpacing: 0 },
  th: {
    position: "sticky",
    top: 0,
    background: "rgba(0,0,0,0.35)",
    color: "var(--text2)",
    fontSize: 12,
    textAlign: "left",
    padding: "10px 12px",
    borderBottom: "1px solid var(--border)",
    fontWeight: 900,
  },
  td: { padding: "12px", borderBottom: "1px solid rgba(255,255,255,0.06)", color: "var(--text)", fontSize: 13 },

  pill: {
    display: "inline-block",
    padding: "6px 10px",
    borderRadius: 999,
    fontSize: 12,
    border: "1px solid var(--border)",
    color: "var(--text2)",
    background: "rgba(255,255,255,0.04)",
    fontWeight: 900,
    whiteSpace: "nowrap",
  },

  stockPill: (low) => ({
    display: "inline-block",
    padding: "4px 8px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 900,
    border: "1px solid var(--border)",
    background: low ? "rgba(244,63,94,0.12)" : "rgba(74,222,128,0.10)",
    color: low ? "white" : "var(--text)",
  }),

  colorChipWrap: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    fontWeight: 900,
    color: "var(--text2)",
  },
  colorDot: {
    width: 14,
    height: 14,
    borderRadius: 999,
  },

  btnGhost: () => ({
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid var(--border)",
    background: "transparent",
    color: "var(--text2)",
    cursor: "pointer",
    fontWeight: 900,
  }),
  btnPrimary: (disabled) => ({
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(108,99,255,0.6)",
    background: disabled ? "rgba(255,255,255,0.06)" : "rgba(108,99,255,0.18)",
    color: disabled ? "var(--text3)" : "var(--accent)",
    cursor: disabled ? "not-allowed" : "pointer",
    fontWeight: 900,
    opacity: disabled ? 0.65 : 1,
    whiteSpace: "nowrap",
  }),
  btnDanger: () => ({
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(244,63,94,0.35)",
    background: "rgba(244,63,94,0.12)",
    color: "white",
    cursor: "pointer",
    fontWeight: 900,
  }),

  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 },
  modal: { maxWidth: "94vw", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: 16, boxShadow: "var(--shadow)" },
  modalHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 },
};
