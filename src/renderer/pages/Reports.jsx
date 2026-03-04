import { useState, useEffect } from 'react';
import { usePOS } from '../App';

const fmt = (n) => `$${(Number(n) || 0).toFixed(2)}`;

export default function Reports() {
  const { api } = usePOS();
  const [period, setPeriod] = useState('week');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api.reports.summary({ period }).then(d => { setData(d); setLoading(false); });
  };
  useEffect(() => { load(); }, [period]);

  const periods = [
    { id: 'today', label: 'Today' },
    { id: 'week', label: '7 Days' },
    { id: 'month', label: '30 Days' },
    { id: 'year', label: 'Year' },
  ];

  if (loading) return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 32, animation: 'spin 1s linear infinite', display: 'inline-block', marginBottom: 12 }}>⚙️</div>
        <div>Loading reports...</div>
      </div>
    </div>
  );

  const s = data?.summary || {};
  const maxRevenue = Math.max(...(data?.byDay?.map(d => d.revenue) || [1]));

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '20px 24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700 }}>📊 Reports & Analytics</h1>
        <div style={{ display: 'flex', gap: 6 }}>
          {periods.map(p => (
            <button key={p.id} onClick={() => setPeriod(p.id)} style={{
              padding: '7px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600,
              background: period === p.id ? 'var(--accent)' : 'var(--surface)',
              color: period === p.id ? 'white' : 'var(--text2)',
              border: `1px solid ${period === p.id ? 'transparent' : 'var(--border)'}`,
            }}>{p.label}</button>
          ))}
        </div>
      </div>

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 24 }}>
        {[
          { label: 'Revenue', value: fmt(s.revenue || 0), icon: '💰', color: 'var(--accent2)', sub: `${s.transactions || 0} transactions` },
          { label: 'Tax Collected', value: fmt(s.tax_collected || 0), icon: '🏛️', color: '#60a5fa', sub: `${((s.tax_collected / s.revenue) * 100 || 0).toFixed(1)}% of revenue` },
          { label: 'Avg. Sale', value: fmt(s.avg_sale || 0), icon: '📈', color: 'var(--accent)', sub: 'per transaction' },
          { label: 'Transactions', value: (s.transactions || 0).toLocaleString(), icon: '🧾', color: '#f59e0b', sub: 'completed sales' },
        ].map(k => (
          <div key={k.label} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 20, position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: 12, right: 16, fontSize: 28, opacity: 0.2 }}>{k.icon}</div>
            <div style={{ color: 'var(--text3)', fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>{k.label}</div>
            <div className="mono" style={{ fontSize: 24, fontWeight: 700, color: k.color, marginBottom: 4 }}>{k.value}</div>
            <div style={{ color: 'var(--text3)', fontSize: 12 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, marginBottom: 16 }}>
        {/* Revenue Chart */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 20 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 20, color: 'var(--text2)' }}>Revenue by Day</h3>
          {data?.byDay?.length > 0 ? (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 160 }}>
              {data.byDay.map((d, i) => {
                const h = Math.max(4, (d.revenue / maxRevenue) * 140);
                return (
                  <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                    <div style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 700 }}>{fmt(d.revenue).replace('$','')}</div>
                    <div style={{ width: '100%', height: h, background: 'linear-gradient(180deg, var(--accent) 0%, rgba(108,99,255,0.3) 100%)', borderRadius: '4px 4px 0 0', position: 'relative', cursor: 'pointer', transition: 'opacity 0.15s' }}
                      title={`${d.day}: ${fmt(d.revenue)} (${d.transactions} sales)`}
                    />
                    <div style={{ fontSize: 9, color: 'var(--text3)', textAlign: 'center' }}>
                      {new Date(d.day + 'T00:00:00').toLocaleDateString([], { month: 'short', day: 'numeric' })}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)' }}>No sales data for this period</div>
          )}
        </div>

        {/* Top Products */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 20 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16, color: 'var(--text2)' }}>Top Products</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {data?.topProducts?.length > 0 ? data.topProducts.map((p, i) => {
              const maxRev = data.topProducts[0]?.revenue || 1;
              return (
                <div key={i}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
                      <span style={{ color: 'var(--text3)', marginRight: 6 }}>#{i + 1}</span>
                      {p.product_name}
                    </span>
                    <span className="mono" style={{ fontSize: 11, color: 'var(--accent2)' }}>{fmt(p.revenue)}</span>
                  </div>
                  <div style={{ height: 4, background: 'var(--surface2)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${(p.revenue / maxRev) * 100}%`, background: `hsl(${240 - i * 30}, 70%, 60%)`, borderRadius: 2 }} />
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{p.qty_sold} units sold</div>
                </div>
              );
            }) : <div style={{ color: 'var(--text3)', fontSize: 13 }}>No sales in this period</div>}
          </div>
        </div>
      </div>

      {/* Low Stock Alert */}
      {data?.lowStock?.length > 0 && (
        <div style={{ background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.25)', borderRadius: 14, padding: 20 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--danger)', marginBottom: 14 }}>⚠️ Low Stock Alerts ({data.lowStock.length})</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
            {data.lowStock.map(p => (
              <div key={p.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px' }}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{p.name}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ color: 'var(--text3)' }}>Stock</span>
                  <span style={{ color: p.stock === 0 ? 'var(--danger)' : 'var(--accent3)', fontWeight: 700 }}>{p.stock} / min {p.low_stock_threshold}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
