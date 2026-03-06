import React, { useEffect, useMemo, useState } from "react";
import { usePOS } from "../App";

function SalesHistory() {
  const { api, showToast } = usePOS();

  const [rows, setRows] = useState([]);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState(null); // {sale, items}
  const [loading, setLoading] = useState(true);

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

    input: {
      width: "100%",
      padding: "10px 12px",
      borderRadius: 12,
      border: "1px solid var(--border)",
      background: "rgba(0,0,0,0.25)",
      color: "var(--text)",
      outline: "none",
    },

    btnPrimary: {
      padding: "10px 12px",
      borderRadius: 12,
      border: "1px solid rgba(108,99,255,0.6)",
      background: "rgba(108,99,255,0.18)",
      color: "var(--accent)",
      cursor: "pointer",
      fontWeight: 800,
      whiteSpace: "nowrap",
    },
    btnGhost: {
      padding: "10px 12px",
      borderRadius: 12,
      border: "1px solid var(--border)",
      background: "transparent",
      color: "var(--text2)",
      cursor: "pointer",
      fontWeight: 800,
      whiteSpace: "nowrap",
    },
    btnDanger: {
      padding: "10px 12px",
      borderRadius: 12,
      border: "1px solid rgba(244,63,94,0.35)",
      background: "rgba(244,63,94,0.12)",
      color: "white",
      cursor: "pointer",
      fontWeight: 800,
      whiteSpace: "nowrap",
    },

    grid: { display: "grid", gridTemplateColumns: selected ? "1.2fr 0.8fr" : "1fr", gap: 14 },

    card: {
      background: "rgba(255,255,255,0.04)",
      border: "1px solid var(--border)",
      borderRadius: 16,
      padding: 14,
      boxShadow: "var(--shadow)",
    },
    cardTitle: { margin: 0, fontSize: 14, letterSpacing: "0.02em", color: "var(--text2)", fontWeight: 700 },

    pill: {
      display: "inline-block",
      padding: "4px 8px",
      borderRadius: 999,
      fontSize: 12,
      border: "1px solid var(--border)",
      color: "var(--text2)",
      background: "rgba(255,255,255,0.04)",
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
      verticalAlign: "middle",
    },
    empty: { padding: 14, color: "var(--text2)", fontSize: 13 },

    itemRow: { display: "flex", justifyContent: "space-between", gap: 10, padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" },
    kv: { display: "flex", justifyContent: "space-between", gap: 10, padding: "6px 0" },
    k: { color: "var(--text2)", fontSize: 12, fontWeight: 700 },
    v: { color: "var(--text)", fontSize: 12, fontWeight: 700 },
  };

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter((r) => (
      String(r.id).includes(t) ||
      String(r.customer_name || "").toLowerCase().includes(t) ||
      String(r.cashier_name || "").toLowerCase().includes(t) ||
      String(r.sale_type || "").toLowerCase().includes(t)
    ));
  }, [rows, q]);

  async function load() {
    setLoading(true);
    try {
      const data = await api.sales.getAll({ limit: 200, offset: 0 });
      setRows(data || []);
    } catch {
      showToast("Failed to load sales", "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function openSale(id) {
    try {
      const d = await api.sales.getOne(id);
      setSelected(d);
    } catch {
      showToast("Failed to open sale", "error");
    }
  }

  async function refundFull() {
    if (!selected?.sale?.id) return;
    if (!confirm(`Refund sale #${selected.sale.id}?`)) return;
    const res = await api.sales.refund({ original_sale_id: selected.sale.id });
    if (!res?.ok) showToast(res?.message || "Refund failed", "error");
    else {
      showToast(`Refund created #${res.refundSaleId}`, "warning");
      setSelected(null);
      load();
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.wrap}>
        <div style={styles.header}>
          <div>
            <h1 style={styles.title}>Sales History</h1>
            <div style={styles.subtitle}>Search transactions, view details, and process refunds.</div>
          </div>

          <div style={{ display: "flex", gap: 10, width: 700, maxWidth: "100%" }}>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by sale #, customer, cashier, type…"
              style={{ ...styles.input, flex: 1 }}
            />
            <button onClick={load} style={styles.btnPrimary}>Refresh</button>
          </div>
        </div>

        <div style={styles.grid}>
          {/* List */}
          <div style={styles.card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={styles.cardTitle}>Transactions</div>
              <div style={styles.pill}>{loading ? "Loading…" : `${filtered.length} record${filtered.length === 1 ? "" : "s"}`}</div>
            </div>

            <div style={styles.tableWrap}>
              {filtered.length === 0 && !loading ? (
                <div style={styles.empty}>No sales found.</div>
              ) : (
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>ID</th>
                      <th style={styles.th}>Type</th>
                      <th style={styles.th}>Total</th>
                      <th style={styles.th}>Customer</th>
                      <th style={styles.th}>Cashier</th>
                      <th style={styles.th}>Time</th>
                      <th style={{ ...styles.th, width: 120 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r, idx) => (
                      <tr key={r.id} style={{ background: idx % 2 ? "rgba(255,255,255,0.02)" : "transparent" }}>
                        <td style={styles.td}>#{r.id}</td>
                        <td style={styles.td}>
                          <span style={styles.pill}>{r.sale_type || "sale"}</span>
                        </td>
                        <td style={styles.td}>{Number(r.total || 0).toFixed(2)}</td>
                        <td style={styles.td}>{r.customer_name || <span style={{ color: "var(--text2)" }}>—</span>}</td>
                        <td style={styles.td}>{r.cashier_name || <span style={{ color: "var(--text2)" }}>—</span>}</td>
                        <td style={styles.td}>{r.created_at}</td>
                        <td style={{ ...styles.td, textAlign: "right" }}>
                          <button onClick={() => openSale(r.id)} style={styles.btnGhost}>View</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Details */}
          {selected?.sale && (
            <div style={styles.card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={styles.cardTitle}>Sale details</div>
                <button onClick={() => setSelected(null)} style={styles.btnGhost}>Close</button>
              </div>

              <div style={{ marginTop: 12 }}>
                <div style={styles.kv}><div style={styles.k}>Sale #</div><div style={styles.v}>#{selected.sale.id}</div></div>
                <div style={styles.kv}><div style={styles.k}>Type</div><div style={styles.v}>{selected.sale.sale_type}</div></div>
                <div style={styles.kv}><div style={styles.k}>Total</div><div style={styles.v}>{Number(selected.sale.total || 0).toFixed(2)}</div></div>
                <div style={styles.kv}><div style={styles.k}>Customer</div><div style={styles.v}>{selected.sale.customer_name || "—"}</div></div>
                <div style={styles.kv}><div style={styles.k}>Cashier</div><div style={styles.v}>{selected.sale.cashier_name || "—"}</div></div>
                <div style={styles.kv}><div style={styles.k}>Time</div><div style={styles.v}>{selected.sale.created_at}</div></div>
              </div>

              <div style={{ marginTop: 12, borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 10 }}>
                <div style={styles.cardTitle}>Items</div>
                <div style={{ marginTop: 6 }}>
                  {(selected.items || []).map((it) => (
                    <div key={it.id} style={styles.itemRow}>
                      <div style={{ color: "var(--text)", fontWeight: 700, fontSize: 13 }}>
                        {it.product_name}
                        <div style={{ color: "var(--text2)", fontSize: 12, fontWeight: 600 }}>
                          qty {it.quantity} × {Number(it.price || 0).toFixed(2)}
                        </div>
                      </div>
                      <div style={{ color: "var(--text)", fontWeight: 800 }}>
                        {Number(it.subtotal || 0).toFixed(2)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {selected.sale.sale_type === "sale" && (
                <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
                  <button onClick={refundFull} style={styles.btnDanger}>Refund (full)</button>
                  <button onClick={() => setSelected(null)} style={styles.btnGhost}>Done</button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default SalesHistory;