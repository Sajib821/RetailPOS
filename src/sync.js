// src/sync.js — Supabase sync (store metadata + catalog + inventory + sales + customers + payments + fiscal years + bank)
// Designed for exact cloud mirroring for one store at a time.

const { createClient } = require("@supabase/supabase-js");

let supabase = null;
let defaultStoreId = null;
let defaultStoreName = null;
let enabled = false;

// Prefer new table names; fallback to older ones if user still has them
const TABLES = {
  stores: ["stores"],
  catalogProducts: ["store_catalog_products", "catalog_products"],
  catalogCategories: ["store_catalog_categories", "catalog_categories"],
  inventory: ["inventory"],
  sales: ["sales"],
  customers: ["customers"],
  customerPayments: ["customer_payments"],
  fiscalYears: ["fiscal_years"],
  bankAccounts: ["bank_accounts"],
  bankTransactions: ["bank_transactions"],
  pendingManagerChanges: ["pending_manager_changes"],
};

function init(config) {
  if (!config?.supabaseUrl || !config?.supabaseKey || !config?.storeId) return;
  supabase = createClient(config.supabaseUrl, config.supabaseKey);
  defaultStoreId = String(config.storeId).trim();
  defaultStoreName = String(config.storeName || `Store ${defaultStoreId}`).trim();
  enabled = true;
  console.log(`[Sync] Connected: ${defaultStoreName} (${defaultStoreId})`);
}

function resolveStoreId(storeId) {
  return String(storeId || defaultStoreId || "").trim();
}

function resolveStoreName(storeName, storeId) {
  const sid = resolveStoreId(storeId);
  return String(storeName || defaultStoreName || `Store ${sid}`).trim();
}

async function pickFirstWorkingTable(candidates, testQueryFn) {
  for (const t of candidates) {
    const ok = await testQueryFn(t);
    if (ok) return t;
  }
  return candidates[0];
}

async function resolveTable(kind) {
  const candidates = TABLES[kind];
  if (!Array.isArray(candidates) || !candidates.length) return kind;
  return pickFirstWorkingTable(candidates, async (t) => {
    try {
      const { error } = await supabase.from(t).select("*").limit(1);
      return !error;
    } catch {
      return false;
    }
  });
}

function chunk(list, size = 500) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function safeJson(val) {
  if (val === undefined) return null;
  if (val === null) return null;
  if (typeof val === "object") return val;
  try {
    return JSON.parse(val);
  } catch {
    return null;
  }
}

function normNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

async function batchedInsert(table, rows) {
  if (!rows.length) return true;
  for (const batch of chunk(rows)) {
    const { error } = await supabase.from(table).insert(batch);
    if (error) throw new Error(error.message);
  }
  return true;
}

async function deleteStoreRows(table, storeId, keyColumn, keysToKeep = null) {
  const s = resolveStoreId(storeId);
  if (!s) return false;

  if (!Array.isArray(keysToKeep)) {
    const { error } = await supabase.from(table).delete().eq("store_id", s);
    if (error) throw new Error(error.message);
    return true;
  }

  const cleanedKeep = [...new Set(keysToKeep.map((x) => String(x)).filter(Boolean))];

  if (!cleanedKeep.length) {
    const { error } = await supabase.from(table).delete().eq("store_id", s);
    if (error) throw new Error(error.message);
    return true;
  }

  const { data: existing, error: readErr } = await supabase
    .from(table)
    .select(keyColumn)
    .eq("store_id", s);

  if (readErr) throw new Error(readErr.message);

  const existingKeys = (existing || [])
    .map((row) => row?.[keyColumn])
    .filter((v) => v !== null && v !== undefined)
    .map((v) => String(v));

  const missing = existingKeys.filter((v) => !cleanedKeep.includes(v));
  if (!missing.length) return true;

  for (const batch of chunk(missing)) {
    const { error } = await supabase
      .from(table)
      .delete()
      .eq("store_id", s)
      .in(keyColumn, batch);
    if (error) throw new Error(error.message);
  }

  return true;
}

async function replaceStoreScopedRows({ kind, storeId, keyColumn, rows, onConflict }) {
  if (!enabled) return false;

  const s = resolveStoreId(storeId);
  if (!s) return false;

  const table = await resolveTable(kind);

  // Cloud mirror mode: replace all rows for this store with the current local rows.
  // This avoids relying on PostgREST ON CONFLICT inference for partial unique indexes.
  await deleteStoreRows(table, s);
  await batchedInsert(table, rows);
  return true;
}

async function ensureStoreRow({ storeId, storeName, currency = "BDT", contact = "", receipt_footer = "Thank you for shopping with us!", fy_start_month = 7 } = {}) {
  if (!enabled) return false;

  const s = resolveStoreId(storeId);
  if (!s) return false;

  const table = await resolveTable("stores");
  const payload = {
    store_id: s,
    store_name: resolveStoreName(storeName, s),
    currency: String(currency || "BDT").trim() || "BDT",
    contact: String(contact || ""),
    receipt_footer: String(receipt_footer || "Thank you for shopping with us!"),
    fy_start_month: Number(fy_start_month || 7) || 7,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase.from(table).upsert(payload, { onConflict: "store_id" });
  if (error) throw new Error(error.message);
  return true;
}

async function testConnection() {
  if (!enabled) return false;

  try {
    const table = await pickFirstWorkingTable(TABLES.catalogProducts, async (t) => {
      const { error } = await supabase.from(t).select("*").limit(1);
      return !error;
    });
    return !!table;
  } catch {
    return false;
  }
}

async function syncStore(store) {
  if (!enabled) return false;
  await ensureStoreRow(store || {});
  return true;
}

// ------------------------------------------------------
// Per-store catalog push/pull
// main.js expects: pullSharedCatalog() / pushSharedCatalog()
// ------------------------------------------------------

async function pushSharedCatalog({ storeId, storeName, categories = [], products = [] } = {}) {
  if (!enabled) return false;

  const s = resolveStoreId(storeId);
  const sn = resolveStoreName(storeName, s);

  await ensureStoreRow({ storeId: s, storeName: sn });

  const catRows = (categories || []).map((c) => ({
    store_id: s,
    local_id: Number(c.id),
    name: String(c.name || "").trim(),
    color: String(c.color || "#6366f1").trim() || "#6366f1",
    updated_at: new Date().toISOString(),
  })).filter((row) => row.local_id && row.name);

  const prodRows = (products || []).map((p) => ({
    store_id: s,
    local_id: Number(p.id),
    sku: String(p.sku || "").trim() || null,
    name: String(p.name || "").trim(),
    category: String(p.category || "").trim(),
    price: normNum(p.price, 0),
    cost: normNum(p.cost, 0),
    low_stock_threshold: Number(p.low_stock_threshold || 5) || 5,
    barcode: String(p.barcode || "").trim() || null,
    updated_at: new Date().toISOString(),
  })).filter((row) => row.local_id && row.name);

  await replaceStoreScopedRows({
    kind: "catalogCategories",
    storeId: s,
    keyColumn: "local_id",
    rows: catRows,
    onConflict: "store_id,local_id",
  });

  await replaceStoreScopedRows({
    kind: "catalogProducts",
    storeId: s,
    keyColumn: "local_id",
    rows: prodRows,
    onConflict: "store_id,local_id",
  });

  return true;
}

async function pullSharedCatalog({ storeId } = {}) {
  if (!enabled) return { products: [], categories: [] };
  const s = resolveStoreId(storeId);

  const catTable = await resolveTable("catalogCategories");
  const prodTable = await resolveTable("catalogProducts");

  const { data: categories, error: catErr } = await supabase.from(catTable).select("*").eq("store_id", s);
  if (catErr) throw new Error(catErr.message);

  const { data: products, error: prodErr } = await supabase.from(prodTable).select("*").eq("store_id", s);
  if (prodErr) throw new Error(prodErr.message);

  return { products: products || [], categories: categories || [] };
}


async function listPendingManagerChanges({ storeId, status = "pending" } = {}) {
  if (!enabled) return [];
  const s = resolveStoreId(storeId);
  if (!s) return [];

  const table = await resolveTable("pendingManagerChanges");
  let query = supabase
    .from(table)
    .select("*")
    .eq("store_id", s)
    .order("requested_at", { ascending: true });

  const cleanStatus = String(status || "").trim().toLowerCase();
  if (cleanStatus) query = query.eq("status", cleanStatus);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data : [];
}

async function setPendingManagerChangeStatus({
  id,
  storeId,
  status,
  reviewedBy = null,
  reviewNote = null,
} = {}) {
  if (!enabled) return false;
  const changeId = Number(id);
  const s = resolveStoreId(storeId);
  const nextStatus = String(status || "").trim().toLowerCase();

  if (!changeId || !s || !["pending", "accepted", "rejected"].includes(nextStatus)) {
    return false;
  }

  const table = await resolveTable("pendingManagerChanges");
  const payload = {
    status: nextStatus,
    reviewed_by: reviewedBy ? String(reviewedBy).trim() : null,
    review_note: reviewNote ? String(reviewNote).trim() : null,
    reviewed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from(table)
    .update(payload)
    .eq("id", changeId)
    .eq("store_id", s);

  if (error) throw new Error(error.message);
  return true;
}

// ------------------------------------------------------
// Inventory
// ------------------------------------------------------

async function syncInventory(arg) {
  if (!enabled) return false;

  const payload = Array.isArray(arg) ? { products: arg } : (arg || {});
  const s = resolveStoreId(payload.storeId);
  const sn = resolveStoreName(payload.storeName, s);
  const products = Array.isArray(payload.products) ? payload.products : [];

  await ensureStoreRow({ storeId: s, storeName: sn });

  const rows = products.map((p) => ({
    store_id: s,
    store_name: sn,
    product_id: Number(p.id),
    product_name: String(p.name || "").trim(),
    sku: String(p.sku || "").trim() || null,
    category: String(p.category || "").trim(),
    price: normNum(p.price, 0),
    cost: normNum(p.cost, 0),
    stock: normNum(p.stock, 0),
    low_stock_threshold: Number(p.low_stock_threshold || 5) || 5,
    barcode: String(p.barcode || "").trim() || null,
    updated_at: new Date().toISOString(),
  })).filter((row) => row.product_id && row.product_name);

  await replaceStoreScopedRows({
    kind: "inventory",
    storeId: s,
    keyColumn: "product_id",
    rows,
    onConflict: "store_id,product_id",
  });

  return true;
}

// ------------------------------------------------------
// Customers / payments / fiscal years / bank
// ------------------------------------------------------

async function syncCustomers({ storeId, storeName, customers = [] } = {}) {
  if (!enabled) return false;
  const s = resolveStoreId(storeId);
  const sn = resolveStoreName(storeName, s);

  await ensureStoreRow({ storeId: s, storeName: sn });

  const rows = (customers || []).map((c) => ({
    store_id: s,
    local_id: Number(c.id),
    name: String(c.name || "").trim(),
    phone: String(c.phone || "").trim() || null,
    email: String(c.email || "").trim() || null,
    address: String(c.address || "").trim() || null,
    created_at: c.created_at || new Date().toISOString(),
    updated_at: c.updated_at || new Date().toISOString(),
  })).filter((row) => row.local_id && row.name);

  await replaceStoreScopedRows({
    kind: "customers",
    storeId: s,
    keyColumn: "local_id",
    rows,
    onConflict: "store_id,local_id",
  });

  return true;
}

async function syncCustomerPayments({ storeId, storeName, payments = [] } = {}) {
  if (!enabled) return false;
  const s = resolveStoreId(storeId);
  const sn = resolveStoreName(storeName, s);

  await ensureStoreRow({ storeId: s, storeName: sn });

  const rows = (payments || []).map((p) => ({
    store_id: s,
    local_id: Number(p.id),
    local_customer_id: p.customer_id === null || p.customer_id === undefined ? null : Number(p.customer_id),
    customer_name: String(p.customer_name || "").trim() || null,
    fiscal_year: String(p.fiscal_year || "").trim() || null,
    amount: normNum(p.amount, 0),
    method: String(p.method || "cash").trim() || "cash",
    note: String(p.note || "").trim() || null,
    cashier_id: p.cashier_id === null || p.cashier_id === undefined ? null : Number(p.cashier_id),
    cashier_name: String(p.cashier_name || "").trim() || null,
    created_at: p.created_at || new Date().toISOString(),
    updated_at: p.updated_at || p.created_at || new Date().toISOString(),
  })).filter((row) => row.local_id && row.amount > 0);

  await replaceStoreScopedRows({
    kind: "customerPayments",
    storeId: s,
    keyColumn: "local_id",
    rows,
    onConflict: "store_id,local_id",
  });

  return true;
}

async function syncFiscalYears({ storeId, storeName, fiscalYears = [] } = {}) {
  if (!enabled) return false;
  const s = resolveStoreId(storeId);
  const sn = resolveStoreName(storeName, s);

  await ensureStoreRow({ storeId: s, storeName: sn });

  const rows = (fiscalYears || []).map((fy) => ({
    store_id: s,
    local_id: fy.id === null || fy.id === undefined ? null : Number(fy.id),
    label: String(fy.label || "").trim(),
    start_date: fy.start_date || null,
    end_date: fy.end_date || null,
    inferred: Number(fy.inferred || 0) ? 1 : 0,
    created_at: fy.created_at || new Date().toISOString(),
    updated_at: fy.updated_at || fy.created_at || new Date().toISOString(),
  })).filter((row) => row.label);

  await replaceStoreScopedRows({
    kind: "fiscalYears",
    storeId: s,
    keyColumn: "label",
    rows,
    onConflict: "store_id,label",
  });

  return true;
}

async function syncBankData({ storeId, storeName, accounts = [], transactions = [] } = {}) {
  if (!enabled) return false;
  const s = resolveStoreId(storeId);
  const sn = resolveStoreName(storeName, s);

  await ensureStoreRow({ storeId: s, storeName: sn });

  const accountRows = (accounts || []).map((a) => ({
    store_id: s,
    local_id: Number(a.id),
    account_name: String(a.account_name || "").trim(),
    bank_name: String(a.bank_name || "").trim() || null,
    account_number: String(a.account_number || "").trim() || null,
    opening_balance: normNum(a.opening_balance, 0),
    note: String(a.note || "").trim() || null,
    active: Number(a.active === undefined ? 1 : a.active) ? 1 : 0,
    created_at: a.created_at || new Date().toISOString(),
    updated_at: a.updated_at || a.created_at || new Date().toISOString(),
  })).filter((row) => row.local_id && row.account_name);

  const txRows = (transactions || []).map((t) => ({
    store_id: s,
    local_id: Number(t.id),
    local_account_id: Number(t.account_id),
    type: String(t.type || "credit").trim().toLowerCase() === "debit" ? "debit" : "credit",
    amount: normNum(t.amount, 0),
    reference: String(t.reference || "").trim() || null,
    note: String(t.note || "").trim() || null,
    created_at: t.created_at || new Date().toISOString(),
    updated_at: t.updated_at || t.created_at || new Date().toISOString(),
  })).filter((row) => row.local_id && row.local_account_id && row.amount > 0);

  await replaceStoreScopedRows({
    kind: "bankAccounts",
    storeId: s,
    keyColumn: "local_id",
    rows: accountRows,
    onConflict: "store_id,local_id",
  });

  await replaceStoreScopedRows({
    kind: "bankTransactions",
    storeId: s,
    keyColumn: "local_id",
    rows: txRows,
    onConflict: "store_id,local_id",
  });

  return true;
}

async function pullBankData({ storeId } = {}) {
  if (!enabled) return { accounts: [], transactions: [] };

  const s = resolveStoreId(storeId);
  const accountsTable = await resolveTable("bankAccounts");
  const txTable = await resolveTable("bankTransactions");

  const { data: accounts, error: accErr } = await supabase
    .from(accountsTable)
    .select("store_id, local_id, account_name, bank_name, account_number, opening_balance, note, active, created_at, updated_at")
    .eq("store_id", s)
    .order("local_id", { ascending: true });

  if (accErr) throw new Error(accErr.message);

  const { data: transactions, error: txErr } = await supabase
    .from(txTable)
    .select("store_id, local_id, local_account_id, type, amount, reference, note, created_at, updated_at")
    .eq("store_id", s)
    .order("local_id", { ascending: true });

  if (txErr) throw new Error(txErr.message);

  return {
    accounts: Array.isArray(accounts) ? accounts : [],
    transactions: Array.isArray(transactions) ? transactions : [],
  };
}

// ------------------------------------------------------
// Sales
// ------------------------------------------------------

function mapSaleRow({ storeId, storeName, sale, items }) {
  return {
    store_id: resolveStoreId(storeId),
    store_name: resolveStoreName(storeName, storeId),

    local_id: sale?.id ?? sale?.local_id ?? null,

    total: normNum(sale?.total, 0),
    subtotal: normNum(sale?.subtotal, 0),
    tax: normNum(sale?.tax, 0),
    discount: normNum(sale?.discount, 0),

    payment_method: sale?.payment_method || null,
    payment_json: safeJson(sale?.payment_json),
    status: sale?.status || "completed",

    sale_type: sale?.sale_type || "sale",
    original_sale_id: sale?.original_sale_id ?? null,

    fiscal_year: sale?.fiscal_year || null,

    customer_id: sale?.customer_id ?? null,
    customer_name: sale?.customer_name || null,
    customer_phone: sale?.customer_phone || null,
    customer_email: sale?.customer_email || null,
    customer_address: sale?.customer_address || null,

    cashier_id: sale?.cashier_id ?? null,
    cashier_name: sale?.cashier_name || null,

    gross_profit: normNum(sale?.gross_profit, 0),

    items_count: Array.isArray(items) ? items.length : normNum(sale?.items_count, 0),
    items_json: Array.isArray(items) ? items : safeJson(sale?.items_json) || [],

    note: sale?.note || null,
    created_at: sale?.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

async function syncSale(arg1, arg2) {
  if (!enabled) return false;

  // Backward compatible signatures:
  // syncSale(sale, items)
  // syncSale({ storeId, storeName, sale, items })
  const payload = (arg1 && typeof arg1 === "object" && ("sale" in arg1 || "storeId" in arg1))
    ? arg1
    : { sale: arg1, items: arg2 };

  const s = resolveStoreId(payload.storeId);
  const sn = resolveStoreName(payload.storeName, s);

  await ensureStoreRow({ storeId: s, storeName: sn });

  const row = mapSaleRow({
    storeId: s,
    storeName: sn,
    sale: payload.sale || {},
    items: Array.isArray(payload.items) ? payload.items : [],
  });

  if (!row.local_id) return false;

  const table = await resolveTable("sales");
  const { error: delErr } = await supabase.from(table).delete().eq("store_id", s).eq("local_id", row.local_id);
  if (delErr) throw new Error(delErr.message);
  const { error: insErr } = await supabase.from(table).insert(row);
  if (insErr) throw new Error(insErr.message);
  return true;
}

async function syncSalesList({ storeId, storeName, sales = [], saleItemsBySaleId = {}, replaceMissing = false } = {}) {
  if (!enabled) return false;

  const s = resolveStoreId(storeId);
  const sn = resolveStoreName(storeName, s);

  await ensureStoreRow({ storeId: s, storeName: sn });

  const rows = (sales || []).map((sale) => mapSaleRow({
    storeId: s,
    storeName: sn,
    sale,
    items: Array.isArray(saleItemsBySaleId?.[String(sale.id)]) ? saleItemsBySaleId[String(sale.id)] : [],
  })).filter((row) => row.local_id);

  if (replaceMissing) {
    await replaceStoreScopedRows({
      kind: "sales",
      storeId: s,
      keyColumn: "local_id",
      rows,
      onConflict: "store_id,local_id",
    });
    return true;
  }

  const table = await resolveTable("sales");
  await deleteStoreRows(table, s);
  await batchedInsert(table, rows);
  return true;
}

// ------------------------------------------------------
// Full push / repair
// ------------------------------------------------------

async function syncAllData({
  store,
  categories = [],
  products = [],
  customers = [],
  customerPayments = [],
  fiscalYears = [],
  bankAccounts = [],
  bankTransactions = [],
  sales = [],
  saleItemsBySaleId = {},
} = {}) {
  if (!enabled) return false;

  const s = resolveStoreId(store?.store_id);
  const sn = resolveStoreName(store?.store_name, s);

  await syncStore({
    ...store,
    store_id: s,
    store_name: sn,
  });

  await pushSharedCatalog({ storeId: s, storeName: sn, categories, products });
  await syncInventory({ storeId: s, storeName: sn, products });
  await syncCustomers({ storeId: s, storeName: sn, customers });
  await syncCustomerPayments({ storeId: s, storeName: sn, payments: customerPayments });
  await syncFiscalYears({ storeId: s, storeName: sn, fiscalYears });
  await syncBankData({ storeId: s, storeName: sn, accounts: bankAccounts, transactions: bankTransactions });
  await syncSalesList({ storeId: s, storeName: sn, sales, saleItemsBySaleId, replaceMissing: true });

  return true;
}

module.exports = {
  init,
  testConnection,
  syncStore,
  pushSharedCatalog,
  pullSharedCatalog,
  syncInventory,
  syncCustomers,
  syncCustomerPayments,
  syncFiscalYears,
  syncBankData,
  pullBankData,
  syncSale,
  syncSalesList,
  syncAllData,
  listPendingManagerChanges,
  setPendingManagerChangeStatus,
};
