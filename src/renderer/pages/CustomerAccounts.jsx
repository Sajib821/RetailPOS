import React, { useEffect, useMemo, useState } from "react";
import { usePOS } from "../App";

const symMap = { BDT: "৳", USD: "$", GBP: "£", EUR: "€" };

export default function CustomerAccounts() {
  const { api, showToast, store, me } = usePOS();

  const storeSafe = store || { store_id: "", store_name: "Store", currency: "BDT" };
  const sym = symMap[storeSafe.currency] || "৳";
  const fmt = (n) => `${sym}${(Number(n) || 0).toFixed(2)}`;
  const isAdminOrSuper = me?.role === "admin" || me?.role === "superadmin";

  const [settings, setSettings] = useState({ contact: "", store_name: "" });

  const [customers, setCustomers] = useState([]);
  const [q, setQ] = useState("");
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [loadingAccount, setLoadingAccount] = useState(false);

  const [selected, setSelected] = useState(null);
  const [due, setDue] = useState(null);

  const [range, setRange] = useState("fy");
  const [fy, setFy] = useState("");
  const [history, setHistory] = useState({ sales: [], payments: [] });

  const [customYears, setCustomYears] = useState([]);
  const [newFYStartYear, setNewFYStartYear] = useState(String(new Date().getFullYear()));

  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("cash");
  const [payFY, setPayFY] = useState("");
  const [payNote, setPayNote] = useState("");
  const [savingPayment, setSavingPayment] = useState(false);

  const [histFY, setHistFY] = useState("");
  const [histTotal, setHistTotal] = useState("");
  const [histStatus, setHistStatus] = useState("due");
  const [histDate, setHistDate] = useState("");
  const [savingHistorical, setSavingHistorical] = useState(false);

  const [postSavePromptOpen, setPostSavePromptOpen] = useState(false);
  const [emailModal, setEmailModal] = useState({
    open: false,
    to: "",
    subject: "",
    html: "",
    fileName: "",
    sending: false,
  });

  const canImportHistorical = me?.role === "admin" || me?.role === "superadmin";

  const baseFiscalYears = useMemo(() => {
    const now = new Date();
    const cur = now.getFullYear();
    const list = [];
    for (let y = cur - 5; y <= cur + 2; y += 1) list.push(`${y}-${y + 1}`);
    return list.reverse();
  }, []);

  const fiscalYears = useMemo(() => {
    return Array.from(new Set([...customYears, ...baseFiscalYears])).sort((a, b) =>
      a > b ? -1 : 1
    );
  }, [baseFiscalYears, customYears]);

  const selectedYearRow = due?.years?.find((y) => y.fiscal_year === fy) || null;

  const salesRows = history?.sales || [];
  const paymentRows = history?.payments || [];

  const totalPurchasedInView = useMemo(
    () =>
      salesRows
        .filter((s) => (s.sale_type || "sale") !== "refund")
        .reduce((a, s) => a + Number(s.total || 0), 0),
    [salesRows]
  );

  const manualPaymentsTotal = useMemo(
    () => paymentRows.reduce((a, p) => a + Number(p.amount || 0), 0),
    [paymentRows]
  );

  const completedSalesPaidTotal = useMemo(
    () =>
      salesRows
        .filter(
          (s) =>
            (s.sale_type || "sale") !== "refund" &&
            String(s.status || "").toLowerCase() === "completed"
        )
        .reduce((a, s) => a + Number(s.total || 0), 0),
    [salesRows]
  );

  const totalPaidInView = manualPaymentsTotal + completedSalesPaidTotal;

  async function loadSettings() {
    try {
      const s = await api.settings?.getAll?.();
      setSettings({
        contact: s?.contact || "",
        store_name: s?.store_name || "",
      });
    } catch {
      setSettings({ contact: "", store_name: "" });
    }
  }

  async function loadCustomers(searchText = q) {
    setLoadingCustomers(true);
    try {
      const rows = String(searchText || "").trim()
        ? await api.customers.search(String(searchText || "").trim())
        : await api.customers.getAll();

      setCustomers(Array.isArray(rows) ? rows : []);
    } catch (e) {
      console.error(e);
      setCustomers([]);
      showToast("Failed to load customers", "error");
    } finally {
      setLoadingCustomers(false);
    }
  }

  async function loadHistory(customer_id, nextRange, fiscal_year) {
    try {
      const actualRange = nextRange === "fy" && !fiscal_year ? "all" : nextRange;

      const res = await api.customers.history({
        customer_id,
        range: actualRange,
        fiscal_year,
      });

      if (!res?.ok) {
        showToast(res?.message || "Failed to load history", "error");
        setHistory({ sales: [], payments: [] });
        return;
      }

      setHistory({
        sales: Array.isArray(res.sales) ? res.sales : [],
        payments: Array.isArray(res.payments) ? res.payments : [],
      });
    } catch (e) {
      console.error(e);
      setHistory({ sales: [], payments: [] });
      showToast("Failed to load history", "error");
    }
  }

  async function refreshCustomer(customer_id, nextRange = range, preferredFY = "") {
    if (!customer_id) return;

    setLoadingAccount(true);
    try {
      const d = await api.customers.dueSummary(customer_id);
      if (!d?.ok) {
        showToast(d?.message || "Failed to load due", "error");
        return;
      }

      setDue(d);

      const resolvedFY =
        preferredFY !== undefined && preferredFY !== null
          ? preferredFY
          : d.years?.[0]?.fiscal_year || "";

      setFy(resolvedFY);
      setPayFY((prev) => prev || d.years?.[0]?.fiscal_year || fiscalYears[0] || "");
      setHistFY((prev) => prev || d.years?.[0]?.fiscal_year || fiscalYears[0] || "");

      await loadHistory(customer_id, nextRange, resolvedFY);
    } finally {
      setLoadingAccount(false);
    }
  }

  async function pickCustomer(c) {
    setSelected(c);
    setHistory({ sales: [], payments: [] });
    await refreshCustomer(c.id, range, fy || "");
  }

  useEffect(() => {
    loadCustomers();
    loadSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeSafe.store_id]);

  useEffect(() => {
    const t = setTimeout(() => {
      loadCustomers(q);
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  async function handleChangeFY(nextFY) {
    setFy(nextFY);
    if (!selected) return;
    const nextRange = nextFY ? "fy" : "all";
    setRange(nextRange);
    await loadHistory(selected.id, nextRange, nextFY);
  }

  async function handleChangeRange(nextRange) {
    setRange(nextRange);
    if (!selected) return;
    await loadHistory(selected.id, nextRange, fy);
  }

  function createFinancialYear() {
    const y = Number(newFYStartYear || 0);
    if (!y || y < 2000 || y > 3000) {
      showToast("Enter a valid start year", "warning");
      return;
    }

    const fyValue = `${y}-${y + 1}`;
    setCustomYears((prev) => Array.from(new Set([fyValue, ...prev])));
    setFy(fyValue);
    setPayFY((prev) => prev || fyValue);
    setHistFY(fyValue);
    showToast(`Financial year ${fyValue} created ✅`);
  }

  async function addPayment() {
    if (!me) return showToast("Login required", "error");
    if (!selected) return showToast("Select a customer", "warning");

    const amt = Number(payAmount || 0);
    if (amt <= 0) return showToast("Enter payment amount", "warning");
    if (!payFY) return showToast("Select financial year", "warning");

    setSavingPayment(true);
    try {
      const res = await api.customers.addPayment({
        customer_id: selected.id,
        amount: amt,
        fiscal_year: payFY,
        method: payMethod,
        note: payNote || `Payment for ${payFY}`,
      });

      if (!res?.ok) return showToast(res?.message || "Payment failed", "error");

      setPayAmount("");
      setPayNote("");

      await refreshCustomer(selected.id, range, fy);

      showToast("Payment saved ✅");
      setPostSavePromptOpen(true);
    } catch (e) {
      console.error(e);
      showToast("Payment failed", "error");
    } finally {
      setSavingPayment(false);
    }
  }

  async function addHistoricalSale() {
    if (!me) return showToast("Login required", "error");
    if (!selected) return showToast("Select a customer", "warning");
    if (!canImportHistorical) return showToast("Admin only", "warning");

    const amt = Number(histTotal || 0);
    if (amt <= 0) return showToast("Enter total", "warning");
    if (!histFY) return showToast("Select financial year", "warning");

    setSavingHistorical(true);
    try {
      const payload = {
        customer_id: selected.id,
        fiscal_year: histFY,
        total: amt,
        status: histStatus,
        note: `Historical sale (${histFY})`,
      };

      if (histDate?.trim()) {
        payload.created_at = histDate.trim().includes("T")
          ? histDate.trim().replace("T", " ")
          : histDate.trim();
      }

      const res = await api.sales.addHistorical(payload);

      if (!res?.ok) return showToast(res?.message || "Failed", "error");

      showToast("Historical sale added ✅");
      setHistTotal("");
      setHistDate("");

      await refreshCustomer(selected.id, range, fy);
    } catch (e) {
      console.error(e);
      showToast("Failed to add historical sale", "error");
    } finally {
      setSavingHistorical(false);
    }
  }

  async function fetchSalesWithItemsForStatement() {
    const rawSales = Array.isArray(history?.sales) ? history.sales : [];
    const salesWithItems = await Promise.all(
      rawSales.map(async (sale) => {
        try {
          const items = await api.sales.getItems(sale.id);
          return { ...sale, items: Array.isArray(items) ? items : [] };
        } catch {
          return { ...sale, items: [] };
        }
      })
    );

    return salesWithItems;
  }

  function normalizeDate(v) {
    if (!v) return "-";
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return String(v);
    return d.toLocaleString();
  }

  function getSortTs(v) {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return 0;
    return d.getTime();
  }

  function compactItemsText(items = []) {
    if (!items.length) return "No items";
    return items
      .map((it) => {
        const name = it.product_name || it.name || "Item";
        const qty = Number(it.quantity || 0);
        return `${name} (Qty: ${qty})`;
      })
      .join(", ");
  }

  function getBranchLabel() {
    return settings.store_name || storeSafe.store_name || "Store";
  }

  function getContactText() {
    return settings.contact || "";
  }

  function getPaidValueFromSale(sale) {
    const isRefund = (sale.sale_type || "sale") === "refund";
    const isCompleted = String(sale.status || "").toLowerCase() === "completed";
    if (isRefund) return "";
    if (isCompleted) return Number(sale.total || 0);
    return "";
  }

  function getSalePaymentLabel(sale) {
    const method = String(sale.payment_method || "").trim();
    if (!method) return "";
    if (method === "history") return "";
    return `Paid by ${method}`;
  }

  async function buildStatementHtml() {
    const customer = due?.customer || selected;
    const salesWithItems = await fetchSalesWithItemsForStatement();
    const payments = Array.isArray(history?.payments) ? history.payments : [];

    const statementLabel = fy ? fy : "All years up to today";
    const yearDue = fy ? Number(selectedYearRow?.due || 0) : Number(due?.overall_due || 0);

    const totalPurchased = salesWithItems
      .filter((s) => (s.sale_type || "sale") !== "refund")
      .reduce((a, s) => a + Number(s.total || 0), 0);

    const totalPaid =
      payments.reduce((a, p) => a + Number(p.amount || 0), 0) +
      salesWithItems
        .filter(
          (s) =>
            (s.sale_type || "sale") !== "refund" &&
            String(s.status || "").toLowerCase() === "completed"
        )
        .reduce((a, s) => a + Number(s.total || 0), 0);

    const statementRows = [];

    salesWithItems.forEach((sale) => {
      statementRows.push({
        sortTs: getSortTs(sale.created_at),
        date: normalizeDate(sale.created_at),
        particulars: compactItemsText(sale.items || []),
        note:
          getSalePaymentLabel(sale) ||
          (String(sale.status || "").toLowerCase() === "due" ? "Status: Due" : ""),
        debit: Number(sale.total || 0),
        credit: getPaidValueFromSale(sale),
        ref: `#${sale.id}`,
      });
    });

    payments.forEach((p) => {
      statementRows.push({
        sortTs: getSortTs(p.created_at),
        date: normalizeDate(p.created_at),
        particulars: `Payment received via ${p.method || "-"}`,
        note: p.fiscal_year ? `Financial year: ${p.fiscal_year}` : "",
        debit: "",
        credit: Number(p.amount || 0),
        ref: `#${p.id}`,
      });
    });

    statementRows.sort((a, b) => a.sortTs - b.sortTs);

    const contactHtml = escapeHtml(getContactText()).replace(/\n/g, "<br>");

    return `
      <html>
      <head>
        <meta charset="utf-8" />
        <title>Customer Statement</title>
        <style>
          @page {
            size: A4;
            margin: 16mm 12mm 16mm 12mm;
          }
          body {
            font-family: Arial, Helvetica, sans-serif;
            color: #111827;
            font-size: 11px;
            margin: 0;
            padding: 0;
          }
          .header {
            border-bottom: 2px solid #111827;
            padding-bottom: 8px;
            margin-bottom: 12px;
            display: flex;
            justify-content: space-between;
            gap: 12px;
          }
          .title {
            font-size: 24px;
            font-weight: 800;
            margin-bottom: 4px;
          }
          .muted {
            color: #6b7280;
            font-size: 11px;
            line-height: 1.4;
          }
          .customer-section {
            border: 1px solid #d1d5db;
            border-radius: 8px;
            padding: 10px 12px;
            margin-bottom: 12px;
          }
          .customer-name {
            font-size: 20px;
            font-weight: 700;
            margin-bottom: 2px;
          }
          .statement-table-wrap {
            border: 1px solid #111827;
            border-radius: 8px;
            overflow: hidden;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
          }
          thead th {
            background: #f3f4f6;
            border-bottom: 1px solid #d1d5db;
            padding: 8px 8px;
            font-size: 10px;
            text-align: left;
          }
          tbody td {
            border-bottom: 1px solid #e5e7eb;
            padding: 8px 8px;
            vertical-align: top;
            word-wrap: break-word;
            overflow-wrap: anywhere;
            line-height: 1.35;
          }
          tbody tr:last-child td {
            border-bottom: none;
          }
          .col-date { width: 18%; }
          .col-ref { width: 10%; }
          .col-particulars { width: 44%; }
          .col-debit { width: 14%; }
          .col-credit { width: 14%; }
          .right { text-align: right; white-space: nowrap; }
          .debit { color: #111827; }
          .credit { color: #065f46; font-weight: 700; }
          .subnote {
            color: #6b7280;
            font-size: 10px;
            margin-top: 3px;
          }
          .summary-wrap {
            margin-top: 14px;
            display: flex;
            justify-content: flex-start;
          }
          .summary-box {
            width: 340px;
            border: 2px solid #111827;
            border-radius: 8px;
            padding: 10px 12px;
          }
          .summary-title {
            font-size: 14px;
            font-weight: 800;
            margin-bottom: 8px;
          }
          .sum-row {
            display: flex;
            justify-content: space-between;
            gap: 10px;
            padding: 5px 0;
            border-bottom: 1px dashed #d1d5db;
          }
          .sum-row:last-child {
            border-bottom: none;
          }
          .footer {
            margin-top: 10px;
            color: #6b7280;
            font-size: 10px;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <div class="title">Customer Statement</div>
            <div class="muted">${escapeHtml(getBranchLabel())}</div>
            <div class="muted">Currency: ${escapeHtml(storeSafe.currency)}</div>
            <div class="muted">Statement period: ${escapeHtml(statementLabel)}</div>
            ${contactHtml ? `<div class="muted" style="margin-top:4px;">${contactHtml}</div>` : ""}
          </div>
          <div style="text-align:right;">
            <div class="muted"><b>Generated:</b> ${escapeHtml(new Date().toLocaleString())}</div>
          </div>
        </div>

        <div class="customer-section">
          <div class="customer-name">${escapeHtml(customer?.name || "")}</div>
          <div class="muted">
            ${escapeHtml(customer?.phone || "")}${customer?.email ? ` · ${escapeHtml(customer.email)}` : ""}
          </div>
          <div class="muted">${escapeHtml(customer?.address || "")}</div>
        </div>

        <div class="statement-table-wrap">
          <table>
            <thead>
              <tr>
                <th class="col-date">Date</th>
                <th class="col-ref">Ref</th>
                <th class="col-particulars">Particulars</th>
                <th class="col-debit right">Purchase</th>
                <th class="col-credit right">Paid</th>
              </tr>
            </thead>
            <tbody>
              ${
                statementRows.length
                  ? statementRows
                      .map(
                        (row) => `
                  <tr>
                    <td>${escapeHtml(row.date)}</td>
                    <td>${escapeHtml(row.ref)}</td>
                    <td>
                      ${escapeHtml(row.particulars)}
                      ${row.note ? `<div class="subnote">${escapeHtml(row.note)}</div>` : ""}
                    </td>
                    <td class="right debit">${row.debit === "" ? "" : fmt(row.debit)}</td>
                    <td class="right credit">${row.credit === "" ? "" : fmt(row.credit)}</td>
                  </tr>
                `
                      )
                      .join("")
                  : `
                  <tr>
                    <td colspan="5" style="text-align:center;padding:18px;color:#6b7280;">
                      No statement data found
                    </td>
                  </tr>
                `
              }
            </tbody>
          </table>
        </div>

        <div class="summary-wrap">
          <div class="summary-box">
            <div class="summary-title">Summary</div>
            <div class="sum-row">
              <div><b>Selected financial year due</b></div>
              <div><b>${fmt(yearDue)}</b></div>
            </div>
            <div class="sum-row">
              <div>Total purchased amount</div>
              <div>${fmt(totalPurchased)}</div>
            </div>
            <div class="sum-row">
              <div>Total paid</div>
              <div>${fmt(totalPaid)}</div>
            </div>
            <div class="sum-row">
              <div><b>Total due (all years)</b></div>
              <div><b>${fmt(due?.overall_due || 0)}</b></div>
            </div>
          </div>
        </div>

        <div class="footer">Generated by RetailPOS</div>
      </body>
      </html>
    `;
  }

  async function savePdf() {
    if (!selected) return showToast("Select customer", "warning");
    if (!api.receipt?.savePdf) return showToast("Save PDF not enabled", "error");

    const html = await buildStatementHtml();
    const safeName = String(selected.name || "customer").replace(/[^\w\-]+/g, "_");
    const fyLabel = fy ? fy : "all_years";
    const fileName = `statement-${safeName}-${fyLabel}.pdf`;

    const r = await api.receipt.savePdf({ html, fileName });
    if (!r?.ok) return showToast(r?.message || "Save failed", "error");

    showToast("Saved PDF ✅");
  }

  async function openEmailModal(defaultEmail = "") {
    if (!selected) return showToast("Select customer", "warning");
    if (!api.receipt?.sendEmail) return showToast("Email not enabled", "error");

    const html = await buildStatementHtml();
    const safeName = String(selected.name || "customer").replace(/[^\w\-]+/g, "_");
    const fyLabel = fy ? fy : "all_years";

    setEmailModal({
      open: true,
      to: defaultEmail || selected?.email || "",
      subject: `Customer statement - ${selected.name} - ${fy ? fy : "All years"}`,
      html,
      fileName: `statement-${safeName}-${fyLabel}.pdf`,
      sending: false,
    });
  }

  async function submitEmailModal() {
    if (!emailModal.to.trim()) {
      showToast("Enter email address", "warning");
      return;
    }

    setEmailModal((prev) => ({ ...prev, sending: true }));

    try {
      const res = await api.receipt.sendEmail({
        to: emailModal.to.trim(),
        subject: emailModal.subject,
        html: emailModal.html,
        fileName: emailModal.fileName,
      });

      if (!res?.ok) {
        showToast(res?.message || "Email failed", "error");
        setEmailModal((prev) => ({ ...prev, sending: false }));
        return;
      }

      showToast("Statement emailed ✅");
      setEmailModal({
        open: false,
        to: "",
        subject: "",
        html: "",
        fileName: "",
        sending: false,
      });
    } catch (e) {
      console.error(e);
      showToast("Email failed", "error");
      setEmailModal((prev) => ({ ...prev, sending: false }));
    }
  }

  async function printStatement() {
    if (!selected) return showToast("Select customer", "warning");

    const html = await buildStatementHtml();
    const printWindow = window.open("", "_blank", "width=1000,height=800");

    if (!printWindow) {
      showToast("Popup blocked. Allow popups and try again.", "error");
      return;
    }

    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();

    setTimeout(() => {
      printWindow.focus();
      printWindow.print();
    }, 400);
  }

  return (
    <>
      <div style={{ padding: 20, height: "100%", overflow: "auto" }}>
        <div style={{ maxWidth: 1320, margin: "0 auto" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-end",
              gap: 12,
            }}
          >
            <div>
              <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900, color: "var(--text)" }}>
                Customer Accounts
              </h1>
              <div style={{ marginTop: 6, color: "var(--text2)", fontSize: 13 }}>
                Track due, take payments by financial year, review history, save, email, and print statements.
              </div>
            </div>
            <div style={pill()}>
              {storeSafe.store_name}
              {isAdminOrSuper && storeSafe.store_id ? ` (${storeSafe.store_id})` : ""}
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "380px 1fr",
              gap: 14,
              marginTop: 14,
            }}
          >
            <div style={card()}>
              <div style={{ fontWeight: 900, color: "var(--text2)", marginBottom: 8 }}>
                Customers
              </div>

              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search customer..."
                style={input()}
              />

              <div
                style={{
                  marginTop: 10,
                  maxHeight: 620,
                  overflow: "auto",
                  border: "1px solid rgba(148,163,184,0.22)",
                  borderRadius: 12,
                  background: "rgba(255,255,255,0.03)",
                }}
              >
                {loadingCustomers && (
                  <div style={{ padding: 12, color: "var(--text2)" }}>Loading customers...</div>
                )}

                {!loadingCustomers &&
                  (customers || []).map((c) => (
                    <div
                      key={c.id}
                      onClick={() => pickCustomer(c)}
                      style={{
                        padding: 12,
                        cursor: "pointer",
                        borderBottom: "1px solid rgba(255,255,255,0.06)",
                        background:
                          selected?.id === c.id ? "rgba(108,99,255,0.16)" : "transparent",
                      }}
                    >
                      <div style={{ fontWeight: 900 }}>{c.name}</div>
                      <div style={{ color: "var(--text3)", fontSize: 12 }}>
                        {c.phone || ""}
                        {c.email ? ` · ${c.email}` : ""}
                      </div>
                    </div>
                  ))}

                {!loadingCustomers && customers.length === 0 && (
                  <div style={{ padding: 12, color: "var(--text2)" }}>No customers</div>
                )}
              </div>
            </div>

            <div style={card()}>
              {!selected || !due?.ok ? (
                <div style={{ color: "var(--text2)" }}>
                  Select a customer to view due and history.
                </div>
              ) : (
                <>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-end",
                      gap: 12,
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 20, fontWeight: 900 }}>{due.customer.name}</div>
                      <div style={{ color: "var(--text2)", fontSize: 13 }}>
                        {due.customer.phone || ""}
                        {due.customer.email ? ` · ${due.customer.email}` : ""}
                      </div>
                      <div style={{ color: "var(--text3)", fontSize: 12 }}>
                        {due.customer.address || ""}
                      </div>
                    </div>

                    <div style={{ textAlign: "right" }}>
                      <div style={{ color: "var(--text2)", fontSize: 12, fontWeight: 900 }}>
                        Total due
                      </div>
                      <div
                        style={{
                          fontSize: 24,
                          fontWeight: 900,
                          color: "var(--accent)",
                        }}
                      >
                        {fmt(due.overall_due)}
                      </div>
                    </div>
                  </div>

                  <div
                    style={{
                      marginTop: 12,
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr 1fr 1fr",
                      gap: 10,
                    }}
                  >
                    <div style={miniStat()}>
                      <div style={miniLabel()}>Selected FY</div>
                      <div style={miniValue()}>{fy || "All years"}</div>
                    </div>
                    <div style={miniStat()}>
                      <div style={miniLabel()}>Due for FY</div>
                      <div style={miniValue()}>
                        {fmt(fy ? selectedYearRow?.due || 0 : due?.overall_due || 0)}
                      </div>
                    </div>
                    <div style={miniStat()}>
                      <div style={miniLabel()}>Purchased in view</div>
                      <div style={miniValue()}>{fmt(totalPurchasedInView)}</div>
                    </div>
                    <div style={miniStat()}>
                      <div style={miniLabel()}>Paid in view</div>
                      <div style={miniValue()}>{fmt(totalPaidInView)}</div>
                    </div>
                  </div>

                  <div
                    style={{
                      marginTop: 14,
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 12,
                    }}
                  >
                    <div>
                      <div style={label()}>Select financial year</div>
                      <select
                        value={fy}
                        onChange={(e) => handleChangeFY(e.target.value)}
                        style={softSelect()}
                      >
                        <option value="">All years up to today</option>
                        {fiscalYears.map((y) => (
                          <option key={y} value={y}>
                            {y}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <div style={label()}>History range</div>
                      <select
                        value={range}
                        onChange={(e) => handleChangeRange(e.target.value)}
                        style={softSelect()}
                      >
                        <option value="today">Today</option>
                        <option value="7d">Last 7 days</option>
                        <option value="month">Last 30 days</option>
                        <option value="fy">Selected financial year</option>
                        <option value="all">All time</option>
                      </select>
                    </div>
                  </div>

                  <div
                    style={{
                      marginTop: 12,
                      display: "grid",
                      gridTemplateColumns: "220px 160px 160px",
                      gap: 10,
                      alignItems: "end",
                    }}
                  >
                    <div>
                      <div style={label()}>Create financial year</div>
                      <input
                        value={newFYStartYear}
                        onChange={(e) => setNewFYStartYear(e.target.value)}
                        style={input()}
                        placeholder="2027"
                      />
                    </div>
                    <button style={btnGhost()} onClick={createFinancialYear}>
                      Create financial year
                    </button>
                  </div>

                  <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <button style={btnPrimary()} onClick={savePdf}>
                      Save PDF
                    </button>
                    <button style={btnGhost()} onClick={() => openEmailModal(selected?.email || "")}>
                      Send PDF by email
                    </button>
                    <button style={btnGhost()} onClick={printStatement}>
                      Print statement
                    </button>
                    <button
                      style={btnGhost()}
                      onClick={() => refreshCustomer(selected.id, range, fy)}
                    >
                      {loadingAccount ? "Refreshing..." : "Refresh"}
                    </button>
                  </div>

                  <div
                    style={{
                      marginTop: 16,
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 14,
                    }}
                  >
                    <div style={subCard()}>
                      <div style={{ fontWeight: 900, marginBottom: 10 }}>Sales history</div>
                      <div style={tableWrap()}>
                        <table style={table()}>
                          <thead>
                            <tr>
                              <th style={th()}>Receipt</th>
                              <th style={th()}>Type</th>
                              <th style={th()}>Status</th>
                              <th style={thRight()}>Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {salesRows.length === 0 ? (
                              <tr>
                                <td colSpan={4} style={emptyTd()}>
                                  No sales in this range
                                </td>
                              </tr>
                            ) : (
                              salesRows.map((s) => (
                                <tr key={s.id}>
                                  <td style={td()}>#{s.id}</td>
                                  <td style={td()}>{s.sale_type || "sale"}</td>
                                  <td style={td()}>{s.status || "-"}</td>
                                  <td style={tdRight()}>{fmt(s.total)}</td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div style={subCard()}>
                      <div style={{ fontWeight: 900, marginBottom: 10 }}>
                        Manual payment history
                      </div>
                      <div style={tableWrap()}>
                        <table style={table()}>
                          <thead>
                            <tr>
                              <th style={th()}>ID</th>
                              <th style={th()}>FY</th>
                              <th style={th()}>Method</th>
                              <th style={thRight()}>Amount</th>
                            </tr>
                          </thead>
                          <tbody>
                            {paymentRows.length === 0 ? (
                              <tr>
                                <td colSpan={4} style={emptyTd()}>
                                  No manual payments in this range
                                </td>
                              </tr>
                            ) : (
                              paymentRows.map((p) => (
                                <tr key={p.id}>
                                  <td style={td()}>#{p.id}</td>
                                  <td style={td()}>{p.fiscal_year || "-"}</td>
                                  <td style={td()}>{p.method || "-"}</td>
                                  <td style={tdRight()}>{fmt(p.amount)}</td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>

                  <div
                    style={{
                      marginTop: 16,
                      borderTop: "1px solid rgba(148,163,184,0.18)",
                      paddingTop: 14,
                    }}
                  >
                    <div style={{ fontWeight: 900, marginBottom: 8 }}>Add payment</div>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr 1fr",
                        gap: 10,
                      }}
                    >
                      <div>
                        <div style={label()}>Amount</div>
                        <input
                          value={payAmount}
                          onChange={(e) => setPayAmount(e.target.value)}
                          style={input()}
                          placeholder="0"
                        />
                      </div>

                      <div>
                        <div style={label()}>Financial year</div>
                        <select
                          value={payFY}
                          onChange={(e) => setPayFY(e.target.value)}
                          style={softSelect()}
                        >
                          {fiscalYears.map((y) => (
                            <option key={y} value={y}>
                              {y}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <div style={label()}>Method</div>
                        <select
                          value={payMethod}
                          onChange={(e) => setPayMethod(e.target.value)}
                          style={softSelect()}
                        >
                          <option value="cash">Cash</option>
                          <option value="card">Card</option>
                          <option value="bkash">bKash</option>
                          <option value="nagad">Nagad</option>
                          <option value="cheque">Cheque</option>
                          <option value="bank">Bank</option>
                        </select>
                      </div>
                    </div>

                    <div style={{ marginTop: 10 }}>
                      <div style={label()}>Note</div>
                      <input
                        value={payNote}
                        onChange={(e) => setPayNote(e.target.value)}
                        style={input()}
                        placeholder="Payment note..."
                      />
                    </div>

                    <div
                      style={{
                        marginTop: 10,
                        display: "flex",
                        gap: 10,
                        flexWrap: "wrap",
                      }}
                    >
                      <button
                        style={btnPrimary(savingPayment)}
                        onClick={addPayment}
                        disabled={savingPayment}
                      >
                        {savingPayment ? "Saving..." : "Save payment"}
                      </button>
                      <button
                        style={btnGhost()}
                        onClick={() => openEmailModal(selected?.email || "")}
                      >
                        Send statement by email
                      </button>
                    </div>

                    <div style={{ marginTop: 6, color: "var(--text3)", fontSize: 12 }}>
                      After saving a payment, you will be asked whether you want to send the
                      email statement.
                    </div>
                  </div>

                  <div
                    style={{
                      marginTop: 16,
                      borderTop: "1px solid rgba(148,163,184,0.18)",
                      paddingTop: 14,
                    }}
                  >
                    <div style={{ fontWeight: 900, marginBottom: 8 }}>
                      Add previous-year sales (admin)
                    </div>

                    {!canImportHistorical && (
                      <div style={{ marginBottom: 10, color: "var(--text3)", fontSize: 12 }}>
                        Login as admin or superadmin to import historical sales.
                      </div>
                    )}

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr 1fr 1.2fr 1.2fr",
                        gap: 10,
                      }}
                    >
                      <div>
                        <div style={label()}>Financial year</div>
                        <select
                          value={histFY}
                          onChange={(e) => setHistFY(e.target.value)}
                          style={softSelect()}
                        >
                          {fiscalYears.map((y) => (
                            <option key={y} value={y}>
                              {y}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <div style={label()}>Total</div>
                        <input
                          value={histTotal}
                          onChange={(e) => setHistTotal(e.target.value)}
                          style={input()}
                          placeholder="0"
                        />
                      </div>

                      <div>
                        <div style={label()}>Status</div>
                        <select
                          value={histStatus}
                          onChange={(e) => setHistStatus(e.target.value)}
                          style={softSelect()}
                        >
                          <option value="due">Due (credit)</option>
                          <option value="completed">Completed</option>
                        </select>
                      </div>

                      <div>
                        <div style={label()}>Date from calendar</div>
                        <input
                          type="datetime-local"
                          value={toDateTimeLocalValue(histDate)}
                          onChange={(e) => setHistDate(fromDateTimeLocalValue(e.target.value))}
                          style={input()}
                        />
                      </div>

                      <div>
                        <div style={label()}>Or type manually</div>
                        <input
                          value={histDate}
                          onChange={(e) => setHistDate(e.target.value)}
                          style={input()}
                          placeholder="YYYY-MM-DD HH:MM:SS"
                        />
                      </div>
                    </div>

                    <div style={{ marginTop: 10 }}>
                      <button
                        style={btnGhost(savingHistorical || !canImportHistorical)}
                        onClick={addHistoricalSale}
                        disabled={savingHistorical || !canImportHistorical}
                      >
                        {savingHistorical ? "Saving..." : "Add historical sale"}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {postSavePromptOpen && (
        <ModalShell onClose={() => setPostSavePromptOpen(false)}>
          <div style={{ fontSize: 20, fontWeight: 900, marginBottom: 8, color: "var(--text)" }}>
            Payment saved
          </div>
          <div style={{ color: "var(--text2)", lineHeight: 1.5 }}>
            Do you want to send the updated statement by email now?
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 18, justifyContent: "flex-end" }}>
            <button style={btnGhost()} onClick={() => setPostSavePromptOpen(false)}>
              Not now
            </button>
            <button
              style={btnPrimary()}
              onClick={async () => {
                setPostSavePromptOpen(false);
                await openEmailModal(selected?.email || "");
              }}
            >
              Yes, send email
            </button>
          </div>
        </ModalShell>
      )}

      {emailModal.open && (
        <ModalShell
          onClose={() =>
            setEmailModal({
              open: false,
              to: "",
              subject: "",
              html: "",
              fileName: "",
              sending: false,
            })
          }
        >
          <div style={{ fontSize: 20, fontWeight: 900, marginBottom: 8, color: "var(--text)" }}>
            Send statement by email
          </div>

          <div style={{ marginBottom: 10 }}>
            <div style={label()}>Email address</div>
            <input
              value={emailModal.to}
              onChange={(e) =>
                setEmailModal((prev) => ({ ...prev, to: e.target.value }))
              }
              style={input()}
              placeholder="customer@email.com"
            />
          </div>

          <div style={{ marginBottom: 10 }}>
            <div style={label()}>Subject</div>
            <input
              value={emailModal.subject}
              onChange={(e) =>
                setEmailModal((prev) => ({ ...prev, subject: e.target.value }))
              }
              style={input()}
            />
          </div>

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18 }}>
            <button
              style={btnGhost()}
              onClick={() =>
                setEmailModal({
                  open: false,
                  to: "",
                  subject: "",
                  html: "",
                  fileName: "",
                  sending: false,
                })
              }
            >
              Cancel
            </button>
            <button
              style={btnPrimary(emailModal.sending)}
              disabled={emailModal.sending}
              onClick={submitEmailModal}
            >
              {emailModal.sending ? "Sending..." : "Send email"}
            </button>
          </div>
        </ModalShell>
      )}
    </>
  );
}

function ModalShell({ children, onClose }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 460,
          background: "rgba(15,18,28,0.98)",
          border: "1px solid rgba(148,163,184,0.18)",
          borderRadius: 18,
          padding: 18,
          boxShadow: "0 20px 50px rgba(0,0,0,0.35)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

function toDateTimeLocalValue(v) {
  if (!v) return "";
  const normalized = String(v).replace(" ", "T");
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function fromDateTimeLocalValue(v) {
  if (!v) return "";
  return v.replace("T", " ") + ":00";
}

function escapeHtml(v) {
  return String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function card() {
  return {
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(148,163,184,0.16)",
    borderRadius: 16,
    padding: 14,
    boxShadow: "var(--shadow)",
  };
}

function subCard() {
  return {
    background: "rgba(255,255,255,0.03)",
    border: "1px solid rgba(148,163,184,0.14)",
    borderRadius: 14,
    padding: 12,
  };
}

function miniStat() {
  return {
    background: "rgba(255,255,255,0.03)",
    border: "1px solid rgba(148,163,184,0.14)",
    borderRadius: 14,
    padding: 12,
  };
}

function miniLabel() {
  return {
    fontSize: 12,
    color: "var(--text2)",
    fontWeight: 900,
    marginBottom: 6,
  };
}

function miniValue() {
  return {
    fontSize: 18,
    fontWeight: 900,
    color: "var(--text)",
  };
}

function pill() {
  return {
    display: "inline-block",
    padding: "6px 10px",
    borderRadius: 999,
    fontSize: 12,
    border: "1px solid rgba(148,163,184,0.16)",
    color: "var(--text2)",
    background: "rgba(255,255,255,0.04)",
    fontWeight: 900,
  };
}

function label() {
  return {
    fontSize: 12,
    color: "var(--text2)",
    marginBottom: 6,
    fontWeight: 900,
  };
}

function input() {
  return {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(148,163,184,0.18)",
    background: "rgba(10,14,24,0.75)",
    color: "var(--text)",
    outline: "none",
    fontWeight: 700,
  };
}

function softSelect() {
  return {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(148,163,184,0.18)",
    background: "rgba(10,14,24,0.9)",
    color: "#f8fafc",
    outline: "none",
    fontWeight: 700,
    boxShadow: "0 0 0 1px rgba(255,255,255,0.02) inset",
  };
}

function btnPrimary(disabled = false) {
  return {
    padding: "10px 14px",
    borderRadius: 12,
    border: "1px solid rgba(108,99,255,0.6)",
    background: "rgba(108,99,255,0.18)",
    color: "var(--accent)",
    cursor: disabled ? "not-allowed" : "pointer",
    fontWeight: 900,
    opacity: disabled ? 0.6 : 1,
  };
}

function btnGhost(disabled = false) {
  return {
    padding: "10px 14px",
    borderRadius: 12,
    border: "1px solid rgba(148,163,184,0.18)",
    background: "rgba(255,255,255,0.03)",
    color: "var(--text)",
    cursor: disabled ? "not-allowed" : "pointer",
    fontWeight: 800,
    opacity: disabled ? 0.6 : 1,
  };
}

function tableWrap() {
  return {
    border: "1px solid rgba(148,163,184,0.14)",
    borderRadius: 12,
    overflow: "hidden",
    maxHeight: 360,
    overflowY: "auto",
    background: "rgba(255,255,255,0.02)",
  };
}

function table() {
  return {
    width: "100%",
    borderCollapse: "collapse",
  };
}

function th() {
  return {
    textAlign: "left",
    padding: "10px 12px",
    fontSize: 12,
    color: "#cbd5e1",
    background: "rgba(255,255,255,0.05)",
    borderBottom: "1px solid rgba(148,163,184,0.14)",
  };
}

function thRight() {
  return { ...th(), textAlign: "right" };
}

function td() {
  return {
    padding: "10px 12px",
    fontSize: 13,
    borderBottom: "1px solid rgba(255,255,255,0.06)",
  };
}

function tdRight() {
  return { ...td(), textAlign: "right", fontWeight: 900 };
}

function emptyTd() {
  return {
    padding: "14px 12px",
    fontSize: 13,
    color: "var(--text2)",
    textAlign: "center",
  };
}