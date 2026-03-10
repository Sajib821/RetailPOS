// src/sync.js — Supabase sync (per-store catalog + sales + inventory)
// Matches the Supabase SQL schema:
// - store_catalog_products, store_catalog_categories
// - inventory PK: (store_id, product_id)
// - sales includes refund/customer/cashier/profit fields

const { createClient } = require("@supabase/supabase-js");

let supabase = null;
let storeId = null;
let storeName = null;
let enabled = false;

// Prefer new table names; fallback to older ones if user still has them
const TABLES = {
  catalogProducts: ["store_catalog_products", "catalog_products"],
  catalogCategories: ["store_catalog_categories", "catalog_categories"],
  inventory: ["inventory"],
  sales: ["sales"],
};

function init(config) {
  if (!config?.supabaseUrl || !config?.supabaseKey || !config?.storeId) return;
  supabase = createClient(config.supabaseUrl, config.supabaseKey);
  storeId = String(config.storeId).trim();
  storeName = String(config.storeName || `Store ${storeId}`).trim();
  enabled = true;
  console.log(`[Sync] Connected: ${storeName} (${storeId})`);
}

async function pickFirstWorkingTable(candidates, testQueryFn) {
  for (const t of candidates) {
    const ok = await testQueryFn(t);
    if (ok) return t;
  }
  return candidates[0]; // default
}

async function testConnection() {
  if (!enabled) return false;

  try {
    // test with catalog products table (new or old)
    const table = await pickFirstWorkingTable(TABLES.catalogProducts, async (t) => {
      const { error } = await supabase.from(t).select("sku").limit(1);
      return !error;
    });
    return !!table;
  } catch {
    return false;
  }
}

// ------------------------------------------------------
// Per-store catalog push/pull
// main.js expects: pullSharedCatalog() / pushSharedCatalog()
// ------------------------------------------------------

async function pushSharedCatalog({ storeId: sid, products = [], categories = [] } = {}) {
  if (!enabled) return false;
  const s = String(sid || storeId).trim();

  const catTable = await pickFirstWorkingTable(TABLES.catalogCategories, async (t) => {
    const { error } = await supabase.from(t).select("name").limit(1);
    return !error;
  });

  const prodTable = await pickFirstWorkingTable(TABLES.catalogProducts, async (t) => {
    const { error } = await supabase.from(t).select("sku").limit(1);
    return !error;
  });

  // categories upsert by (store_id, name)
  const catRows = (categories || [])
    .filter((c) => c?.name)
    .map((c) => ({
      store_id: s,
      name: String(c.name).trim(),
      color: c.color || "#6366f1",
      updated_at: new Date().toISOString(),
    }));

  // products upsert by (store_id, sku)
  const prodRows = (products || [])
    .filter((p) => p?.sku) // sku is required for cloud catalog PK
    .map((p) => ({
      store_id: s,
      sku: String(p.sku).trim(),
      name: p.name,
      category: p.category || "",
      price: Number(p.price || 0),
      cost: Number(p.cost || 0),
      low_stock_threshold: Number(p.low_stock_threshold || 5),
      barcode: p.barcode || null,
      updated_at: new Date().toISOString(),
    }));

  if (catRows.length) {
    const { error } = await supabase.from(catTable).upsert(catRows, { onConflict: "store_id,name" });
    if (error) throw new Error(error.message);
  }

  if (prodRows.length) {
    const { error } = await supabase.from(prodTable).upsert(prodRows, { onConflict: "store_id,sku" });
    if (error) throw new Error(error.message);
  }

  return true;
}

async function pullSharedCatalog({ storeId: sid } = {}) {
  if (!enabled) return { products: [], categories: [] };
  const s = String(sid || storeId).trim();

  const catTable = await pickFirstWorkingTable(TABLES.catalogCategories, async (t) => {
    const { error } = await supabase.from(t).select("name").limit(1);
    return !error;
  });

  const prodTable = await pickFirstWorkingTable(TABLES.catalogProducts, async (t) => {
    const { error } = await supabase.from(t).select("sku").limit(1);
    return !error;
  });

  const { data: categories, error: catErr } = await supabase.from(catTable).select("*").eq("store_id", s);
  if (catErr) throw new Error(catErr.message);

  const { data: products, error: prodErr } = await supabase.from(prodTable).select("*").eq("store_id", s);
  if (prodErr) throw new Error(prodErr.message);

  return { products: products || [], categories: categories || [] };
}

// ------------------------------------------------------
// Sales + Inventory sync (best effort)
// ------------------------------------------------------

function safeJson(val) {
  if (!val) return null;
  if (typeof val === "object") return val;
  try {
    return JSON.parse(val);
  } catch {
    return null;
  }
}

async function syncSale(sale, items) {
  if (!enabled) return;

  try {
    const payload = {
      store_id: storeId,
      store_name: storeName,

      // local receipt id from SQLite
      local_id: sale?.id ?? sale?.local_id ?? null,

      // money
      total: Number(sale?.total || 0),
      subtotal: Number(sale?.subtotal || 0),
      tax: Number(sale?.tax || 0),
      discount: Number(sale?.discount || 0),

      // payments
      payment_method: sale?.payment_method || null,
      payment_json: safeJson(sale?.payment_json),
      status: sale?.status || "completed",

      // refunds
      sale_type: sale?.sale_type || "sale",
      original_sale_id: sale?.original_sale_id ?? null,

      // customer info (optional)
      customer_id: sale?.customer_id ?? null,
      customer_name: sale?.customer_name || null,
      customer_phone: sale?.customer_phone || null,
      customer_email: sale?.customer_email || null,
      customer_address: sale?.customer_address || null,

      // cashier info (optional)
      cashier_id: sale?.cashier_id ?? null,
      cashier_name: sale?.cashier_name || null,

      // profit
      gross_profit: Number(sale?.gross_profit || 0),

      // items
      items_count: Array.isArray(items) ? items.length : 0,
      items_json: Array.isArray(items) ? items : [],

      created_at: new Date().toISOString(),
    };

    const { error } = await supabase.from("sales").insert(payload);
    if (error) console.error("[Sync] Sale sync failed:", error.message);
  } catch (e) {
    console.error("[Sync] Sale sync network error:", e.message);
  }
}

async function syncInventory(products) {
  if (!enabled) return;

  // New schema uses PK (store_id, product_id)
  const rows = (products || []).map((p) => ({
    store_id: storeId,
    store_name: storeName,

    product_id: Number(p.id),
    product_name: p.name,

    sku: p.sku || null,
    category: p.category || "",
    price: Number(p.price || 0),
    cost: Number(p.cost || 0),

    stock: Number(p.stock || 0),
    low_stock_threshold: Number(p.low_stock_threshold || 5),
    barcode: p.barcode || null,

    updated_at: new Date().toISOString(),
  }));

  if (!rows.length) return;

  // Try new onConflict first; fallback to old (store_id,sku) if user still has older schema
  try {
    const { error } = await supabase.from("inventory").upsert(rows, { onConflict: "store_id,product_id" });
    if (error) throw error;
  } catch (e) {
    const msg = String(e?.message || e || "");
    console.error("[Sync] Inventory sync failed (store_id,product_id):", msg);

    // fallback attempt for older schema (store_id,sku)
    try {
      const rowsSku = rows.filter((r) => r.sku); // needs sku for this fallback
      if (!rowsSku.length) return;
      const { error } = await supabase.from("inventory").upsert(rowsSku, { onConflict: "store_id,sku" });
      if (error) console.error("[Sync] Inventory sync failed (store_id,sku):", error.message);
    } catch (e2) {
      console.error("[Sync] Inventory sync network error:", String(e2?.message || e2));
    }
  }
}

module.exports = {
  init,
  testConnection,
  pushSharedCatalog,
  pullSharedCatalog,
  syncSale,
  syncInventory,
};