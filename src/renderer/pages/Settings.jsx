// src/renderer/pages/Settings.jsx — UPDATED with Cloud Sync section
import { useState, useEffect } from 'react';
import { usePOS } from '../App';

export default function Settings() {
  const { api, showToast } = usePOS();
  const [settings, setSettings] = useState({});
  const [categories, setCategories] = useState([]);
  const [newCat, setNewCat] = useState({ name: '', color: '#6366f1' });
  const [saving, setSaving] = useState(false);
  const [syncStatus, setSyncStatus] = useState(null); // null | 'testing' | 'ok' | 'fail'

  useEffect(() => {
    api.settings.getAll().then(setSettings);
    api.categories.getAll().then(setCategories);
  }, []);

  const update = (key, value) => setSettings(prev => ({ ...prev, [key]: value }));

  const saveSettings = async () => {
    setSaving(true);
    try {
      await Promise.all(Object.entries(settings).map(([k, v]) => api.settings.set(k, v)));
      showToast('Settings saved!');
    } catch { showToast('Failed to save', 'error'); }
    setSaving(false);
  };

  const testSync = async () => {
    setSyncStatus('testing');
    // Save credentials first
    await api.settings.set('supabase_url', settings.supabase_url || '');
    await api.settings.set('supabase_key', settings.supabase_key || '');
    await api.settings.set('store_id', settings.store_id || 'store_1');
    await api.settings.set('store_name', settings.store_name || 'Store 1');
    try {
      const ok = await api.sync?.test();
      setSyncStatus(ok ? 'ok' : 'fail');
      if (ok) { showToast('Connected to cloud! ☁️'); await api.sync?.pushInventory(); }
      else showToast('Connection failed — check your URL and key', 'error');
    } catch { setSyncStatus('fail'); showToast('Connection failed', 'error'); }
  };

  const addCat = async () => {
    if (!newCat.name.trim()) { showToast('Name required', 'error'); return; }
    await api.categories.create(newCat);
    showToast('Category added');
    api.categories.getAll().then(setCategories);
    setNewCat({ name: '', color: '#6366f1' });
  };

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '20px 24px', maxWidth: 720 }}>
      <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 24 }}>⚙️ Settings</h1>

      {/* Store Info */}
      <Section title="🏪 Store Information">
        <Field label="Store Name (shown in dashboard)">
          <input value={settings.store_name || ''} onChange={e => update('store_name', e.target.value)} style={inp} />
        </Field>
        <Field label="Store ID (unique per store, e.g. store_1, store_2, store_3)">
          <input value={settings.store_id || ''} onChange={e => update('store_id', e.target.value)} placeholder="store_1" style={inp} />
          <p style={{ color: 'var(--text3)', fontSize: 11, marginTop: 4 }}>⚠️ Each store must have a different Store ID. Never change this after setup.</p>
        </Field>
        <Field label="Currency">
          <select value={settings.currency || 'USD'} onChange={e => update('currency', e.target.value)} style={inp}>
            {['USD','EUR','GBP','CAD','AUD'].map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Tax Rate">
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <input value={settings.tax_rate || ''} onChange={e => update('tax_rate', e.target.value)} type="number" step="0.01" style={{ ...inp, width: 120 }} />
            <span style={{ color: 'var(--text2)', fontSize: 14 }}>= {((parseFloat(settings.tax_rate)||0)*100).toFixed(1)}%</span>
          </div>
        </Field>
      </Section>

      {/* ── CLOUD SYNC ── */}
      <div style={{ background: 'linear-gradient(135deg, rgba(108,99,255,0.08) 0%, rgba(74,222,128,0.05) 100%)', border: '1px solid rgba(108,99,255,0.3)', borderRadius: 14, padding: 24, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700 }}>☁️ Cloud Sync — Multi-Store</h3>
          <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: 'rgba(108,99,255,0.2)', color: 'var(--accent)' }}>SUPABASE</span>
        </div>
        <p style={{ color: 'var(--text2)', fontSize: 12, marginBottom: 20, lineHeight: 1.6 }}>
          Connect all your stores to one Supabase database. Sales and inventory sync automatically.
          Your mobile dashboard will show live data from all stores. <strong style={{ color: 'var(--text)' }}>Free plan supports 3+ stores easily.</strong>
        </p>

        <div style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', marginBottom: 18 }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent2)', marginBottom: 10 }}>📋 Setup steps (do once):</p>
          {[
            ['1', 'Go to supabase.com → New project (free)'],
            ['2', 'In Supabase: SQL Editor → paste the SQL from the README'],
            ['3', 'Go to Project Settings → API → copy URL and anon key'],
            ['4', 'Paste them below and click "Test Connection"'],
            ['5', 'Repeat on each store computer with the SAME URL/key but different Store ID'],
          ].map(([n, t]) => (
            <div key={n} style={{ display: 'flex', gap: 10, marginBottom: 6, fontSize: 12 }}>
              <span style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--accent)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, flexShrink: 0 }}>{n}</span>
              <span style={{ color: 'var(--text2)', lineHeight: 1.5 }}>{t}</span>
            </div>
          ))}
        </div>

        <Field label="Supabase Project URL">
          <input value={settings.supabase_url || ''} onChange={e => update('supabase_url', e.target.value)} placeholder="https://xxxxxxxxxxxx.supabase.co" style={inp} />
        </Field>
        <div style={{ height: 12 }} />
        <Field label="Supabase Anon Key (public)">
          <input value={settings.supabase_key || ''} onChange={e => update('supabase_key', e.target.value)} placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." type="password" style={inp} />
        </Field>

        <div style={{ display: 'flex', gap: 10, marginTop: 16, alignItems: 'center' }}>
          <button onClick={testSync} disabled={syncStatus === 'testing'} style={{ padding: '10px 20px', borderRadius: 8, background: 'var(--accent)', color: 'white', fontWeight: 600, fontSize: 13, opacity: syncStatus === 'testing' ? 0.7 : 1 }}>
            {syncStatus === 'testing' ? '⏳ Testing...' : '🔌 Test Connection'}
          </button>
          {syncStatus === 'ok' && <span style={{ color: 'var(--accent2)', fontWeight: 600, fontSize: 13 }}>✅ Connected & syncing!</span>}
          {syncStatus === 'fail' && <span style={{ color: 'var(--danger)', fontWeight: 600, fontSize: 13 }}>❌ Connection failed</span>}
        </div>
      </div>

      {/* Categories */}
      <Section title="🏷️ Product Categories">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
          {categories.map(c => <span key={c.id} style={{ padding: '5px 13px', borderRadius: 20, fontSize: 12, fontWeight: 600, background: `${c.color}22`, color: c.color, border: `1px solid ${c.color}44` }}>{c.name}</span>)}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={newCat.name} onChange={e => setNewCat(n => ({ ...n, name: e.target.value }))} placeholder="New category name" style={{ ...inp, flex: 1 }} onKeyDown={e => e.key === 'Enter' && addCat()} />
          <input type="color" value={newCat.color} onChange={e => setNewCat(n => ({ ...n, color: e.target.value }))} style={{ width: 40, height: 38, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)', cursor: 'pointer', padding: 2 }} />
          <button onClick={addCat} style={{ padding: '9px 16px', borderRadius: 8, background: 'var(--accent)', color: 'white', fontWeight: 600, fontSize: 13 }}>+ Add</button>
        </div>
      </Section>

      <button onClick={saveSettings} disabled={saving} style={{ padding: '12px 32px', borderRadius: 10, background: 'var(--accent)', color: 'white', fontWeight: 700, fontSize: 15, boxShadow: '0 4px 20px rgba(108,99,255,0.35)', marginBottom: 32 }}>
        {saving ? 'Saving...' : '💾 Save All Settings'}
      </button>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 24, marginBottom: 16 }}>
      <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 18 }}>{title}</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>{children}</div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 11, color: 'var(--text3)', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 7 }}>{label}</label>
      {children}
    </div>
  );
}

const inp = { width: '100%', padding: '10px 14px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', fontSize: 14 };
