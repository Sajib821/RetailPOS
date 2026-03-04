// src/sync.js — Drop this file into your retail-pos/src/ folder
// It syncs all sales & inventory changes to Supabase in real-time

const { createClient } = require('@supabase/supabase-js');

let supabase = null;
let storeId = null;
let storeName = null;
let syncEnabled = false;

function init(config) {
  if (!config.supabaseUrl || !config.supabaseKey || !config.storeId) return;
  supabase = createClient(config.supabaseUrl, config.supabaseKey);
  storeId = config.storeId;
  storeName = config.storeName || `Store ${config.storeId}`;
  syncEnabled = true;
  console.log(`[Sync] Connected — Store: ${storeName}`);
}

async function syncSale(sale, items) {
  if (!syncEnabled) return;
  try {
    const { error } = await supabase.from('sales').insert({
      local_id: sale.id,
      store_id: storeId,
      store_name: storeName,
      total: sale.total,
      subtotal: sale.subtotal,
      tax: sale.tax,
      discount: sale.discount,
      payment_method: sale.payment_method,
      items_count: items.length,
      items_json: JSON.stringify(items),
      created_at: new Date().toISOString(),
    });
    if (error) console.error('[Sync] Sale sync failed:', error.message);
    else console.log('[Sync] Sale synced ✓');
  } catch (e) {
    console.error('[Sync] Network error:', e.message);
  }
}

async function syncInventory(products) {
  if (!syncEnabled) return;
  try {
    // Upsert all product stock levels
    const rows = products.map(p => ({
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
    const { error } = await supabase.from('inventory').upsert(rows, { onConflict: 'store_id,product_id' });
    if (error) console.error('[Sync] Inventory sync failed:', error.message);
    else console.log(`[Sync] Inventory synced ✓ (${rows.length} products)`);
  } catch (e) {
    console.error('[Sync] Network error:', e.message);
  }
}

async function testConnection() {
  if (!supabase) return false;
  try {
    const { error } = await supabase.from('sales').select('count').limit(1);
    return !error;
  } catch { return false; }
}

module.exports = { init, syncSale, syncInventory, testConnection };
