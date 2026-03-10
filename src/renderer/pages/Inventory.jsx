import { useState, useEffect } from 'react';
import { usePOS } from '../App';
function Modal({ open, title, children, onClose }) {
  if (!open) return null;
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
      }}
      onMouseDown={onClose}
    >
      <div
        style={{
          width: 520,
          maxWidth: "92vw",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 16,
          padding: 16,
          boxShadow: "var(--shadow)",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <div style={{ fontWeight: 900, fontSize: 16 }}>{title}</div>
          <button
            onClick={onClose}
            style={{
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--text2)",
              fontWeight: 900,
              borderRadius: 10,
              padding: "6px 10px",
              cursor: "pointer",
            }}
          >
            Close
          </button>
        </div>
        <div style={{ marginTop: 12 }}>{children}</div>
      </div>
    </div>
  );
}

const fmt = (n) => `$${(Number(n) || 0).toFixed(2)}`;

export default function Inventory() {
  const { api, showToast } = usePOS();
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('name');
  const [filterLow, setFilterLow] = useState(false);
  const [adjustModal, setAdjustModal] = useState(null);
  const [adjQty, setAdjQty] = useState('');
  const [adjNote, setAdjNote] = useState('');

  const load = () => {
    api.products.getAll().then(setProducts);
    api.categories.getAll().then(setCategories);
  };
  useEffect(() => { load(); }, []);

  const catColors = Object.fromEntries(categories.map(c => [c.name, c.color]));

  let filtered = products.filter(p => {
    const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase()) || (p.sku || '').includes(search);
    const matchLow = !filterLow || p.stock <= p.low_stock_threshold;
    return matchSearch && matchLow;
  });

  filtered = [...filtered].sort((a, b) => {
    if (sortBy === 'name') return a.name.localeCompare(b.name);
    if (sortBy === 'stock_asc') return a.stock - b.stock;
    if (sortBy === 'stock_desc') return b.stock - a.stock;
    if (sortBy === 'value') return (b.stock * b.cost) - (a.stock * a.cost);
    return 0;
  });

  const totalValue = products.reduce((s, p) => s + p.stock * p.cost, 0);
  const totalItems = products.reduce((s, p) => s + p.stock, 0);
  const lowStockCount = products.filter(p => p.stock <= p.low_stock_threshold).length;
  const outOfStock = products.filter(p => p.stock === 0).length;

  const handleAdjust = async () => {
    const qty = parseInt(adjQty);
    if (isNaN(qty)) { showToast('Enter a valid quantity', 'error'); return; }
    const newStock = Math.max(0, adjustModal.stock + qty);
    try {
      await api.products.update({ ...adjustModal, stock: newStock });
      showToast(`Stock ${qty >= 0 ? 'added' : 'removed'}: ${Math.abs(qty)} units`);
      setAdjustModal(null);
      setAdjQty('');
      setAdjNote('');
      load();
    } catch (e) { showToast('Failed to adjust stock', 'error'); }
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)' }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>🗃️ Inventory</h1>

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
          {[
            { label: 'Total SKUs', value: products.length, icon: '📦', color: 'var(--accent)' },
            { label: 'Total Units', value: totalItems.toLocaleString(), icon: '🔢', color: '#3b82f6' },
            { label: 'Inventory Value', value: fmt(totalValue), icon: '💰', color: 'var(--accent2)' },
            { label: 'Low Stock', value: lowStockCount, icon: '⚠️', color: lowStockCount > 0 ? 'var(--danger)' : 'var(--text2)' },
          ].map(s => (
            <div key={s.label} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px' }}>
              <div style={{ color: 'var(--text3)', fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>{s.icon} {s.label}</div>
              <div className="mono" style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Controls */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search inventory..."
            style={{ flex: 1, padding: '8px 12px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', fontSize: 13 }} />
          <select value={sortBy} onChange={e => setSortBy(e.target.value)}
            style={{ padding: '8px 12px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', fontSize: 13 }}>
            <option value="name">Sort: Name</option>
            <option value="stock_asc">Stock: Low → High</option>
            <option value="stock_desc">Stock: High → Low</option>
            <option value="value">Value: High → Low</option>
          </select>
          <button onClick={() => setFilterLow(!filterLow)} style={{
            padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
            background: filterLow ? 'rgba(244,63,94,0.15)' : 'var(--surface2)',
            color: filterLow ? 'var(--danger)' : 'var(--text2)',
            border: `1px solid ${filterLow ? 'var(--danger)' : 'var(--border)'}`,
          }}>⚠️ Low Stock Only</button>
        </div>
      </div>

      {/* Inventory Table */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 24px' }}>
        <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: '0 4px' }}>
          <thead>
            <tr style={{ color: 'var(--text3)', fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              <th style={{ padding: '6px 12px', textAlign: 'left' }}>Product</th>
              <th style={{ padding: '6px 12px', textAlign: 'left' }}>SKU</th>
              <th style={{ padding: '6px 12px', textAlign: 'right' }}>Cost</th>
              <th style={{ padding: '6px 12px', textAlign: 'right' }}>Stock</th>
              <th style={{ padding: '6px 12px', textAlign: 'right' }}>Min</th>
              <th style={{ padding: '6px 12px', textAlign: 'right' }}>Inv. Value</th>
              <th style={{ padding: '6px 12px', textAlign: 'center' }}>Status</th>
              <th style={{ padding: '6px 12px', textAlign: 'right' }}>Adjust</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(p => {
              const lowStock = p.stock <= p.low_stock_threshold;
              const value = p.stock * p.cost;
              const pct = Math.min(100, (p.stock / (p.low_stock_threshold * 3)) * 100);
              return (
                <tr key={p.id} style={{ background: 'var(--surface)', animation: 'slideIn 0.2s ease' }}>
                  <td style={{ padding: '12px', borderRadius: '10px 0 0 10px', fontWeight: 600, fontSize: 13 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: p.stock === 0 ? 'var(--danger)' : lowStock ? 'var(--accent3)' : 'var(--accent2)', flexShrink: 0 }} />
                      {p.name}
                    </div>
                    {/* Stock bar */}
                    <div style={{ height: 3, background: 'var(--surface3)', borderRadius: 2, marginTop: 6, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: p.stock === 0 ? 'var(--danger)' : lowStock ? 'var(--accent3)' : 'var(--accent2)', borderRadius: 2, transition: 'width 0.5s ease' }} />
                    </div>
                  </td>
                  <td style={{ padding: '12px', color: 'var(--text3)', fontSize: 11 }} className="mono">{p.sku || '—'}</td>
                  <td style={{ padding: '12px', textAlign: 'right', color: 'var(--text2)' }} className="mono">{fmt(p.cost)}</td>
                  <td style={{ padding: '12px', textAlign: 'right', fontWeight: 700, fontSize: 15 }} className="mono">
                    <span style={{ color: p.stock === 0 ? 'var(--danger)' : lowStock ? 'var(--accent3)' : 'var(--text)' }}>{p.stock}</span>
                  </td>
                  <td style={{ padding: '12px', textAlign: 'right', color: 'var(--text3)', fontSize: 12 }}>{p.low_stock_threshold}</td>
                  <td style={{ padding: '12px', textAlign: 'right', fontWeight: 600 }} className="mono">{fmt(value)}</td>
                  <td style={{ padding: '12px', textAlign: 'center' }}>
                    <span style={{
                      padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                      background: p.stock === 0 ? 'rgba(244,63,94,0.2)' : lowStock ? 'rgba(245,158,11,0.15)' : 'rgba(74,222,128,0.1)',
                      color: p.stock === 0 ? 'var(--danger)' : lowStock ? 'var(--accent3)' : 'var(--accent2)',
                    }}>
                      {p.stock === 0 ? 'Out of Stock' : lowStock ? 'Low Stock' : 'In Stock'}
                    </span>
                  </td>
                  <td style={{ padding: '12px', textAlign: 'right', borderRadius: '0 10px 10px 0' }}>
                    <button onClick={() => { setAdjustModal(p); setAdjQty(''); }} style={{ padding: '6px 12px', borderRadius: 6, background: 'var(--surface2)', color: 'var(--text2)', fontSize: 12 }}>
                      Adjust ±
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Adjust Modal */}
      {adjustModal && (
        <Modal title={`Adjust Stock: ${adjustModal.name}`} onClose={() => setAdjustModal(null)}>
          <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
            {[1, 5, 10, 25, 50, -1, -5, -10].map(n => (
              <button key={n} onClick={() => setAdjQty(String(n))} style={{
                padding: '6px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                background: n > 0 ? 'rgba(74,222,128,0.1)' : 'rgba(244,63,94,0.1)',
                color: n > 0 ? 'var(--accent2)' : 'var(--danger)',
                border: `1px solid ${n > 0 ? 'rgba(74,222,128,0.2)' : 'rgba(244,63,94,0.2)'}`,
              }}>{n > 0 ? '+' : ''}{n}</button>
            ))}
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--text3)', marginBottom: 6 }}>QUANTITY ADJUSTMENT (use negative to remove)</label>
            <input value={adjQty} onChange={e => setAdjQty(e.target.value)} placeholder="e.g. +10 or -5" type="number"
              style={{ width: '100%', padding: '10px 12px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', fontSize: 14 }} />
          </div>
          <div style={{ padding: '12px', background: 'var(--surface2)', borderRadius: 8, marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text2)' }}>Current: <strong>{adjustModal.stock}</strong></span>
            <span style={{ color: 'var(--text2)' }}>→ New: <strong style={{ color: 'var(--accent)' }}>{Math.max(0, adjustModal.stock + (parseInt(adjQty) || 0))}</strong></span>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => setAdjustModal(null)} style={{ flex: 1, padding: 12, borderRadius: 8, background: 'var(--surface2)', color: 'var(--text)', fontWeight: 600 }}>Cancel</button>
            <button onClick={handleAdjust} style={{ flex: 2, padding: 12, borderRadius: 8, background: 'var(--accent)', color: 'white', fontWeight: 600 }}>Apply Adjustment</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
