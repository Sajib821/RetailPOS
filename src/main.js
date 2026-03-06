// src/main.js
// Electron main process for RetailPOS (SQLite + IPC + users/customers/sales/reports + receipt PDF/email + optional sync)

const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const crypto = require("crypto");
const fs = require("fs/promises");

// Load .env (SMTP settings etc.)
require("dotenv").config();

const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;

let mainWindow;
let db;

// -------------------- Optional: Sync module loader --------------------
let sync = {
  init: () => {},
  syncSale: async () => {},
  syncInventory: async () => {},
  pullSharedCatalog: async () => ({ products: [], categories: [] }),
  pushSharedCatalog: async () => true,
  testConnection: async () => false,
};

function loadSyncModule() {
  try {
    // If src/main.js is in src, sync.js should also be in src
    sync = require(path.join(__dirname, "sync"));
  } catch (e) {
    console.warn("[Sync] sync.js not found; running offline-only.");
  }
}
loadSyncModule();

// -------------------- Helpers --------------------
function sha256(text) {
  return crypto.createHash("sha256").update(String(text)).digest("hex");
}

let currentUser = null;
function isAdmin() {
  return currentUser && currentUser.role === "admin";
}
function adminOnly() {
  return { ok: false, message: "Admin only" };
}

// -------------------- Create window --------------------
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
      preload: path.join(__dirname, "preload.js"), // src/preload.js
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) mainWindow.loadURL("http://localhost:3000");
  else mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));

  mainWindow.once("ready-to-show", () => mainWindow.show());
}

// -------------------- DB init + migrations --------------------
function initDB() {
  const Database = require("better-sqlite3");
  const dbPath = path.join(app.getPath("userData"), "retailpos.db");
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  // Base tables (latest)
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      sku TEXT UNIQUE,
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
      name TEXT UNIQUE NOT NULL,
      color TEXT DEFAULT '#6366f1'
    );

    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      total REAL NOT NULL,
      subtotal REAL NOT NULL,
      tax REAL DEFAULT 0,
      discount REAL DEFAULT 0,
      payment_method TEXT DEFAULT 'cash',
      status TEXT DEFAULT 'completed',
      note TEXT,
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
      FOREIGN KEY (sale_id) REFERENCES sales(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    INSERT OR IGNORE INTO settings VALUES ('store_name', 'Store 1');
    INSERT OR IGNORE INTO settings VALUES ('tax_rate', '0.00'); -- tax disabled
    INSERT OR IGNORE INTO settings VALUES ('currency', 'USD');
    INSERT OR IGNORE INTO settings VALUES ('receipt_footer', 'Thank you for shopping with us!');
    INSERT OR IGNORE INTO settings VALUES ('store_id', 'store_1');
    INSERT OR IGNORE INTO settings VALUES ('supabase_url', '');
    INSERT OR IGNORE INTO settings VALUES ('supabase_key', '');
  `);

  // Migrations using user_version
  const v0 = db.pragma("user_version", { simple: true }) || 0;
  db.transaction(() => {
    let v = v0;

    // v1: customers + users + indexes
    if (v < 1) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS customers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          phone TEXT,
          email TEXT,
          address TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          username TEXT,
          role TEXT DEFAULT 'cashier',
          pin_hash TEXT NOT NULL,
          active INTEGER DEFAULT 1,
          created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales(created_at);
        CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items(sale_id);
      `);

      // Ensure username column exists even if old users table existed
      const ucols = db.prepare("PRAGMA table_info(users)").all().map(r => r.name);
      if (!ucols.includes("username")) {
        db.exec(`ALTER TABLE users ADD COLUMN username TEXT;`);
      }
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_unique ON users(username);`);

      // Default admin user
      const adminExists = db.prepare("SELECT COUNT(*) AS c FROM users").get().c;
      if (adminExists === 0) {
        db.prepare("INSERT INTO users (name, username, role, pin_hash) VALUES (?,?,?,?)")
          .run("Admin", "admin", "admin", sha256("1234"));
      }

      v = 1;
      db.pragma("user_version = 1");
    }

    // v2: sales extra columns + sale_items cost/profit + users unique index
    if (v < 2) {
      const addCol = (table, col, def) => {
        const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(r => r.name);
        if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def};`);
      };

      // sales extra columns
      addCol("sales", "sale_type", "TEXT DEFAULT 'sale'");         // 'sale' | 'refund'
      addCol("sales", "original_sale_id", "INTEGER");
      addCol("sales", "customer_id", "INTEGER");
      addCol("sales", "customer_name", "TEXT");
      addCol("sales", "cashier_id", "INTEGER");
      addCol("sales", "cashier_name", "TEXT");
      addCol("sales", "payment_json", "TEXT");
      addCol("sales", "gross_profit", "REAL DEFAULT 0");

      // sale_items extra columns
      addCol("sale_items", "cost", "REAL DEFAULT 0");
      addCol("sale_items", "profit", "REAL DEFAULT 0");

      // users username unique index
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_unique ON users(username);`);

      v = 2;
      db.pragma("user_version = 2");
    }

    // v3: receipt_footer setting (if missing)
    if (v < 3) {
      db.prepare("INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)")
        .run("receipt_footer", "Thank you for shopping with us!");
      v = 3;
      db.pragma("user_version = 3");
    }
  })();

  // Seed demo categories if empty
  const catCount = db.prepare("SELECT COUNT(*) AS c FROM categories").get().c;
  if (catCount === 0) {
    const ins = db.prepare("INSERT OR IGNORE INTO categories (name,color) VALUES (?,?)");
    [
      ["Electronics", "#6366f1"],
      ["Clothing", "#ec4899"],
      ["Food & Drink", "#f59e0b"],
      ["Home & Garden", "#10b981"],
      ["Sports", "#3b82f6"],
      ["Books", "#8b5cf6"],
    ].forEach(c => ins.run(c[0], c[1]));
  }

  initSyncFromSettings();
}

// -------------------- Settings helpers --------------------
function getSettingsObject() {
  const rows = db.prepare("SELECT * FROM settings").all();
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

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

    // Best-effort initial inventory push
    const products = db.prepare("SELECT * FROM products").all();
    Promise.resolve(sync.syncInventory(products)).catch(() => {});
  } catch {
    // offline ok
  }
}

// -------------------- Receipt PDF helper (shared by save + email) --------------------
async function htmlToPdfBufferA4(html) {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

  const buf = await win.webContents.printToPDF({
    printBackground: true,
    pageSize: "A4",
  });

  win.destroy();
  return buf;
}

// -------------------- App ready --------------------
app.whenReady().then(() => {
  console.log("✅ MAIN.JS LOADED:", __filename);

  createWindow();
  initDB();

  // -------------------- AUTH --------------------
  ipcMain.handle("auth:current", () => currentUser);

  // login({username, pin})
  ipcMain.handle("auth:login", (_, { username, pin }) => {
    const u = String(username || "").trim().toLowerCase();
    const p = String(pin || "").trim();
    if (!u || !p) return { ok: false, message: "Username and PIN required" };

    const h = sha256(p);
    const user = db
      .prepare("SELECT id,name,username,role,active FROM users WHERE lower(username)=? AND pin_hash=? AND active=1")
      .get(u, h);

    if (!user) return { ok: false, message: "Invalid username or PIN" };

    currentUser = user;
    return { ok: true, user };
  });

  ipcMain.handle("auth:logout", () => {
    currentUser = null;
    return { ok: true };
  });

  // change own password: {oldPin, newPin}
  ipcMain.handle("auth:changePassword", (_, { oldPin, newPin }) => {
    if (!currentUser) return { ok: false, message: "Login required" };

    const oldP = String(oldPin || "").trim();
    const newP = String(newPin || "").trim();
    if (!oldP || !newP) return { ok: false, message: "Old and new password required" };
    if (newP.length < 3 || newP.length > 30) return { ok: false, message: "Password must be 3–30 characters" };

    const row = db.prepare("SELECT pin_hash FROM users WHERE id=? AND active=1").get(currentUser.id);
    if (!row) return { ok: false, message: "User not found" };

    if (sha256(oldP) !== row.pin_hash) return { ok: false, message: "Old password incorrect" };

    db.prepare("UPDATE users SET pin_hash=? WHERE id=?").run(sha256(newP), currentUser.id);
    return { ok: true };
  });

  // -------------------- USERS --------------------
  ipcMain.handle("users:getAll", () =>
    db.prepare("SELECT id,name,username,role,active,created_at FROM users ORDER BY id DESC").all()
  );

  ipcMain.handle("users:create", (_, { name, username, role, pin }) => {
    if (!isAdmin()) return adminOnly();

    const nm = String(name || "").trim();
    const un = String(username || "").trim().toLowerCase();
    const pn = String(pin || "").trim();

    if (!nm || !un || !pn) return { ok: false, message: "Name, username and PIN required" };

    const exists = db.prepare("SELECT id FROM users WHERE lower(username)=?").get(un);
    if (exists) return { ok: false, message: "Username already exists" };

    const r = db
      .prepare("INSERT INTO users (name, username, role, pin_hash) VALUES (?,?,?,?)")
      .run(nm, un, role || "cashier", sha256(pn));

    return { ok: true, id: r.lastInsertRowid };
  });

  ipcMain.handle("users:update", (_, { id, name, username, role, active }) => {
    if (!isAdmin()) return adminOnly();

    const un = String(username || "").trim().toLowerCase();
    const nm = String(name || "").trim();

    if (!nm || !un) return { ok: false, message: "Name and username required" };

    // unique username check
    const exists = db.prepare("SELECT id FROM users WHERE lower(username)=? AND id<>?").get(un, id);
    if (exists) return { ok: false, message: "Username already used by another user" };

    db.prepare("UPDATE users SET name=?, username=?, role=?, active=? WHERE id=?")
      .run(nm, un, role || "cashier", active ? 1 : 0, id);

    return { ok: true };
  });

  ipcMain.handle("users:setPin", (_, { id, pin }) => {
    if (!isAdmin()) return adminOnly();
    const p = String(pin || "").trim();
    if (!p) return { ok: false, message: "PIN required" };

    db.prepare("UPDATE users SET pin_hash=? WHERE id=?").run(sha256(p), id);
    return { ok: true };
  });

  ipcMain.handle("users:delete", (_, id) => {
    if (!isAdmin()) return adminOnly();
    if (currentUser?.id === id) return { ok: false, message: "Can't delete logged-in user" };

    db.prepare("DELETE FROM users WHERE id=?").run(id);
    return { ok: true };
  });

  // -------------------- CUSTOMERS --------------------
  ipcMain.handle("customers:getAll", () => db.prepare("SELECT * FROM customers ORDER BY id DESC").all());

  ipcMain.handle("customers:search", (_, q) => {
    const query = `%${String(q || "").trim()}%`;
    return db
      .prepare("SELECT * FROM customers WHERE name LIKE ? OR phone LIKE ? OR email LIKE ? ORDER BY id DESC")
      .all(query, query, query);
  });

  ipcMain.handle("customers:create", (_, c) => {
    const r = db
      .prepare("INSERT INTO customers (name,phone,email,address,updated_at) VALUES (?,?,?,?,datetime('now'))")
      .run(c.name, c.phone || "", c.email || "", c.address || "");
    return { ok: true, id: r.lastInsertRowid };
  });

  ipcMain.handle("customers:update", (_, c) => {
    db.prepare("UPDATE customers SET name=?, phone=?, email=?, address=?, updated_at=datetime('now') WHERE id=?")
      .run(c.name, c.phone || "", c.email || "", c.address || "", c.id);
    return { ok: true };
  });

  ipcMain.handle("customers:delete", (_, id) => {
    db.prepare("DELETE FROM customers WHERE id=?").run(id);
    return { ok: true };
  });

  ipcMain.handle("customers:sales", (_, customerId) =>
    db.prepare("SELECT * FROM sales WHERE customer_id=? ORDER BY created_at DESC").all(customerId)
  );

  // -------------------- PRODUCTS --------------------
  ipcMain.handle("products:getAll", () => db.prepare("SELECT * FROM products ORDER BY name").all());

  ipcMain.handle("products:search", (_, q) => {
    const query = `%${String(q || "").trim()}%`;
    return db
      .prepare("SELECT * FROM products WHERE name LIKE ? OR sku LIKE ? OR barcode LIKE ? ORDER BY name")
      .all(query, query, query);
  });

  ipcMain.handle("products:create", (_, p) => {
    if (!isAdmin()) return adminOnly();

    const r = db
      .prepare("INSERT INTO products (name,sku,category,price,cost,stock,low_stock_threshold,barcode) VALUES (?,?,?,?,?,?,?,?)")
      .run(p.name, p.sku, p.category, p.price, p.cost || 0, p.stock || 0, p.low_stock_threshold || 5, p.barcode || "");

    // best-effort sync inventory
    const all = db.prepare("SELECT * FROM products").all();
    Promise.resolve(sync.syncInventory(all)).catch(() => {});

    return { ok: true, id: r.lastInsertRowid };
  });

  ipcMain.handle("products:update", (_, p) => {
    if (!isAdmin()) return adminOnly();

    db.prepare(
      "UPDATE products SET name=?,sku=?,category=?,price=?,cost=?,stock=?,low_stock_threshold=?,barcode=?,updated_at=datetime('now') WHERE id=?"
    ).run(p.name, p.sku, p.category, p.price, p.cost || 0, p.stock || 0, p.low_stock_threshold || 5, p.barcode || "", p.id);

    const all = db.prepare("SELECT * FROM products").all();
    Promise.resolve(sync.syncInventory(all)).catch(() => {});
    return { ok: true };
  });

  ipcMain.handle("products:delete", (_, id) => {
    if (!isAdmin()) return adminOnly();

    db.prepare("DELETE FROM products WHERE id=?").run(id);
    const all = db.prepare("SELECT * FROM products").all();
    Promise.resolve(sync.syncInventory(all)).catch(() => {});
    return { ok: true };
  });

  // -------------------- CATEGORIES --------------------
  ipcMain.handle("categories:getAll", () => db.prepare("SELECT * FROM categories ORDER BY name").all());

  ipcMain.handle("categories:create", (_, c) => {
    if (!isAdmin()) return adminOnly();
    db.prepare("INSERT OR IGNORE INTO categories (name,color) VALUES (?,?)").run(c.name, c.color || "#6366f1");
    return { ok: true };
  });

  // -------------------- SALES --------------------
  ipcMain.handle("sales:create", (_, { sale, items }) => {
    if (!currentUser) return { ok: false, message: "Please login before selling." };

    const insertSale = db.prepare(`
      INSERT INTO sales (
        total, subtotal, tax, discount,
        payment_method, payment_json, note,
        sale_type, original_sale_id,
        customer_id, customer_name,
        cashier_id, cashier_name,
        gross_profit
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);

    const insertItem = db.prepare(`
      INSERT INTO sale_items (sale_id, product_id, product_name, quantity, price, subtotal, cost, profit)
      VALUES (?,?,?,?,?,?,?,?)
    `);

    const updateStock = db.prepare("UPDATE products SET stock=stock-?, updated_at=datetime('now') WHERE id=?");
    const getProduct = db.prepare("SELECT id,name,cost FROM products WHERE id=?");

    const tx = db.transaction(() => {
      let grossProfit = 0;

      const enriched = (items || []).map((it) => {
        const prod = getProduct.get(it.product_id);
        const cost = Number(prod?.cost ?? 0);
        const price = Number(it.price ?? 0);
        const qty = Number(it.quantity ?? 0);
        const profit = (price - cost) * qty;
        grossProfit += profit;
        return { ...it, cost, profit };
      });

      const r = insertSale.run(
        Number(sale.total || 0),
        Number(sale.subtotal || 0),
        0, // tax disabled
        Number(sale.discount || 0),
        sale.payment_method || "cash",
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
        updateStock.run(Number(it.quantity), it.product_id);
      });

      return saleId;
    });

    const saleId = tx();

    // best-effort cloud sync
    try {
      const fullSale = db.prepare("SELECT * FROM sales WHERE id=?").get(saleId);
      const saleItems = db.prepare("SELECT * FROM sale_items WHERE sale_id=?").all(saleId);
      Promise.resolve(sync.syncSale(fullSale, saleItems)).catch(() => {});
      const allProducts = db.prepare("SELECT * FROM products").all();
      Promise.resolve(sync.syncInventory(allProducts)).catch(() => {});
    } catch {}

    return { ok: true, saleId };
  });

  ipcMain.handle("sales:getAll", (_, { limit = 100, offset = 0 } = {}) =>
    db.prepare("SELECT * FROM sales ORDER BY created_at DESC LIMIT ? OFFSET ?").all(limit, offset)
  );

  // keep old name for older UI
  ipcMain.handle("sales:getItems", (_, id) =>
    db.prepare("SELECT * FROM sale_items WHERE sale_id=?").all(id)
  );

  ipcMain.handle("sales:getOne", (_, id) => {
    const sale = db.prepare("SELECT * FROM sales WHERE id=?").get(id);
    if (!sale) return null;
    const items = db.prepare("SELECT * FROM sale_items WHERE sale_id=?").all(id);
    return { sale, items };
  });

  // Refund (simple)
  ipcMain.handle("sales:refund", (_, { original_sale_id, refundItems, note }) => {
    if (!currentUser) return { ok: false, message: "Login required" };

    const orig = db.prepare("SELECT * FROM sales WHERE id=? AND sale_type='sale'").get(original_sale_id);
    if (!orig) return { ok: false, message: "Original sale not found" };

    const origItems = db.prepare("SELECT * FROM sale_items WHERE sale_id=?").all(original_sale_id);
    const qtyMap = new Map((refundItems || []).map(x => [x.product_id, Number(x.quantity)]));

    const itemsToRefund = origItems
      .map(it => {
        const qty = qtyMap.has(it.product_id) ? qtyMap.get(it.product_id) : it.quantity;
        const q = Math.max(0, Math.min(Number(it.quantity), Number(qty)));
        if (q <= 0) return null;
        const subtotal = Number(it.price) * q;
        const profit = (Number(it.price) - Number(it.cost || 0)) * q;
        return { ...it, quantity: q, subtotal, profit };
      })
      .filter(Boolean);

    if (itemsToRefund.length === 0) return { ok: false, message: "Nothing to refund" };

    const totalRefund = -itemsToRefund.reduce((a, it) => a + Number(it.subtotal), 0);
    const grossProfit = -itemsToRefund.reduce((a, it) => a + Number(it.profit || 0), 0);

    const insertSale = db.prepare(`
      INSERT INTO sales (
        total, subtotal, tax, discount,
        payment_method, payment_json, note,
        sale_type, original_sale_id,
        customer_id, customer_name,
        cashier_id, cashier_name,
        gross_profit
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);

    const insertItem = db.prepare(`
      INSERT INTO sale_items (sale_id, product_id, product_name, quantity, price, subtotal, cost, profit)
      VALUES (?,?,?,?,?,?,?,?)
    `);

    const restock = db.prepare("UPDATE products SET stock=stock+?, updated_at=datetime('now') WHERE id=?");

    const tx = db.transaction(() => {
      const r = insertSale.run(
        totalRefund,
        totalRefund,
        0,
        0,
        "refund",
        JSON.stringify({ method: "refund" }),
        note || `Refund for sale #${original_sale_id}`,
        "refund",
        original_sale_id,
        orig.customer_id || null,
        orig.customer_name || null,
        currentUser.id,
        currentUser.name,
        grossProfit
      );

      const refundSaleId = r.lastInsertRowid;

      itemsToRefund.forEach(it => {
        insertItem.run(
          refundSaleId,
          it.product_id,
          it.product_name,
          -Math.abs(it.quantity),
          it.price,
          -Math.abs(it.subtotal),
          it.cost || 0,
          -Math.abs(it.profit || 0)
        );
        restock.run(it.quantity, it.product_id);
      });

      return refundSaleId;
    });

    const refundSaleId = tx();

    // best-effort sync
    try {
      const fullRefund = db.prepare("SELECT * FROM sales WHERE id=?").get(refundSaleId);
      const refundRows = db.prepare("SELECT * FROM sale_items WHERE sale_id=?").all(refundSaleId);
      Promise.resolve(sync.syncSale(fullRefund, refundRows)).catch(() => {});
      const allProducts = db.prepare("SELECT * FROM products").all();
      Promise.resolve(sync.syncInventory(allProducts)).catch(() => {});
    } catch {}

    return { ok: true, refundSaleId };
  });

  // -------------------- REPORTS --------------------
  ipcMain.handle("reports:summary", (_, { period = "today" } = {}) => {
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
      WHERE ${where} AND s.status='completed'
    `).get();

    const topProducts = db.prepare(`
      SELECT
        si.product_name,
        SUM(si.quantity) AS qty_sold,
        SUM(si.subtotal) AS revenue,
        SUM(si.profit) AS profit
      FROM sale_items si
      JOIN sales s ON si.sale_id=s.id
      WHERE ${where} AND s.status='completed'
      GROUP BY si.product_id, si.product_name
      ORDER BY revenue DESC
      LIMIT 10
    `).all();

    const byDay = db.prepare(`
      SELECT
        date(s.created_at) AS day,
        SUM(CASE WHEN s.sale_type='sale' THEN s.total ELSE 0 END) AS revenue,
        SUM(CASE WHEN s.sale_type='refund' THEN s.total ELSE 0 END) AS refunds,
        SUM(s.gross_profit) AS profit,
        COUNT(*) AS transactions
      FROM sales s
      WHERE ${where} AND s.status='completed'
      GROUP BY day
      ORDER BY day
    `).all();

    const lowStock = db.prepare(`
      SELECT * FROM products
      WHERE stock <= low_stock_threshold
      ORDER BY stock ASC
      LIMIT 20
    `).all();

    return { summary, topProducts, byDay, lowStock };
  });

  // -------------------- SETTINGS --------------------
  ipcMain.handle("settings:getAll", () => getSettingsObject());

  // Only admin can change settings (reading allowed for all)
  ipcMain.handle("settings:set", (_, { key, value }) => {
    if (!isAdmin()) return adminOnly();

    db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)")
      .run(String(key), String(value ?? ""));

    if (["supabase_url", "supabase_key", "store_id", "store_name"].includes(key)) {
      initSyncFromSettings();
    }

    return { ok: true };
  });

  // -------------------- SYNC --------------------
  ipcMain.handle("sync:test", async () => {
    try {
      return await sync.testConnection();
    } catch {
      return false;
    }
  });

  ipcMain.handle("sync:pushInventory", async () => {
    try {
      const products = db.prepare("SELECT * FROM products").all();
      await sync.syncInventory(products);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle("sync:pullProducts", async () => {
    if (!sync || typeof sync.pullSharedCatalog !== "function") return { ok: false, message: "Not supported" };
    const r = await sync.pullSharedCatalog();
    const { products = [], categories = [] } = r || {};

    const upCat = db.prepare("INSERT OR IGNORE INTO categories (name,color) VALUES (?,?)");
    categories.forEach(c => upCat.run(c.name, c.color || "#6366f1"));

    const getBySku = db.prepare("SELECT id FROM products WHERE sku=?");
    const ins = db.prepare("INSERT INTO products (name,sku,category,price,cost,stock,low_stock_threshold,barcode) VALUES (?,?,?,?,?,?,?,?)");
    const upd = db.prepare("UPDATE products SET name=?, category=?, price=?, cost=?, low_stock_threshold=?, barcode=?, updated_at=datetime('now') WHERE id=?");

    products.forEach(p => {
      if (!p.sku) return;
      const ex = getBySku.get(p.sku);
      if (!ex) {
        ins.run(p.name, p.sku, p.category || "", p.price || 0, p.cost || 0, 0, p.low_stock_threshold || 5, p.barcode || "");
      } else {
        upd.run(p.name, p.category || "", p.price || 0, p.cost || 0, p.low_stock_threshold || 5, p.barcode || "", ex.id);
      }
    });

    return { ok: true, counts: { products: products.length, categories: categories.length } };
  });

  ipcMain.handle("sync:pushProducts", async () => {
    if (!sync || typeof sync.pushSharedCatalog !== "function") return { ok: false, message: "Not supported" };
    const products = db.prepare("SELECT * FROM products").all();
    const categories = db.prepare("SELECT * FROM categories").all();
    const ok = await sync.pushSharedCatalog({ products, categories });
    return { ok: !!ok };
  });

  // -------------------- RECEIPTS: Save PDF --------------------
  ipcMain.handle("receipt:savePdf", async (_, { html, fileName }) => {
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

  // -------------------- RECEIPTS: Send Email with PDF attachment --------------------
  ipcMain.handle("receipt:sendEmail", async (_, { to, subject, html, fileName }) => {
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

      const transporter = nodemailer.createTransport({
        host,
        port,
        secure,
        auth: { user, pass },
      });

      await transporter.sendMail({
        from,
        to,
        subject: subject || "Your receipt",
        text: "Thanks for your purchase. Your receipt is attached as a PDF.",
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

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  try { if (db) db.close(); } catch {}
});