import { useState, useEffect, createContext, useContext } from 'react';
import Checkout from './pages/Checkout';
import Products from './pages/Products';
import Inventory from './pages/Inventory';
import Reports from './pages/Reports';
import Settings from './pages/Settings';

// Mock API for browser preview (when window.pos is not available)
const mockData = {
  products: [
    { id: 1, name: 'Wireless Earbuds Pro', sku: 'SKU-001', category: 'Electronics', price: 79.99, cost: 35, stock: 45, low_stock_threshold: 10 },
    { id: 2, name: 'Cotton T-Shirt (M)', sku: 'SKU-002', category: 'Clothing', price: 24.99, cost: 8, stock: 120, low_stock_threshold: 20 },
    { id: 3, name: 'Organic Coffee Beans', sku: 'SKU-003', category: 'Food & Drink', price: 14.99, cost: 6.5, stock: 80, low_stock_threshold: 15 },
    { id: 4, name: 'Yoga Mat Premium', sku: 'SKU-004', category: 'Sports', price: 49.99, cost: 18, stock: 30, low_stock_threshold: 8 },
    { id: 5, name: 'LED Desk Lamp', sku: 'SKU-005', category: 'Electronics', price: 39.99, cost: 15, stock: 25, low_stock_threshold: 5 },
    { id: 6, name: 'Running Shoes', sku: 'SKU-006', category: 'Sports', price: 89.99, cost: 40, stock: 3, low_stock_threshold: 5 },
    { id: 7, name: 'Ceramic Mug Set (4)', sku: 'SKU-007', category: 'Home & Garden', price: 34.99, cost: 12, stock: 40, low_stock_threshold: 10 },
    { id: 8, name: 'Novel: The Last Hour', sku: 'SKU-008', category: 'Books', price: 16.99, cost: 7, stock: 55, low_stock_threshold: 10 },
    { id: 9, name: 'Bluetooth Speaker', sku: 'SKU-009', category: 'Electronics', price: 59.99, cost: 25, stock: 3, low_stock_threshold: 5 },
    { id: 10, name: 'Denim Jeans (32x30)', sku: 'SKU-010', category: 'Clothing', price: 54.99, cost: 22, stock: 35, low_stock_threshold: 10 },
  ],
  categories: [
    { id: 1, name: 'Electronics', color: '#6366f1' },
    { id: 2, name: 'Clothing', color: '#ec4899' },
    { id: 3, name: 'Food & Drink', color: '#f59e0b' },
    { id: 4, name: 'Home & Garden', color: '#10b981' },
    { id: 5, name: 'Sports', color: '#3b82f6' },
    { id: 6, name: 'Books', color: '#8b5cf6' },
  ],
  sales: [],
  settings: { store_name: 'My Retail Store', tax_rate: '0.08', currency: 'USD', receipt_footer: 'Thank you for shopping with us!' },
};

const createMockAPI = () => ({
  products: {
    getAll: async () => [...mockData.products],
    search: async (q) => mockData.products.filter(p => p.name.toLowerCase().includes(q.toLowerCase()) || p.sku.includes(q)),
    create: async (p) => { const id = Date.now(); mockData.products.push({ ...p, id }); return { lastInsertRowid: id }; },
    update: async (p) => { const i = mockData.products.findIndex(x => x.id === p.id); if (i >= 0) mockData.products[i] = p; },
    delete: async (id) => { mockData.products = mockData.products.filter(x => x.id !== id); },
  },
  categories: {
    getAll: async () => [...mockData.categories],
    create: async (c) => { mockData.categories.push({ ...c, id: Date.now() }); },
  },
  sales: {
    create: async ({ sale, items }) => {
      const id = Date.now();
      mockData.sales.unshift({ ...sale, id, created_at: new Date().toISOString() });
      items.forEach(item => {
        const p = mockData.products.find(x => x.id === item.product_id);
        if (p) p.stock -= item.quantity;
      });
      return id;
    },
    getAll: async () => [...mockData.sales],
    getItems: async (id) => [],
  },
  reports: {
    summary: async () => ({
      summary: { transactions: 42, revenue: 3847.50, tax_collected: 307.80, avg_sale: 91.61 },
      topProducts: [
        { product_name: 'Wireless Earbuds Pro', qty_sold: 18, revenue: 1439.82 },
        { product_name: 'Running Shoes', qty_sold: 12, revenue: 1079.88 },
        { product_name: 'Yoga Mat Premium', qty_sold: 9, revenue: 449.91 },
        { product_name: 'Cotton T-Shirt (M)', qty_sold: 24, revenue: 599.76 },
        { product_name: 'Bluetooth Speaker', qty_sold: 7, revenue: 419.93 },
      ],
      byDay: [
        { day: '2024-03-25', transactions: 8, revenue: 642.50 },
        { day: '2024-03-26', transactions: 11, revenue: 987.30 },
        { day: '2024-03-27', transactions: 6, revenue: 521.00 },
        { day: '2024-03-28', transactions: 9, revenue: 834.70 },
        { day: '2024-03-29', transactions: 8, revenue: 862.00 },
      ],
      lowStock: mockData.products.filter(p => p.stock <= p.low_stock_threshold),
    }),
  },
  settings: {
    getAll: async () => ({ ...mockData.settings }),
    set: async (key, value) => { mockData.settings[key] = value; },
  },
});

export const POSContext = createContext(null);
export const usePOS = () => useContext(POSContext);

const NAV = [
  { id: 'checkout', label: 'Checkout', icon: '🛒' },
  { id: 'products', label: 'Products', icon: '📦' },
  { id: 'inventory', label: 'Inventory', icon: '🗃️' },
  { id: 'reports', label: 'Reports', icon: '📊' },
  { id: 'settings', label: 'Settings', icon: '⚙️' },
];

export default function App() {
  const [page, setPage] = useState('checkout');
  const [api] = useState(() => window.pos || createMockAPI());
  const [toast, setToast] = useState(null);
  const [storeName, setStoreName] = useState('RetailPOS');

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    api.settings.getAll().then(s => { if (s?.store_name) setStoreName(s.store_name); });
  }, []);

  const pages = { checkout: Checkout, products: Products, inventory: Inventory, reports: Reports, settings: Settings };
  const PageComponent = pages[page];

  return (
    <POSContext.Provider value={{ api, showToast }}>
      <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
        {/* Sidebar */}
        <nav style={{
          width: 72, background: 'var(--surface)', borderRight: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '16px 0', gap: 4,
          flexShrink: 0,
        }}>
          {/* Logo */}
          <div style={{
            width: 44, height: 44, borderRadius: 12, background: 'var(--accent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 20, marginBottom: 16, boxShadow: '0 0 20px rgba(108,99,255,0.4)',
          }}>🏪</div>

          {NAV.map(n => (
            <button key={n.id} onClick={() => setPage(n.id)} title={n.label} style={{
              width: 52, height: 52, borderRadius: 12, background: page === n.id ? 'rgba(108,99,255,0.2)' : 'transparent',
              border: page === n.id ? '1px solid rgba(108,99,255,0.5)' : '1px solid transparent',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: 2, cursor: 'pointer', transition: 'all 0.15s',
              color: page === n.id ? 'var(--accent)' : 'var(--text2)',
            }}>
              <span style={{ fontSize: 18 }}>{n.icon}</span>
              <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.03em' }}>{n.label}</span>
            </button>
          ))}

          {/* Time at bottom */}
          <div style={{ marginTop: 'auto', color: 'var(--text3)', fontSize: 10, textAlign: 'center', lineHeight: 1.4 }}>
            <Clock />
          </div>
        </nav>

        {/* Main */}
        <main style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <PageComponent />
        </main>
      </div>

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
          background: toast.type === 'error' ? 'var(--danger)' : toast.type === 'warning' ? 'var(--accent3)' : '#1a2e1a',
          border: `1px solid ${toast.type === 'error' ? '#f43f5e44' : toast.type === 'warning' ? '#f59e0b44' : 'var(--accent2)'}`,
          color: 'white', padding: '12px 20px', borderRadius: 10,
          boxShadow: 'var(--shadow)', animation: 'fadeIn 0.2s ease',
          fontWeight: 500, fontSize: 14, maxWidth: 320,
        }}>
          {toast.type === 'error' ? '❌ ' : toast.type === 'warning' ? '⚠️ ' : '✅ '}{toast.msg}
        </div>
      )}
    </POSContext.Provider>
  );
}

function Clock() {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <>
      <div className="mono" style={{ fontSize: 11 }}>{time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
      <div style={{ fontSize: 9 }}>{time.toLocaleDateString([], { month: 'short', day: 'numeric' })}</div>
    </>
  );
}
