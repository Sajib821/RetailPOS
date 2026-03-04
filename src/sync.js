// src/sync.js — Supabase sync for sales + inventory (safe + idempotent)

const { createClient } = require('@supabase/supabase-js');

let supabase = null;
let storeId = null;
let storeName = null;
let syncEnabled = false;

function init(config) {
  const supabaseUrl = (config?.supabaseUrl || '').trim();
  const supabaseKey = (config?.supabaseKey || '').trim();
  const sid = (config?.storeId || '').trim();

  if (!supabaseUrl || !supabaseKey || !sid) return;

  supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false }, // good for desktop apps
  });

  storeId = sid;
  storeName = (config?.storeName || `Store ${sid}`).trim();
  syncEnabled = true;

  console.log(`[Sync] Connected — Store: ${storeName} (${storeId})`);
}

async function syncSale(sale, items) {
  if (!syncEnabled || !supabase) return;

  try {
    // Prefer using local sale time if you want:
    // const createdAt = sale.created_at ? new Date(sale.created_at).toISOString() : new Date().toISOString();
    const createdAt = new Date().toISOString();

    const payload = {
      local_id: sale.id,
      store_id: storeId,
      store_name: storeName,
      total: sale.total,
      subtotal: sale.subtotal,
      tax: sale.tax,
      discount: sale.discount,
      payment_method: sale.payment_method,
      items_count: Array.isArray(items) ? items.length : 0,
      items_json: items, // ✅ send array/object (jsonb), NOT JSON.stringify
      created_at: createdAt,
    };

    // ✅ idempotent (requires unique index on store_id+local_id)
    const { error } = await supabase
      .from('sales')
      .upsert(payload, { onConflict: 'store_id,local_id' });

    if (error) console.error('[Sync] Sale sync failed:', error.message);
    else console.log('[Sync] Sale synced ✓');
  } catch (e) {
    console.error('[Sync] Network error:', e.message);
  }
}

async function syncInventory(products) {
  if (!syncEnabled || !supabase) return;

  try {
    const rows = (products || []).map((p) => ({
      store_id: storeId,
      store_name: storeName,
      product_id: p.id,
      product_name: p.name,
      sku: p.sku,
      category: p.category,
      price: p.price,
      stock: p.stock,
      low_stock_threshold: p.low_stock_threshold,
      updated_at: new Date().toISOString(),
    }));

    const { error } = await supabase
      .from('inventory')
      .upsert(rows, { onConflict: 'store_id,product_id' });

    if (error) console.error('[Sync] Inventory sync failed:', error.message);
    else console.log(`[Sync] Inventory synced ✓ (${rows.length} products)`);
  } catch (e) {
    console.error('[Sync] Network error:', e.message);
  }
}

async function testConnection() {
  if (!supabase) return false;
  try {
    const { error } = await supabase.from('sales').select('id').limit(1);
    return !error;
  } catch {
    return false;
  }
}

module.exports = { init, syncSale, syncInventory, testConnection };