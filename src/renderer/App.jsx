import { useState, useEffect, createContext, useContext } from 'react';
import Checkout from './pages/Checkout';
import Products from './pages/Products';
import Inventory from './pages/Inventory';
import Reports from './pages/Reports';
import Settings from './pages/Settings';

// NEW pages
import Customers from "./pages/Customers.jsx";
import Users from "./pages/Users.jsx";
import SalesHistory from "./pages/SalesHistory.jsx";

// Mock API for browser preview (when window.pos is not available)
const mockData = {
  products: [
    { id: 1, name: 'Wireless Earbuds Pro', sku: 'SKU-001', category: 'Electronics', price: 79.99, cost: 35, stock: 45, low_stock_threshold: 10 },
    { id: 2, name: 'Cotton T-Shirt (M)', sku: 'SKU-002', category: 'Clothing', price: 24.99, cost: 8, stock: 120, low_stock_threshold: 20 },
  ],
  categories: [
    { id: 1, name: 'Electronics', color: '#6366f1' },
    { id: 2, name: 'Clothing', color: '#ec4899' },
  ],
  sales: [],
  sale_items: [],
  customers: [{ id: 1, name: 'Walk-in', phone: '', email: '', address: '' }],
  users: [{ id: 1, name: 'Admin', role: 'admin', active: 1, pin: '1234' }],
  currentUser: null,
  settings: { store_name: 'My Retail Store', tax_rate: '0.08', currency: 'USD', receipt_footer: 'Thank you!' },
};

const createMockAPI = () => ({
  auth: {
    current: async () => mockData.currentUser,

    // Supports BOTH: login("1234") and login({pin:"1234"})
    login: async (arg) => {
      const pin = typeof arg === "object" ? arg?.pin : arg;
      const u = mockData.users.find(x => x.active && x.pin === String(pin));
      if (!u) return { ok: false, message: 'Invalid PIN' };
      mockData.currentUser = { id: u.id, name: u.name, role: u.role, active: u.active };
      return { ok: true, user: mockData.currentUser };
    },

    logout: async () => { mockData.currentUser = null; return { ok: true }; },
  },

  users: {
    getAll: async () => mockData.users.map(u => ({ id: u.id, name: u.name, role: u.role, active: u.active })),
    create: async (u) => { mockData.users.push({ id: Date.now(), ...u, active: 1 }); return { ok: true }; },
    update: async (u) => { const i = mockData.users.findIndex(x => x.id === u.id); if (i >= 0) mockData.users[i] = { ...mockData.users[i], ...u }; return { ok: true }; },
    setPin: async ({ id, pin }) => { const i = mockData.users.findIndex(x => x.id === id); if (i >= 0) mockData.users[i].pin = String(pin); return { ok: true }; },
    delete: async (id) => { mockData.users = mockData.users.filter(x => x.id !== id); return { ok: true }; },
  },

  customers: {
    getAll: async () => [...mockData.customers],
    search: async (q) => mockData.customers.filter(c => (c.name || '').toLowerCase().includes(String(q || '').toLowerCase())),
    create: async (c) => { mockData.customers.push({ id: Date.now(), ...c }); return { ok: true }; },
    update: async (c) => { const i = mockData.customers.findIndex(x => x.id === c.id); if (i >= 0) mockData.customers[i] = { ...mockData.customers[i], ...c }; return { ok: true }; },
    delete: async (id) => { mockData.customers = mockData.customers.filter(x => x.id !== id); return { ok: true }; },
    sales: async (customerId) => mockData.sales.filter(s => s.customer_id === customerId),
  },

  products: {
    getAll: async () => [...mockData.products],
    search: async (q) => mockData.products.filter(p => p.name.toLowerCase().includes(String(q || '').toLowerCase()) || String(p.sku || '').includes(String(q || ''))),
    create: async (p) => { const id = Date.now(); mockData.products.push({ ...p, id }); return { lastInsertRowid: id }; },
    update: async (p) => { const i = mockData.products.findIndex(x => x.id === p.id); if (i >= 0) mockData.products[i] = { ...mockData.products[i], ...p }; },
    delete: async (id) => { mockData.products = mockData.products.filter(x => x.id !== id); },
  },

  categories: {
    getAll: async () => [...mockData.categories],
    create: async (c) => { mockData.categories.push({ ...c, id: Date.now() }); },
  },

  sales: {
    create: async ({ sale, items }) => {
      const id = Date.now();
      mockData.sales.unshift({ ...sale, id, created_at: new Date().toISOString(), sale_type: 'sale' });
      items.forEach(item => mockData.sale_items.push({ id: Date.now() + Math.random(), sale_id: id, ...item }));
      return id;
    },
    getAll: async () => [...mockData.sales],
    getItems: async (id) => mockData.sale_items.filter(it => it.sale_id === id),
    getOne: async (id) => ({ sale: mockData.sales.find(s => s.id === id), items: mockData.sale_items.filter(it => it.sale_id === id) }),
    refund: async () => ({ ok: false, message: 'Refund mock not implemented' }),
  },

  reports: {
    summary: async () => ({
      summary: { transactions: mockData.sales.length, revenue: 0, tax_collected: 0, avg_sale: 0 },
      topProducts: [],
      byDay: [],
      lowStock: mockData.products.filter(p => p.stock <= p.low_stock_threshold),
    }),
  },

  settings: {
    getAll: async () => ({ ...mockData.settings }),
    set: async (key, value) => { mockData.settings[key] = value; return { ok: true }; },
  },

  sync: {
    test: async () => true,
    pushInventory: async () => true,
    pullProducts: async () => ({ ok: true }),
    pushProducts: async () => ({ ok: true }),
  },
});

export const POSContext = createContext(null);
export const usePOS = () => useContext(POSContext);

const NAV = [
  { id: 'checkout', label: 'Checkout', icon: '🛒' },
  { id: 'products', label: 'Products', icon: '📦', adminOnly: true },   // admin-only
  { id: 'inventory', label: 'Inventory', icon: '🗃️' },
  { id: 'reports', label: 'Reports', icon: '📊' },
  { id: 'sales', label: 'Sales', icon: '🧾' },
  { id: 'customers', label: 'Customers', icon: '👥' },
  { id: 'users', label: 'Users', icon: '👤' },
  { id: 'settings', label: 'Settings', icon: '⚙️', adminOnly: true },   // admin-only
];

export default function App() {
  const [page, setPage] = useState('checkout');

  // If preload exposes window.pos use it, otherwise mock.
  const [api] = useState(() => window.pos || createMockAPI());

  const [toast, setToast] = useState(null);
  const [storeName, setStoreName] = useState('RetailPOS');

  // ✅ current logged-in user (admin/cashier)
  const [me, setMe] = useState(null);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Load store name
  useEffect(() => {
    api.settings.getAll().then(s => { if (s?.store_name) setStoreName(s.store_name); });
  }, []);

  // Load current user
  useEffect(() => {
    if (api.auth?.current) api.auth.current().then(setMe).catch(() => setMe(null));
  }, []);

  // Prevent cashiers from landing on admin-only pages
  useEffect(() => {
    const admin = me?.role === 'admin';
    if (!admin && (page === 'products' || page === 'settings')) {
      setPage('checkout');
    }
  }, [me, page]);

  const pages = {
    checkout: Checkout,
    products: Products,
    inventory: Inventory,
    reports: Reports,
    sales: SalesHistory,
    customers: Customers,
    users: Users,
    settings: Settings,
  };

  const PageComponent = pages[page] || Checkout;

  return (
    <POSContext.Provider value={{ api, showToast, me, setMe }}>
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
          }} title={storeName}>🏪</div>

          {/* ✅ fixed map() parentheses */}
          {NAV
            .filter(n => !n.adminOnly || me?.role === 'admin')
            .map(n => (
              <button
                key={n.id}
                onClick={() => setPage(n.id)}
                title={n.label}
                style={{
                  width: 52, height: 52, borderRadius: 12,
                  background: page === n.id ? 'rgba(108,99,255,0.2)' : 'transparent',
                  border: page === n.id ? '1px solid rgba(108,99,255,0.5)' : '1px solid transparent',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  gap: 2, cursor: 'pointer', transition: 'all 0.15s',
                  color: page === n.id ? 'var(--accent)' : 'var(--text2)',
                }}
              >
                <span style={{ fontSize: 18 }}>{n.icon}</span>
                <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.03em' }}>{n.label}</span>
              </button>
            ))}

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
          boxShadow: 'var(--shadow)',
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