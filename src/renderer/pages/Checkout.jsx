import { useEffect, useMemo, useRef, useState } from "react";
import { usePOS } from "../App";

const fmt = (n) => `$${(Number(n) || 0).toFixed(2)}`;

export default function Checkout() {
  const { api, showToast, me } = usePOS();

  // Data
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);

  // Cart + checkout
  const [cart, setCart] = useState([]);
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("All");
  const [payMethod, setPayMethod] = useState("cash");
  const [discount, setDiscount] = useState("");
  const [cashGiven, setCashGiven] = useState("");

  // Receipt modal
  const [showReceipt, setShowReceipt] = useState(false);
  const [lastSale, setLastSale] = useState(null);

  // Settings
  const [storeName, setStoreName] = useState("RetailPOS");
  const [receiptFooter, setReceiptFooter] = useState("");

  // Customers
  const [customers, setCustomers] = useState([]);
  const [customerPanelOpen, setCustomerPanelOpen] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [newCustomerMode, setNewCustomerMode] = useState(false);
  const [newCustomer, setNewCustomer] = useState({
    name: "",
    phone: "",
    email: "",
    address: "",
    code: "", // temporary "barcode/loyalty code" stored inside address
  });

  // Price correction popup
  const [priceEditItem, setPriceEditItem] = useState(null);
  const [priceEditValue, setPriceEditValue] = useState("");

  const searchRef = useRef();

  // ----- Temporary customer code storage inside address -----
  const CODE_RE = /\[\[CODE:([^\]]+)\]\]/i;

  function extractCode(address) {
    const m = String(address || "").match(CODE_RE);
    return m ? String(m[1] || "").trim() : "";
  }

  function stripCode(address) {
    return String(address || "")
      .replace(CODE_RE, "")
      .replace(/\n\s*\n/g, "\n")
      .trim();
  }

  function encodeAddress(address, code) {
    const clean = stripCode(address);
    const c = String(code || "").trim();
    if (!c) return clean;
    return `${clean}\n[[CODE:${c}]]`.trim();
  }

  // ----- Loaders -----
  const reloadProducts = async () => {
    const p = await api.products.getAll();
    setProducts(p || []);
  };

  const reloadCustomers = async () => {
    try {
      const list = await api.customers.getAll();
      const mapped = (list || []).map((c) => ({
        ...c,
        code: extractCode(c.address),
        address: stripCode(c.address),
      }));
      setCustomers(mapped);
    } catch {
      setCustomers([]);
    }
  };

  useEffect(() => {
    reloadProducts();
    api.categories.getAll().then(setCategories);

    // settings (safe even if missing, but your main.js must have settings:getAll handler)
    api.settings
      .getAll()
      .then((s) => {
        if (s?.store_name) setStoreName(s.store_name);
        if (s?.receipt_footer) setReceiptFooter(s.receipt_footer);
      })
      .catch(() => {});

    reloadCustomers();
    searchRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const catColors = Object.fromEntries(categories.map((c) => [c.name, c.color]));

  const filtered = products.filter((p) => {
    const matchCat = catFilter === "All" || p.category === catFilter;
    const q = search.toLowerCase();
    const matchSearch =
      !search ||
      (p.name || "").toLowerCase().includes(q) ||
      String(p.sku || "").toLowerCase().includes(q) ||
      String(p.barcode || "").toLowerCase().includes(q);
    return matchCat && matchSearch && p.stock > 0;
  });

  // ----- Price correction: DOES NOT change product DB price -----
  const getUnitPrice = (i) => Number(i.priceOverride ?? i.price) || 0;

  const openPriceEdit = (item) => {
    setPriceEditItem(item);
    setPriceEditValue(String(getUnitPrice(item)));
  };

  const applyPriceEdit = () => {
    const num = Number(priceEditValue);
    if (!Number.isFinite(num) || num < 0) {
      showToast("Invalid price", "error");
      return;
    }
    setCart((prev) =>
      prev.map((x) => (x.id === priceEditItem.id ? { ...x, priceOverride: num } : x))
    );
    setPriceEditItem(null);
    showToast("Price updated (only for this sale)");
  };

  const resetPrice = (item) => {
    setCart((prev) => prev.map((x) => (x.id === item.id ? { ...x, priceOverride: null } : x)));
    showToast("Price reset to original");
  };

  // ----- Cart actions -----
  const addToCart = (product) => {
    setCart((prev) => {
      const existing = prev.find((i) => i.id === product.id);
      if (existing) {
        if (existing.qty >= product.stock) {
          showToast(`Only ${product.stock} in stock`, "warning");
          return prev;
        }
        return prev.map((i) => (i.id === product.id ? { ...i, qty: i.qty + 1 } : i));
      }
      return [...prev, { ...product, qty: 1, priceOverride: null }];
    });
  };

  const updateQty = (id, qty) => {
    if (qty <= 0) {
      setCart((prev) => prev.filter((i) => i.id !== id));
      return;
    }
    setCart((prev) =>
      prev.map((i) => (i.id === id ? { ...i, qty: Math.min(qty, i.stock) } : i))
    );
  };

  const removeItem = (id) => setCart((prev) => prev.filter((i) => i.id !== id));

  // ----- Totals (tax removed) -----
  const subtotal = useMemo(() => cart.reduce((s, i) => s + getUnitPrice(i) * i.qty, 0), [cart]);

  const discountAmt = discount
    ? discount.includes("%")
      ? (subtotal * parseFloat(discount)) / 100
      : parseFloat(discount)
    : 0;

  const total = Math.max(0, subtotal - (Number(discountAmt) || 0));
  const change = payMethod === "cash" && cashGiven ? parseFloat(cashGiven) - total : 0;

  // ----- Customers: match list + auto-select exact phone/email/code -----
  const customerMatches = useMemo(() => {
    const q = customerSearch.trim().toLowerCase();
    if (!q) return customers.slice(0, 20);

    return customers
      .filter((c) => {
        const name = (c.name || "").toLowerCase();
        const phone = (c.phone || "").toLowerCase();
        const email = (c.email || "").toLowerCase();
        const code = (c.code || "").toLowerCase();
        return name.includes(q) || phone.includes(q) || email.includes(q) || code.includes(q);
      })
      .slice(0, 20);
  }, [customers, customerSearch]);

  useEffect(() => {
    if (!customerPanelOpen || newCustomerMode) return;
    const q = customerSearch.trim().toLowerCase();
    if (!q) return;

    const exact = customers.filter((c) => {
      const phone = String(c.phone || "").trim().toLowerCase();
      const email = String(c.email || "").trim().toLowerCase();
      const code = String(c.code || "").trim().toLowerCase();
      return q === phone || q === email || q === code;
    });

    if (exact.length === 1) {
      setSelectedCustomer(exact[0]);
      setCustomerPanelOpen(false);
      setCustomerSearch("");
      showToast(`Customer selected: ${exact[0].name}`);
    }
  }, [customerSearch, customerPanelOpen, newCustomerMode, customers, showToast]);

  const selectCustomer = (c) => {
    setSelectedCustomer(c);
    setCustomerPanelOpen(false);
    setNewCustomerMode(false);
    setCustomerSearch("");
    showToast(`Customer selected: ${c.name}`);
  };

  const clearCustomer = () => {
    setSelectedCustomer(null);
    showToast("Customer cleared (Walk-in)");
  };

  const saveNewCustomer = async () => {
    if (!newCustomer.name.trim()) return showToast("Customer name required", "warning");

    try {
      const payload = {
        name: newCustomer.name.trim(),
        phone: (newCustomer.phone || "").trim(),
        email: (newCustomer.email || "").trim(),
        address: encodeAddress((newCustomer.address || "").trim(), (newCustomer.code || "").trim()),
      };

      const res = await api.customers.create(payload);
      if (res?.ok === false) return showToast(res.message || "Failed", "error");

      await reloadCustomers();

      setSelectedCustomer({
        id: res?.id,
        ...payload,
        address: stripCode(payload.address),
        code: extractCode(payload.address),
      });

      setNewCustomer({ name: "", phone: "", email: "", address: "", code: "" });
      setNewCustomerMode(false);
      setCustomerPanelOpen(false);
      showToast("Customer saved");
    } catch {
      showToast("Failed to save customer", "error");
    }
  };

  // ----- Receipt HTML (A4) -----
  const buildReceiptHtmlA4 = (sale, { autoPrint = false } = {}) => {
    const dt = sale?.date ? new Date(sale.date) : new Date();
    const cust = sale.customer || null;

    const itemsHtml = (sale.items || [])
      .map(
        (it) => `
      <tr>
        <td>${escapeHtml(it.product_name)}</td>
        <td style="text-align:center;">${escapeHtml(String(it.quantity))}</td>
        <td style="text-align:right;">${money(it.price)}</td>
        <td style="text-align:right;">${money(it.subtotal)}</td>
      </tr>`
      )
      .join("");

    const customerHtml = cust
      ? `
      <div class="box">
        <div style="font-size:12px;color:#333;"><b>Customer</b></div>
        <div class="muted">
          <b>Name:</b> ${escapeHtml(cust.name || "-")}<br/>
          <b>Phone:</b> ${escapeHtml(cust.phone || "-")}<br/>
          <b>Email:</b> ${escapeHtml(cust.email || "-")}<br/>
          <b>Address:</b> ${escapeHtml(cust.address || "-")}<br/>
        </div>
      </div>
    `
      : `
      <div class="box">
        <div style="font-size:12px;color:#333;"><b>Customer</b></div>
        <div class="muted">Walk-in</div>
      </div>
    `;

    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Receipt #${escapeHtml(String(sale.id))}</title>
  <style>
    @page { size: A4; margin: 12mm; }
    html, body { background:#fff; color:#111; font-family: Arial, sans-serif; }
    .brand { font-size: 22px; font-weight: 800; }
    .muted { color:#555; font-size: 12px; margin-top: 4px; line-height: 1.4; }
    .hr { height:1px; background:#eee; margin: 10px 0; }
    table { width:100%; border-collapse: collapse; margin-top: 10px; }
    th, td { padding: 8px 6px; border-bottom: 1px solid #eee; font-size: 12px; }
    th { text-align:left; font-size: 12px; color:#333; background:#fafafa; }
    .right { text-align:right; }
    .totals { margin-top: 10px; display:flex; justify-content:flex-end; }
    .totals table { width: 320px; }
    .totals td { border-bottom:none; padding: 6px; }
    .grand { font-size: 14px; font-weight: 800; }
    .footer { margin-top: 14px; font-size: 12px; color: #555; text-align:center; }
    .box { border: 1px solid #e5e7eb; border-radius: 10px; padding: 10px 12px; }
  </style>
</head>
<body>
  <div>
    <div style="display:flex; justify-content:space-between; gap:12px;">
      <div>
        <div class="brand">${escapeHtml(sale.storeName || "RetailPOS")}</div>
        <div class="muted">
          <b>Receipt #:</b> ${escapeHtml(String(sale.id))}<br/>
          <b>Date:</b> ${escapeHtml(dt.toLocaleString())}<br/>
          <b>Payment:</b> ${escapeHtml(sale.payment_method || "-")}<br/>
          ${sale.cashier ? `<b>Cashier:</b> ${escapeHtml(sale.cashier)}<br/>` : ``}
          <b>Returns:</b> customer must bring this receipt #
        </div>
      </div>
      ${customerHtml}
    </div>

    <div class="hr"></div>

    <table>
      <thead>
        <tr>
          <th>Item</th>
          <th style="text-align:center;">Qty</th>
          <th class="right">Price</th>
          <th class="right">Amount</th>
        </tr>
      </thead>
      <tbody>${itemsHtml}</tbody>
    </table>

    <div class="totals">
      <table>
        <tr><td class="right">Subtotal</td><td class="right">${money(sale.subtotal)}</td></tr>
        ${
          Number(sale.discount || 0) > 0
            ? `<tr><td class="right">Discount</td><td class="right">-${money(
                sale.discount
              )}</td></tr>`
            : ``
        }
        <tr><td class="right grand">Total</td><td class="right grand">${money(sale.total)}</td></tr>
      </table>
    </div>

    <div class="footer">${escapeHtml(sale.footer || "Thank you for your purchase!")}</div>
  </div>
  ${autoPrint ? `<script>window.onload=()=>{window.focus();window.print();};</script>` : ``}
</body>
</html>`;
  };

  const printReceiptA4 = () => {
    if (!lastSale) return;
    const html = buildReceiptHtmlA4(lastSale, { autoPrint: true });
    const w = window.open("", "_blank", "width=900,height=650");
    if (!w) return showToast("Popup blocked. Allow popups/prints.", "error");
    w.document.open();
    w.document.write(html);
    w.document.close();
  };

  const saveReceiptPdf = async () => {
    if (!lastSale) return;
    if (!api.receipt?.savePdf) {
      showToast("Save PDF not enabled (missing main.js/preload.js setup)", "error");
      return;
    }
    const html = buildReceiptHtmlA4(lastSale, { autoPrint: false });
    const res = await api.receipt.savePdf({ html, fileName: `Receipt-${lastSale.id}.pdf` });
    if (!res?.ok) return showToast(res?.message || "Save failed", "error");
    showToast("Receipt saved (PDF)");
  };

  const emailReceipt = async () => {
    if (!lastSale) return;
    const email = lastSale?.customer?.email;
    if (!email) return showToast("Customer email not set", "warning");

    const subject = `Receipt #${lastSale.id} - ${storeName}`;
    const html = buildReceiptHtmlA4(lastSale, { autoPrint: false });

    if (api.receipt?.sendEmail) {
      const res = await api.receipt.sendEmail({
        to: email,
        subject,
        html,
        fileName: `Receipt-${lastSale.id}.pdf`,
      });
      if (!res?.ok) return showToast(res?.message || "Email failed", "error");
      showToast("Receipt emailed");
      return;
    }

    // fallback
    const body = `Thank you for your purchase.\nReceipt #: ${lastSale.id}\nTotal: ${money(
      lastSale.total
    )}\n\n(Bring this receipt number for returns.)`;
    window.open(
      `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(
        body
      )}`
    );
    showToast("Opened email draft (attachment requires email setup)", "warning");
  };

  // ----- Sale / Charge -----
  const handleCharge = async () => {
    if (!cart.length) return showToast("Cart is empty", "warning");
    if (!me) return showToast("Login required before selling", "warning");

    const sale = {
      total,
      subtotal,
      tax: 0,
      discount: discountAmt,
      payment_method: payMethod,
      note: "",
      customer_id: selectedCustomer?.id || null,
      customer_name: selectedCustomer?.name || null,
    };

    const items = cart.map((i) => {
      const unit = getUnitPrice(i);
      return {
        product_id: i.id,
        product_name: i.name,
        quantity: i.qty,
        price: unit,
        subtotal: unit * i.qty,
      };
    });

    try {
      const res = await api.sales.create({ sale, items });

      if (res && typeof res === "object" && res.ok === false) {
        showToast(res.message || "Failed", "error");
        return;
      }

      const saleId = res && typeof res === "object" ? res.saleId : res;

      const receipt = {
        id: saleId,
        ...sale,
        items,
        date: new Date(),
        cashier: me?.name || null,
        storeName,
        footer: receiptFooter,
        customer: selectedCustomer ? { ...selectedCustomer } : null,
      };

      setLastSale(receipt);
      setShowReceipt(true);

      setCart([]);
      setDiscount("");
      setCashGiven("");
      await reloadProducts();

      showToast("Sale completed!");
    } catch {
      showToast("Failed to process sale", "error");
    }
  };

  // ----- UI -----
  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {/* Products Panel */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", padding: 20, gap: 12 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div style={{ flex: 1, position: "relative" }}>
            <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text3)", fontSize: 16 }}>🔍</span>
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search products or scan barcode..."
              style={{
                width: "100%",
                padding: "10px 12px 10px 38px",
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
                color: "var(--text)",
                fontSize: 14,
              }}
            />
          </div>

          <div style={{
            padding: "8px 10px",
            borderRadius: 999,
            border: "1px solid var(--border)",
            background: "rgba(255,255,255,0.04)",
            color: "var(--text2)",
            fontSize: 12,
            fontWeight: 700,
            whiteSpace: "nowrap",
          }}>
            {me ? `👤 ${me.name}` : "🔒 Login required"}
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
          {["All", ...categories.map((c) => c.name)].map((cat) => (
            <button
              key={cat}
              onClick={() => setCatFilter(cat)}
              style={{
                padding: "6px 14px",
                borderRadius: 20,
                fontSize: 13,
                fontWeight: 500,
                flexShrink: 0,
                background: catFilter === cat ? (catColors[cat] || "var(--accent)") : "var(--surface)",
                color: catFilter === cat ? "white" : "var(--text2)",
                border: `1px solid ${catFilter === cat ? "transparent" : "var(--border)"}`,
              }}
            >
              {cat}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: "auto", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 10, alignContent: "start" }}>
          {filtered.map((p) => (
            <button
              key={p.id}
              onClick={() => addToCart(p)}
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                padding: 14,
                textAlign: "left",
                cursor: "pointer",
                transition: "all 0.15s",
                position: "relative",
                overflow: "hidden",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = catColors[p.category] || "var(--accent)"; e.currentTarget.style.transform = "translateY(-2px)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.transform = "none"; }}
            >
              <div style={{ width: "100%", height: 40, borderRadius: 8, marginBottom: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, background: `${catColors[p.category] || "#6366f1"}22` }}>
                {categoryIcon(p.category)}
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 4, lineHeight: 1.3 }}>{p.name}</div>
              <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 8 }}>{p.sku}</div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontWeight: 700, color: "var(--accent)", fontSize: 14 }} className="mono">{fmt(p.price)}</span>
                <span style={{
                  fontSize: 10, padding: "2px 6px", borderRadius: 4, fontWeight: 600,
                  background: p.stock <= p.low_stock_threshold ? "rgba(244,63,94,0.15)" : "rgba(74,222,128,0.1)",
                  color: p.stock <= p.low_stock_threshold ? "var(--danger)" : "var(--accent2)",
                }}>{p.stock}</span>
              </div>
            </button>
          ))}
          {filtered.length === 0 && (
            <div style={{ gridColumn: "1/-1", textAlign: "center", color: "var(--text3)", padding: 40 }}>
              No products found
            </div>
          )}
        </div>
      </div>

      {/* Cart Panel */}
      <div style={{ width: 400, background: "var(--surface)", borderLeft: "1px solid var(--border)", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>
            🛒 Cart {cart.length > 0 && <span style={{ color: "var(--accent)" }}>({cart.length})</span>}
          </span>
          {cart.length > 0 && (
            <button onClick={() => setCart([])} style={{ color: "var(--danger)", background: "none", fontSize: 12 }}>
              Clear all
            </button>
          )}
        </div>

        {/* Customer bar */}
        <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <div>
              <div style={{ fontSize: 12, color: "var(--text2)", fontWeight: 800 }}>Customer</div>
              <div style={{ fontSize: 13, color: "var(--text)" }}>
                {selectedCustomer ? (
                  <>
                    <b>{selectedCustomer.name}</b>
                    <div style={{ fontSize: 11, color: "var(--text3)" }}>
                      {selectedCustomer.phone || ""}
                      {selectedCustomer.phone && selectedCustomer.email ? " · " : ""}
                      {selectedCustomer.email || ""}
                      {selectedCustomer.code ? ` · CODE:${selectedCustomer.code}` : ""}
                    </div>
                    {selectedCustomer.address ? (
                      <div style={{ fontSize: 11, color: "var(--text3)" }}>{selectedCustomer.address}</div>
                    ) : null}
                  </>
                ) : (
                  <span style={{ color: "var(--text3)" }}>Walk-in</span>
                )}
              </div>
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              {selectedCustomer && (
                <button onClick={clearCustomer} style={btnGhost()}>
                  Clear
                </button>
              )}

              <button
                onClick={() => { setCustomerPanelOpen(!customerPanelOpen); setNewCustomerMode(false); }}
                style={btnSoft()}
              >
                {customerPanelOpen ? "Close" : "Select / Add"}
              </button>
            </div>
          </div>

          {customerPanelOpen && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
              {!newCustomerMode ? (
                <>
                  <input
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                    placeholder="Search or scan: phone / email / customer code…"
                    style={miniInputStyle()}
                  />

                  <div style={{ maxHeight: 160, overflow: "auto", border: "1px solid var(--border)", borderRadius: 12, marginTop: 8 }}>
                    {customerMatches.length === 0 ? (
                      <div style={{ padding: 10, color: "var(--text3)", fontSize: 12 }}>No customers found.</div>
                    ) : (
                      customerMatches.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => selectCustomer(c)}
                          style={{
                            width: "100%",
                            textAlign: "left",
                            padding: "10px 12px",
                            border: "none",
                            background: "transparent",
                            color: "var(--text)",
                            cursor: "pointer",
                            borderBottom: "1px solid rgba(255,255,255,0.06)",
                          }}
                        >
                          <div style={{ fontWeight: 900, fontSize: 13 }}>{c.name}</div>
                          <div style={{ fontSize: 11, color: "var(--text3)" }}>
                            {c.phone || ""}
                            {c.phone && c.email ? " · " : ""}
                            {c.email || ""}
                            {c.code ? ` · CODE:${c.code}` : ""}
                          </div>
                        </button>
                      ))
                    )}
                  </div>

                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button
                      onClick={() => { setNewCustomerMode(true); setNewCustomer({ name: "", phone: "", email: "", address: "", code: "" }); }}
                      style={btnGhostWide()}
                    >
                      + Add new customer
                    </button>
                    <button onClick={reloadCustomers} style={btnGhost()}>
                      Refresh
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
                    <input value={newCustomer.name} onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })} placeholder="Name *" style={miniInputStyle()} />
                    <input value={newCustomer.phone} onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })} placeholder="Phone" style={miniInputStyle()} />
                    <input value={newCustomer.email} onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })} placeholder="Email" style={{ ...miniInputStyle(), gridColumn: "1/-1" }} />
                    <input value={newCustomer.address} onChange={(e) => setNewCustomer({ ...newCustomer, address: e.target.value })} placeholder="Address" style={{ ...miniInputStyle(), gridColumn: "1/-1" }} />
                    <input value={newCustomer.code} onChange={(e) => setNewCustomer({ ...newCustomer, code: e.target.value })} placeholder="Customer code / barcode (optional)" style={{ ...miniInputStyle(), gridColumn: "1/-1" }} />
                  </div>

                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button onClick={saveNewCustomer} style={btnSoftWide()}>
                      Save customer
                    </button>
                    <button onClick={() => setNewCustomerMode(false)} style={btnGhost()}>
                      Back
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Cart Items */}
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
          {cart.length === 0 ? (
            <div style={{ textAlign: "center", color: "var(--text3)", padding: "60px 20px" }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🛒</div>
              <div style={{ fontSize: 14 }}>Add items to begin</div>
            </div>
          ) : (
            cart.map((item) => {
              const unit = getUnitPrice(item);
              const lineTotal = unit * item.qty;
              const overridden = item.priceOverride !== null && item.priceOverride !== undefined;

              return (
                <div key={item.id} style={{ padding: "10px 20px", display: "flex", gap: 10, alignItems: "center", borderBottom: "1px solid var(--border)" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 900, fontSize: 13, marginBottom: 2 }}>{item.name}</div>

                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ color: "var(--accent)", fontSize: 13 }} className="mono">
                        {fmt(unit)}
                      </div>

                      <button onClick={() => openPriceEdit(item)} style={miniBtn()} title="Price correction">
                        Edit price
                      </button>

                      {overridden && (
                        <button onClick={() => resetPrice(item)} style={miniBtnDanger()} title={`Reset to original ${fmt(item.price)}`}>
                          Reset
                        </button>
                      )}
                    </div>

                    {overridden && (
                      <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>
                        Original: {fmt(item.price)}
                      </div>
                    )}
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <button onClick={() => updateQty(item.id, item.qty - 1)} style={qtyBtnStyle()}>−</button>
                    <span style={{ width: 24, textAlign: "center", fontWeight: 900, fontSize: 14 }}>{item.qty}</span>
                    <button onClick={() => updateQty(item.id, item.qty + 1)} style={qtyBtnStyle()}>+</button>
                  </div>

                  <div style={{ width: 92, textAlign: "right" }}>
                    <div className="mono" style={{ fontWeight: 900, fontSize: 13 }}>{fmt(lineTotal)}</div>
                    <button onClick={() => removeItem(item.id)} style={{ color: "var(--danger)", background: "none", fontSize: 11 }}>
                      Remove
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Totals & Payment */}
        <div style={{ padding: 20, borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ color: "var(--text2)", fontSize: 13, flex: 1 }}>Discount</span>
            <input value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="e.g. 10 or 10%" style={smallInputStyle()} />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "12px 0", borderTop: "1px solid var(--border)" }}>
            <Row label="Subtotal" value={fmt(subtotal)} />
            {discountAmt > 0 && <Row label="Discount" value={`-${fmt(discountAmt)}`} color="var(--accent2)" />}
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
              <span style={{ fontWeight: 900, fontSize: 16 }}>Total</span>
              <span className="mono" style={{ fontWeight: 900, fontSize: 20, color: "var(--accent)" }}>{fmt(total)}</span>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
            {["cash", "card", "other"].map((m) => (
              <button key={m} onClick={() => setPayMethod(m)} style={{
                padding: "8px 4px",
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 900,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                background: payMethod === m ? "rgba(108,99,255,0.2)" : "var(--surface2)",
                color: payMethod === m ? "var(--accent)" : "var(--text2)",
                border: `1px solid ${payMethod === m ? "var(--accent)" : "var(--border)"}`,
                cursor: "pointer",
              }}>
                {m === "cash" ? "💵" : m === "card" ? "💳" : "📱"} {m}
              </button>
            ))}
          </div>

          {payMethod === "cash" && (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ color: "var(--text2)", fontSize: 13, flex: 1 }}>Cash Given</span>
              <input value={cashGiven} onChange={(e) => setCashGiven(e.target.value)} placeholder="0.00" type="number" style={smallInputStyle()} />
            </div>
          )}

          {payMethod === "cash" && cashGiven && change >= 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", background: "rgba(74,222,128,0.1)", borderRadius: 8, border: "1px solid rgba(74,222,128,0.2)" }}>
              <span style={{ color: "var(--accent2)", fontWeight: 900, fontSize: 13 }}>Change</span>
              <span className="mono" style={{ color: "var(--accent2)", fontWeight: 900, fontSize: 15 }}>{fmt(change)}</span>
            </div>
          )}

          <button
            onClick={handleCharge}
            disabled={!cart.length || !me}
            style={{
              padding: "14px",
              borderRadius: "var(--radius)",
              fontWeight: 900,
              fontSize: 16,
              background: cart.length && me ? "var(--accent)" : "var(--surface3)",
              color: cart.length && me ? "white" : "var(--text3)",
              boxShadow: cart.length && me ? "0 4px 20px rgba(108,99,255,0.4)" : "none",
              transition: "all 0.2s",
              cursor: cart.length && me ? "pointer" : "not-allowed",
            }}
          >
            {!me ? "Login to charge" : cart.length ? `Charge ${fmt(total)}` : "Add items to cart"}
          </button>
        </div>
      </div>

      {/* Receipt Modal */}
      {showReceipt && lastSale && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: 28, width: 560, boxShadow: "var(--shadow)" }}>
            <div style={{ textAlign: "center", marginBottom: 16 }}>
              <div style={{ fontSize: 40 }}>✅</div>
              <div style={{ fontWeight: 900, fontSize: 18, marginTop: 8 }}>Sale Complete!</div>
              <div style={{ color: "var(--text3)", fontSize: 13 }}>{new Date(lastSale.date).toLocaleString()}</div>

              <div style={{ color: "var(--text2)", fontSize: 12, marginTop: 6 }}>
                Receipt #: <b>{lastSale.id}</b> (customer must bring this for returns)
              </div>

              {lastSale.customer?.name && (
                <div style={{ color: "var(--text2)", fontSize: 12, marginTop: 6, lineHeight: 1.4 }}>
                  Customer: <b>{lastSale.customer.name}</b>
                  {lastSale.customer.phone ? ` · ${lastSale.customer.phone}` : ""}
                  {lastSale.customer.email ? ` · ${lastSale.customer.email}` : ""}
                  {lastSale.customer.address ? <div style={{ color: "var(--text3)" }}>{lastSale.customer.address}</div> : null}
                </div>
              )}
            </div>

            <div style={{ borderTop: "1px dashed var(--border)", padding: "14px 0", display: "flex", flexDirection: "column", gap: 6 }}>
              {lastSale.items.map((it, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                  <span>{it.product_name} × {it.quantity}</span>
                  <span className="mono">{fmt(it.subtotal)}</span>
                </div>
              ))}
            </div>

            <div style={{ borderTop: "1px dashed var(--border)", paddingTop: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 900, fontSize: 16 }}>
                <span>Total</span>
                <span className="mono" style={{ color: "var(--accent)" }}>{fmt(lastSale.total)}</span>
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <button onClick={printReceiptA4} style={actionBtn("soft")}>Print (A4)</button>
              <button onClick={saveReceiptPdf} style={actionBtn("neutral")}>Save PDF</button>
              <button
                onClick={emailReceipt}
                disabled={!lastSale?.customer?.email}
                title={!lastSale?.customer?.email ? "Customer email not set" : "Send receipt to customer email"}
                style={actionBtn("neutral", !lastSale?.customer?.email)}
              >
                Email receipt
              </button>
              <button onClick={() => setShowReceipt(false)} style={actionBtn("primary")}>New Sale</button>
            </div>
          </div>
        </div>
      )}

      {/* ✅ Price correction popup (must be OUTSIDE receipt modal) */}
      {priceEditItem && (
        <div style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.6)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 9999
        }}>
          <div style={{
            width: 360,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 16,
            padding: 16,
            boxShadow: "var(--shadow)"
          }}>
            <div style={{ fontWeight: 900, fontSize: 16, marginBottom: 10 }}>
              Price correction
            </div>

            <div style={{ color: "var(--text2)", fontSize: 12, marginBottom: 10 }}>
              {priceEditItem.name} (original {fmt(priceEditItem.price)})
            </div>

            <input
              value={priceEditValue}
              onChange={(e) => setPriceEditValue(e.target.value)}
              type="number"
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 12,
                border: "1px solid var(--border)",
                background: "rgba(0,0,0,0.25)",
                color: "var(--text)",
                outline: "none",
              }}
              placeholder="Enter new unit price"
            />

            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button onClick={() => setPriceEditItem(null)} style={btnGhostWide()}>
                Cancel
              </button>
              <button onClick={applyPriceEdit} style={btnSoftWide()}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- small UI helpers ---------------- */

function Row({ label, value, color }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
      <span style={{ color: "var(--text2)" }}>{label}</span>
      <span className="mono" style={{ color: color || "var(--text)" }}>{value}</span>
    </div>
  );
}

function categoryIcon(cat) {
  const icons = {
    Electronics: "⚡",
    Clothing: "👕",
    "Food & Drink": "☕",
    Sports: "🏃",
    "Home & Garden": "🏠",
    Books: "📚",
  };
  return icons[cat] || "📦";
}

function money(n) {
  return `$${(Number(n) || 0).toFixed(2)}`;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function smallInputStyle() {
  return {
    width: 120,
    padding: "6px 10px",
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    color: "var(--text)",
    fontSize: 13,
    textAlign: "right",
    outline: "none",
  };
}

function miniInputStyle() {
  return {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid var(--border)",
    background: "rgba(0,0,0,0.25)",
    color: "var(--text)",
    outline: "none",
  };
}

function qtyBtnStyle() {
  return {
    width: 24,
    height: 24,
    borderRadius: 6,
    background: "var(--surface2)",
    color: "var(--text)",
    fontSize: 14,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    border: "1px solid var(--border)",
    cursor: "pointer",
    fontWeight: 900,
  };
}

function actionBtn(kind, disabled = false) {
  const base = {
    flex: 1,
    padding: "12px",
    borderRadius: 10,
    fontWeight: 900,
    fontSize: 13,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.55 : 1,
  };

  if (kind === "primary") return { ...base, background: "var(--accent)", color: "white", border: "none" };
  if (kind === "soft") return { ...base, background: "rgba(108,99,255,0.18)", border: "1px solid rgba(108,99,255,0.6)", color: "var(--accent)" };
  return { ...base, background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)" };
}

function miniBtn() {
  return {
    border: "1px solid var(--border)",
    background: "transparent",
    color: "var(--text2)",
    fontSize: 11,
    padding: "4px 8px",
    borderRadius: 10,
    cursor: "pointer",
    fontWeight: 900,
  };
}

function miniBtnDanger() {
  return {
    border: "1px solid rgba(244,63,94,0.35)",
    background: "rgba(244,63,94,0.12)",
    color: "white",
    fontSize: 11,
    padding: "4px 8px",
    borderRadius: 10,
    cursor: "pointer",
    fontWeight: 900,
  };
}

function btnGhost() {
  return {
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "transparent",
    color: "var(--text2)",
    fontWeight: 900,
    cursor: "pointer",
  };
}

function btnGhostWide() {
  return { ...btnGhost(), flex: 1 };
}

function btnSoft() {
  return {
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid rgba(108,99,255,0.6)",
    background: "rgba(108,99,255,0.18)",
    color: "var(--accent)",
    fontWeight: 900,
    cursor: "pointer",
  };
}

function btnSoftWide() {
  return { ...btnSoft(), flex: 1 };
}