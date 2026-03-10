// src/main.js
// Multi-store RetailPOS (SQLite + IPC + per-store users + products + sales + refunds + reports + receipts + Supabase sync)
// + Superadmin + Stores + Fiscal Year + Customer Due/Payments + Historical Sales Import
// + Store contact / per-store receipt footer support

const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const crypto = require("crypto");
const fs = require("fs/promises");

require("dotenv").config();

const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;

let mainWindow;
let db;

let storeCtx = {
  store_id: "store_1",
  store_name: "Store 1",
  currency: "BDT",
  fy_start_month: 7,
};

let currentUser = null; // {id, store_id, username, name, role, manage_store_id?}

// ---------- Sync module (optional) ----------
let sync = {
  init: () => {},
  testConnection: async () => false,
  syncSale: async () => {},
  syncInventory: async () => {},
  pullSharedCatalog: async () => ({ products: [], categories: [] }),
  pushSharedCatalog: async () => true,
};

try {
  sync = require(path.join(__dirname, "sync"));
} catch {
  console.warn("[Sync] src/sync.js not found; running offline-only.");
}

// ---------- helpers ----------
function sha256(text) {
  return crypto.createHash("sha256").update(String(text)).digest("hex");
}

function parseDateLoose(s) {
  if (!s) return new Date();
  if (typeof s !== "string") return new Date(s);
  if (s.includes("T")) return new Date(s);
  const iso = s.replace(" ", "T");
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function fiscalYearFromDate(dateObj, startMonth = 7) {
  const y = dateObj.getFullYear();
  const m = dateObj.getMonth() + 1;
  if (m >= startMonth) return `${y}-${y + 1}`;
  return `${y - 1}-${y}`;
}

function isSuperadmin() {
  return currentUser?.role === "superadmin";
}

function isAdmin() {
  return currentUser?.role === "admin" || isSuperadmin();
}

function adminOnly() {
  return { ok: false, message: "Admin only" };
}

function superadminOnly() {
  return { ok: false, message: "Superadmin only" };
}

// Superadmin can temporarily "manage" another store without changing device settings
function effectiveStoreId() {
  if (isSuperadmin() && currentUser?.manage_store_id) return currentUser.manage_store_id;
  return storeCtx.store_id;
}

function getStoreRow(storeId) {
  try {
    return db.prepare("SELECT * FROM stores WHERE store_id=?").get(storeId);
  } catch {
    return null;
  }
}

function effectiveStoreName() {
  const sid = effectiveStoreId();
  try {
    const row = getStoreRow(sid);
    return row?.store_name || storeCtx.store_name || sid;
  } catch {
    return storeCtx.store_name || sid;
  }
}

function effectiveCurrency() {
  const sid = effectiveStoreId();
  try {
    const row = getStoreRow(sid);
    return row?.currency || storeCtx.currency || "BDT";
  } catch {
    return storeCtx.currency || "BDT";
  }
}

function effectiveFyStartMonth() {
  const sid = effectiveStoreId();
  try {
    const row = getStoreRow(sid);
    return Number(row?.fy_start_month || storeCtx.fy_start_month || 7) || 7;
  } catch {
    return Number(storeCtx.fy_start_month || 7) || 7;
  }
}

function effectiveReceiptFooter() {
  const sid = effectiveStoreId();
  try {
    const row = getStoreRow(sid);
    if (row && row.receipt_footer !== undefined && row.receipt_footer !== null) {
      return String(row.receipt_footer);
    }
    const s = getSettingsObject();
    return s.receipt_footer || "Thank you for shopping with us!";
  } catch {
    return "Thank you for shopping with us!";
  }
}

function effectiveContact() {
  const sid = effectiveStoreId();
  try {
    const row = getStoreRow(sid);
    if (row && row.contact !== undefined && row.contact !== null) {
      return String(row.contact);
    }
    const s = getSettingsObject();
    return s.contact || "";
  } catch {
    return "";
  }
}

function nowFiscalYear() {
  return fiscalYearFromDate(new Date(), effectiveFyStartMonth());
}

function safeHandle(channel, handler) {
  try {
    ipcMain.removeHandler(channel);
  } catch {}
  ipcMain.handle(channel, handler);
}

// ---------- window ----------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    backgroundColor: "#0f1117",
    show: false,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:3000");
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  mainWindow.once("ready-to-show", () => mainWindow.show());
}

// ---------- receipt PDF ----------
async function htmlToPdfBufferA4(html) {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  const buf = await win.webContents.printToPDF({ printBackground: true, pageSize: "A4" });
  win.destroy();
  return buf;
}

// ---------- Email ----------
async function sendEmailWithPdf({ to, subject, html, fileName }) {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = String(process.env.SMTP_SECURE || "false").toLowerCase() === "true";
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || user;

  if (!host || !user || !pass) {
    return { ok: false, message: "Email not configured (SMTP env missing)" };
  }

  let nodemailer;
  try {
    nodemailer = require("nodemailer");
  } catch {
    return { ok: false, message: "nodemailer not installed. Run: npm install nodemailer" };
  }

  const pdfBuffer = await htmlToPdfBufferA4(html);
  const transporter = nodemailer.createTransport({ host, port, secure, auth: { user, pass } });

  await transporter.sendMail({
    from,
    to,
    subject: subject || "RetailPOS Notification",
    text: "Attached PDF.",
    attachments: [
      {
        filename: fileName || "report.pdf",
        content: pdfBuffer,
        contentType: "application/pdf",
      },
    ],
  });

  return { ok: true };
}

// ---------- settings helpers ----------
function getSettingsObject() {
  const rows = db.prepare("SELECT * FROM settings").all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

function refreshStoreCtxFromSettings() {
  const s = getSettingsObject();
  storeCtx = {
    store_id: (s.store_id || "store_1").trim(),
    store_name: (s.store_name || "Store 1").trim(),
    currency: (s.currency || "BDT").trim(),
    fy_start_month: Number(s.fy_start_month || 7) || 7,
  };
}

function getEffectiveSettingsObject() {
  const base = getSettingsObject();
  const sid = effectiveStoreId();
  const row = getStoreRow(sid) || {};

  return {
    ...base,
    store_id: sid,
    store_name: row.store_name || base.store_name || storeCtx.store_name || sid,
    currency: row.currency || base.currency || storeCtx.currency || "BDT",
    fy_start_month: String(row.fy_start_month || base.fy_start_month || storeCtx.fy_start_month || 7),
    receipt_footer:
      row.receipt_footer !== undefined && row.receipt_footer !== null
        ? row.receipt_footer
        : base.receipt_footer || "Thank you for shopping with us!",
    contact:
      row.contact !== undefined && row.contact !== null
        ? row.contact
        : base.contact || "",
  };
}

// ---------- sync init ----------
function initSyncFromSettings() {
  try {
    const s = getSettingsObject();
    const supabaseUrl = (s.supabase_url || "").trim();
    const supabaseKey = (s.supabase_key || "").trim();
    const storeId = (s.store_id || "").trim();
    const storeName = (s.store_name || "").trim();

    if (!supabaseUrl || !supabaseKey || !storeId) return;
    if (!sync || typeof sync.init !== "function") return;

    sync.init({ supabaseUrl, supabaseKey, storeId, storeName });

    const products = db.prepare("SELECT * FROM products WHERE store_id=?").all(storeId);
    Promise.resolve(sync.syncInventory(products)).catch(() => {});
  } catch {
    // offline ok
  }
}

// ---------- customer due ----------
function computeCustomerDueByYear(store_id, customer_id) {
  const fyStart = effectiveFyStartMonth();

  const dueSales = db.prepare(`
    SELECT id, fiscal_year, total, sale_type, status, created_at
    FROM sales
    WHERE store_id=? AND customer_id=? AND status='due'
  `).all(store_id, customer_id);

  const payments = db.prepare(`
    SELECT fiscal_year, amount
    FROM customer_payments
    WHERE store_id=? AND customer_id=?
  `).all(store_id, customer_id);

  const yearMap = new Map();

  const addYear = (fy) => {
    if (!yearMap.has(fy)) {
      yearMap.set(fy, {
        fiscal_year: fy,
        credit_sales: 0,
        refunds: 0,
        payments: 0,
        due: 0,
      });
    }
    return yearMap.get(fy);
  };

  for (const s of dueSales) {
    const fy = s.fiscal_year || fiscalYearFromDate(parseDateLoose(s.created_at), fyStart);
    const y = addYear(fy);
    if ((s.sale_type || "sale") === "refund") y.refunds += Number(s.total || 0);
    else y.credit_sales += Number(s.total || 0);
  }

  for (const p of payments) {
    const fy = p.fiscal_year || nowFiscalYear();
    const y = addYear(fy);
    y.payments += Number(p.amount || 0);
  }

  let overall = 0;
  const years = Array.from(yearMap.values())
    .map((y) => {
      const raw =
        Number(y.credit_sales || 0) +
        Number(y.refunds || 0) -
        Number(y.payments || 0);
      y.due = Math.max(0, raw);
      overall += y.due;
      return y;
    })
    .sort((a, b) => (a.fiscal_year > b.fiscal_year ? -1 : 1));

  return { overall_due: overall, years };
}

// ---------- categories normalization for old DBs ----------
function normalizeCategoriesTable() {
  const cols = db.prepare("PRAGMA table_info(categories)").all().map((r) => r.name);
  const hasStoreId = cols.includes("store_id");
  const hasColor = cols.includes("color");

  const rows = db.prepare(`
    SELECT id,
           ${hasStoreId ? "store_id" : "NULL AS store_id"},
           name,
           ${hasColor ? "color" : "'#6366f1' AS color"}
    FROM categories
    ORDER BY id ASC
  `).all();

  const tx = db.transaction(() => {
    db.exec(`
      DROP TABLE IF EXISTS categories_new;
      CREATE TABLE categories_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        store_id TEXT,
        name TEXT NOT NULL,
        color TEXT DEFAULT '#6366f1'
      );
    `);

    const ins = db.prepare(`
      INSERT INTO categories_new (store_id, name, color)
      VALUES (?, ?, ?)
    `);

    const seen = new Set();

    for (const row of rows) {
      const sid = String(row.store_id || storeCtx.store_id || "store_1").trim();
      const name = String(row.name || "").trim();
      const color = String(row.color || "#6366f1").trim() || "#6366f1";

      if (!name) continue;

      const key = `${sid}::${name.toLowerCase()}`;
      if (seen.has(key)) continue;

      ins.run(sid, name, color);
      seen.add(key);
    }

    db.exec("DROP TABLE categories;");
    db.exec("ALTER TABLE categories_new RENAME TO categories;");
  });

  tx();
}

// ---------- DB init ----------
function initDB() {
  const Database = require("better-sqlite3");
  const dbPath = path.join(app.getPath("userData"), "retailpos.db");
  db = new Database(dbPath);

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);

    INSERT OR IGNORE INTO settings VALUES ('store_name', 'Store 1');
    INSERT OR IGNORE INTO settings VALUES ('store_id', 'store_1');
    INSERT OR IGNORE INTO settings VALUES ('currency', 'BDT');
    INSERT OR IGNORE INTO settings VALUES ('fy_start_month', '7');
    INSERT OR IGNORE INTO settings VALUES ('receipt_footer', 'Thank you for shopping with us!');
    INSERT OR IGNORE INTO settings VALUES ('contact', '');
    INSERT OR IGNORE INTO settings VALUES ('supabase_url', '');
    INSERT OR IGNORE INTO settings VALUES ('supabase_key', '');
    INSERT OR IGNORE INTO settings VALUES ('superadmin_pin_hash', '${sha256("1111")}');

    CREATE TABLE IF NOT EXISTS stores (
      store_id TEXT PRIMARY KEY,
      store_name TEXT NOT NULL,
      currency TEXT DEFAULT 'BDT',
      contact TEXT DEFAULT '',
      receipt_footer TEXT DEFAULT 'Thank you for shopping with us!',
      fy_start_month INTEGER DEFAULT 7,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id TEXT,
      name TEXT NOT NULL,
      sku TEXT,
      category TEXT,
      price REAL NOT NULL,
      cost REAL DEFAULT 0,
      stock INTEGER DEFAULT 0,
      low_stock_threshold INTEGER DEFAULT 5,
      barcode TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id TEXT,
      name TEXT NOT NULL,
      color TEXT DEFAULT '#6366f1'
    );

    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id TEXT,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      address TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id TEXT,
      username TEXT,
      name TEXT NOT NULL,
      role TEXT DEFAULT 'cashier',
      pin_hash TEXT NOT NULL,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id TEXT,
      store_name TEXT,
      fiscal_year TEXT,
      total REAL NOT NULL,
      subtotal REAL NOT NULL,
      tax REAL DEFAULT 0,
      discount REAL DEFAULT 0,
      payment_method TEXT DEFAULT 'cash',
      status TEXT DEFAULT 'completed',
      payment_json TEXT,
      note TEXT,
      sale_type TEXT DEFAULT 'sale',
      original_sale_id INTEGER,
      customer_id INTEGER,
      customer_name TEXT,
      cashier_id INTEGER,
      cashier_name TEXT,
      gross_profit REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      price REAL NOT NULL,
      subtotal REAL NOT NULL,
      cost REAL DEFAULT 0,
      profit REAL DEFAULT 0,
      FOREIGN KEY (sale_id) REFERENCES sales(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS customer_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id TEXT NOT NULL,
      customer_id INTEGER NOT NULL,
      fiscal_year TEXT NOT NULL,
      amount REAL NOT NULL,
      method TEXT DEFAULT 'cash',
      note TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      cashier_id INTEGER,
      cashier_name TEXT
    );
  `);

  const ensureCol = (table, col, def) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name);
    if (!cols.includes(col)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def};`);
    }
  };

  refreshStoreCtxFromSettings();

  ensureCol("stores", "currency", "TEXT DEFAULT 'BDT'");
  ensureCol("stores", "contact", "TEXT DEFAULT ''");
  ensureCol("stores", "receipt_footer", "TEXT DEFAULT 'Thank you for shopping with us!'");
  ensureCol("stores", "fy_start_month", "INTEGER DEFAULT 7");

  ensureCol("products", "store_id", "TEXT");
  ensureCol("categories", "store_id", "TEXT");
  ensureCol("customers", "store_id", "TEXT");
  ensureCol("users", "store_id", "TEXT");
  ensureCol("users", "username", "TEXT");

  ensureCol("sales", "store_id", "TEXT");
  ensureCol("sales", "store_name", "TEXT");
  ensureCol("sales", "fiscal_year", "TEXT");
  ensureCol("sales", "payment_json", "TEXT");
  ensureCol("sales", "sale_type", "TEXT DEFAULT 'sale'");
  ensureCol("sales", "original_sale_id", "INTEGER");
  ensureCol("sales", "customer_id", "INTEGER");
  ensureCol("sales", "customer_name", "TEXT");
  ensureCol("sales", "cashier_id", "INTEGER");
  ensureCol("sales", "cashier_name", "TEXT");
  ensureCol("sales", "gross_profit", "REAL DEFAULT 0");

  ensureCol("sale_items", "cost", "REAL DEFAULT 0");
  ensureCol("sale_items", "profit", "REAL DEFAULT 0");

  db.prepare("UPDATE products SET store_id=? WHERE store_id IS NULL OR store_id=''").run(storeCtx.store_id);
  db.prepare("UPDATE categories SET store_id=? WHERE store_id IS NULL OR store_id=''").run(storeCtx.store_id);
  db.prepare("UPDATE customers SET store_id=? WHERE store_id IS NULL OR store_id=''").run(storeCtx.store_id);
  db.prepare("UPDATE users SET store_id=? WHERE store_id IS NULL OR store_id=''").run(storeCtx.store_id);
  db.prepare("UPDATE sales SET store_id=?, store_name=COALESCE(store_name, ?) WHERE store_id IS NULL OR store_id=''")
    .run(storeCtx.store_id, storeCtx.store_name);

  const baseSettings = getSettingsObject();

  db.prepare(`
    INSERT OR IGNORE INTO stores (
      store_id, store_name, currency, contact, receipt_footer, fy_start_month
    ) VALUES (?,?,?,?,?,?)
  `).run(
    storeCtx.store_id,
    storeCtx.store_name,
    storeCtx.currency,
    String(baseSettings.contact || ""),
    String(baseSettings.receipt_footer || "Thank you for shopping with us!"),
    Number(baseSettings.fy_start_month || 7) || 7
  );

  db.prepare(`
    UPDATE stores
    SET
      store_name = COALESCE(NULLIF(store_name,''), ?),
      currency = COALESCE(NULLIF(currency,''), ?),
      contact = COALESCE(contact, ?),
      receipt_footer = COALESCE(receipt_footer, ?),
      fy_start_month = COALESCE(fy_start_month, ?)
    WHERE store_id=?
  `).run(
    storeCtx.store_name,
    storeCtx.currency,
    String(baseSettings.contact || ""),
    String(baseSettings.receipt_footer || "Thank you for shopping with us!"),
    Number(baseSettings.fy_start_month || 7) || 7,
    storeCtx.store_id
  );

  const usersNoUsername = db.prepare(`
    SELECT id, store_id, name
    FROM users
    WHERE username IS NULL OR username=''
  `).all();

  const checkUsername = db.prepare(`
    SELECT id
    FROM users
    WHERE store_id=? AND lower(username)=lower(?) AND id<>?
  `);

  const setUsername = db.prepare("UPDATE users SET username=? WHERE id=?");

  usersNoUsername.forEach((u) => {
    const base = String(u.name || "user").trim().toLowerCase().replace(/\s+/g, "_") || "user";
    let candidate = base;
    let n = 1;

    while (checkUsername.get(u.store_id, candidate, u.id)) {
      n += 1;
      candidate = `${base}${n}`;
    }

    setUsername.run(candidate, u.id);
  });

  const fyStart = storeCtx.fy_start_month || 7;
  const salesNoFY = db.prepare(`
    SELECT id, created_at
    FROM sales
    WHERE fiscal_year IS NULL OR fiscal_year=''
  `).all();

  const updFY = db.prepare("UPDATE sales SET fiscal_year=? WHERE id=?");
  salesNoFY.forEach((s) => {
    updFY.run(fiscalYearFromDate(parseDateLoose(s.created_at), fyStart), s.id);
  });

  normalizeCategoriesTable();

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales(created_at);
    CREATE INDEX IF NOT EXISTS idx_sales_store_id ON sales(store_id);
    CREATE INDEX IF NOT EXISTS idx_products_store_id ON products(store_id);
    CREATE INDEX IF NOT EXISTS idx_customers_store_id ON customers(store_id);
    CREATE INDEX IF NOT EXISTS idx_categories_store_id ON categories(store_id);
    CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items(sale_id);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_store_username_unique ON users(store_id, username);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_store_name_unique ON categories(store_id, name);

    CREATE INDEX IF NOT EXISTS idx_payments_store_customer_year ON customer_payments(store_id, customer_id, fiscal_year);
    CREATE INDEX IF NOT EXISTS idx_payments_created_at ON customer_payments(created_at);
  `);

  const seedCategories = [
    ["Electronics", "#6366f1"],
    ["Clothing", "#ec4899"],
    ["Food & Drink", "#f59e0b"],
    ["Home & Garden", "#10b981"],
    ["Sports", "#3b82f6"],
    ["Books", "#8b5cf6"],
  ];

  const seedTx = db.transaction(() => {
    const ins = db.prepare(`
      INSERT OR IGNORE INTO categories (store_id, name, color)
      VALUES (?, ?, ?)
    `);

    for (const [name, color] of seedCategories) {
      ins.run(storeCtx.store_id, name, color);
    }
  });

  seedTx();

  const admin = db.prepare(`
    SELECT id
    FROM users
    WHERE store_id=? AND lower(username)='admin'
  `).get(storeCtx.store_id);

  if (!admin) {
    db.prepare(`
      INSERT INTO users (store_id, username, name, role, pin_hash)
      VALUES (?,?,?,?,?)
    `).run(storeCtx.store_id, "admin", "Admin", "admin", sha256("1234"));
  }

  initSyncFromSettings();
}

// ---------- IPC ----------
function registerIpcHandlers() {
  // -------------------- STORE --------------------
  safeHandle("store:get", () => ({
    store_id: effectiveStoreId(),
    store_name: effectiveStoreName(),
    currency: effectiveCurrency(),
    fy_start_month: effectiveFyStartMonth(),
    receipt_footer: effectiveReceiptFooter(),
    contact: effectiveContact(),
    is_superadmin: isSuperadmin(),
  }));

  // -------------------- STORES (Superadmin) --------------------
  safeHandle("stores:list", () => {
    try {
      return db.prepare("SELECT * FROM stores ORDER BY store_id").all();
    } catch {
      return [];
    }
  });

  safeHandle("stores:create", (_, { store_id, store_name, currency }) => {
    if (!isSuperadmin()) return superadminOnly();

    const sid = String(store_id || "").trim();
    const sn = String(store_name || "").trim();
    const cur = String(currency || "BDT").trim();

    if (!sid || !sn) return { ok: false, message: "Store ID and Store Name required" };

    try {
      db.prepare(`
        INSERT INTO stores (
          store_id, store_name, currency, contact, receipt_footer, fy_start_month
        ) VALUES (?,?,?,?,?,?)
      `).run(
        sid,
        sn,
        cur,
        "",
        "Thank you for shopping with us!",
        7
      );

      const admin = db.prepare(`
        SELECT id FROM users WHERE store_id=? AND lower(username)='admin'
      `).get(sid);

      if (!admin) {
        db.prepare(`
          INSERT INTO users (store_id, username, name, role, pin_hash)
          VALUES (?,?,?,?,?)
        `).run(sid, "admin", "Admin", "admin", sha256("1234"));
      }

      return { ok: true };
    } catch {
      return { ok: false, message: "Store ID already exists" };
    }
  });

  safeHandle("stores:setActive", (_, { store_id }) => {
    if (!isSuperadmin()) return superadminOnly();

    const sid = String(store_id || "").trim();
    const st = db.prepare("SELECT * FROM stores WHERE store_id=?").get(sid);
    if (!st) return { ok: false, message: "Store not found" };

    currentUser.manage_store_id = sid;
    return { ok: true, store: st };
  });

  // -------------------- AUTH --------------------
  safeHandle("auth:current", () => currentUser);

  safeHandle("auth:login", (_, payload) => {
    const username = String(payload?.username || "").trim();
    const pin = String(payload?.pin || "").trim();
    const requestedStore = String(payload?.store_id || "").trim();

    // (A) Superadmin
    if (username && username.toLowerCase() === "superadmin") {
      const s = getSettingsObject();
      const hash = s.superadmin_pin_hash || sha256("1111");

      if (sha256(pin) !== hash) {
        return { ok: false, message: "Invalid Superadmin PIN" };
      }

      currentUser = {
        id: 0,
        role: "superadmin",
        username: "superadmin",
        name: "Superadmin",
      };

      if (requestedStore) {
        const st = db.prepare("SELECT * FROM stores WHERE store_id=?").get(requestedStore);
        if (!st) return { ok: false, message: "Store not found for Superadmin" };
        currentUser.manage_store_id = requestedStore;
      }

      return { ok: true, user: currentUser };
    }

    // (B) Username + PIN
    if (username && pin) {
      const u = username.toLowerCase();
      const h = sha256(pin);
      const sid = effectiveStoreId();

      const user = db.prepare(`
        SELECT id, store_id, username, name, role, active
        FROM users
        WHERE store_id=? AND lower(username)=? AND pin_hash=? AND active=1
      `).get(sid, u, h);

      if (!user) return { ok: false, message: "Invalid username or PIN for this store" };

      currentUser = {
        id: user.id,
        store_id: user.store_id,
        username: user.username,
        name: user.name,
        role: user.role,
      };

      return { ok: true, user: currentUser };
    }

    // (C) PIN-only
    if (!username && pin) {
      const sid = effectiveStoreId();
      const h = sha256(pin);

      const matches = db.prepare(`
        SELECT id, store_id, username, name, role
        FROM users
        WHERE store_id=? AND pin_hash=? AND active=1
      `).all(sid, h);

      if (matches.length === 0) {
        return { ok: false, message: "No user found with that PIN in this store" };
      }

      if (matches.length > 1) {
        return { ok: false, message: "Multiple users share this PIN. Use username + PIN." };
      }

      const user = matches[0];
      currentUser = {
        id: user.id,
        store_id: user.store_id,
        username: user.username,
        name: user.name,
        role: user.role,
      };

      return { ok: true, user: currentUser };
    }

    return { ok: false, message: "Provide (Superadmin+PIN) OR (Username+PIN) OR (PIN-only)" };
  });

  safeHandle("auth:logout", () => {
    currentUser = null;
    return { ok: true };
  });

  safeHandle("auth:changePassword", (_, { oldPin, newPin }) => {
    const oldP = String(oldPin || "").trim();
    const newP = String(newPin || "").trim();

    if (!oldP || !newP) return { ok: false, message: "Old and new PIN required" };
    if (newP.length < 3 || newP.length > 30) {
      return { ok: false, message: "PIN must be 3–30 characters" };
    }

    if (isSuperadmin()) {
      const s = getSettingsObject();
      const hash = s.superadmin_pin_hash || sha256("1111");
      if (sha256(oldP) !== hash) return { ok: false, message: "Old Superadmin PIN incorrect" };

      db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('superadmin_pin_hash',?)")
        .run(sha256(newP));

      return { ok: true };
    }

    if (!currentUser) return { ok: false, message: "Login required" };

    const sid = effectiveStoreId();
    const row = db.prepare(`
      SELECT pin_hash FROM users
      WHERE id=? AND store_id=? AND active=1
    `).get(currentUser.id, sid);

    if (!row) return { ok: false, message: "User not found" };
    if (sha256(oldP) !== row.pin_hash) return { ok: false, message: "Old PIN incorrect" };

    db.prepare("UPDATE users SET pin_hash=? WHERE id=? AND store_id=?")
      .run(sha256(newP), currentUser.id, sid);

    return { ok: true };
  });

  // -------------------- USERS --------------------
  safeHandle("users:getAll", (_, payload = {}) => {
    const sid = isSuperadmin() && payload?.store_id
      ? String(payload.store_id).trim()
      : effectiveStoreId();

    return db.prepare(`
      SELECT id, store_id, username, name, role, active, created_at
      FROM users
      WHERE store_id=?
      ORDER BY id DESC
    `).all(sid);
  });

  safeHandle("users:create", (_, payload) => {
    if (!isAdmin()) return adminOnly();

    const sid = isSuperadmin() && payload?.store_id
      ? String(payload.store_id).trim()
      : effectiveStoreId();

    const u = String(payload?.username || "").trim().toLowerCase();
    const n = String(payload?.name || "").trim();
    const r = String(payload?.role || "cashier").trim();
    const p = String(payload?.pin || "").trim();

    if (!u || !n || !p) return { ok: false, message: "Username, name and PIN required" };

    try {
      const res = db.prepare(`
        INSERT INTO users (store_id, username, name, role, pin_hash)
        VALUES (?,?,?,?,?)
      `).run(sid, u, n, r, sha256(p));

      return { ok: true, id: res.lastInsertRowid };
    } catch {
      return { ok: false, message: "Username already exists in this store" };
    }
  });

  safeHandle("users:update", (_, payload) => {
    if (!isAdmin()) return adminOnly();

    const sid = isSuperadmin() && payload?.store_id
      ? String(payload.store_id).trim()
      : effectiveStoreId();

    const uid = Number(payload?.id);
    const u = String(payload?.username || "").trim().toLowerCase();
    const n = String(payload?.name || "").trim();
    const r = String(payload?.role || "cashier").trim();
    const a = payload?.active ? 1 : 0;

    if (!uid) return { ok: false, message: "Missing id" };
    if (!u || !n) return { ok: false, message: "Username and name required" };

    const exists = db.prepare(`
      SELECT id FROM users
      WHERE store_id=? AND lower(username)=? AND id<>?
    `).get(sid, u, uid);

    if (exists) return { ok: false, message: "Username already exists in this store" };

    db.prepare(`
      UPDATE users
      SET username=?, name=?, role=?, active=?
      WHERE id=? AND store_id=?
    `).run(u, n, r, a, uid, sid);

    return { ok: true };
  });

  safeHandle("users:setPin", (_, payload) => {
    if (!isAdmin()) return adminOnly();

    const sid = isSuperadmin() && payload?.store_id
      ? String(payload.store_id).trim()
      : effectiveStoreId();

    const uid = Number(payload?.id);
    const p = String(payload?.pin || "").trim();

    if (!uid || !p) return { ok: false, message: "Missing id/PIN" };

    db.prepare("UPDATE users SET pin_hash=? WHERE id=? AND store_id=?")
      .run(sha256(p), uid, sid);

    return { ok: true };
  });

  safeHandle("users:delete", (_, payload) => {
    if (!isAdmin()) return adminOnly();

    const sid = isSuperadmin() && payload?.store_id
      ? String(payload.store_id).trim()
      : effectiveStoreId();

    const uid = typeof payload === "number" ? Number(payload) : Number(payload?.id);

    if (!uid) return { ok: false, message: "Missing id" };
    if (!isSuperadmin() && currentUser?.id === uid) {
      return { ok: false, message: "You can't delete yourself while logged in" };
    }

    const u = db.prepare("SELECT role, active FROM users WHERE id=? AND store_id=?").get(uid, sid);
    const admins = db.prepare(`
      SELECT COUNT(*) as c
      FROM users
      WHERE store_id=? AND role='admin' AND active=1
    `).get(sid).c;

    if (u?.role === "admin" && admins <= 1) {
      return { ok: false, message: "You can't delete the last admin" };
    }

    db.prepare("DELETE FROM users WHERE id=? AND store_id=?").run(uid, sid);
    return { ok: true };
  });

  // -------------------- CUSTOMERS --------------------
  safeHandle("customers:getAll", () => {
    return db.prepare("SELECT * FROM customers WHERE store_id=? ORDER BY id DESC")
      .all(effectiveStoreId());
  });

  safeHandle("customers:search", (_, q) => {
    const query = `%${String(q || "").trim()}%`;
    const sid = effectiveStoreId();

    return db.prepare(`
      SELECT * FROM customers
      WHERE store_id=? AND (name LIKE ? OR phone LIKE ? OR email LIKE ?)
      ORDER BY id DESC
    `).all(sid, query, query, query);
  });

  safeHandle("customers:create", (_, c) => {
    const sid = effectiveStoreId();

    const r = db.prepare(`
      INSERT INTO customers (store_id,name,phone,email,address,updated_at)
      VALUES (?,?,?,?,?,datetime('now'))
    `).run(
      sid,
      c.name,
      c.phone || "",
      c.email || "",
      c.address || ""
    );

    return { ok: true, id: r.lastInsertRowid };
  });

  safeHandle("customers:update", (_, c) => {
    const sid = effectiveStoreId();

    db.prepare(`
      UPDATE customers
      SET name=?, phone=?, email=?, address=?, updated_at=datetime('now')
      WHERE id=? AND store_id=?
    `).run(
      c.name,
      c.phone || "",
      c.email || "",
      c.address || "",
      c.id,
      sid
    );

    return { ok: true };
  });

  safeHandle("customers:delete", (_, id) => {
    const sid = effectiveStoreId();
    db.prepare("DELETE FROM customers WHERE id=? AND store_id=?").run(Number(id), sid);
    return { ok: true };
  });

  safeHandle("customers:sales", (_, customerId) => {
    return db.prepare(`
      SELECT * FROM sales
      WHERE store_id=? AND customer_id=?
      ORDER BY created_at DESC
    `).all(effectiveStoreId(), customerId);
  });

  safeHandle("customers:dueSummary", (_, arg) => {
    const sid = effectiveStoreId();
    const cid = Number(typeof arg === "object" ? arg?.customer_id : arg);

    const customer = db.prepare("SELECT * FROM customers WHERE id=? AND store_id=?").get(cid, sid);
    if (!customer) return { ok: false, message: "Customer not found" };

    const due = computeCustomerDueByYear(sid, cid);
    return { ok: true, customer, ...due };
  });

  safeHandle("customers:history", (_, { customer_id, range, fiscal_year } = {}) => {
    const sid = effectiveStoreId();
    const cid = Number(customer_id);
    const fy = String(fiscal_year || "").trim();

    let where = "1=1";
    if (range === "today") where = "date(created_at)=date('now')";
    if (range === "7d") where = "date(created_at)>=date('now','-7 days')";
    if (range === "month") where = "date(created_at)>=date('now','-30 days')";
    if (range === "fy" && fy) where = "fiscal_year=?";

    const salesSql = `
      SELECT * FROM sales
      WHERE store_id=? AND customer_id=? AND ${where}
      ORDER BY created_at DESC
    `;

    const sales =
      range === "fy" && fy
        ? db.prepare(salesSql).all(sid, cid, fy)
        : db.prepare(salesSql).all(sid, cid);

    const paymentsSql = `
      SELECT * FROM customer_payments
      WHERE store_id=? AND customer_id=? ${range === "fy" && fy ? "AND fiscal_year=?" : ""}
      ORDER BY created_at DESC
    `;

    const payments =
      range === "fy" && fy
        ? db.prepare(paymentsSql).all(sid, cid, fy)
        : db.prepare(paymentsSql).all(sid, cid);

    return { ok: true, sales, payments };
  });

  safeHandle("customers:addPayment", async (_, payload) => {
    if (!currentUser) return { ok: false, message: "Login required" };

    const sid = effectiveStoreId();
    const cid = Number(payload?.customer_id);
    const amount = Number(payload?.amount || 0);
    const fy = String(payload?.fiscal_year || "").trim() || nowFiscalYear();
    const method = String(payload?.method || "cash").trim();
    const note = String(payload?.note || "").trim();

    if (!cid || amount <= 0) return { ok: false, message: "Customer and amount required" };

    const cust = db.prepare("SELECT * FROM customers WHERE id=? AND store_id=?").get(cid, sid);
    if (!cust) return { ok: false, message: "Customer not found" };

    const r = db.prepare(`
      INSERT INTO customer_payments (
        store_id, customer_id, fiscal_year, amount, method, note, created_at, cashier_id, cashier_name
      )
      VALUES (?,?,?,?,?,?, datetime('now'), ?, ?)
    `).run(
      sid,
      cid,
      fy,
      amount,
      method,
      note || `Payment for ${fy}`,
      currentUser.id || null,
      currentUser.name || null
    );

    const due = computeCustomerDueByYear(sid, cid);
    const yearRow = due.years.find((y) => y.fiscal_year === fy) || { due: 0 };

    let emailed = false;
    let emailMsg = null;

    if (cust.email) {
      const html = `
        <html>
          <body style="font-family: Arial, sans-serif; padding: 24px;">
            <h2>Payment received</h2>
            <p><b>Customer:</b> ${cust.name}</p>
            <p><b>Store:</b> ${effectiveStoreName()}</p>
            <p><b>Fiscal year:</b> ${fy}</p>
            <p><b>Paid:</b> ${amount.toFixed(2)} (${method})</p>
            <p><b>Remaining due for ${fy}:</b> ${Number(yearRow.due || 0).toFixed(2)}</p>
            <p><b>Total due (all years):</b> ${Number(due.overall_due || 0).toFixed(2)}</p>
            <p style="margin-top:16px;color:#666;">RetailPOS</p>
          </body>
        </html>
      `;

      const send = await sendEmailWithPdf({
        to: cust.email,
        subject: `Payment receipt (${fy})`,
        html,
        fileName: `payment-${cust.name}-${fy}.pdf`,
      });

      emailed = !!send.ok;
      emailMsg = send.ok ? null : send.message;
    }

    return {
      ok: true,
      payment_id: r.lastInsertRowid,
      emailed,
      email_message: emailMsg,
      due_year: yearRow.due,
      due_total: due.overall_due,
    };
  });

  // -------------------- SALES --------------------
  safeHandle("sales:addHistorical", (_, payload) => {
    if (!isAdmin()) return adminOnly();

    const sid = effectiveStoreId();
    const storeName = effectiveStoreName();

    const cid = Number(payload?.customer_id);
    const customer = db.prepare("SELECT * FROM customers WHERE id=? AND store_id=?").get(cid, sid);
    if (!customer) return { ok: false, message: "Customer not found" };

    const fy = String(payload?.fiscal_year || "").trim() || nowFiscalYear();
    const amount = Number(payload?.total || 0);
    const status = String(payload?.status || "due");
    const created_at = String(payload?.created_at || "").trim() || null;
    const note = String(payload?.note || `Historical sale import for ${fy}`).trim();

    if (amount <= 0) return { ok: false, message: "Total must be > 0" };

    const r = db.prepare(`
      INSERT INTO sales (
        store_id, store_name, fiscal_year,
        total, subtotal, tax, discount,
        payment_method, status, payment_json, note,
        sale_type, original_sale_id,
        customer_id, customer_name,
        cashier_id, cashier_name,
        gross_profit,
        created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, COALESCE(?, datetime('now')))
    `).run(
      sid,
      storeName,
      fy,
      amount,
      amount,
      0,
      0,
      "history",
      status,
      null,
      note,
      "sale",
      null,
      cid,
      customer.name,
      currentUser?.id || null,
      currentUser?.name || null,
      0,
      created_at
    );

    return { ok: true, saleId: r.lastInsertRowid };
  });

  safeHandle("sales:create", (_, { sale, items }) => {
    if (!currentUser) return { ok: false, message: "Please login before selling." };

    const sid = effectiveStoreId();
    const storeName = effectiveStoreName();
    const fy = fiscalYearFromDate(new Date(), effectiveFyStartMonth());

    const insertSale = db.prepare(`
      INSERT INTO sales (
        store_id, store_name, fiscal_year,
        total, subtotal, tax, discount,
        payment_method, status, payment_json, note,
        sale_type, original_sale_id,
        customer_id, customer_name,
        cashier_id, cashier_name,
        gross_profit
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);

    const insertItem = db.prepare(`
      INSERT INTO sale_items (sale_id, product_id, product_name, quantity, price, subtotal, cost, profit)
      VALUES (?,?,?,?,?,?,?,?)
    `);

    const updateStock = db.prepare(`
      UPDATE products
      SET stock=stock-?, updated_at=datetime('now')
      WHERE id=? AND store_id=?
    `);

    const getProduct = db.prepare("SELECT cost FROM products WHERE id=? AND store_id=?");

    const tx = db.transaction(() => {
      let grossProfit = 0;

      const enriched = (items || []).map((it) => {
        const prod = getProduct.get(it.product_id, sid);
        const cost = Number(prod?.cost ?? 0);
        const price = Number(it.price ?? 0);
        const qty = Number(it.quantity ?? 0);
        const profit = (price - cost) * qty;
        grossProfit += profit;
        return { ...it, cost, profit };
      });

      const r = insertSale.run(
        sid,
        storeName,
        fy,
        Number(sale.total || 0),
        Number(sale.subtotal || 0),
        0,
        Number(sale.discount || 0),
        sale.payment_method || "cash",
        sale.status || "completed",
        sale.payment_json || null,
        sale.note || null,
        "sale",
        null,
        sale.customer_id || null,
        sale.customer_name || null,
        currentUser.id,
        currentUser.name,
        grossProfit
      );

      const saleId = r.lastInsertRowid;

      enriched.forEach((it) => {
        insertItem.run(
          saleId,
          it.product_id,
          it.product_name,
          Number(it.quantity),
          Number(it.price),
          Number(it.subtotal),
          Number(it.cost || 0),
          Number(it.profit || 0)
        );

        updateStock.run(Number(it.quantity), it.product_id, sid);
      });

      return saleId;
    });

    const saleId = tx();

    try {
      const fullSale = db.prepare("SELECT * FROM sales WHERE id=?").get(saleId);
      const saleItems = db.prepare("SELECT * FROM sale_items WHERE sale_id=?").all(saleId);
      Promise.resolve(sync.syncSale(fullSale, saleItems)).catch(() => {});
      const all = db.prepare("SELECT * FROM products WHERE store_id=?").all(sid);
      Promise.resolve(sync.syncInventory(all)).catch(() => {});
    } catch {}

    return { ok: true, saleId };
  });

  safeHandle("sales:getAll", (_, { limit = 200, offset = 0 } = {}) => {
    return db.prepare(`
      SELECT * FROM sales
      WHERE store_id=?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(effectiveStoreId(), limit, offset);
  });

  safeHandle("sales:getItems", (_, id) => {
    return db.prepare("SELECT * FROM sale_items WHERE sale_id=?").all(Number(id));
  });

  safeHandle("sales:getOne", (_, id) => {
    const sid = effectiveStoreId();
    const sale = db.prepare("SELECT * FROM sales WHERE id=? AND store_id=?").get(Number(id), sid);
    if (!sale) return null;

    const items = db.prepare("SELECT * FROM sale_items WHERE sale_id=?").all(Number(id));
    return { sale, items };
  });

  safeHandle("sales:refund", (_, payload) => {
    if (!currentUser) return { ok: false, message: "Please login first." };

    const sid = effectiveStoreId();
    const storeName = effectiveStoreName();

    const original_sale_id = Number(payload?.original_sale_id);
    const reqItems = Array.isArray(payload?.items) ? payload.items : [];
    const note = payload?.note || null;

    if (!original_sale_id) return { ok: false, message: "Missing original_sale_id" };
    if (reqItems.length === 0) return { ok: false, message: "No refund items provided" };

    const origSale = db.prepare(`
      SELECT * FROM sales
      WHERE id=? AND store_id=? AND sale_type='sale'
    `).get(original_sale_id, sid);

    if (!origSale) return { ok: false, message: "Original sale not found" };

    const origFY =
      origSale.fiscal_year ||
      fiscalYearFromDate(parseDateLoose(origSale.created_at), effectiveFyStartMonth());

    const origItems = db.prepare("SELECT * FROM sale_items WHERE sale_id=?").all(original_sale_id);
    if (origItems.length === 0) return { ok: false, message: "Original sale has no items" };

    const origMap = new Map();
    origItems.forEach((it) => origMap.set(it.product_id, it));

    const refundedRows = db.prepare(`
      SELECT si.product_id, ABS(SUM(si.quantity)) as refunded_qty
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      WHERE s.store_id=? AND s.sale_type='refund' AND s.original_sale_id=?
      GROUP BY si.product_id
    `).all(sid, original_sale_id);

    const refundedMap = new Map(refundedRows.map((r) => [r.product_id, Number(r.refunded_qty || 0)]));

    const restock = db.prepare(`
      UPDATE products
      SET stock = stock + ?, updated_at=datetime('now')
      WHERE id=? AND store_id=?
    `);

    const insertSale = db.prepare(`
      INSERT INTO sales (
        store_id, store_name, fiscal_year,
        total, subtotal, tax, discount,
        payment_method, status, payment_json, note,
        sale_type, original_sale_id,
        customer_id, customer_name,
        cashier_id, cashier_name,
        gross_profit
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);

    const insertItem = db.prepare(`
      INSERT INTO sale_items (sale_id, product_id, product_name, quantity, price, subtotal, cost, profit)
      VALUES (?,?,?,?,?,?,?,?)
    `);

    const tx = db.transaction(() => {
      let totalRefundAbs = 0;
      let grossProfitAbs = 0;
      const rowsToInsert = [];

      for (const r of reqItems) {
        const product_id = Number(r.product_id);
        if (!product_id) continue;

        const orig = origMap.get(product_id);
        if (!orig) continue;

        const alreadyRefunded = refundedMap.get(product_id) || 0;
        const maxRefundable = Math.max(0, Number(orig.quantity) - alreadyRefunded);

        let qty = Math.floor(Number(r.quantity || 0));
        if (qty <= 0) continue;
        if (qty > maxRefundable) qty = maxRefundable;
        if (qty <= 0) continue;

        const unitPrice =
          r.price === "" || r.price === null || r.price === undefined
            ? Number(orig.price || 0)
            : Number(r.price || 0);

        const unitCost = Number(orig.cost || 0);
        const lineSubtotal = unitPrice * qty;
        const lineProfit = (unitPrice - unitCost) * qty;

        totalRefundAbs += lineSubtotal;
        grossProfitAbs += lineProfit;

        rowsToInsert.push({
          product_id,
          product_name: orig.product_name,
          quantity: qty,
          price: unitPrice,
          subtotal: lineSubtotal,
          cost: unitCost,
          profit: lineProfit,
        });
      }

      if (rowsToInsert.length === 0) {
        return { ok: false, message: "Nothing refundable (qty too high or invalid)" };
      }

      const total = -Math.abs(totalRefundAbs);
      const subtotal = total;

      const rSale = insertSale.run(
        sid,
        storeName,
        origFY,
        total,
        subtotal,
        0,
        0,
        "refund",
        "completed",
        JSON.stringify({ method: "refund" }),
        note || `Refund for receipt #${original_sale_id}`,
        "refund",
        original_sale_id,
        origSale.customer_id || null,
        origSale.customer_name || null,
        currentUser.id,
        currentUser.name,
        -Math.abs(grossProfitAbs)
      );

      const refundSaleId = rSale.lastInsertRowid;

      rowsToInsert.forEach((it) => {
        insertItem.run(
          refundSaleId,
          it.product_id,
          it.product_name,
          -Math.abs(it.quantity),
          it.price,
          -Math.abs(it.subtotal),
          it.cost,
          -Math.abs(it.profit)
        );

        restock.run(it.quantity, it.product_id, sid);
      });

      return { ok: true, refundSaleId };
    });

    const res = tx();
    if (res?.ok === false) return res;

    try {
      const refundSale = db.prepare("SELECT * FROM sales WHERE id=?").get(res.refundSaleId);
      const refundItems = db.prepare("SELECT * FROM sale_items WHERE sale_id=?").all(res.refundSaleId);
      Promise.resolve(sync.syncSale(refundSale, refundItems)).catch(() => {});
      const all = db.prepare("SELECT * FROM products WHERE store_id=?").all(sid);
      Promise.resolve(sync.syncInventory(all)).catch(() => {});
    } catch {}

    return res;
  });

  // -------------------- PRODUCTS --------------------
  safeHandle("products:getAll", () => {
    return db.prepare("SELECT * FROM products WHERE store_id=? ORDER BY name")
      .all(effectiveStoreId());
  });

  safeHandle("products:search", (_, q) => {
    const query = `%${String(q || "").trim()}%`;
    const sid = effectiveStoreId();

    return db.prepare(`
      SELECT * FROM products
      WHERE store_id=? AND (name LIKE ? OR sku LIKE ? OR barcode LIKE ?)
      ORDER BY name
    `).all(sid, query, query, query);
  });

  safeHandle("products:create", (_, p) => {
    if (!isAdmin()) return adminOnly();

    const sid = effectiveStoreId();

    const r = db.prepare(`
      INSERT INTO products (store_id,name,sku,category,price,cost,stock,low_stock_threshold,barcode)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(
      sid,
      p.name,
      p.sku || null,
      p.category || "",
      Number(p.price || 0),
      Number(p.cost || 0),
      Number(p.stock || 0),
      Number(p.low_stock_threshold || 5),
      p.barcode || ""
    );

    const all = db.prepare("SELECT * FROM products WHERE store_id=?").all(sid);
    Promise.resolve(sync.syncInventory(all)).catch(() => {});

    return { ok: true, id: r.lastInsertRowid };
  });

  safeHandle("products:update", (_, p) => {
    if (!isAdmin()) return adminOnly();

    const sid = effectiveStoreId();

    db.prepare(`
      UPDATE products
      SET name=?, sku=?, category=?, price=?, cost=?, stock=?, low_stock_threshold=?, barcode=?, updated_at=datetime('now')
      WHERE id=? AND store_id=?
    `).run(
      p.name,
      p.sku || null,
      p.category || "",
      Number(p.price || 0),
      Number(p.cost || 0),
      Number(p.stock || 0),
      Number(p.low_stock_threshold || 5),
      p.barcode || "",
      p.id,
      sid
    );

    const all = db.prepare("SELECT * FROM products WHERE store_id=?").all(sid);
    Promise.resolve(sync.syncInventory(all)).catch(() => {});

    return { ok: true };
  });

  safeHandle("products:delete", (_, id) => {
    if (!isAdmin()) return adminOnly();

    const sid = effectiveStoreId();
    db.prepare("DELETE FROM products WHERE id=? AND store_id=?").run(Number(id), sid);

    const all = db.prepare("SELECT * FROM products WHERE store_id=?").all(sid);
    Promise.resolve(sync.syncInventory(all)).catch(() => {});

    return { ok: true };
  });

  // -------------------- CATEGORIES --------------------
  safeHandle("categories:getAll", () => {
    return db.prepare("SELECT * FROM categories WHERE store_id=? ORDER BY name")
      .all(effectiveStoreId());
  });

  safeHandle("categories:create", (_, c) => {
    if (!isAdmin()) return adminOnly();

    const sid = effectiveStoreId();
    const name = String(c?.name || "").trim();
    const color = String(c?.color || "#6366f1").trim() || "#6366f1";

    if (!name) return { ok: false, message: "Category name required" };

    try {
      db.prepare("INSERT INTO categories (store_id,name,color) VALUES (?,?,?)").run(sid, name, color);
      return { ok: true };
    } catch {
      return { ok: false, message: "Category already exists in this store" };
    }
  });

  safeHandle("categories:update", (_, c) => {
    if (!isAdmin()) return adminOnly();

    const sid = effectiveStoreId();
    const id = Number(c?.id);
    const name = String(c?.name || "").trim();
    const color = String(c?.color || "#6366f1").trim() || "#6366f1";

    if (!id || !name) return { ok: false, message: "Missing id/name" };

    const old = db.prepare("SELECT id,name FROM categories WHERE id=? AND store_id=?").get(id, sid);
    if (!old) return { ok: false, message: "Category not found" };

    const tx = db.transaction(() => {
      db.prepare("UPDATE categories SET name=?, color=? WHERE id=? AND store_id=?")
        .run(name, color, id, sid);

      if (old.name !== name) {
        db.prepare(`
          UPDATE products
          SET category=?, updated_at=datetime('now')
          WHERE store_id=? AND category=?
        `).run(name, sid, old.name);
      }
    });

    tx();
    return { ok: true };
  });

  safeHandle("categories:delete", (_, id) => {
    if (!isAdmin()) return adminOnly();

    const sid = effectiveStoreId();
    const catId = Number(id);

    if (!catId) return { ok: false, message: "Missing id" };

    const old = db.prepare("SELECT id,name FROM categories WHERE id=? AND store_id=?").get(catId, sid);
    if (!old) return { ok: false, message: "Category not found" };

    const tx = db.transaction(() => {
      db.prepare(`
        UPDATE products
        SET category='', updated_at=datetime('now')
        WHERE store_id=? AND category=?
      `).run(sid, old.name);

      db.prepare("DELETE FROM categories WHERE id=? AND store_id=?").run(catId, sid);
    });

    tx();
    return { ok: true };
  });

  // -------------------- REPORTS --------------------
  safeHandle("reports:summary", (_, arg = {}) => {
    const sid = effectiveStoreId();
    const period = typeof arg === "string" ? arg : arg?.period || "today";

    const filters = {
      today: "date(s.created_at)=date('now')",
      week: "date(s.created_at)>=date('now','-7 days')",
      month: "date(s.created_at)>=date('now','-30 days')",
      year: "date(s.created_at)>=date('now','-365 days')",
    };

    const where = filters[period] || filters.today;

    const summary = db.prepare(`
      SELECT
        COUNT(*) AS transactions,
        SUM(CASE WHEN s.sale_type='sale' THEN s.total ELSE 0 END) AS revenue,
        SUM(CASE WHEN s.sale_type='refund' THEN s.total ELSE 0 END) AS refunds,
        SUM(s.gross_profit) AS gross_profit
      FROM sales s
      WHERE s.store_id=? AND ${where} AND s.status IN ('completed','due')
    `).get(sid);

    const topProducts = db.prepare(`
      SELECT
        si.product_name,
        SUM(si.quantity) AS qty_sold,
        SUM(si.subtotal) AS revenue,
        SUM(si.profit) AS profit
      FROM sale_items si
      JOIN sales s ON si.sale_id=s.id
      WHERE s.store_id=? AND ${where} AND s.status IN ('completed','due')
      GROUP BY si.product_id, si.product_name
      ORDER BY revenue DESC
      LIMIT 10
    `).all(sid);

    const byDay = db.prepare(`
      SELECT
        date(s.created_at) AS day,
        SUM(CASE WHEN s.sale_type='sale' THEN s.total ELSE 0 END) AS revenue,
        SUM(CASE WHEN s.sale_type='refund' THEN s.total ELSE 0 END) AS refunds,
        SUM(s.gross_profit) AS profit,
        COUNT(*) AS transactions
      FROM sales s
      WHERE s.store_id=? AND ${where} AND s.status IN ('completed','due')
      GROUP BY day
      ORDER BY day
    `).all(sid);

    const lowStock = db.prepare(`
      SELECT * FROM products
      WHERE store_id=? AND stock <= low_stock_threshold
      ORDER BY stock ASC
      LIMIT 20
    `).all(sid);

    return { summary, topProducts, byDay, lowStock };
  });

  // -------------------- SETTINGS --------------------
  safeHandle("settings:getAll", () => getEffectiveSettingsObject());

  safeHandle("settings:set", (_, { key, value }) => {
    if (!isAdmin()) return adminOnly();

    const k = String(key || "").trim();
    const v = String(value ?? "");

    const perStoreFields = {
      store_name: "store_name",
      currency: "currency",
      fy_start_month: "fy_start_month",
      receipt_footer: "receipt_footer",
      contact: "contact",
    };

    // change default/current device store
    if (k === "store_id") {
      db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)").run(k, v);

      refreshStoreCtxFromSettings();

      const merged = getEffectiveSettingsObject();

      db.prepare(`
        INSERT OR IGNORE INTO stores (
          store_id, store_name, currency, contact, receipt_footer, fy_start_month
        ) VALUES (?,?,?,?,?,?)
      `).run(
        storeCtx.store_id,
        merged.store_name || "Store 1",
        merged.currency || "BDT",
        merged.contact || "",
        merged.receipt_footer || "Thank you for shopping with us!",
        Number(merged.fy_start_month || 7) || 7
      );

      currentUser = null;
      initSyncFromSettings();
      return { ok: true };
    }

    // per-store keys
    if (perStoreFields[k]) {
      const sid = effectiveStoreId();
      const merged = getEffectiveSettingsObject();

      db.prepare(`
        INSERT OR IGNORE INTO stores (
          store_id, store_name, currency, contact, receipt_footer, fy_start_month
        ) VALUES (?,?,?,?,?,?)
      `).run(
        sid,
        merged.store_name || storeCtx.store_name || sid,
        merged.currency || storeCtx.currency || "BDT",
        merged.contact || "",
        merged.receipt_footer || "Thank you for shopping with us!",
        Number(merged.fy_start_month || storeCtx.fy_start_month || 7) || 7
      );

      const col = perStoreFields[k];
      const storeValue = col === "fy_start_month" ? Number(v || 7) || 7 : v;
      db.prepare(`UPDATE stores SET ${col}=? WHERE store_id=?`).run(storeValue, sid);

      // keep settings table in sync for the device's own current store
      if (sid === storeCtx.store_id) {
        db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)").run(k, v);
        refreshStoreCtxFromSettings();

        if (["store_name", "currency", "fy_start_month"].includes(k)) {
          currentUser = null;
        }

        if (["store_name", "currency"].includes(k)) {
          initSyncFromSettings();
        }
      }

      return { ok: true };
    }

    // global keys
    db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)").run(k, v);

    if (["supabase_url", "supabase_key", "store_id", "store_name"].includes(k)) {
      initSyncFromSettings();
    }

    return { ok: true };
  });

  // -------------------- SYNC --------------------
  safeHandle("sync:test", async () => {
    try {
      return await sync.testConnection();
    } catch {
      return false;
    }
  });

  safeHandle("sync:pushInventory", async () => {
    try {
      const sid = effectiveStoreId();
      const products = db.prepare("SELECT * FROM products WHERE store_id=?").all(sid);
      await sync.syncInventory(products);
      return true;
    } catch {
      return false;
    }
  });

  safeHandle("sync:pushProducts", async () => {
    if (!isAdmin()) return adminOnly();

    try {
      const sid = effectiveStoreId();
      const products = db.prepare("SELECT * FROM products WHERE store_id=?").all(sid);
      const categories = db.prepare("SELECT * FROM categories WHERE store_id=?").all(sid);
      const ok = await sync.pushSharedCatalog({ storeId: sid, products, categories });
      return { ok: !!ok };
    } catch (e) {
      return { ok: false, message: e?.message || "Push failed" };
    }
  });

  safeHandle("sync:pullProducts", async () => {
    try {
      const sid = effectiveStoreId();
      const r = await sync.pullSharedCatalog({ storeId: sid });
      const products = r?.products || [];
      const categories = r?.categories || [];

      const getCat = db.prepare("SELECT id FROM categories WHERE store_id=? AND name=?");
      const insCat = db.prepare("INSERT INTO categories (store_id,name,color) VALUES (?,?,?)");
      const updCat = db.prepare("UPDATE categories SET color=? WHERE id=? AND store_id=?");

      categories.forEach((c) => {
        const name = String(c.name || "").trim();
        if (!name) return;

        const ex = getCat.get(sid, name);
        if (!ex) insCat.run(sid, name, c.color || "#6366f1");
        else updCat.run(c.color || "#6366f1", ex.id, sid);
      });

      const getBySku = db.prepare("SELECT id FROM products WHERE store_id=? AND sku=?");
      const ins = db.prepare(`
        INSERT INTO products (store_id,name,sku,category,price,cost,stock,low_stock_threshold,barcode)
        VALUES (?,?,?,?,?,?,?,?,?)
      `);
      const upd = db.prepare(`
        UPDATE products
        SET name=?, category=?, price=?, cost=?, low_stock_threshold=?, barcode=?, updated_at=datetime('now')
        WHERE id=? AND store_id=?
      `);

      products.forEach((p) => {
        const sku = String(p.sku || "").trim();
        if (!sku) return;

        const ex = getBySku.get(sid, sku);
        if (!ex) {
          ins.run(
            sid,
            p.name || "",
            sku,
            p.category || "",
            Number(p.price || 0),
            Number(p.cost || 0),
            0,
            Number(p.low_stock_threshold || 5),
            p.barcode || ""
          );
        } else {
          upd.run(
            p.name || "",
            p.category || "",
            Number(p.price || 0),
            Number(p.cost || 0),
            Number(p.low_stock_threshold || 5),
            p.barcode || "",
            ex.id,
            sid
          );
        }
      });

      return { ok: true, counts: { products: products.length, categories: categories.length } };
    } catch (e) {
      return { ok: false, message: e?.message || "Pull failed" };
    }
  });

  // -------------------- RECEIPTS --------------------
  safeHandle("receipt:savePdf", async (_, { html, fileName }) => {
    try {
      if (!html) return { ok: false, message: "No receipt content" };

      const suggested = fileName || `Receipt-${Date.now()}.pdf`;
      const { canceled, filePath } = await dialog.showSaveDialog({
        title: "Save Receipt PDF",
        defaultPath: path.join(app.getPath("documents"), suggested),
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });

      if (canceled || !filePath) return { ok: false, message: "Cancelled" };

      const pdfBuffer = await htmlToPdfBufferA4(html);
      await fs.writeFile(filePath, pdfBuffer);

      return { ok: true, path: filePath };
    } catch (e) {
      return { ok: false, message: e?.message || "Failed to save PDF" };
    }
  });

  safeHandle("receipt:sendEmail", async (_, { to, subject, html, fileName }) => {
    try {
      if (!to) return { ok: false, message: "Missing email address" };
      if (!html) return { ok: false, message: "Missing receipt html" };

      const host = process.env.SMTP_HOST;
      const port = Number(process.env.SMTP_PORT || 587);
      const secure = String(process.env.SMTP_SECURE || "false").toLowerCase() === "true";
      const user = process.env.SMTP_USER;
      const pass = process.env.SMTP_PASS;
      const from = process.env.SMTP_FROM || user;

      if (!host || !user || !pass) {
        return { ok: false, message: "Email not configured (SMTP env missing)" };
      }

      let nodemailer;
      try {
        nodemailer = require("nodemailer");
      } catch {
        return { ok: false, message: "nodemailer not installed. Run: npm install nodemailer" };
      }

      const pdfBuffer = await htmlToPdfBufferA4(html);
      const transporter = nodemailer.createTransport({ host, port, secure, auth: { user, pass } });

      await transporter.sendMail({
        from,
        to,
        subject: subject || "Your receipt",
        text: "Thanks for your purchase. Receipt attached as PDF.",
        attachments: [
          {
            filename: fileName || "receipt.pdf",
            content: pdfBuffer,
            contentType: "application/pdf",
          },
        ],
      });

      return { ok: true };
    } catch (e) {
      return { ok: false, message: e?.message || "Email failed" };
    }
  });
}

// ---------- app ----------
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Promise Rejection:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
});

app.whenReady().then(() => {
  console.log("✅ MAIN.JS LOADED:", __filename);

  try {
    initDB();
    registerIpcHandlers();
    createWindow();
  } catch (e) {
    console.error("Startup failed:", e);
    dialog.showErrorBox(
      "RetailPOS startup failed",
      e?.stack || e?.message || String(e)
    );
    app.quit();
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  try {
    if (db) db.close();
  } catch {}
});