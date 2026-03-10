import React, { useEffect, useMemo, useState } from "react";
import { usePOS } from "../App";

const symMap = { BDT: "৳", USD: "$", GBP: "£", EUR: "€" };

export default function SalesHistory() {
  const { api, showToast, me } = usePOS();

  const [currency, setCurrency] = useState("BDT");
  const sym = symMap[currency] || "৳";
  const fmt = (n) => `${sym}${(Number(n) || 0).toFixed(2)}`;

  const [q, setQ] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  const [open, setOpen] = useState(false);
  const [sale, setSale] = useState(null);
  const [items, setItems] = useState([]);

  // refund UI state: product_id -> { quantity, price } (price is UNIT refund price)
  const [refund, setRefund] = useState({});
  const [refundNote, setRefundNote] = useState("");

  async function load() {
    setLoading(true);
    try {
      const s = await api.settings.getAll().catch(() => null);
      if (s?.currency) setCurrency(String(s.currency).trim());

      const list = await api.sales.getAll({ limit: 200, offset: 0 });
      setRows(list || []);
    } catch (e) {
      console.error(e);
      showToast("Failed to load sales", "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []); // eslint-disable-line

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((r) => {
      const s = `${r.id} ${r.customer_name || ""} ${r.cashier_name || ""} ${r.sale_type || ""} ${r.payment_method || ""}`.toLowerCase();
      return s.includes(term);
    });
  }, [q, rows]);

  async function view(id) {
    try {
      const res = await api.sales.getOne(id);
      if (!res?.sale) return showToast("Sale not found", "error");

      setSale(res.sale);
      setItems(res.items || []);
      setOpen(true);

      // ✅ FIX: initialize refund map correctly (price = original unit price)
      const m = {};
      (res.items || []).forEach((it) => {
        if (Number(it.quantity) > 0) {
          m[it.product_id] = {
            quantity: 0,
            price: Number(it.price || 0),
          };
        }
      });
      setRefund(m);

      setRefundNote(`Refund for receipt #${id}`);
    } catch (e) {
      console.error(e);
      showToast("Failed to open sale", "error");
    }
  }

  const isOriginalSale = sale?.sale_type === "sale";

  // ✅ refund total preview (positive number)
  const refundPreview = useMemo(() => {
    let total = 0;
    for (const it of items) {
      if (Number(it.quantity) <= 0) continue; // only original sale items

      const r = refund[it.product_id];
      const qty = Number(r?.quantity || 0);
      const price = Number(r?.price ?? it.price);

      if (qty > 0) total += price * qty;
    }
    return total;
  }, [refund, items]);

  async function submitRefund() {
    if (!me) return showToast("Please login first", "error");
    if (!sale?.id) return;

    const refundItems = [];

    for (const it of items) {
      if (Number(it.quantity) <= 0) continue;

      const r = refund[it.product_id];
      const qty = Math.floor(Number(r?.quantity || 0));
      const price = Number(r?.price ?? it.price);

      if (qty > 0) {
        refundItems.push({
          product_id: it.product_id,
          quantity: qty,
          price: price, // unit refund price
        });
      }
    }

    if (refundItems.length === 0) return showToast("Select at least 1 item to refund", "warning");

    try {
      const res = await api.sales.refund({
        original_sale_id: sale.id,
        items: refundItems,
        note: refundNote || `Refund for receipt #${sale.id}`,
      });

      if (res?.ok === false) return showToast(res.message || "Refund failed", "error");

      showToast(`Refund created ✅ (#${res.refundSaleId})`);
      setOpen(false);
      setSale(null);
      setItems([]);
      setRefund({});
      await load();
    } catch (e) {
      console.error(e);
      showToast("Refund failed", "error");
    }
  }

  return (
    <div style={{ padding: 20, height: "100%", overflow: "auto" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900, color: "var(--text)" }}>Sales History</h1>
            <div style={{ marginTop: 6, color: "var(--text2)", fontSize: 13 }}>
              View receipts and create partial refunds (quantity + unit refund price).
            </div>
          </div>
          <div style={pill()}>{loading ? "Loading…" : `${rows.length} sales`}</div>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 12, alignItems: "center" }}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by receipt #, customer, cashier, type…"
            style={inputStyle(false)}
          />
          <button onClick={load} style={btnGhost()}>Refresh</button>
        </div>

        <div style={{ marginTop: 12, border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "rgba(0,0,0,0.25)" }}>
                <th style={th()}>Receipt</th>
                <th style={th()}>Type</th>
                <th style={th()}>Customer</th>
                <th style={th()}>Cashier</th>
                <th style={{ ...th(), textAlign: "right" }}>Total</th>
                <th style={th()}>Time</th>
                <th style={{ ...th(), textAlign: "right" }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, idx) => (
                <tr
                  key={r.id}
                  style={{
                    borderTop: "1px solid rgba(255,255,255,0.06)",
                    background: idx % 2 ? "rgba(255,255,255,0.02)" : "transparent",
                  }}
                >
                  <td style={td()}><b>#{r.id}</b></td>
                  <td style={td()}>{r.sale_type || "sale"}</td>
                  <td style={td()}>{r.customer_name || "-"}</td>
                  <td style={td()}>{r.cashier_name || "-"}</td>
                  <td style={{ ...td(), textAlign: "right" }} className="mono">{fmt(r.total)}</td>
                  <td style={td()}>{r.created_at || "-"}</td>
                  <td style={{ ...td(), textAlign: "right" }}>
                    <button onClick={() => view(r.id)} style={btnGhost()}>View</button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ padding: 14, color: "var(--text2)" }}>
                    No results.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* View / Refund modal */}
      {open && sale && (
        <div style={overlay()} onMouseDown={() => setOpen(false)}>
          <div style={modal()} onMouseDown={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
              <div style={{ fontWeight: 900, fontSize: 16 }}>
                Receipt #{sale.id} ({sale.sale_type || "sale"})
              </div>
              <button onClick={() => setOpen(false)} style={btnGhost()}>Close</button>
            </div>

            <div style={{ marginTop: 10, color: "var(--text2)", fontSize: 13 }}>
              Customer: <b>{sale.customer_name || "-"}</b> &nbsp;|&nbsp; Cashier: <b>{sale.cashier_name || "-"}</b>
            </div>

            <div style={{ marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
              <div style={{ fontWeight: 900, marginBottom: 8 }}>Items</div>

              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "rgba(0,0,0,0.25)" }}>
                    <th style={th()}>Product</th>
                    <th style={{ ...th(), textAlign: "right" }}>Sold Qty</th>
                    <th style={{ ...th(), textAlign: "right" }}>Unit Price</th>
                    {isOriginalSale && <th style={{ ...th(), textAlign: "right" }}>Refund Qty</th>}
                    {isOriginalSale && <th style={{ ...th(), textAlign: "right" }}>Refund Price</th>}
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => {
                    const soldQty = Number(it.quantity);
                    const showRefund = isOriginalSale && soldQty > 0;

                    const current = refund[it.product_id] || { quantity: 0, price: Number(it.price || 0) };

                    return (
                      <tr key={it.id} style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                        <td style={td()}>{it.product_name}</td>
                        <td style={{ ...td(), textAlign: "right" }} className="mono">{soldQty}</td>
                        <td style={{ ...td(), textAlign: "right" }} className="mono">{fmt(it.price)}</td>

                        {showRefund ? (
                          <>
                            <td style={{ ...td(), textAlign: "right" }}>
                              <input
                                type="number"
                                min={0}
                                max={soldQty}
                                value={current.quantity}
                                // ✅ FIX: when qty changes, if price invalid, auto set to original unit price
                                onChange={(e) => {
                                  const qtyVal = e.target.value;
                                  const p = Number(current.price);
                                  const fixedPrice = Number.isFinite(p) && p > 0 ? current.price : Number(it.price || 0);

                                  setRefund({
                                    ...refund,
                                    [it.product_id]: { quantity: qtyVal, price: fixedPrice },
                                  });
                                }}
                                style={{ ...inputStyle(false), width: 110, textAlign: "right" }}
                              />
                            </td>
                            <td style={{ ...td(), textAlign: "right" }}>
                              <input
                                type="number"
                                min={0}
                                value={current.price}
                                onChange={(e) =>
                                  setRefund({
                                    ...refund,
                                    [it.product_id]: { ...current, price: e.target.value },
                                  })
                                }
                                style={{ ...inputStyle(false), width: 130, textAlign: "right" }}
                              />
                            </td>
                          </>
                        ) : isOriginalSale ? (
                          <>
                            <td style={td()}></td>
                            <td style={td()}></td>
                          </>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <div style={{ marginTop: 12, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                <div style={{ flex: 1 }}>
                  {isOriginalSale && (
                    <>
                      <div style={{ fontSize: 12, color: "var(--text2)", fontWeight: 900 }}>Refund note</div>
                      <input value={refundNote} onChange={(e) => setRefundNote(e.target.value)} style={inputStyle(false)} />
                    </>
                  )}
                </div>

                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 12, color: "var(--text2)", fontWeight: 900 }}>Refund total</div>
                  <div className="mono" style={{ fontSize: 18, fontWeight: 900, color: "var(--accent)" }}>
                    {fmt(refundPreview)}
                  </div>
                </div>
              </div>

              {isOriginalSale && (
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 12 }}>
                  <button onClick={submitRefund} style={btnPrimary(false)}>Create refund</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- UI helpers ---
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
function btnGhost() {
  return {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid var(--border)",
    background: "transparent",
    color: "var(--text2)",
    cursor: "pointer",
    fontWeight: 900,
    whiteSpace: "nowrap",
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
function th() {
  return { textAlign: "left", padding: "10px 12px", fontSize: 12, color: "var(--text2)", fontWeight: 900 };
}
function td() {
  return { padding: "10px 12px", fontSize: 13, color: "var(--text)" };
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
    width: 920,
    maxWidth: "96vw",
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: 16,
    padding: 16,
    boxShadow: "var(--shadow)",
  };
}