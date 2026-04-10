import React, { useEffect, useState } from "react";
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

  const [fyRows, setFyRows] = useState([]);
  const [newFYLabel, setNewFYLabel] = useState(`${new Date().getFullYear()}-${new Date().getFullYear() + 1}`);
  const [newFYStartDate, setNewFYStartDate] = useState("");
  const [newFYEndDate, setNewFYEndDate] = useState("");
  const [editingFYOriginalLabel, setEditingFYOriginalLabel] = useState("");
  const [editingFYLabel, setEditingFYLabel] = useState("");
  const [editingFYStartDate, setEditingFYStartDate] = useState("");
  const [editingFYEndDate, setEditingFYEndDate] = useState("");
  const [confirmState, setConfirmState] = useState(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  async function loadAll() {
    setLoading(true);
    try {
      const [s, years] = await Promise.all([
        api.settings.getAll(),
        api.fiscalYears?.list?.().catch(() => []),
      ]);

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

      setFyRows(Array.isArray(years) ? years : []);
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


  async function refreshFinancialYears() {
    const years = await api.fiscalYears?.list?.().catch(() => []);
    setFyRows(Array.isArray(years) ? years : []);
  }

  function resetFinancialYearEditor() {
    setEditingFYOriginalLabel("");
    setEditingFYLabel("");
    setEditingFYStartDate("");
    setEditingFYEndDate("");
  }

  function startEditFinancialYear(row) {
    setEditingFYOriginalLabel(String(row?.label || "").trim());
    setEditingFYLabel(String(row?.label || "").trim());
    setEditingFYStartDate(String(row?.start_date || "").slice(0, 10));
    setEditingFYEndDate(String(row?.end_date || "").slice(0, 10));
  }

  async function saveFinancialYearEdit(row) {
    if (!isAdmin) return showToast("Admin only", "error");

    const originalLabel = String(editingFYOriginalLabel || row?.label || "").trim();
    const nextLabel = String(editingFYLabel || "").trim();
    const start = String(editingFYStartDate || "").trim();
    const end = String(editingFYEndDate || "").trim();

    if (!originalLabel || !nextLabel || !start || !end) {
      return showToast("Enter label, start date, and end date", "warning");
    }

    const res = await api.fiscalYears.update({
      original_label: originalLabel,
      label: nextLabel,
      start_date: start,
      end_date: end,
      allow_inferred_create: row?.inferred && originalLabel === nextLabel ? 1 : 0,
    });

    if (res?.ok === false) {
      return showToast(res.message || "Failed to update financial year", "error");
    }

    showToast(`Financial year ${nextLabel} updated ✅`);
    resetFinancialYearEditor();
    await refreshFinancialYears();
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

  async function pushProducts() {
    try {
      const res = await api.sync.pushProducts();
      const ok = !!(res?.ok ?? res);
      showToast(ok ? "Products + categories pushed ✅" : (res?.message || "Push failed ❌"), ok ? "success" : "error");
    } catch (e) {
      console.error(e);
      showToast("Push failed", "error");
    }
  }

  async function pushAllCloud() {
    try {
      const res = await api.sync.pushAll();
      const ok = !!(res?.ok ?? res);
      showToast(ok ? "All store data pushed ✅" : (res?.message || "Full push failed ❌"), ok ? "success" : "error");
    } catch (e) {
      console.error(e);
      showToast("Full push failed", "error");
    }
  }



  async function restoreFromCloud() {
    if (!isAdmin) return showToast("Admin only", "error");
    try {
      const res = await api.sync.restoreFromCloud({ force: true });
      const ok = !!(res?.ok ?? res);
      showToast(ok ? "Cloud restore completed ✅" : (res?.message || "Cloud restore failed ❌"), ok ? "success" : "error");
      if (ok) {
        await loadAll();
      }
    } catch (e) {
      console.error(e);
      showToast(e?.message || "Cloud restore failed", "error");
    }
  }

  async function createFinancialYear() {
    if (!isAdmin) return showToast("Admin only", "error");

    const label = String(newFYLabel || "").trim();
    const start = String(newFYStartDate || "").trim();
    const end = String(newFYEndDate || "").trim();

    if (!label || !start || !end) {
      return showToast("Enter label, start date, and end date", "warning");
    }

    const res = await api.fiscalYears.create({
      label,
      start_date: start,
      end_date: end,
    });

    if (res?.ok === false) {
      return showToast(res.message || "Failed to create financial year", "error");
    }

    showToast(`Financial year ${label} created ✅`);
    setNewFYLabel(`${new Date().getFullYear()}-${new Date().getFullYear() + 1}`);
    setNewFYStartDate("");
    setNewFYEndDate("");
    resetFinancialYearEditor();

    await refreshFinancialYears();
  }

  async function performDeleteFinancialYear(row) {
    setConfirmBusy(true);
    try {
      const res = await api.fiscalYears.delete(row.label);
      if (res?.ok === false) {
        return showToast(res.message || "Failed to delete financial year", "error");
      }

      showToast(`Financial year ${row.label} deleted`, "warning");
      if (String(editingFYOriginalLabel || "") === String(row.label || "")) {
        resetFinancialYearEditor();
      }
      await refreshFinancialYears();
      setConfirmState(null);
    } finally {
      setConfirmBusy(false);
    }
  }

  function deleteFinancialYear(row) {
    if (!isAdmin) return showToast("Admin only", "error");
    if (!row?.label) return;

    setConfirmState({
      title: "Delete financial year",
      message: `Delete financial year "${row.label}"?`,
      confirmText: "Delete financial year",
      onConfirm: () => performDeleteFinancialYear(row),
    });
  }

  function formatFyDate(value) {
    if (!value) return "-";
    const d = new Date(`${String(value).slice(0, 10)}T00:00:00`);
    if (Number.isNaN(d.getTime())) return String(value || "-");
    return d.toLocaleDateString("en-GB");
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
                ? "Admin can edit store settings, financial years, and cloud sync. Product categories are now managed from the Products page."
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

          <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
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
          <div style={cardTitle()}>Financial years</div>

          <div style={{ marginTop: 10, color: "var(--text3)", fontSize: 12, lineHeight: 1.5 }}>
            Create / save financial years with manual start and end dates. You can also edit existing financial year dates here.
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1.2fr 1fr 1fr 260px",
              gap: 10,
              marginTop: 12,
              alignItems: "end",
            }}
          >
            <Field
              label="Financial year label"
              value={newFYLabel}
              disabled={!isAdmin}
              onChange={(v) => setNewFYLabel(v)}
              placeholder="2026-2027"
            />

            <div>
              <div style={labelStyle()}>Start date</div>
              <input
                type="date"
                value={newFYStartDate}
                disabled={!isAdmin}
                onChange={(e) => setNewFYStartDate(e.target.value)}
                style={inputStyle(!isAdmin)}
              />
            </div>

            <div>
              <div style={labelStyle()}>End date</div>
              <input
                type="date"
                value={newFYEndDate}
                disabled={!isAdmin}
                onChange={(e) => setNewFYEndDate(e.target.value)}
                style={inputStyle(!isAdmin)}
              />
            </div>

            <div style={{ display: "flex", alignItems: "flex-end" }}>
              <button
                onClick={createFinancialYear}
                style={btnPrimary(!isAdmin)}
                disabled={!isAdmin}
              >
                Create financial year
              </button>
            </div>
          </div>

          <div style={{ marginTop: 12, border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "rgba(0,0,0,0.25)" }}>
                  <th style={th()}>Label</th>
                  <th style={th()}>Start date</th>
                  <th style={th()}>End date</th>
                  <th style={th()}>Type</th>
                  <th style={{ ...th(), textAlign: "right" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {fyRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ padding: 14, color: "var(--text2)" }}>
                      No financial years found.
                    </td>
                  </tr>
                ) : (
                  fyRows.map((row, idx) => {
                    const isEditing = String(editingFYOriginalLabel || "") === String(row.label || "");
                    return (
                      <tr
                        key={`${row.label}-${row.start_date || ""}-${idx}`}
                        style={{
                          borderTop: "1px solid rgba(255,255,255,0.06)",
                          background: idx % 2 ? "rgba(255,255,255,0.02)" : "transparent",
                        }}
                      >
                        <td style={td()}>
                          {isEditing ? (
                            <input
                              value={editingFYLabel}
                              onChange={(e) => setEditingFYLabel(e.target.value)}
                              disabled={!isAdmin || !!row.inferred}
                              style={inputStyle(!isAdmin || !!row.inferred)}
                            />
                          ) : (
                            <b>{row.label}</b>
                          )}
                        </td>
                        <td style={td()}>
                          {isEditing ? (
                            <input
                              type="date"
                              value={editingFYStartDate}
                              onChange={(e) => setEditingFYStartDate(e.target.value)}
                              disabled={!isAdmin}
                              style={inputStyle(!isAdmin)}
                            />
                          ) : (
                            formatFyDate(row.start_date)
                          )}
                        </td>
                        <td style={td()}>
                          {isEditing ? (
                            <input
                              type="date"
                              value={editingFYEndDate}
                              onChange={(e) => setEditingFYEndDate(e.target.value)}
                              disabled={!isAdmin}
                              style={inputStyle(!isAdmin)}
                            />
                          ) : (
                            formatFyDate(row.end_date)
                          )}
                        </td>
                        <td style={td()}>{row.inferred ? "Inferred" : "Manual"}</td>
                        <td style={{ ...td(), textAlign: "right" }}>
                          <div style={{ display: "inline-flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                            {isEditing ? (
                              <>
                                <button
                                  onClick={() => saveFinancialYearEdit(row)}
                                  style={btnPrimary(!isAdmin)}
                                  disabled={!isAdmin}
                                >
                                  Save
                                </button>
                                <button
                                  onClick={resetFinancialYearEditor}
                                  style={btnGhost()}
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <button
                                onClick={() => startEditFinancialYear(row)}
                                style={btnGhost()}
                                disabled={!isAdmin}
                                title={row.inferred ? "You can edit dates for inferred years. To change the label, update related records first." : "Edit financial year"}
                              >
                                Edit
                              </button>
                            )}
                            <button
                              onClick={() => deleteFinancialYear(row)}
                              style={btnDanger()}
                              disabled={!isAdmin || !!row.inferred}
                              title={row.inferred ? "Inferred financial years cannot be deleted until related records are updated" : "Delete financial year"}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
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
            <button onClick={pushProducts} style={btnGhost()} disabled={!isAdmin}>
              Push products + categories
            </button>
            <button onClick={pushInventory} style={btnGhost()} disabled={!isAdmin}>
              Push inventory
            </button>
            <button onClick={pushAllCloud} style={btnGhost()} disabled={!isAdmin}>
              Push all data
            </button>
            <button onClick={restoreFromCloud} style={btnGhost()} disabled={!isAdmin}>
              Restore from cloud
            </button>
          </div>

          <div style={{ marginTop: 10, color: "var(--text3)", fontSize: 12, lineHeight: 1.5 }}>
            Automatic cloud sync covers sales, refunds, inventory, product/category changes, customers, customer payments, financial years, bank accounts, and bank transactions. Use <b>Push all data</b> once after first connection or after changing the Supabase schema. Use <b>Restore from cloud</b> on a new / empty PC to pull store data down from Supabase into the local desktop database.
          </div>
        </div>

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
    color: "#fecdd3",
    cursor: "pointer",
    fontWeight: 900,
  };
}

function th() {
  return {
    padding: "12px 14px",
    color: "var(--text2)",
    fontSize: 12,
    textAlign: "left",
    fontWeight: 900,
  };
}

function td() {
  return {
    padding: "12px 14px",
    color: "var(--text)",
    fontSize: 13,
  };
}
