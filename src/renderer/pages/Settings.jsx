import React, { useEffect, useMemo, useState } from "react";
import { usePOS } from "../App";

export default function Settings() {
  const { api, showToast, me } = usePOS();
  const isAdmin = me?.role === "admin" || me?.role === "superadmin";
  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState({
    store_id: "",
    store_name: "",
    currency: "BDT",
    fy_start_month: "7",
    receipt_footer: "",
    contact: "",
    supabase_url: "",
    supabase_key: "",
  });

  const [cats, setCats] = useState([]);
  const [newCat, setNewCat] = useState({ name: "", color: "#6366f1" });
  const [editOpen, setEditOpen] = useState(false);
  const [editCat, setEditCat] = useState(null);

  async function loadAll() {
    setLoading(true);
    try {
      const s = await api.settings.getAll();

      setForm({
        store_id: s?.store_id || "store_1",
        store_name: s?.store_name || "Store 1",
        currency: s?.currency || "BDT",
        fy_start_month: String(s?.fy_start_month || "7"),
        receipt_footer: s?.receipt_footer || "Thank you for shopping with us!",
        contact: s?.contact || "",
        supabase_url: s?.supabase_url || "",
        supabase_key: s?.supabase_key || "",
      });

      const list = await api.categories.getAll();
      setCats(list || []);
    } catch (e) {
      console.error(e);
      showToast("Failed to load settings", "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveKey(key, value) {
    const res = await api.settings.set(key, value);
    if (res?.ok === false) throw new Error(res.message || "Admin only");
  }

  async function saveAll() {
    if (!isAdmin) return showToast("Admin only", "error");

    setLoading(true);
    try {
      const current = await api.settings.getAll().catch(() => ({}));

      await saveKey("receipt_footer", form.receipt_footer || "");
      await saveKey("contact", form.contact || "");
      await saveKey("supabase_url", form.supabase_url || "");
      await saveKey("supabase_key", form.supabase_key || "");

      const storeFieldChanges = [
        current?.store_name !== (form.store_name || "Store 1"),
        current?.store_id !== (form.store_id || "store_1"),
        current?.currency !== (form.currency || "BDT"),
        String(current?.fy_start_month || "7") !== String(form.fy_start_month || "7"),
      ].filter(Boolean).length;

      if (storeFieldChanges > 1) {
        showToast(
          "Store ID / Store Name / Currency / Financial year start: save one store field at a time with current backend.",
          "warning"
        );
      } else if (current?.store_name !== (form.store_name || "Store 1")) {
        await saveKey("store_name", form.store_name || "Store 1");
        showToast("Store name saved. Please log in again.", "warning");
      } else if (current?.store_id !== (form.store_id || "store_1")) {
        await saveKey("store_id", form.store_id || "store_1");
        showToast("Store ID saved. Please log in again.", "warning");
      } else if (current?.currency !== (form.currency || "BDT")) {
        await saveKey("currency", form.currency || "BDT");
        showToast("Currency saved. Please log in again.", "warning");
      } else if (String(current?.fy_start_month || "7") !== String(form.fy_start_month || "7")) {
        await saveKey("fy_start_month", String(form.fy_start_month || "7"));
        showToast("Financial year start month saved. Please log in again.", "warning");
      } else {
        showToast("Settings saved ✅");
      }

      await loadAll();
    } catch (e) {
      console.error(e);
      showToast(e?.message || "Save failed", "error");
    } finally {
      setLoading(false);
    }
  }

  async function testSupabase() {
    try {
      const ok = await api.sync.test();
      showToast(ok ? "Supabase connected ✅" : "Supabase test failed ❌", ok ? "success" : "error");
    } catch (e) {
      console.error(e);
      showToast("Supabase test failed", "error");
    }
  }

  async function pushInventory() {
    try {
      const ok = await api.sync.pushInventory();
      showToast(ok ? "Inventory pushed ✅" : "Push failed ❌", ok ? "success" : "error");
    } catch (e) {
      console.error(e);
      showToast("Push failed", "error");
    }
  }

  const canAddCat = useMemo(() => newCat.name.trim().length > 0, [newCat.name]);

  async function addCategory() {
    if (!isAdmin) return showToast("Admin only", "error");
    if (!canAddCat) return showToast("Category name required", "warning");

    const res = await api.categories.create({
      name: newCat.name.trim(),
      color: newCat.color,
    });

    if (res?.ok === false) return showToast(res.message || "Create failed", "error");

    showToast("Category created ✅");
    setNewCat({ name: "", color: "#6366f1" });
    setCats(await api.categories.getAll());
  }

  function openEdit(c) {
    setEditCat({
      id: c.id,
      name: c.name || "",
      color: c.color || "#6366f1",
    });
    setEditOpen(true);
  }

  async function saveEdit() {
    if (!isAdmin) return showToast("Admin only", "error");
    if (!editCat?.name?.trim()) return showToast("Name required", "warning");

    const res = await api.categories.update({
      id: editCat.id,
      name: editCat.name.trim(),
      color: editCat.color || "#6366f1",
    });

    if (res?.ok === false) return showToast(res.message || "Update failed", "error");

    showToast("Category updated ✅");
    setEditOpen(false);
    setEditCat(null);
    setCats(await api.categories.getAll());
  }

  async function deleteCat(c) {
    if (!isAdmin) return showToast("Admin only", "error");
    if (!window.confirm(`Delete category "${c.name}"?\n\nProducts in this category will be cleared.`)) return;

    const res = await api.categories.delete(c.id);
    if (res?.ok === false) return showToast(res.message || "Delete failed", "error");

    showToast("Category deleted", "warning");
    setCats(await api.categories.getAll());
  }

  return (
    <div style={{ padding: 20, height: "100%", overflow: "auto" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900, color: "var(--text)" }}>
              Settings
            </h1>
            <div style={{ marginTop: 6, color: "var(--text2)", fontSize: 13 }}>
              {isAdmin
                ? "Admin can edit store settings, contact, categories, and cloud sync."
                : "Read-only (admin only)."}
            </div>
          </div>
          <div style={pill()}>
            {me ? `Current: ${me.name} (${me.role})` : "Not logged in"}
          </div>
        </div>

        <div style={{ ...card(), marginTop: 14 }}>
          <div style={cardTitle()}>Store settings</div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
            <Field
              label="Store ID"
              value={form.store_id}
              disabled={!isAdmin}
              onChange={(v) => setForm({ ...form, store_id: v })}
            />

            <Field
              label="Store Name / Branch Name"
              value={form.store_name}
              disabled={!isAdmin}
              onChange={(v) => setForm({ ...form, store_name: v })}
            />

            <div>
              <div style={labelStyle()}>Currency</div>
              <select
                value={form.currency}
                disabled={!isAdmin}
                onChange={(e) => setForm({ ...form, currency: e.target.value })}
                style={selectStyle(!isAdmin)}
              >
                <option value="BDT">BDT (৳)</option>
                <option value="USD">USD ($)</option>
                <option value="GBP">GBP (£)</option>
                <option value="EUR">EUR (€)</option>
              </select>
              <div style={{ marginTop: 6, color: "var(--text3)", fontSize: 12 }}>
                Tip: Restart Electron if currency doesn’t change everywhere.
              </div>
            </div>

            <div>
              <div style={labelStyle()}>Financial year starts in</div>
              <select
                value={form.fy_start_month}
                disabled={!isAdmin}
                onChange={(e) => setForm({ ...form, fy_start_month: e.target.value })}
                style={selectStyle(!isAdmin)}
              >
                <option value="1">January</option>
                <option value="2">February</option>
                <option value="3">March</option>
                <option value="4">April</option>
                <option value="5">May</option>
                <option value="6">June</option>
                <option value="7">July</option>
                <option value="8">August</option>
                <option value="9">September</option>
                <option value="10">October</option>
                <option value="11">November</option>
                <option value="12">December</option>
              </select>
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <div style={labelStyle()}>Store contact (shown on sales receipt and statement)</div>
            <textarea
              value={form.contact}
              disabled={!isAdmin}
              onChange={(e) => setForm({ ...form, contact: e.target.value })}
              placeholder={"Phone: 01800000000\nEmail: support@store.com\nAddress: Dhaka"}
              style={textareaStyle(!isAdmin)}
              rows={4}
            />
            <div style={{ marginTop: 6, color: "var(--text3)", fontSize: 12 }}>
              This is store-specific contact information. It will appear on receipts and customer statements.
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <div style={labelStyle()}>Receipt footer</div>
            <textarea
              value={form.receipt_footer}
              disabled={!isAdmin}
              onChange={(e) => setForm({ ...form, receipt_footer: e.target.value })}
              placeholder="Thank you for shopping with us!"
              style={textareaStyle(!isAdmin)}
              rows={3}
            />
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <button
              onClick={saveAll}
              style={btnPrimary(!isAdmin || loading)}
              disabled={!isAdmin || loading}
            >
              Save settings
            </button>
            <button onClick={loadAll} style={btnGhost()} disabled={loading}>
              Reload
            </button>
          </div>
        </div>

        <div style={{ ...card(), marginTop: 14 }}>
          <div style={cardTitle()}>Supabase connection</div>

          {!isAdmin && (
            <div style={{ marginTop: 10, color: "var(--text2)", fontSize: 13 }}>
              Login as <b>admin</b> to connect cloud sync.
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
            <Field
              label="Supabase Project URL"
              value={form.supabase_url}
              disabled={!isAdmin}
              onChange={(v) => setForm({ ...form, supabase_url: v })}
              placeholder="https://xxxx.supabase.co"
            />
            <Field
              label="Supabase Anon Key (public)"
              value={form.supabase_key}
              disabled={!isAdmin}
              onChange={(v) => setForm({ ...form, supabase_key: v })}
              placeholder="eyJhbGciOi..."
            />
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
            <button
              onClick={saveAll}
              style={btnPrimary(!isAdmin || loading)}
              disabled={!isAdmin || loading}
            >
              Save Supabase
            </button>
            <button onClick={testSupabase} style={btnGhost()} disabled={!isAdmin}>
              Test connection
            </button>
            <button onClick={pushInventory} style={btnGhost()} disabled={!isAdmin}>
              Push inventory
            </button>
          </div>

          <div style={{ marginTop: 10, color: "var(--text3)", fontSize: 12, lineHeight: 1.5 }}>
            Your tills sync sales + inventory to Supabase. Use different <b>Store ID</b> per shop to separate products.
          </div>
        </div>

        <div style={{ ...card(), marginTop: 14 }}>
          <div style={cardTitle()}>Product Categories</div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 180px 140px", gap: 10, marginTop: 12 }}>
            <Field
              label="New category name"
              value={newCat.name}
              disabled={!isAdmin}
              onChange={(v) => setNewCat({ ...newCat, name: v })}
              placeholder="e.g. Grocery"
            />

            <div>
              <div style={labelStyle()}>Color</div>
              <input
                type="color"
                value={newCat.color}
                disabled={!isAdmin}
                onChange={(e) => setNewCat({ ...newCat, color: e.target.value })}
                style={{
                  width: "100%",
                  height: 42,
                  borderRadius: 12,
                  border: "1px solid var(--border)",
                  background: "transparent",
                  padding: 6,
                  opacity: !isAdmin ? 0.65 : 1,
                }}
              />
            </div>

            <div style={{ display: "flex", alignItems: "flex-end" }}>
              <button
                onClick={addCategory}
                style={btnPrimary(!isAdmin || !canAddCat)}
                disabled={!isAdmin || !canAddCat}
              >
                Add
              </button>
            </div>
          </div>

          <div style={{ marginTop: 12, border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "rgba(0,0,0,0.25)" }}>
                  <th style={th()}>Name</th>
                  <th style={th()}>Color</th>
                  <th style={{ ...th(), textAlign: "right" }} />
                </tr>
              </thead>
              <tbody>
                {cats.map((c, idx) => (
                  <tr
                    key={c.id}
                    style={{
                      borderTop: "1px solid rgba(255,255,255,0.06)",
                      background: idx % 2 ? "rgba(255,255,255,0.02)" : "transparent",
                    }}
                  >
                    <td style={td()}>
                      <b>{c.name}</b>
                    </td>
                    <td style={td()}>
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 8,
                          fontWeight: 900,
                          color: "var(--text2)",
                        }}
                      >
                        <span
                          style={{
                            width: 14,
                            height: 14,
                            borderRadius: 999,
                            background: c.color || "#6366f1",
                          }}
                        />
                        {c.color || "#6366f1"}
                      </span>
                    </td>
                    <td style={{ ...td(), textAlign: "right" }}>
                      <button onClick={() => openEdit(c)} style={btnGhost()} disabled={!isAdmin}>
                        Edit
                      </button>
                      <button
                        onClick={() => deleteCat(c)}
                        style={{ ...btnDanger(), marginLeft: 8 }}
                        disabled={!isAdmin}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
                {cats.length === 0 && (
                  <tr>
                    <td colSpan={3} style={{ padding: 14, color: "var(--text2)" }}>
                      No categories found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {editOpen && editCat && (
          <div style={overlay()} onMouseDown={() => setEditOpen(false)}>
            <div style={modal()} onMouseDown={(e) => e.stopPropagation()}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                <div style={{ fontWeight: 900, fontSize: 16 }}>Edit category</div>
                <button onClick={() => setEditOpen(false)} style={btnGhost()}>
                  Close
                </button>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 180px", gap: 10, marginTop: 12 }}>
                <Field
                  label="Name"
                  value={editCat.name}
                  onChange={(v) => setEditCat({ ...editCat, name: v })}
                />
                <div>
                  <div style={labelStyle()}>Color</div>
                  <input
                    type="color"
                    value={editCat.color || "#6366f1"}
                    onChange={(e) => setEditCat({ ...editCat, color: e.target.value })}
                    style={{
                      width: "100%",
                      height: 42,
                      borderRadius: 12,
                      border: "1px solid var(--border)",
                      background: "transparent",
                      padding: 6,
                    }}
                  />
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 14 }}>
                <button onClick={() => setEditOpen(false)} style={btnGhost()}>
                  Cancel
                </button>
                <button onClick={saveEdit} style={btnPrimary(false)}>
                  Save
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, disabled }) {
  return (
    <div>
      <div style={labelStyle()}>{label}</div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        style={inputStyle(disabled)}
      />
    </div>
  );
}

function card() {
  return {
    background: "rgba(255,255,255,0.04)",
    border: "1px solid var(--border)",
    borderRadius: 16,
    padding: 14,
    boxShadow: "var(--shadow)",
  };
}

function cardTitle() {
  return {
    margin: 0,
    fontSize: 14,
    letterSpacing: "0.02em",
    color: "var(--text2)",
    fontWeight: 900,
  };
}

function pill() {
  return {
    display: "inline-block",
    padding: "6px 10px",
    borderRadius: 999,
    fontSize: 12,
    border: "1px solid var(--border)",
    color: "var(--text2)",
    background: "rgba(255,255,255,0.04)",
    fontWeight: 900,
    whiteSpace: "nowrap",
  };
}

function labelStyle() {
  return {
    fontSize: 12,
    color: "var(--text2)",
    marginBottom: 6,
    fontWeight: 900,
  };
}

function inputStyle(disabled) {
  return {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid var(--border)",
    background: disabled ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.25)",
    color: "var(--text)",
    outline: "none",
    opacity: disabled ? 0.7 : 1,
    fontWeight: 900,
  };
}

function textareaStyle(disabled) {
  return {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid var(--border)",
    background: disabled ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.25)",
    color: "var(--text)",
    outline: "none",
    opacity: disabled ? 0.7 : 1,
    fontWeight: 700,
    resize: "vertical",
    minHeight: 90,
    fontFamily: "inherit",
  };
}

function selectStyle(disabled) {
  return {
    ...inputStyle(disabled),
    appearance: "none",
    WebkitAppearance: "none",
    MozAppearance: "none",
    backgroundImage:
      "linear-gradient(45deg, transparent 50%, rgba(255,255,255,0.6) 50%), linear-gradient(135deg, rgba(255,255,255,0.6) 50%, transparent 50%)",
    backgroundPosition:
      "calc(100% - 20px) calc(50% - 2px), calc(100% - 14px) calc(50% - 2px)",
    backgroundSize: "6px 6px, 6px 6px",
    backgroundRepeat: "no-repeat",
    paddingRight: 36,
  };
}

function btnGhost() {
  return {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid var(--border)",
    background: "transparent",
    color: "var(--text2)",
    cursor: "pointer",
    fontWeight: 900,
  };
}

function btnPrimary(disabled) {
  return {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(108,99,255,0.6)",
    background: disabled ? "rgba(255,255,255,0.06)" : "rgba(108,99,255,0.18)",
    color: disabled ? "var(--text3)" : "var(--accent)",
    cursor: disabled ? "not-allowed" : "pointer",
    fontWeight: 900,
    opacity: disabled ? 0.7 : 1,
    whiteSpace: "nowrap",
  };
}

function btnDanger() {
  return {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(244,63,94,0.35)",
    background: "rgba(244,63,94,0.12)",
    color: "white",
    cursor: "pointer",
    fontWeight: 900,
    whiteSpace: "nowrap",
  };
}

function th() {
  return {
    textAlign: "left",
    padding: "10px 12px",
    fontSize: 12,
    color: "var(--text2)",
    fontWeight: 900,
  };
}

function td() {
  return {
    padding: "10px 12px",
    fontSize: 13,
    color: "var(--text)",
  };
}

function overlay() {
  return {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.6)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9999,
  };
}

function modal() {
  return {
    width: 560,
    maxWidth: "94vw",
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: 16,
    padding: 16,
    boxShadow: "var(--shadow)",
  };
}