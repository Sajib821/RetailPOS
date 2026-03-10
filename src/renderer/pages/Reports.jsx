import { useEffect, useMemo, useState } from "react";
import { usePOS } from "../App";

const symMap = { BDT: "৳", USD: "$", GBP: "£", EUR: "€" };

export default function Reports() {
  const { api, showToast } = usePOS();
  const [period, setPeriod] = useState("week");
  const [currency, setCurrency] = useState("BDT");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const sym = symMap[currency] || "৳";
  const fmt = (n) => `${sym}${(Number(n) || 0).toFixed(2)}`;

  const load = async () => {
    setLoading(true);
    try {
      const s = await api.settings.getAll().catch(() => null);
      if (s?.currency) setCurrency(String(s.currency).trim());

      const d = await api.reports.summary(period);
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
  }, [period]);

  const periods = [
    { id: "today", label: "Today" },
    { id: "week", label: "7 Days" },
    { id: "month", label: "30 Days" },
    { id: "year", label: "Year" },
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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24, gap: 12 }}>
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
                  <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                    <div style={{ fontSize: 10, color: "var(--accent)", fontWeight: 700 }}>{fmt(dayRevenue).replace(sym, "")}</div>
                    <div
                      style={{
                        width: "100%",
                        height: h,
                        background: "linear-gradient(180deg, var(--accent) 0%, rgba(108,99,255,0.3) 100%)",
                        borderRadius: "4px 4px 0 0",
                        position: "relative",
                        cursor: "pointer",
                        transition: "opacity 0.15s",
                      }}
                      title={`${d.day}: ${fmt(dayRevenue)} (${Number(d.transactions || 0)} sales)`}
                    />
                    <div style={{ fontSize: 9, color: "var(--text3)", textAlign: "center" }}>
                      {new Date(`${d.day}T00:00:00`).toLocaleDateString([], { month: "short", day: "numeric" })}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ height: 160, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text3)" }}>No sales data for this period</div>
          )}
        </div>

        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 20 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16, color: "var(--text2)" }}>Top Products</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {topProducts.length > 0 ? (
              topProducts.map((p, i) => {
                const maxRev = Number(topProducts[0]?.revenue || 1);
                const revenueWidth = Math.max(0, (Number(p.revenue || 0) / maxRev) * 100);
                return (
                  <div key={`${p.product_name}-${i}`}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, gap: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>
                        <span style={{ color: "var(--text3)", marginRight: 6 }}>#{i + 1}</span>
                        {p.product_name}
                      </span>
                      <span className="mono" style={{ fontSize: 11, color: "var(--accent2)" }}>{fmt(p.revenue)}</span>
                    </div>
                    <div style={{ height: 4, background: "var(--surface2)", borderRadius: 2, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${revenueWidth}%`, background: "var(--accent)", borderRadius: 2 }} />
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>{Number(p.qty_sold || 0)} units sold</div>
                  </div>
                );
              })
            ) : (
              <div style={{ color: "var(--text3)", fontSize: 13 }}>No sales in this period</div>
            )}
          </div>
        </div>
      </div>

      {lowStock.length > 0 && (
        <div style={{ background: "rgba(244,63,94,0.08)", border: "1px solid rgba(244,63,94,0.25)", borderRadius: 14, padding: 20 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--danger)", marginBottom: 14 }}>⚠️ Low Stock Alerts ({lowStock.length})</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10 }}>
            {lowStock.map((p) => (
              <div key={p.id} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 14px" }}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{p.name}</div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                  <span style={{ color: "var(--text3)" }}>Stock</span>
                  <span style={{ color: Number(p.stock) === 0 ? "var(--danger)" : "var(--accent3)", fontWeight: 700 }}>
                    {Number(p.stock || 0)} / min {Number(p.low_stock_threshold || 0)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
