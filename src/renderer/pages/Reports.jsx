import { useEffect, useMemo, useState } from "react";
import { usePOS } from "../App";

const symMap = { BDT: "৳", USD: "$", GBP: "£", EUR: "€" };

function formatFyDate(value) {
  if (!value) return "";
  const d = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(value || "");
  return d.toLocaleDateString("en-GB");
}

export default function Reports() {
  const { api, showToast } = usePOS();
  const [period, setPeriod] = useState("week");
  const [currency, setCurrency] = useState("BDT");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fyRows, setFyRows] = useState([]);
  const [fy, setFy] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const sym = symMap[currency] || "৳";
  const fmt = (n) => `${sym}${(Number(n) || 0).toFixed(2)}`;

  const formatFyOptionLabel = (row) => {
    if (!row) return "";
    if (row.start_date && row.end_date) {
      return `${row.label} • ${formatFyDate(row.start_date)} - ${formatFyDate(row.end_date)}`;
    }
    return row.label;
  };

  const load = async () => {
    setLoading(true);
    try {
      const [s, years, d] = await Promise.all([
        api.settings.getAll().catch(() => null),
        api.fiscalYears?.list?.().catch(() => []),
        api.reports.summary({
          period,
          fiscal_year: fy,
          from_date: fromDate,
          to_date: toDate,
        }),
      ]);

      if (s?.currency) setCurrency(String(s.currency).trim());
      setFyRows(Array.isArray(years) ? years : []);
      setData(d || null);
    } catch (e) {
      console.error(e);
      showToast("Failed to load reports", "error");
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, fy, fromDate, toDate]);

  const periods = [
    { id: "today", label: "Today" },
    { id: "week", label: "7 Days" },
    { id: "month", label: "30 Days" },
    { id: "year", label: "Year" },
    { id: "custom", label: "Custom" },
  ];

  const summary = data?.summary || {};
  const transactions = Number(summary.transactions || 0);
  const revenue = Number(summary.revenue || 0);
  const refunds = Math.abs(Number(summary.refunds || 0));
  const grossProfit = Number(summary.gross_profit || 0);
  const avgSale = transactions > 0 ? revenue / transactions : 0;
  const byDay = data?.byDay || [];
  const topProducts = data?.topProducts || [];
  const lowStock = data?.lowStock || [];

  const maxRevenue = useMemo(() => {
    if (!byDay.length) return 1;
    return Math.max(...byDay.map((d) => Number(d.revenue || 0)), 1);
  }, [byDay]);

  if (loading) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text3)" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 32, animation: "spin 1s linear infinite", display: "inline-block", marginBottom: 12 }}>⚙️</div>
          <div>Loading reports...</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "20px 24px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, gap: 12 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700 }}>📊 Reports & Analytics</h1>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {periods.map((p) => (
            <button
              key={p.id}
              onClick={() => setPeriod(p.id)}
              style={{
                padding: "7px 16px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                background: period === p.id ? "var(--accent)" : "var(--surface)",
                color: period === p.id ? "white" : "var(--text2)",
                border: `1px solid ${period === p.id ? "transparent" : "var(--border)"}`,
                cursor: "pointer",
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.5fr 1fr 1fr auto",
          gap: 10,
          marginBottom: 20,
        }}
      >
        <div>
          <div style={{ color: "var(--text3)", fontSize: 12, marginBottom: 6, fontWeight: 700 }}>Financial year</div>
          <select
            value={fy}
            onChange={(e) => setFy(e.target.value)}
            style={{
              width: "100%",
              padding: "11px 14px",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              color: "var(--text)",
              fontSize: 13,
            }}
          >
            <option value="">All financial years</option>
            {fyRows.map((row) => (
              <option key={`${row.label}-${row.start_date || ""}`} value={row.label}>
                {formatFyOptionLabel(row)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <div style={{ color: "var(--text3)", fontSize: 12, marginBottom: 6, fontWeight: 700 }}>From date</div>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => {
              setFromDate(e.target.value);
              setPeriod("custom");
            }}
            style={{
              width: "100%",
              padding: "11px 14px",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              color: "var(--text)",
              fontSize: 13,
            }}
          />
        </div>

        <div>
          <div style={{ color: "var(--text3)", fontSize: 12, marginBottom: 6, fontWeight: 700 }}>To date</div>
          <input
            type="date"
            value={toDate}
            onChange={(e) => {
              setToDate(e.target.value);
              setPeriod("custom");
            }}
            style={{
              width: "100%",
              padding: "11px 14px",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              color: "var(--text)",
              fontSize: 13,
            }}
          />
        </div>

        <div style={{ display: "flex", alignItems: "end" }}>
          <button
            onClick={load}
            style={{
              padding: "11px 18px",
              borderRadius: 12,
              fontSize: 13,
              fontWeight: 700,
              background: "var(--surface)",
              color: "var(--text)",
              border: "1px solid var(--border)",
              cursor: "pointer",
            }}
          >
            Refresh
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 24 }}>
        {[
          { label: "Revenue", value: fmt(revenue), icon: "💰", color: "var(--accent2)", sub: `${transactions} transactions` },
          { label: "Refunds", value: fmt(refunds), icon: "↩️", color: "#60a5fa", sub: "absolute refund total" },
          { label: "Gross Profit", value: fmt(grossProfit), icon: "📈", color: "var(--accent)", sub: "sales minus cost" },
          { label: "Avg. Sale", value: fmt(avgSale), icon: "🧾", color: "#f59e0b", sub: "per transaction" },
        ].map((k) => (
          <div key={k.label} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 20, position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", top: 12, right: 16, fontSize: 28, opacity: 0.2 }}>{k.icon}</div>
            <div style={{ color: "var(--text3)", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 8 }}>{k.label}</div>
            <div className="mono" style={{ fontSize: 24, fontWeight: 700, color: k.color, marginBottom: 4 }}>{k.value}</div>
            <div style={{ color: "var(--text3)", fontSize: 12 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16, marginBottom: 16 }}>
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 20 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 20, color: "var(--text2)" }}>Revenue by Day</h3>
          {byDay.length > 0 ? (
            <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 160 }}>
              {byDay.map((d, i) => {
                const dayRevenue = Number(d.revenue || 0);
                const h = Math.max(4, (dayRevenue / maxRevenue) * 140);
                return (
                  <div key={`${d.day}-${i}`} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%" }}>
                    <div className="mono" style={{ marginBottom: 6, fontSize: 10, color: "var(--accent)", fontWeight: 700 }}>{dayRevenue.toFixed(2)}</div>
                    <div
                      style={{
                        width: "100%",
                        maxWidth: 120,
                        height: h,
                        borderRadius: "6px 6px 0 0",
                        background: "linear-gradient(180deg, #6d5efc 0%, rgba(109,94,252,0.35) 100%)",
                        border: "1px solid rgba(109,94,252,0.35)",
                      }}
                    />
                    <div style={{ marginTop: 8, fontSize: 11, color: "var(--text3)" }}>{d.day}</div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ color: "var(--text3)", fontSize: 13 }}>No sales found for this selection.</div>
          )}
        </div>

        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 20 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16, color: "var(--text2)" }}>Top Products</h3>
          {topProducts.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {topProducts.map((p, i) => {
                const maxTopRevenue = Math.max(...topProducts.map((x) => Number(x.revenue || 0)), 1);
                const width = `${Math.max(10, (Number(p.revenue || 0) / maxTopRevenue) * 100)}%`;
                return (
                  <div key={`${p.product_name}-${i}`}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
                      <div style={{ fontWeight: 700 }}>#{i + 1} {p.product_name}</div>
                      <div className="mono" style={{ color: "var(--accent2)", fontWeight: 700 }}>{fmt(p.revenue)}</div>
                    </div>
                    <div style={{ height: 4, borderRadius: 999, background: "rgba(148,163,184,0.12)", overflow: "hidden" }}>
                      <div style={{ width, height: "100%", background: "var(--accent)", borderRadius: 999 }} />
                    </div>
                    <div style={{ marginTop: 6, fontSize: 12, color: "var(--text3)" }}>{Number(p.qty_sold || 0)} units sold</div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ color: "var(--text3)", fontSize: 13 }}>No product data in this range.</div>
          )}
        </div>
      </div>

      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 20 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16, color: "var(--text2)" }}>Low Stock</h3>
        {lowStock.length > 0 ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
            {lowStock.map((p) => (
              <div key={p.id} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, background: "var(--surface2)" }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>{p.name}</div>
                <div style={{ fontSize: 12, color: "var(--text3)" }}>Stock: {Number(p.stock || 0)} / Min: {Number(p.low_stock_threshold || 0)}</div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ color: "var(--text3)", fontSize: 13 }}>No low-stock products right now.</div>
        )}
      </div>
    </div>
  );
}
