import { useState, useEffect } from 'react';
import { usePOS } from '../App';

const fmt = (n) => `$${(Number(n) || 0).toFixed(2)}`;
const EMPTY = { name: '', sku: '', category: '', price: '', cost: '', stock: '', low_stock_threshold: '5', barcode: '' };

function categoryIcon(cat) {
  const icons = { Electronics: '⚡', Clothing: '👕', 'Food & Drink': '☕', Sports: '🏃', 'Home & Garden': '🏠', Books: '📚' };
  return icons[cat] || '📦';
}

export default function Products() {
  const { api, showToast } = usePOS();
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [search, setSearch] = useState('');
  const [editProduct, setEditProduct] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [showModal, setShowModal] = useState(false);
  const [catFilter, setCatFilter] = useState('All');
  const [confirmDelete, setConfirmDelete] = useState(null);

  const load = () => {
    api.products.getAll().then(setProducts);
    api.categories.getAll().then(setCategories);
  };

  useEffect(() => { load(); }, []);

  const filtered = products.filter(p => {
    const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase()) || (p.sku || '').includes(search);
    const matchCat = catFilter === 'All' || p.category === catFilter;
    return matchSearch && matchCat;
  });

  const openCreate = () => { setForm(EMPTY); setEditProduct(null); setShowModal(true); };
  const openEdit = (p) => { setForm({ ...p, price: String(p.price), cost: String(p.cost), stock: String(p.stock), low_stock_threshold: String(p.low_stock_threshold) }); setEditProduct(p); setShowModal(true); };

  const handleSave = async () => {
    if (!form.name || !form.price) { showToast('Name and price are required', 'error'); return; }
    const data = { ...form, price: parseFloat(form.price), cost: parseFloat(form.cost) || 0, stock: parseInt(form.stock) || 0, low_stock_threshold: parseInt(form.low_stock_threshold) || 5 };
    try {
      if (editProduct) { await api.products.update({ ...data, id: editProduct.id }); showToast('Product updated'); }
      else { await api.products.create(data); showToast('Product created'); }
      setShowModal(false);
      load();
    } catch (e) { showToast('Failed to save product', 'error'); }
  };

  const handleDelete = async (id) => {
    try { await api.products.delete(id); showToast('Product deleted'); setConfirmDelete(null); load(); }
    catch (e) { showToast('Failed to delete', 'error'); }
  };

  const catColors = Object.fromEntries(categories.map(c => [c.name, c.color]));

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 12, alignItems: 'center' }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, flex: 1 }}>📦 Products</h1>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search products..."
          style={{ padding: '8px 14px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', fontSize: 13, width: 240 }} />
        <div style={{ display: 'flex', gap: 6 }}>
          {['All', ...categories.map(c => c.name)].map(cat => (
            <button key={cat} onClick={() => setCatFilter(cat)} style={{
              padding: '6px 12px', borderRadius: 20, fontSize: 12, fontWeight: 500,
              background: catFilter === cat ? (catColors[cat] || 'var(--accent)') : 'var(--surface2)',
              color: catFilter === cat ? 'white' : 'var(--text2)',
              border: `1px solid ${catFilter === cat ? 'transparent' : 'var(--border)'}`,
            }}>{cat}</button>
          ))}
        </div>
        <button onClick={openCreate} style={{ padding: '8px 16px', borderRadius: 8, background: 'var(--accent)', color: 'white', fontWeight: 600, fontSize: 13 }}>+ Add Product</button>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 24px 24px' }}>
        <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: '0 4px', marginTop: 12 }}>
          <thead>
            <tr style={{ color: 'var(--text3)', fontSize: 12, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              <th style={{ padding: '8px 12px', textAlign: 'left' }}>Product</th>
              <th style={{ padding: '8px 12px', textAlign: 'left' }}>SKU</th>
              <th style={{ padding: '8px 12px', textAlign: 'left' }}>Category</th>
              <th style={{ padding: '8px 12px', textAlign: 'right' }}>Price</th>
              <th style={{ padding: '8px 12px', textAlign: 'right' }}>Cost</th>
              <th style={{ padding: '8px 12px', textAlign: 'right' }}>Margin</th>
              <th style={{ padding: '8px 12px', textAlign: 'right' }}>Stock</th>
              <th style={{ padding: '8px 12px', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(p => {
              const margin = p.cost ? ((p.price - p.cost) / p.price * 100).toFixed(0) : null;
              const lowStock = p.stock <= p.low_stock_threshold;
              return (
                <tr key={p.id} style={{ background: 'var(--surface)', borderRadius: 10 }}>
                  <td style={{ padding: '12px', borderRadius: '10px 0 0 10px', fontWeight: 600, fontSize: 13 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 32, height: 32, borderRadius: 8, background: `${catColors[p.category] || '#6366f1'}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>{categoryIcon(p.category)}</div>
                      {p.name}
                    </div>
                  </td>
                  <td style={{ padding: '12px', color: 'var(--text3)', fontSize: 12 }} className="mono">{p.sku || '—'}</td>
                  <td style={{ padding: '12px' }}>
                    <span style={{ padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, background: `${catColors[p.category] || '#6366f1'}22`, color: catColors[p.category] || 'var(--accent)' }}>{p.category || '—'}</span>
                  </td>
                  <td style={{ padding: '12px', textAlign: 'right' }} className="mono">{fmt(p.price)}</td>
                  <td style={{ padding: '12px', textAlign: 'right', color: 'var(--text2)' }} className="mono">{fmt(p.cost)}</td>
                  <td style={{ padding: '12px', textAlign: 'right' }}>
                    {margin && <span style={{ color: parseInt(margin) > 40 ? 'var(--accent2)' : 'var(--accent3)', fontSize: 12, fontWeight: 600 }}>{margin}%</span>}
                  </td>
                  <td style={{ padding: '12px', textAlign: 'right' }}>
                    <span style={{
                      padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 700,
                      background: lowStock ? 'rgba(244,63,94,0.15)' : 'rgba(74,222,128,0.1)',
                      color: lowStock ? 'var(--danger)' : 'var(--accent2)',
                    }}>{p.stock} {lowStock && '⚠️'}</span>
                  </td>
                  <td style={{ padding: '12px', textAlign: 'right', borderRadius: '0 10px 10px 0' }}>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <button onClick={() => openEdit(p)} style={{ padding: '6px 12px', borderRadius: 6, background: 'var(--surface2)', color: 'var(--text2)', fontSize: 12 }}>Edit</button>
                      <button onClick={() => setConfirmDelete(p)} style={{ padding: '6px 12px', borderRadius: 6, background: 'rgba(244,63,94,0.1)', color: 'var(--danger)', fontSize: 12 }}>Delete</button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text3)', padding: 48 }}>No products found</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Edit/Create Modal */}
      {showModal && (
        <Modal title={editProduct ? 'Edit Product' : 'New Product'} onClose={() => setShowModal(false)}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FormField label="Product Name *" colSpan={2}>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Product name" style={inputStyle} />
            </FormField>
            <FormField label="SKU">
              <input value={form.sku} onChange={e => setForm(f => ({ ...f, sku: e.target.value }))} placeholder="SKU-001" style={inputStyle} />
            </FormField>
            <FormField label="Category">
              <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} style={inputStyle}>
                <option value="">Select category</option>
                {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
            </FormField>
            <FormField label="Price *">
              <input value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} placeholder="0.00" type="number" step="0.01" style={inputStyle} />
            </FormField>
            <FormField label="Cost">
              <input value={form.cost} onChange={e => setForm(f => ({ ...f, cost: e.target.value }))} placeholder="0.00" type="number" step="0.01" style={inputStyle} />
            </FormField>
            <FormField label="Stock">
              <input value={form.stock} onChange={e => setForm(f => ({ ...f, stock: e.target.value }))} placeholder="0" type="number" style={inputStyle} />
            </FormField>
            <FormField label="Low Stock Alert">
              <input value={form.low_stock_threshold} onChange={e => setForm(f => ({ ...f, low_stock_threshold: e.target.value }))} placeholder="5" type="number" style={inputStyle} />
            </FormField>
            <FormField label="Barcode" colSpan={2}>
              <input value={form.barcode} onChange={e => setForm(f => ({ ...f, barcode: e.target.value }))} placeholder="Barcode (optional)" style={inputStyle} />
            </FormField>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
            <button onClick={() => setShowModal(false)} style={{ flex: 1, padding: 12, borderRadius: 8, background: 'var(--surface2)', color: 'var(--text2)', fontWeight: 600 }}>Cancel</button>
            <button onClick={handleSave} style={{ flex: 2, padding: 12, borderRadius: 8, background: 'var(--accent)', color: 'white', fontWeight: 600 }}>
              {editProduct ? 'Update Product' : 'Create Product'}
            </button>
          </div>
        </Modal>
      )}

      {/* Delete Confirm */}
      {confirmDelete && (
        <Modal title="Delete Product?" onClose={() => setConfirmDelete(null)}>
          <p style={{ color: 'var(--text2)', marginBottom: 20 }}>Are you sure you want to delete <strong>{confirmDelete.name}</strong>? This cannot be undone.</p>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => setConfirmDelete(null)} style={{ flex: 1, padding: 12, borderRadius: 8, background: 'var(--surface2)', color: 'var(--text)', fontWeight: 600 }}>Cancel</button>
            <button onClick={() => handleDelete(confirmDelete.id)} style={{ flex: 1, padding: 12, borderRadius: 8, background: 'var(--danger)', color: 'white', fontWeight: 600 }}>Delete</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

const inputStyle = { width: '100%', padding: '10px 12px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', fontSize: 13 };

function FormField({ label, children, colSpan }) {
  return (
    <div style={{ gridColumn: colSpan === 2 ? '1 / -1' : 'auto' }}>
      <label style={{ display: 'block', fontSize: 12, color: 'var(--text3)', fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</label>
      {children}
    </div>
  );
}

export function Modal({ title, onClose, children }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 28, width: 480, maxHeight: '90vh', overflowY: 'auto', boxShadow: 'var(--shadow)', animation: 'fadeIn 0.2s ease' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700 }}>{title}</h2>
          <button onClick={onClose} style={{ color: 'var(--text3)', background: 'none', fontSize: 20 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
