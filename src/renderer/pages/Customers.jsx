import React, { useEffect, useMemo, useState } from "react";
import { usePOS } from "../App";

function Customers() {
  const { api, showToast } = usePOS();

  const [rows, setRows] = useState([]);
  const [q, setQ] = useState("");
  const [form, setForm] = useState({ name: "", phone: "", email: "", address: "" });
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(false);

  const styles = {
    page: { padding: 20, height: "100%", overflow: "auto" },
    wrap: { maxWidth: 1200, margin: "0 auto" },

    header: {
      display: "flex",
      alignItems: "flex-end",
      justifyContent: "space-between",
      gap: 12,
      marginBottom: 14,
    },
    title: { margin: 0, fontSize: 28, fontWeight: 800, color: "var(--text)" },
    subtitle: { marginTop: 6, color: "var(--text2)", fontSize: 13 },

    grid: { display: "grid", gridTemplateColumns: "420px 1fr", gap: 14 },
    card: {
      background: "rgba(255,255,255,0.04)",
      border: "1px solid var(--border)",
      borderRadius: 16,
      padding: 14,
      boxShadow: "var(--shadow)",
    },
    cardTitle: { margin: 0, fontSize: 14, letterSpacing: "0.02em", color: "var(--text2)", fontWeight: 700 },

    input: {
      width: "100%",
      padding: "10px 12px",
      borderRadius: 12,
      border: "1px solid var(--border)",
      background: "rgba(0,0,0,0.25)",
      color: "var(--text)",
      outline: "none",
    },
    label: { fontSize: 12, color: "var(--text2)", marginBottom: 6, fontWeight: 600 },

    row2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 },
    actions: { display: "flex", gap: 10, marginTop: 12 },

    btnPrimary: {
      padding: "10px 12px",
      borderRadius: 12,
      border: "1px solid rgba(108,99,255,0.6)",
      background: "rgba(108,99,255,0.18)",
      color: "var(--accent)",
      cursor: "pointer",
      fontWeight: 700,
    },
    btnGhost: {
      padding: "10px 12px",
      borderRadius: 12,
      border: "1px solid var(--border)",
      background: "transparent",
      color: "var(--text2)",
      cursor: "pointer",
      fontWeight: 700,
    },
    btnDanger: {
      padding: "8px 10px",
      borderRadius: 10,
      border: "1px solid rgba(244,63,94,0.35)",
      background: "rgba(244,63,94,0.12)",
      color: "white",
      cursor: "pointer",
      fontWeight: 700,
    },

    tableWrap: { overflow: "auto", borderRadius: 12, border: "1px solid var(--border)", marginTop: 12 },
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
      fontWeight: 800,
    },
    td: {
      padding: "10px 12px",
      borderBottom: "1px solid rgba(255,255,255,0.06)",
      color: "var(--text)",
      fontSize: 13,
    },
    tr: { background: "transparent" },
    empty: { padding: 14, color: "var(--text2)", fontSize: 13 },
    pill: {
      display: "inline-block",
      padding: "4px 8px",
      borderRadius: 999,
      fontSize: 12,
      border: "1px solid var(--border)",
      color: "var(--text2)",
      background: "rgba(255,255,255,0.04)",
    },
  };

  async function load() {
    setLoading(true);
    try {
      const data = q.trim() ? await api.customers.search(q) : await api.customers.getAll();
      setRows(data || []);
    } catch (e) {
      showToast("Failed to load customers", "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [q]);

  const canSave = useMemo(() => form.name.trim().length > 0, [form.name]);

  async function save() {
    if (!canSave) return showToast("Name is required", "error");

    try {
      if (editingId) {
        await api.customers.update({ ...form, id: editingId });
        showToast("Customer updated");
      } else {
        await api.customers.create(form);
        showToast("Customer added");
      }
      setForm({ name: "", phone: "", email: "", address: "" });
      setEditingId(null);
      load();
    } catch {
      showToast("Save failed", "error");
    }
  }

  function edit(c) {
    setEditingId(c.id);
    setForm({ name: c.name || "", phone: c.phone || "", email: c.email || "", address: c.address || "" });
  }

  async function del(id) {
    if (!confirm("Delete customer?")) return;
    try {
      await api.customers.delete(id);
      showToast("Customer deleted", "warning");
      load();
    } catch {
      showToast("Delete failed", "error");
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.wrap}>
        <div style={styles.header}>
          <div>
            <h1 style={styles.title}>Customers</h1>
            <div style={styles.subtitle}>Manage customer list and contact details.</div>
          </div>

          <div style={{ minWidth: 420, width: 520, maxWidth: "100%" }}>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name / phone / email…"
              style={styles.input}
            />
          </div>
        </div>

        <div style={styles.grid}>
          {/* Form */}
          <div style={styles.card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={styles.cardTitle}>{editingId ? "Edit customer" : "Add customer"}</div>
              {editingId && <span style={styles.pill}>Editing #{editingId}</span>}
            </div>

            <div style={{ marginTop: 12 }}>
              <div style={styles.label}>Name</div>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Customer name"
                style={styles.input}
              />
            </div>

            <div style={{ marginTop: 10, ...styles.row2 }}>
              <div>
                <div style={styles.label}>Phone</div>
                <input
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="+880..."
                  style={styles.input}
                />
              </div>
              <div>
                <div style={styles.label}>Email</div>
                <input
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="example@mail.com"
                  style={styles.input}
                />
              </div>
            </div>

            <div style={{ marginTop: 10 }}>
              <div style={styles.label}>Address</div>
              <input
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="Street / area / city"
                style={styles.input}
              />
            </div>

            <div style={styles.actions}>
              <button onClick={save} style={{ ...styles.btnPrimary, opacity: canSave ? 1 : 0.55 }} disabled={!canSave}>
                {editingId ? "Update" : "Add"}
              </button>

              {editingId ? (
                <button
                  onClick={() => { setEditingId(null); setForm({ name: "", phone: "", email: "", address: "" }); }}
                  style={styles.btnGhost}
                >
                  Cancel
                </button>
              ) : (
                <button
                  onClick={() => setForm({ name: "", phone: "", email: "", address: "" })}
                  style={styles.btnGhost}
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* List */}
          <div style={styles.card}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={styles.cardTitle}>Customer list</div>
              <div style={styles.pill}>
                {loading ? "Loading…" : `${rows.length} customer${rows.length === 1 ? "" : "s"}`}
              </div>
            </div>

            <div style={styles.tableWrap}>
              {rows.length === 0 && !loading ? (
                <div style={styles.empty}>No customers yet. Add your first customer from the left panel.</div>
              ) : (
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Name</th>
                      <th style={styles.th}>Phone</th>
                      <th style={styles.th}>Email</th>
                      <th style={{ ...styles.th, width: 160 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((c, idx) => (
                      <tr
                        key={c.id}
                        style={{
                          ...styles.tr,
                          background: idx % 2 ? "rgba(255,255,255,0.02)" : "transparent",
                        }}
                      >
                        <td style={styles.td}>{c.name}</td>
                        <td style={styles.td}>{c.phone || <span style={{ color: "var(--text2)" }}>—</span>}</td>
                        <td style={styles.td}>{c.email || <span style={{ color: "var(--text2)" }}>—</span>}</td>
                        <td style={{ ...styles.td, textAlign: "right" }}>
                          <button onClick={() => edit(c)} style={styles.btnGhost}>Edit</button>
                          <button onClick={() => del(c.id)} style={{ ...styles.btnDanger, marginLeft: 8 }}>Delete</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}

export default Customers;