// src/main.js — RetailPOS (Electron main process)
// Fixes packaged error: Cannot find module './sync'
// Includes: SQLite DB + IPC handlers + Supabase sync init + Reports fix + Auto-updater

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

let mainWindow;
let db;

// -------------------- Robust sync loader (dev + packaged) --------------------
let sync = {
  init: () => {},
  syncSale: async () => {},
  syncInventory: async () => {},
  testConnection: async () => false,
};

try {
  // Dev: __dirname == .../src  -> ./sync works
  // Packaged (sometimes): main.js at app root -> ./sync may NOT exist
  sync = require(path.join(__dirname, 'sync'));
} catch (e1) {
  try {
    // Packaged fallback: sync is usually inside /src in app.asar
    sync = require(path.join(__dirname, 'src', 'sync'));
  } catch (e2) {
    console.warn('[Sync] sync module not found; app will run offline only.');
  }
}

// -------------------- Window --------------------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    backgroundColor: '#0f1117',
    show: false,
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.once('ready-to-show', () => mainWindow.show());
}

// -------------------- Auto Update (GitHub Releases) --------------------
function initAutoUpdate() {
  autoUpdater.autoDownload = true;

  autoUpdater.on('update-downloaded', async () => {
    const r = await dialog.showMessageBox({
      type: 'info',
      buttons: ['Restart now', 'Later'],
      title: 'Update ready',
      message: 'A new version was downloaded. Restart to apply it.',
    });
    if (r.response === 0) autoUpdater.quitAndInstall();
  });

  autoUpdater.checkForUpdatesAndNotify();
}

// -------------------- Safe Sync Helpers --------------------
function safeSyncInventory(products) {
  if (!sync || typeof sync.syncInventory !== 'function') return;
  Promise.resolve(sync.syncInventory(products)).catch(() => {});
}

function safeSyncSale(sale, items) {
  if (!sync || typeof sync.syncSale !== 'function') return;
  Promise.resolve(sync.syncSale(sale, items)).catch(() => {});
}

// -------------------- DB --------------------
function initDB() {
  const Database = require('better-sqlite3');
  const dbPath = path.join(app.getPath('userData'), 'retailpos.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

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

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      color TEXT DEFAULT '#6366f1'
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    INSERT OR IGNORE INTO settings VALUES ('store_name', 'Store 1');
    INSERT OR IGNORE INTO settings VALUES ('tax_rate', '0.08');
    INSERT OR IGNORE INTO settings VALUES ('currency', 'USD');
    INSERT OR IGNORE INTO settings VALUES ('store_id', 'store_1');
    INSERT OR IGNORE INTO settings VALUES ('supabase_url', '');
    INSERT OR IGNORE INTO settings VALUES ('supabase_key', '');

    INSERT OR IGNORE INTO categories (name, color) VALUES ('Electronics', '#6366f1');
    INSERT OR IGNORE INTO categories (name, color) VALUES ('Clothing', '#ec4899');
    INSERT OR IGNORE INTO categories (name, color) VALUES ('Food & Drink', '#f59e0b');
    INSERT OR IGNORE INTO categories (name, color) VALUES ('Home & Garden', '#10b981');
    INSERT OR IGNORE INTO categories (name, color) VALUES ('Sports', '#3b82f6');
    INSERT OR IGNORE INTO categories (name, color) VALUES ('Books', '#8b5cf6');
  `);

  // Seed demo products if empty
  const count = db.prepare('SELECT COUNT(*) as c FROM products').get();
  if (count.c === 0) {
    const ins = db.prepare(
      'INSERT INTO products (name,sku,category,price,cost,stock,low_stock_threshold) VALUES (?,?,?,?,?,?,?)'
    );
    [
      ['Wireless Earbuds Pro', 'SKU-001', 'Electronics', 79.99, 35, 45, 10],
      ['Cotton T-Shirt (M)', 'SKU-002', 'Clothing', 24.99, 8, 120, 20],
      ['Organic Coffee Beans', 'SKU-003', 'Food & Drink', 14.99, 6.5, 80, 15],
      ['Yoga Mat Premium', 'SKU-004', 'Sports', 49.99, 18, 30, 8],
      ['LED Desk Lamp', 'SKU-005', 'Electronics', 39.99, 15, 25, 5],
    ].forEach((p) => ins.run(...p));
  }

  initSync();
}

function initSync() {
  if (!db) return;

  const rows = db.prepare('SELECT * FROM settings').all();
  const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));

  const supabaseUrl = (s.supabase_url || '').trim();
  const supabaseKey = (s.supabase_key || '').trim();
  const storeId = (s.store_id || '').trim();
  const storeName = (s.store_name || '').trim();

  if (!supabaseUrl || !supabaseKey || !storeId) return;
  if (!sync || typeof sync.init !== 'function') return;

  try {
    sync.init({ supabaseUrl, supabaseKey, storeId, storeName });

    // Push current inventory on startup (best-effort)
    const products = db.prepare('SELECT * FROM products').all();
    safeSyncInventory(products);
  } catch {
    // ignore; app still works offline
  }
}

// -------------------- App lifecycle --------------------
app.whenReady().then(() => {
  createWindow();
  initDB();

  if (app.isPackaged) initAutoUpdate();

  // ── Products ──────────────────────────────────────────────────────────────
  ipcMain.handle('products:getAll', () => db.prepare('SELECT * FROM products ORDER BY name').all());

  ipcMain.handle('products:search', (_, q) => {
    const query = (q || '').trim();
    return db
      .prepare('SELECT * FROM products WHERE name LIKE ? OR sku LIKE ? ORDER BY name')
      .all(`%${query}%`, `%${query}%`);
  });

  ipcMain.handle('products:create', (_, p) => {
    const r = db
      .prepare(
        'INSERT INTO products (name,sku,category,price,cost,stock,low_stock_threshold,barcode) VALUES (?,?,?,?,?,?,?,?)'
      )
      .run(p.name, p.sku, p.category, p.price, p.cost, p.stock, p.low_stock_threshold, p.barcode);

    const all = db.prepare('SELECT * FROM products').all();
    safeSyncInventory(all);

    return { ok: true, id: r.lastInsertRowid };
  });

  ipcMain.handle('products:update', (_, p) => {
    db.prepare(
      'UPDATE products SET name=?,sku=?,category=?,price=?,cost=?,stock=?,low_stock_threshold=?,barcode=?,updated_at=datetime("now") WHERE id=?'
    ).run(p.name, p.sku, p.category, p.price, p.cost, p.stock, p.low_stock_threshold, p.barcode, p.id);

    const all = db.prepare('SELECT * FROM products').all();
    safeSyncInventory(all);

    return { ok: true };
  });

  ipcMain.handle('products:delete', (_, id) => {
    db.prepare('DELETE FROM products WHERE id=?').run(id);

    const all = db.prepare('SELECT * FROM products').all();
    safeSyncInventory(all);

    return { ok: true };
  });

  // ── Categories ────────────────────────────────────────────────────────────
  ipcMain.handle('categories:getAll', () => db.prepare('SELECT * FROM categories ORDER BY name').all());

  ipcMain.handle('categories:create', (_, c) => {
    const r = db.prepare('INSERT OR IGNORE INTO categories (name,color) VALUES (?,?)').run(c.name, c.color);
    return { ok: true, changes: r.changes };
  });

  // ── Sales ─────────────────────────────────────────────────────────────────
  ipcMain.handle('sales:create', (_, { sale, items }) => {
    const insertSale = db.prepare(
      'INSERT INTO sales (total,subtotal,tax,discount,payment_method,note) VALUES (?,?,?,?,?,?)'
    );
    const insertItem = db.prepare(
      'INSERT INTO sale_items (sale_id,product_id,product_name,quantity,price,subtotal) VALUES (?,?,?,?,?,?)'
    );
    const updateStock = db.prepare('UPDATE products SET stock=stock-? WHERE id=?');

    const tx = db.transaction(() => {
      const result = insertSale.run(
        sale.total,
        sale.subtotal,
        sale.tax,
        sale.discount,
        sale.payment_method,
        sale.note
      );
      const saleId = result.lastInsertRowid;

      items.forEach((item) => {
        insertItem.run(saleId, item.product_id, item.product_name, item.quantity, item.price, item.subtotal);
        updateStock.run(item.quantity, item.product_id);
      });

      return saleId;
    });

    const saleId = tx();

    // Sync to cloud (best-effort)
    const fullSale = db.prepare('SELECT * FROM sales WHERE id=?').get(saleId);
    safeSyncSale({ ...fullSale, id: saleId }, items);

    const allProducts = db.prepare('SELECT * FROM products').all();
    safeSyncInventory(allProducts);

    return saleId;
  });

  ipcMain.handle('sales:getAll', (_, { limit = 50, offset = 0 } = {}) =>
    db.prepare('SELECT * FROM sales ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset)
  );

  ipcMain.handle('sales:getItems', (_, id) => db.prepare('SELECT * FROM sale_items WHERE sale_id=?').all(id));

  // ── Reports ───────────────────────────────────────────────────────────────
  ipcMain.handle('reports:summary', (_, { period = 'today' } = {}) => {
    const filters = {
      today: "date(s.created_at)=date('now')",
      week: "date(s.created_at)>=date('now','-7 days')",
      month: "date(s.created_at)>=date('now','-30 days')",
      year: "date(s.created_at)>=date('now','-365 days')",
    };
    const where = filters[period] || filters.today;

    return {
      summary: db
        .prepare(
          `SELECT
            COUNT(*) as transactions,
            SUM(s.total) as revenue,
            SUM(s.tax) as tax_collected,
            AVG(s.total) as avg_sale
          FROM sales s
          WHERE ${where} AND s.status='completed'`
        )
        .get(),

      topProducts: db
        .prepare(
          `SELECT
            si.product_name,
            SUM(si.quantity) as qty_sold,
            SUM(si.subtotal) as revenue
          FROM sale_items si
          JOIN sales s ON si.sale_id = s.id
          WHERE ${where} AND s.status='completed'
          GROUP BY si.product_id, si.product_name
          ORDER BY qty_sold DESC
          LIMIT 5`
        )
        .all(),

      byDay: db
        .prepare(
          `SELECT
            date(s.created_at) as day,
            COUNT(*) as transactions,
            SUM(s.total) as revenue
          FROM sales s
          WHERE ${where} AND s.status='completed'
          GROUP BY day
          ORDER BY day`
        )
        .all(),

      lowStock: db
        .prepare(
          `SELECT *
           FROM products
           WHERE stock <= low_stock_threshold
           ORDER BY stock ASC
           LIMIT 10`
        )
        .all(),
    };
  });

  // ── Settings ──────────────────────────────────────────────────────────────
  ipcMain.handle('settings:getAll', () => {
    const rows = db.prepare('SELECT * FROM settings').all();
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  });

  ipcMain.handle('settings:set', (_, { key, value }) => {
    db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').run(key, value);
    if (['supabase_url', 'supabase_key', 'store_id', 'store_name'].includes(key)) initSync();
    return { ok: true };
  });

  // ── Sync ──────────────────────────────────────────────────────────────────
  ipcMain.handle('sync:test', async () => {
    if (!sync || typeof sync.testConnection !== 'function') return false;
    try {
      return await sync.testConnection();
    } catch {
      return false;
    }
  });

  ipcMain.handle('sync:pushInventory', async () => {
    const products = db.prepare('SELECT * FROM products').all();
    if (!sync || typeof sync.syncInventory !== 'function') return false;
    try {
      await sync.syncInventory(products);
      return true;
    } catch {
      return false;
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  try {
    if (db) db.close();
  } catch {}
});