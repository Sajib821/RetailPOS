import { useState, useEffect, useRef } from 'react';
import { usePOS } from '../App';

const fmt = (n) => `$${(Number(n) || 0).toFixed(2)}`;

export default function Checkout() {
  const { api, showToast } = usePOS();
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [cart, setCart] = useState([]);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('All');
  const [payMethod, setPayMethod] = useState('cash');
  const [discount, setDiscount] = useState('');
  const [cashGiven, setCashGiven] = useState('');
  const [showReceipt, setShowReceipt] = useState(false);
  const [lastSale, setLastSale] = useState(null);
  const [taxRate, setTaxRate] = useState(0.08);
  const searchRef = useRef();

  useEffect(() => {
    api.products.getAll().then(setProducts);
    api.categories.getAll().then(setCategories);
    api.settings.getAll().then(s => { if (s?.tax_rate) setTaxRate(parseFloat(s.tax_rate)); });
    searchRef.current?.focus();
  }, []);

  const filtered = products.filter(p => {
    const matchCat = catFilter === 'All' || p.category === catFilter;
    const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase()) || (p.sku || '').includes(search);
    return matchCat && matchSearch && p.stock > 0;
  });

  const addToCart = (product) => {
    setCart(prev => {
      const existing = prev.find(i => i.id === product.id);
      if (existing) {
        if (existing.qty >= product.stock) { showToast(`Only ${product.stock} in stock`, 'warning'); return prev; }
        return prev.map(i => i.id === product.id ? { ...i, qty: i.qty + 1 } : i);
      }
      return [...prev, { ...product, qty: 1 }];
    });
  };

  const updateQty = (id, qty) => {
    if (qty <= 0) { removeItem(id); return; }
    setCart(prev => prev.map(i => i.id === id ? { ...i, qty: Math.min(qty, i.stock) } : i));
  };

  const removeItem = (id) => setCart(prev => prev.filter(i => i.id !== id));

  const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const discountAmt = discount ? (discount.includes('%') ? subtotal * parseFloat(discount) / 100 : parseFloat(discount)) : 0;
  const taxable = subtotal - discountAmt;
  const tax = taxable * taxRate;
  const total = taxable + tax;
  const change = cashGiven ? parseFloat(cashGiven) - total : 0;

  const handleCharge = async () => {
    if (!cart.length) { showToast('Cart is empty', 'warning'); return; }
    const sale = { total, subtotal, tax, discount: discountAmt, payment_method: payMethod, note: '' };
    const items = cart.map(i => ({ product_id: i.id, product_name: i.name, quantity: i.qty, price: i.price, subtotal: i.price * i.qty }));
    try {
      const saleId = await api.sales.create({ sale, items });
      setLastSale({ id: saleId, ...sale, items, date: new Date() });
      setShowReceipt(true);
      setCart([]);
      setDiscount('');
      setCashGiven('');
      api.products.getAll().then(setProducts);
      showToast('Sale completed!');
    } catch (e) {
      showToast('Failed to process sale', 'error');
    }
  };

  const catColors = Object.fromEntries(categories.map(c => [c.name, c.color]));

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Products Panel */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 20, gap: 12 }}>
        {/* Header */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text3)', fontSize: 16 }}>🔍</span>
            <input ref={searchRef} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search products or scan barcode..."
              style={{
                width: '100%', padding: '10px 12px 10px 38px', background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: 14,
              }} />
          </div>
        </div>

        {/* Category Filter */}
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
          {['All', ...categories.map(c => c.name)].map(cat => (
            <button key={cat} onClick={() => setCatFilter(cat)} style={{
              padding: '6px 14px', borderRadius: 20, fontSize: 13, fontWeight: 500, flexShrink: 0,
              background: catFilter === cat ? (catColors[cat] || 'var(--accent)') : 'var(--surface)',
              color: catFilter === cat ? 'white' : 'var(--text2)',
              border: `1px solid ${catFilter === cat ? 'transparent' : 'var(--border)'}`,
            }}>{cat}</button>
          ))}
        </div>

        {/* Product Grid */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10, alignContent: 'start' }}>
          {filtered.map(p => (
            <button key={p.id} onClick={() => addToCart(p)} style={{
              background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
              padding: 14, textAlign: 'left', cursor: 'pointer', transition: 'all 0.15s',
              position: 'relative', overflow: 'hidden',
            }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = catColors[p.category] || 'var(--accent)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.transform = 'none'; }}
            >
              <div style={{ width: '100%', height: 40, borderRadius: 8, marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, background: `${catColors[p.category] || '#6366f1'}22` }}>
                {categoryIcon(p.category)}
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 4, lineHeight: 1.3 }}>{p.name}</div>
              <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 8 }}>{p.sku}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 700, color: 'var(--accent)', fontSize: 14 }} className="mono">{fmt(p.price)}</span>
                <span style={{
                  fontSize: 10, padding: '2px 6px', borderRadius: 4, fontWeight: 600,
                  background: p.stock <= p.low_stock_threshold ? 'rgba(244,63,94,0.15)' : 'rgba(74,222,128,0.1)',
                  color: p.stock <= p.low_stock_threshold ? 'var(--danger)' : 'var(--accent2)',
                }}>{p.stock}</span>
              </div>
            </button>
          ))}
          {filtered.length === 0 && (
            <div style={{ gridColumn: '1/-1', textAlign: 'center', color: 'var(--text3)', padding: 40 }}>No products found</div>
          )}
        </div>
      </div>

      {/* Cart Panel */}
      <div style={{ width: 360, background: 'var(--surface)', borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
        {/* Cart Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>🛒 Cart {cart.length > 0 && <span style={{ color: 'var(--accent)' }}>({cart.length})</span>}</span>
          {cart.length > 0 && <button onClick={() => setCart([])} style={{ color: 'var(--danger)', background: 'none', fontSize: 12 }}>Clear all</button>}
        </div>

        {/* Cart Items */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          {cart.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--text3)', padding: '60px 20px' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🛒</div>
              <div style={{ fontSize: 14 }}>Add items to begin</div>
            </div>
          ) : cart.map(item => (
            <div key={item.id} style={{ padding: '10px 20px', display: 'flex', gap: 10, alignItems: 'center', borderBottom: '1px solid var(--border)' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 2 }}>{item.name}</div>
                <div style={{ color: 'var(--accent)', fontSize: 13 }} className="mono">{fmt(item.price)}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button onClick={() => updateQty(item.id, item.qty - 1)} style={{ width: 24, height: 24, borderRadius: 6, background: 'var(--surface2)', color: 'var(--text)', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
                <span style={{ width: 24, textAlign: 'center', fontWeight: 700, fontSize: 14 }}>{item.qty}</span>
                <button onClick={() => updateQty(item.id, item.qty + 1)} style={{ width: 24, height: 24, borderRadius: 6, background: 'var(--surface2)', color: 'var(--text)', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
              </div>
              <div style={{ width: 64, textAlign: 'right' }}>
                <div className="mono" style={{ fontWeight: 700, fontSize: 13 }}>{fmt(item.price * item.qty)}</div>
                <button onClick={() => removeItem(item.id)} style={{ color: 'var(--danger)', background: 'none', fontSize: 11 }}>Remove</button>
              </div>
            </div>
          ))}
        </div>

        {/* Totals & Payment */}
        <div style={{ padding: 20, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Discount */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ color: 'var(--text2)', fontSize: 13, flex: 1 }}>Discount</span>
            <input value={discount} onChange={e => setDiscount(e.target.value)} placeholder="e.g. 10 or 10%"
              style={{ width: 120, padding: '6px 10px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', fontSize: 13, textAlign: 'right' }} />
          </div>

          {/* Totals */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 0', borderTop: '1px solid var(--border)' }}>
            <Row label="Subtotal" value={fmt(subtotal)} />
            {discountAmt > 0 && <Row label="Discount" value={`-${fmt(discountAmt)}`} color="var(--accent2)" />}
            <Row label={`Tax (${(taxRate * 100).toFixed(0)}%)`} value={fmt(tax)} />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
              <span style={{ fontWeight: 700, fontSize: 16 }}>Total</span>
              <span className="mono" style={{ fontWeight: 700, fontSize: 20, color: 'var(--accent)' }}>{fmt(total)}</span>
            </div>
          </div>

          {/* Payment Method */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
            {['cash', 'card', 'other'].map(m => (
              <button key={m} onClick={() => setPayMethod(m)} style={{
                padding: '8px 4px', borderRadius: 8, fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em',
                background: payMethod === m ? 'rgba(108,99,255,0.2)' : 'var(--surface2)',
                color: payMethod === m ? 'var(--accent)' : 'var(--text2)',
                border: `1px solid ${payMethod === m ? 'var(--accent)' : 'var(--border)'}`,
              }}>{m === 'cash' ? '💵' : m === 'card' ? '💳' : '📱'} {m}</button>
            ))}
          </div>

          {payMethod === 'cash' && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ color: 'var(--text2)', fontSize: 13, flex: 1 }}>Cash Given</span>
              <input value={cashGiven} onChange={e => setCashGiven(e.target.value)} placeholder="0.00" type="number"
                style={{ width: 120, padding: '6px 10px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', fontSize: 13, textAlign: 'right' }} />
            </div>
          )}
          {payMethod === 'cash' && cashGiven && change >= 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: 'rgba(74,222,128,0.1)', borderRadius: 8, border: '1px solid rgba(74,222,128,0.2)' }}>
              <span style={{ color: 'var(--accent2)', fontWeight: 600, fontSize: 13 }}>Change</span>
              <span className="mono" style={{ color: 'var(--accent2)', fontWeight: 700, fontSize: 15 }}>{fmt(change)}</span>
            </div>
          )}

          <button onClick={handleCharge} disabled={!cart.length} style={{
            padding: '14px', borderRadius: 'var(--radius)', fontWeight: 700, fontSize: 16,
            background: cart.length ? 'var(--accent)' : 'var(--surface3)',
            color: cart.length ? 'white' : 'var(--text3)',
            boxShadow: cart.length ? '0 4px 20px rgba(108,99,255,0.4)' : 'none',
            transition: 'all 0.2s',
          }}>
            {cart.length ? `Charge ${fmt(total)}` : 'Add items to cart'}
          </button>
        </div>
      </div>

      {/* Receipt Modal */}
      {showReceipt && lastSale && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 32, width: 360, boxShadow: 'var(--shadow)' }}>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div style={{ fontSize: 40 }}>✅</div>
              <div style={{ fontWeight: 700, fontSize: 18, marginTop: 8 }}>Sale Complete!</div>
              <div style={{ color: 'var(--text3)', fontSize: 13 }}>{lastSale.date.toLocaleString()}</div>
            </div>
            <div style={{ borderTop: '1px dashed var(--border)', padding: '16px 0', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {lastSale.items.map((item, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span>{item.product_name} × {item.quantity}</span>
                  <span className="mono">{fmt(item.subtotal)}</span>
                </div>
              ))}
            </div>
            <div style={{ borderTop: '1px dashed var(--border)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Row label="Tax" value={fmt(lastSale.tax)} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 16 }}>
                <span>Total</span>
                <span className="mono" style={{ color: 'var(--accent)' }}>{fmt(lastSale.total)}</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <button onClick={() => setShowReceipt(false)} style={{
                flex: 1, padding: '12px', borderRadius: 10, fontWeight: 600, fontSize: 14,
                background: 'var(--accent)', color: 'white',
              }}>New Sale</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, color }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
      <span style={{ color: 'var(--text2)' }}>{label}</span>
      <span className="mono" style={{ color: color || 'var(--text)' }}>{value}</span>
    </div>
  );
}

function categoryIcon(cat) {
  const icons = { Electronics: '⚡', Clothing: '👕', 'Food & Drink': '☕', Sports: '🏃', 'Home & Garden': '🏠', Books: '📚' };
  return icons[cat] || '📦';
}
