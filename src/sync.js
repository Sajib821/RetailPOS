// src/sync.js — Supabase sync: sales + inventory + optional shared catalog

const { createClient } = require("@supabase/supabase-js");

let supabase = null;
let storeId = null;
let storeName = null;
let enabled = false;

function init({ supabaseUrl, supabaseKey, storeId: sid, storeName: sname }) {
  const url = (supabaseUrl || "").trim();
  const key = (supabaseKey || "").trim();
  const id = (sid || "").trim();
  if (!url || !key || !id) return;

  supabase = createClient(url, key, { auth: { persistSession: false } });
  storeId = id;
  storeName = (sname || `Store ${id}`).trim();
  enabled = true;
  console.log(`[Sync] Connected: ${storeName} (${storeId})`);
}

async function syncSale(sale, items) {
  if (!enabled || !supabase) return;

  const payload = {
    local_id: sale.id,
    store_id: storeId,
    store_name: storeName,
    sale_type: sale.sale_type || "sale",
    original_sale_id: sale.original_sale_id || null,
    total: sale.total,
    subtotal: sale.subtotal,
    tax: sale.tax,
    discount: sale.discount,
    payment_method: sale.payment_method,
    payment_json: sale.payment_json ? safeJsonParse(sale.payment_json) : null,
    customer_id: sale.customer_id || null,
    customer_name: sale.customer_name || null,
    cashier_id: sale.cashier_id || null,
    cashier_name: sale.cashier_name || null,
    gross_profit: sale.gross_profit || 0,
    items_count: Array.isArray(items) ? items.length : 0,
    items_json: items || [],
    created_at: new Date().toISOString(),
  };

  try {
    // Make this idempotent: unique on (store_id, local_id)
    const { error } = await supabase.from("sales").upsert(payload, { onConflict: "store_id,local_id" });
    if (error) console.error("[Sync] Sale sync failed:", error.message);
  } catch (e) {
    console.error("[Sync] Sale sync network error:", e.message);
  }
}

async function syncInventory(products) {
  if (!enabled || !supabase) return;

  try {
    const rows = (products || []).map((p) => ({
      store_id: storeId,
      store_name: storeName,
      product_id: p.id,
      product_name: p.name,
      sku: p.sku,
      category: p.category,
      price: p.price,
      cost: p.cost || 0,
      stock: p.stock,
      low_stock_threshold: p.low_stock_threshold,
      barcode: p.barcode || null,
      updated_at: new Date().toISOString(),
    }));

    const { error } = await supabase.from("inventory").upsert(rows, { onConflict: "store_id,product_id" });
    if (error) console.error("[Sync] Inventory sync failed:", error.message);
  } catch (e) {
    console.error("[Sync] Inventory sync network error:", e.message);
  }
}

async function testConnection() {
  if (!supabase) return false;
  try {
    const { error } = await supabase.from("sales").select("id").limit(1);
    return !error;
  } catch {
    return false;
  }
}

// Optional: shared catalog tables (admin pushes, tills pull)
// Tables: public.products_shared, public.categories_shared
async function pullSharedCatalog() {
  if (!enabled || !supabase) return { products: [], categories: [] };

  const [cats, prods] = await Promise.all([
    supabase.from("categories_shared").select("*"),
    supabase.from("products_shared").select("*"),
  ]);

  if (cats.error) console.error("[Sync] pull categories error:", cats.error.message);
  if (prods.error) console.error("[Sync] pull products error:", prods.error.message);

  return {
    categories: cats.data || [],
    products: prods.data || [],
  };
}

async function pushSharedCatalog({ products, categories }) {
  if (!enabled || !supabase) return false;

  try {
    // categories by name
    const catRows = (categories || []).map((c) => ({
      name: c.name,
      color: c.color || "#6366f1",
      updated_at: new Date().toISOString(),
    }));

    const prodRows = (products || []).map((p) => ({
      sku: p.sku,
      barcode: p.barcode || null,
      name: p.name,
      category: p.category || "",
      price: p.price || 0,
      cost: p.cost || 0,
      low_stock_threshold: p.low_stock_threshold || 5,
      updated_at: new Date().toISOString(),
    })).filter(p => !!p.sku);

    const r1 = await supabase.from("categories_shared").upsert(catRows, { onConflict: "name" });
    if (r1.error) console.error("[Sync] push categories error:", r1.error.message);

    const r2 = await supabase.from("products_shared").upsert(prodRows, { onConflict: "sku" });
    if (r2.error) console.error("[Sync] push products error:", r2.error.message);

    return !(r1.error || r2.error);
  } catch (e) {
    console.error("[Sync] push shared catalog error:", e.message);
    return false;
  }
}

function safeJsonParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

module.exports = { init, syncSale, syncInventory, testConnection, pullSharedCatalog, pushSharedCatalog };