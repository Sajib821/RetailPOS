// src/main.js
// Multi-store RetailPOS (SQLite + IPC + per-store users + products + sales + refunds + reports + receipts + Supabase sync)
// + Superadmin + Stores + Fiscal Year + Customer Due/Payments + Historical Sales Import
// + Store contact / per-store receipt footer support
// + Auto update (GitHub Releases)

const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");
const crypto = require("crypto");
const fs = require("fs/promises");
const fsSync = require("fs");
const dotenv = require("dotenv");

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
  syncStore: async () => {},
  syncSale: async () => {},
  syncSalesList: async () => {},
  syncInventory: async () => {},
  syncCustomers: async () => {},
  syncCustomerPayments: async () => {},
  syncFiscalYears: async () => {},
  syncBankData: async () => {},
  syncAllData: async () => {},
  pullSharedCatalog: async () => ({ products: [], categories: [] }),
  pullBankData: async () => ({ accounts: [], transactions: [] }),
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

function sendToRenderer(channel, payload) {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, payload);
    }
  } catch {}
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

function normYmd(v) {
  const raw = String(v || '').trim();
  if (!raw) return '';
  const d = new Date(raw.includes('T') ? raw : `${raw}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function parseSalePaymentJson(sale) {
  try {
    const raw = sale?.payment_json;
    if (!raw) return {};
    if (typeof raw === 'string') return JSON.parse(raw);
    if (typeof raw === 'object' && raw !== null) return raw;
    return {};
  } catch {
    return {};
  }
}

function getSalePaidAmount(sale) {
  if ((sale?.sale_type || 'sale') === 'refund') return 0;

  const total = Number(sale?.total || 0);
  const payment = parseSalePaymentJson(sale);

  const paidFromJson = Number(payment?.paidTotal);
  if (Number.isFinite(paidFromJson) && paidFromJson > 0) {
    return Math.min(total, Math.max(0, paidFromJson));
  }

  const status = String(sale?.status || '').toLowerCase();
  if (status === 'completed') return total;

  return 0;
}

function inferFiscalYearDates(label, startMonth = 7) {
  const m = String(label || '').trim().match(/^(\d{4})-(\d{4})$/);
  if (!m) return { start_date: '', end_date: '' };

  const startYear = Number(m[1]);
  const endYear = Number(m[2]);
  if (!startYear || !endYear) return { start_date: '', end_date: '' };

  const start = new Date(Date.UTC(startYear, Math.max(0, Number(startMonth || 7) - 1), 1));
  const end = new Date(Date.UTC(endYear, Math.max(0, Number(startMonth || 7) - 1), 0));

  return {
    start_date: start.toISOString().slice(0, 10),
    end_date: end.toISOString().slice(0, 10),
  };
}

function listFiscalYearsForStore(store_id) {
  const sid = String(store_id || effectiveStoreId() || '').trim();
  const explicit = db.prepare(`
    SELECT id, label, start_date, end_date, created_at
    FROM fiscal_years
    WHERE store_id=?
    ORDER BY start_date DESC, created_at DESC
  `).all(sid);

  const byLabel = new Map();
  explicit.forEach((row) => {
    byLabel.set(String(row.label || '').trim(), {
      id: row.id,
      label: String(row.label || '').trim(),
      start_date: String(row.start_date || '').trim(),
      end_date: String(row.end_date || '').trim(),
      created_at: row.created_at || null,
      inferred: 0,
    });
  });

  const rawLabels = db.prepare(`
    SELECT fiscal_year AS label FROM sales WHERE store_id=? AND fiscal_year IS NOT NULL AND trim(fiscal_year)<>''
    UNION
    SELECT fiscal_year AS label FROM customer_payments WHERE store_id=? AND fiscal_year IS NOT NULL AND trim(fiscal_year)<>''
  `).all(sid, sid);

  const startMonth = effectiveFyStartMonth();

  rawLabels.forEach((row) => {
    const label = String(row.label || '').trim();
    if (!label || byLabel.has(label)) return;
    const inferred = inferFiscalYearDates(label, startMonth);
    byLabel.set(label, {
      id: null,
      label,
      start_date: inferred.start_date,
      end_date: inferred.end_date,
      created_at: null,
      inferred: 1,
    });
  });

  return Array.from(byLabel.values()).sort((a, b) => {
    const aDate = String(a.start_date || '');
    const bDate = String(b.start_date || '');
    if (aDate && bDate && aDate !== bDate) return aDate < bDate ? 1 : -1;
    return String(a.label || '') < String(b.label || '') ? 1 : -1;
  });
}

function buildDateWhere(alias, range, fromDate, toDate) {
  if (range === 'today') {
    return { clause: `date(${alias}.created_at)=date('now')`, params: [] };
  }

  if (range === '7d') {
    return { clause: `date(${alias}.created_at)>=date('now','-6 days')`, params: [] };
  }

  if (range === 'month') {
    return { clause: `date(${alias}.created_at)>=date('now','-29 days')`, params: [] };
  }

  if (range === 'custom') {
    const start = normYmd(fromDate);
    const end = normYmd(toDate || fromDate);
    if (start && end) {
      return { clause: `date(${alias}.created_at) BETWEEN date(?) AND date(?)`, params: [start, end] };
    }
  }

  return { clause: '1=1', params: [] };
}

function safeHandle(channel, handler) {
  try {
    ipcMain.removeHandler(channel);
  } catch {}
  ipcMain.handle(channel, handler);
}

function getUserEnvPath() {
  return path.join(app.getPath("userData"), ".env");
}

function ensureUserEnvTemplate() {
  try {
    const userEnvPath = getUserEnvPath();

    if (!fsSync.existsSync(userEnvPath)) {
      const template = [
        "SMTP_HOST=",
        "SMTP_PORT=587",
        "SMTP_SECURE=false",
        "SMTP_USER=",
        "SMTP_PASS=",
        "SMTP_FROM=",
        "",
      ].join("\n");

      fsSync.writeFileSync(userEnvPath, template, "utf8");
      console.log("[ENV] Created template .env at:", userEnvPath);
    }
  } catch (e) {
    console.error("[ENV] Failed to create template .env:", e);
  }
}

function loadEnvFiles() {
  try {
    const devEnvPath = path.join(__dirname, "../.env");
    const userEnvPath = getUserEnvPath();

    // 1) load project .env in dev mode if present
    if (fsSync.existsSync(devEnvPath)) {
      dotenv.config({ path: devEnvPath });
      console.log("[ENV] Loaded dev .env:", devEnvPath);
    }

    // 2) always make sure userData .env exists
    ensureUserEnvTemplate();

    // 3) load userData .env and let it override dev values
    if (fsSync.existsSync(userEnvPath)) {
      dotenv.config({ path: userEnvPath, override: true });
      console.log("[ENV] Loaded userData .env:", userEnvPath);
    }

    console.log("[ENV] SMTP status:", process.env.SMTP_HOST ? "configured" : "missing");
  } catch (e) {
    console.error("[ENV] Failed to load .env files:", e);
  }
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

// ---------- auto updater ----------
function setupAutoUpdater() {
  if (isDev) {
    console.log("[Updater] Disabled in development mode.");
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    console.log("[Updater] Checking for update...");
    sendToRenderer("updater:message", {
      type: "info",
      message: "Checking for updates...",
    });
  });

  autoUpdater.on("update-available", (info) => {
    console.log("[Updater] Update available:", info?.version);
    sendToRenderer("updater:message", {
      type: "info",
      message: `Update available: ${info?.version || "new version"}`,
      version: info?.version || null,
    });
  });

  autoUpdater.on("update-not-available", () => {
    console.log("[Updater] No update available.");
    sendToRenderer("updater:message", {
      type: "info",
      message: "You already have the latest version.",
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    console.log("[Updater] Download progress:", progress?.percent);
    sendToRenderer("updater:progress", {
      percent: Number(progress?.percent || 0),
      bytesPerSecond: Number(progress?.bytesPerSecond || 0),
      transferred: Number(progress?.transferred || 0),
      total: Number(progress?.total || 0),
    });
  });

  autoUpdater.on("update-downloaded", async (info) => {
    console.log("[Updater] Update downloaded:", info?.version);

    sendToRenderer("updater:message", {
      type: "success",
      message: `Update downloaded: ${info?.version || "new version"}. Restart to install.`,
      version: info?.version || null,
      downloaded: true,
    });

    const result = await dialog.showMessageBox(mainWindow, {
      type: "info",
      buttons: ["Restart now", "Later"],
      defaultId: 0,
      cancelId: 1,
      title: "Update ready",
      message: `Version ${info?.version || ""} has been downloaded.`,
      detail: "Restart the app to install the update.",
    });

    if (result.response === 0) {
      autoUpdater.quitAndInstall();
    }
  });

  autoUpdater.on("error", (err) => {
    console.error("[Updater] Error:", err);
    sendToRenderer("updater:message", {
      type: "error",
      message: err?.message || "Update error",
    });
  });

  setTimeout(() => {
    autoUpdater.checkForUpdatesAndNotify().catch((err) => {
      console.error("[Updater] Initial check failed:", err);
    });
  }, 4000);
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

function getBootstrapDefaults() {
  const envStoreId = String(
    process.env.POS_DEFAULT_STORE_ID ||
    process.env.DEFAULT_STORE_ID ||
    process.env.STORE_ID ||
    ""
  ).trim();
  const envStoreName = String(
    process.env.POS_DEFAULT_STORE_NAME ||
    process.env.DEFAULT_STORE_NAME ||
    process.env.STORE_NAME ||
    ""
  ).trim();
  const envCurrency = String(
    process.env.POS_DEFAULT_CURRENCY ||
    process.env.DEFAULT_CURRENCY ||
    process.env.CURRENCY ||
    "BDT"
  ).trim() || "BDT";
  const envFyStartMonth = Number(
    process.env.POS_FY_START_MONTH ||
    process.env.DEFAULT_FY_START_MONTH ||
    7
  ) || 7;

  let row = null;
  try {
    const hasStoresTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='stores'")
      .get();

    if (hasStoresTable) {
      if (envStoreId) {
        row = db.prepare("SELECT * FROM stores WHERE store_id=?").get(envStoreId) || null;
      }
      if (!row) {
        row = db.prepare("SELECT * FROM stores ORDER BY created_at ASC, store_id ASC LIMIT 1").get() || null;
      }
    }
  } catch {
    row = null;
  }

  return {
    store_id: String(row?.store_id || envStoreId || "").trim(),
    store_name: String(row?.store_name || envStoreName || row?.store_id || "RetailPOS").trim() || "RetailPOS",
    currency: String(row?.currency || envCurrency || "BDT").trim() || "BDT",
    fy_start_month: Number(row?.fy_start_month || envFyStartMonth || 7) || 7,
  };
}

function getSyncDefaults() {
  const s = getSettingsObject();
  return {
    supabase_url: String(
      s.supabase_url ||
      process.env.POS_SUPABASE_URL ||
      process.env.SUPABASE_URL ||
      process.env.VITE_SUPABASE_URL ||
      ""
    ).trim(),
    supabase_key: String(
      s.supabase_key ||
      process.env.POS_SUPABASE_KEY ||
      process.env.SUPABASE_KEY ||
      process.env.VITE_SUPABASE_ANON_KEY ||
      ""
    ).trim(),
  };
}

function getSuperadminPinHash() {
  const s = getSettingsObject();
  const envPinHash = String(
    process.env.POS_SUPERADMIN_PIN_HASH ||
    process.env.SUPERADMIN_PIN_HASH ||
    ""
  ).trim();
  const envPin = String(
    process.env.POS_SUPERADMIN_PIN ||
    process.env.SUPERADMIN_PIN ||
    ""
  ).trim();

  return (
    String(s.superadmin_pin_hash || "").trim() ||
    envPinHash ||
    (envPin ? sha256(envPin) : sha256("1111"))
  );
}

function applyStoreAsPrimary(storeId) {
  const sid = String(storeId || "").trim();
  if (!sid) return;

  const row = getStoreRow(sid);
  if (!row) {
    db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)").run("store_id", sid);
    refreshStoreCtxFromSettings();
    return;
  }

  db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)").run("store_id", sid);
  db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)").run("store_name", String(row.store_name || sid));
  db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)").run("currency", String(row.currency || "BDT"));
  db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)").run("fy_start_month", String(Number(row.fy_start_month || 7) || 7));
  refreshStoreCtxFromSettings();
}

function refreshStoreCtxFromSettings() {
  const s = getSettingsObject();
  const fallback = getBootstrapDefaults();
  storeCtx = {
    store_id: String(s.store_id || fallback.store_id || "").trim(),
    store_name: String(s.store_name || fallback.store_name || fallback.store_id || "RetailPOS").trim() || "RetailPOS",
    currency: String(s.currency || fallback.currency || "BDT").trim() || "BDT",
    fy_start_month: Number(s.fy_start_month || fallback.fy_start_month || 7) || 7,
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
let restoreInFlight = false;

function shouldAttemptCloudRestore(storeId) {
  const sid = String(storeId || "").trim();
  if (!sid) return false;

  const counts = {
    products: Number(db.prepare("SELECT COUNT(*) AS c FROM products WHERE store_id=?").get(sid)?.c || 0),
    categories: Number(db.prepare("SELECT COUNT(*) AS c FROM categories WHERE store_id=?").get(sid)?.c || 0),
    customers: Number(db.prepare("SELECT COUNT(*) AS c FROM customers WHERE store_id=?").get(sid)?.c || 0),
    customerPayments: Number(db.prepare("SELECT COUNT(*) AS c FROM customer_payments WHERE store_id=?").get(sid)?.c || 0),
    fiscalYears: Number(db.prepare("SELECT COUNT(*) AS c FROM fiscal_years WHERE store_id=?").get(sid)?.c || 0),
    bankAccounts: Number(db.prepare("SELECT COUNT(*) AS c FROM bank_accounts WHERE store_id=?").get(sid)?.c || 0),
    bankTransactions: Number(db.prepare("SELECT COUNT(*) AS c FROM bank_transactions WHERE store_id=?").get(sid)?.c || 0),
    sales: Number(db.prepare("SELECT COUNT(*) AS c FROM sales WHERE store_id=?").get(sid)?.c || 0),
  };

  return Object.values(counts).every((n) => !n);
}

function applyPulledStoreMetaToLocal(store = {}, storeId = null) {
  const sid = String(store?.store_id || storeId || "").trim();
  if (!sid) return;

  const storeName = String(store?.store_name || sid).trim() || sid;
  const currency = String(store?.currency || "BDT").trim() || "BDT";
  const fyStart = Number(store?.fy_start_month || 7) || 7;
  const contact = store?.contact == null ? "" : String(store.contact);
  const receiptFooter = store?.receipt_footer == null ? "Thank you for shopping with us!" : String(store.receipt_footer);

  db.prepare(`
    INSERT INTO stores (store_id, store_name, currency, contact, receipt_footer, fy_start_month, created_at)
    VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))
    ON CONFLICT(store_id) DO UPDATE SET
      store_name=excluded.store_name,
      currency=excluded.currency,
      contact=excluded.contact,
      receipt_footer=excluded.receipt_footer,
      fy_start_month=excluded.fy_start_month
  `).run(
    sid,
    storeName,
    currency,
    contact,
    receiptFooter,
    fyStart,
    store?.created_at || null
  );

  db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)").run("store_id", sid);
  db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)").run("store_name", storeName);
  db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)").run("currency", currency);
  db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)").run("fy_start_month", String(fyStart));
  db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)").run("contact", contact);
  db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)").run("receipt_footer", receiptFooter);
  refreshStoreCtxFromSettings();
}

function applyPulledCatalogToLocal({ storeId, categories = [], products = [], inventory = [] } = {}) {
  const sid = String(storeId || "").trim();
  if (!sid) return { categories: 0, products: 0 };

  const inventoryByProductId = new Map(
    (inventory || []).map((row) => [String(row?.product_id), row]).filter(([k]) => !!k)
  );

  const run = db.transaction(() => {
    db.prepare("DELETE FROM categories WHERE store_id=?").run(sid);
    db.prepare("DELETE FROM products WHERE store_id=?").run(sid);

    const insertCategory = db.prepare(`
      INSERT INTO categories (id, store_id, name, color)
      VALUES (?, ?, ?, ?)
    `);

    (categories || [])
      .map((row) => ({
        id: Number(row?.local_id),
        name: String(row?.name || "").trim(),
        color: String(row?.color || "#6366f1").trim() || "#6366f1",
      }))
      .filter((row) => row.id && row.name)
      .sort((a, b) => a.id - b.id)
      .forEach((row) => {
        insertCategory.run(row.id, sid, row.name, row.color);
      });

    const insertProduct = db.prepare(`
      INSERT INTO products (
        id, store_id, name, sku, category, price, cost, stock, low_stock_threshold, barcode, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), COALESCE(?, datetime('now')))
    `);

    (products || [])
      .map((row) => {
        const inv = inventoryByProductId.get(String(row?.local_id)) || {};
        return {
          id: Number(row?.local_id),
          name: String(row?.name || "").trim(),
          sku: row?.sku == null ? "" : String(row.sku),
          category: row?.category == null ? "" : String(row.category),
          price: Number(row?.price || 0),
          cost: Number(row?.cost || 0),
          stock: Number(inv?.stock || 0),
          low_stock_threshold: Number(inv?.low_stock_threshold || row?.low_stock_threshold || 5) || 5,
          barcode: row?.barcode == null ? "" : String(row.barcode),
          created_at: row?.created_at || inv?.created_at || null,
          updated_at: row?.updated_at || inv?.updated_at || null,
        };
      })
      .filter((row) => row.id && row.name)
      .sort((a, b) => a.id - b.id)
      .forEach((row) => {
        insertProduct.run(
          row.id,
          sid,
          row.name,
          row.sku,
          row.category,
          row.price,
          row.cost,
          row.stock,
          row.low_stock_threshold,
          row.barcode,
          row.created_at,
          row.updated_at
        );
      });
  });

  run();
  return { categories: Array.isArray(categories) ? categories.length : 0, products: Array.isArray(products) ? products.length : 0 };
}

function applyPulledCustomersToLocal({ storeId, customers = [] } = {}) {
  const sid = String(storeId || "").trim();
  if (!sid) return { customers: 0 };

  const run = db.transaction(() => {
    db.prepare("DELETE FROM customers WHERE store_id=?").run(sid);
    const ins = db.prepare(`
      INSERT INTO customers (id, store_id, name, phone, email, address, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), COALESCE(?, datetime('now')))
    `);

    (customers || [])
      .map((row) => ({
        id: Number(row?.local_id),
        name: String(row?.name || "").trim(),
        phone: row?.phone == null ? null : String(row.phone),
        email: row?.email == null ? null : String(row.email),
        address: row?.address == null ? null : String(row.address),
        created_at: row?.created_at || null,
        updated_at: row?.updated_at || null,
      }))
      .filter((row) => row.id && row.name)
      .sort((a, b) => a.id - b.id)
      .forEach((row) => {
        ins.run(row.id, sid, row.name, row.phone, row.email, row.address, row.created_at, row.updated_at);
      });
  });

  run();
  return { customers: Array.isArray(customers) ? customers.length : 0 };
}

function applyPulledCustomerPaymentsToLocal({ storeId, customerPayments = [] } = {}) {
  const sid = String(storeId || "").trim();
  if (!sid) return { customerPayments: 0 };

  const run = db.transaction(() => {
    db.prepare("DELETE FROM customer_payments WHERE store_id=?").run(sid);
    const ins = db.prepare(`
      INSERT INTO customer_payments (
        id, store_id, customer_id, fiscal_year, amount, method, note, created_at, cashier_id, cashier_name
      ) VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), ?, ?)
    `);

    (customerPayments || [])
      .map((row) => ({
        id: Number(row?.local_id),
        customer_id: row?.local_customer_id == null ? null : Number(row.local_customer_id),
        fiscal_year: row?.fiscal_year == null ? "" : String(row.fiscal_year),
        amount: Number(row?.amount || 0),
        method: row?.method == null ? "cash" : String(row.method),
        note: row?.note == null ? "" : String(row.note),
        created_at: row?.created_at || null,
        cashier_id: row?.cashier_id == null ? null : Number(row.cashier_id),
        cashier_name: row?.cashier_name == null ? null : String(row.cashier_name),
      }))
      .filter((row) => row.id && row.amount > 0)
      .sort((a, b) => a.id - b.id)
      .forEach((row) => {
        ins.run(row.id, sid, row.customer_id, row.fiscal_year, row.amount, row.method, row.note, row.created_at, row.cashier_id, row.cashier_name);
      });
  });

  run();
  return { customerPayments: Array.isArray(customerPayments) ? customerPayments.length : 0 };
}

function applyPulledFiscalYearsToLocal({ storeId, fiscalYears = [] } = {}) {
  const sid = String(storeId || "").trim();
  if (!sid) return { fiscalYears: 0 };

  const run = db.transaction(() => {
    db.prepare("DELETE FROM fiscal_years WHERE store_id=?").run(sid);
    const ins = db.prepare(`
      INSERT INTO fiscal_years (id, store_id, label, start_date, end_date, created_at)
      VALUES (?, ?, ?, ?, ?, COALESCE(?, datetime('now')))
    `);

    (fiscalYears || [])
      .map((row) => ({
        id: row?.local_id == null ? null : Number(row.local_id),
        label: String(row?.label || "").trim(),
        start_date: normYmd(row?.start_date),
        end_date: normYmd(row?.end_date),
        created_at: row?.created_at || null,
      }))
      .filter((row) => row.label && row.start_date && row.end_date)
      .sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)))
      .forEach((row, idx) => {
        ins.run(row.id || (idx + 1), sid, row.label, row.start_date, row.end_date, row.created_at);
      });
  });

  run();
  return { fiscalYears: Array.isArray(fiscalYears) ? fiscalYears.length : 0 };
}

async function triggerFirstRunCloudRestore(storeId = effectiveStoreId(), { force = false } = {}) {
  const sid = String(storeId || effectiveStoreId() || "").trim();
  if (!sid) return { ok: false, message: "No store selected" };
  if (!sync?.pullStoreSnapshot) return { ok: false, message: "Cloud restore not available" };
  if (restoreInFlight) return { ok: false, message: "Cloud restore already running" };
  if (!force && !shouldAttemptCloudRestore(sid)) {
    return { ok: false, message: "Local store already has data. Use force restore only on a new/empty PC." };
  }

  restoreInFlight = true;
  try {
    const snapshot = await sync.pullStoreSnapshot({ storeId: sid });
    applyPulledStoreMetaToLocal(snapshot?.store || {}, sid);
    const catalogCounts = applyPulledCatalogToLocal({
      storeId: sid,
      categories: snapshot?.categories || [],
      products: snapshot?.products || [],
      inventory: snapshot?.inventory || [],
    });
    const customerCounts = applyPulledCustomersToLocal({ storeId: sid, customers: snapshot?.customers || [] });
    const paymentCounts = applyPulledCustomerPaymentsToLocal({ storeId: sid, customerPayments: snapshot?.customerPayments || [] });
    const fyCounts = applyPulledFiscalYearsToLocal({ storeId: sid, fiscalYears: snapshot?.fiscalYears || [] });
    applyPulledBankDataToLocal({
      storeId: sid,
      accounts: snapshot?.bankAccounts || [],
      transactions: snapshot?.bankTransactions || [],
    });

    const admin = db.prepare("SELECT id FROM users WHERE store_id=? AND lower(username)='admin'").get(sid);
    if (!admin) {
      db.prepare(`
        INSERT INTO users (store_id, username, name, role, pin_hash)
        VALUES (?,?,?,?,?)
      `).run(sid, "admin", "Admin", "admin", sha256("1234"));
    }

    currentUser = null;
    initSyncFromSettings();

    return {
      ok: true,
      counts: {
        categories: catalogCounts.categories,
        products: catalogCounts.products,
        customers: customerCounts.customers,
        customerPayments: paymentCounts.customerPayments,
        fiscalYears: fyCounts.fiscalYears,
        bankAccounts: Array.isArray(snapshot?.bankAccounts) ? snapshot.bankAccounts.length : 0,
        bankTransactions: Array.isArray(snapshot?.bankTransactions) ? snapshot.bankTransactions.length : 0,
      },
    };
  } catch (e) {
    return { ok: false, message: e?.message || "Cloud restore failed" };
  } finally {
    restoreInFlight = false;
  }
}

function initSyncFromSettings() {
  try {
    const s = getSettingsObject();
    const syncDefaults = getSyncDefaults();
    const supabaseUrl = (s.supabase_url || syncDefaults.supabase_url || "").trim();
    const supabaseKey = (s.supabase_key || syncDefaults.supabase_key || "").trim();
    const storeId = String(s.store_id || getBootstrapDefaults().store_id || "").trim();
    const storeName = String(s.store_name || getBootstrapDefaults().store_name || "").trim();

    if (!supabaseUrl || !supabaseKey || !storeId) return;
    if (!sync || typeof sync.init !== "function") return;

    if ((s.supabase_url || "") !== supabaseUrl) {
      db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)").run("supabase_url", supabaseUrl);
    }
    if ((s.supabase_key || "") !== supabaseKey) {
      db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)").run("supabase_key", supabaseKey);
    }
    if ((s.store_id || "") !== storeId) {
      db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)").run("store_id", storeId);
    }
    if ((s.store_name || "") !== storeName && storeName) {
      db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)").run("store_name", storeName);
    }
    refreshStoreCtxFromSettings();

    sync.init({ supabaseUrl, supabaseKey, storeId, storeName });

    if (shouldAttemptCloudRestore(storeId)) {
      Promise.resolve(triggerFirstRunCloudRestore(storeId, { force: true })).catch(() => {});
      return;
    }

    Promise.resolve(triggerStoreMetaSync(storeId)).catch(() => {});
    const products = db.prepare("SELECT * FROM products WHERE store_id=?").all(storeId);
    Promise.resolve(sync.syncInventory({ storeId, storeName, products })).catch(() => {});
  } catch {
    // offline ok
  }
}

function getStoreSettingsForSync(storeId) {
  const sid = String(storeId || effectiveStoreId() || "").trim();
  const base = getSettingsObject();
  const row = getStoreRow(sid) || {};

  return {
    store_id: sid,
    store_name: String(row.store_name || (sid === storeCtx.store_id ? base.store_name : "") || storeCtx.store_name || sid).trim() || sid,
    currency: String(row.currency || (sid === storeCtx.store_id ? base.currency : "") || storeCtx.currency || "BDT").trim() || "BDT",
    fy_start_month: Number(row.fy_start_month || (sid === storeCtx.store_id ? base.fy_start_month : "") || storeCtx.fy_start_month || 7) || 7,
    receipt_footer:
      row.receipt_footer !== undefined && row.receipt_footer !== null
        ? String(row.receipt_footer)
        : String((sid === storeCtx.store_id ? base.receipt_footer : "") || "Thank you for shopping with us!"),
    contact:
      row.contact !== undefined && row.contact !== null
        ? String(row.contact)
        : String((sid === storeCtx.store_id ? base.contact : "") || ""),
  };
}

function getCustomerPaymentsForSync(storeId) {
  const sid = String(storeId || effectiveStoreId() || "").trim();
  return db.prepare(`
    SELECT p.*, c.name AS customer_name
    FROM customer_payments p
    LEFT JOIN customers c ON c.id = p.customer_id AND c.store_id = p.store_id
    WHERE p.store_id=?
    ORDER BY p.created_at DESC, p.id DESC
  `).all(sid);
}

function getFiscalYearsForSync(storeId) {
  return listFiscalYearsForStore(String(storeId || effectiveStoreId() || "").trim());
}

function getBankAccountsForSync(storeId) {
  const sid = String(storeId || effectiveStoreId() || "").trim();
  return db.prepare(`
    SELECT *
    FROM bank_accounts
    WHERE store_id=?
    ORDER BY id DESC
  `).all(sid);
}

function getBankTransactionsForSync(storeId) {
  const sid = String(storeId || effectiveStoreId() || "").trim();
  return db.prepare(`
    SELECT *
    FROM bank_transactions
    WHERE store_id=?
    ORDER BY created_at DESC, id DESC
  `).all(sid);
}

function getSalesForSync(storeId) {
  const sid = String(storeId || effectiveStoreId() || "").trim();
  return db.prepare(`
    SELECT *
    FROM sales
    WHERE store_id=?
    ORDER BY created_at DESC, id DESC
  `).all(sid);
}

function getSaleItemsMapForSync(storeId) {
  const sid = String(storeId || effectiveStoreId() || "").trim();
  const rows = db.prepare(`
    SELECT si.*
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    WHERE s.store_id=?
    ORDER BY si.id ASC
  `).all(sid);

  const map = {};
  rows.forEach((row) => {
    const key = String(row.sale_id);
    if (!Array.isArray(map[key])) map[key] = [];
    map[key].push(row);
  });
  return map;
}

function triggerStoreMetaSync(storeId = effectiveStoreId()) {
  const store = getStoreSettingsForSync(storeId);
  return sync.syncStore(store);
}

function triggerCatalogSync(storeId = effectiveStoreId()) {
  const sid = String(storeId || effectiveStoreId() || "").trim();
  const store = getStoreSettingsForSync(sid);
  const categories = db.prepare("SELECT * FROM categories WHERE store_id=? ORDER BY name").all(sid);
  const products = db.prepare("SELECT * FROM products WHERE store_id=? ORDER BY name").all(sid);
  return sync.pushSharedCatalog({
    storeId: sid,
    storeName: store.store_name,
    categories,
    products,
  });
}

function triggerInventorySync(storeId = effectiveStoreId()) {
  const sid = String(storeId || effectiveStoreId() || "").trim();
  const store = getStoreSettingsForSync(sid);
  const products = db.prepare("SELECT * FROM products WHERE store_id=? ORDER BY name").all(sid);
  return sync.syncInventory({
    storeId: sid,
    storeName: store.store_name,
    products,
  });
}

function triggerCustomersSync(storeId = effectiveStoreId()) {
  const sid = String(storeId || effectiveStoreId() || "").trim();
  const store = getStoreSettingsForSync(sid);
  const customers = db.prepare("SELECT * FROM customers WHERE store_id=? ORDER BY id DESC").all(sid);
  return sync.syncCustomers({
    storeId: sid,
    storeName: store.store_name,
    customers,
  });
}

function triggerCustomerPaymentsSync(storeId = effectiveStoreId()) {
  const sid = String(storeId || effectiveStoreId() || "").trim();
  const store = getStoreSettingsForSync(sid);
  return sync.syncCustomerPayments({
    storeId: sid,
    storeName: store.store_name,
    payments: getCustomerPaymentsForSync(sid),
  });
}

function triggerFiscalYearsSync(storeId = effectiveStoreId()) {
  const sid = String(storeId || effectiveStoreId() || "").trim();
  const store = getStoreSettingsForSync(sid);
  return sync.syncFiscalYears({
    storeId: sid,
    storeName: store.store_name,
    fiscalYears: getFiscalYearsForSync(sid),
  });
}

function triggerBankSync(storeId = effectiveStoreId()) {
  const sid = String(storeId || effectiveStoreId() || "").trim();
  const store = getStoreSettingsForSync(sid);
  return sync.syncBankData({
    storeId: sid,
    storeName: store.store_name,
    accounts: getBankAccountsForSync(sid),
    transactions: getBankTransactionsForSync(sid),
  });
}

function applyPulledBankDataToLocal({ storeId, accounts = [], transactions = [] } = {}) {
  const sid = String(storeId || effectiveStoreId() || "").trim();
  if (!sid) return { ok: false, message: "Missing store id" };

  const safeAccounts = Array.isArray(accounts) ? accounts : [];
  const safeTransactions = Array.isArray(transactions) ? transactions : [];

  const run = db.transaction(() => {
    db.prepare("DELETE FROM bank_transactions WHERE store_id=?").run(sid);
    db.prepare("DELETE FROM bank_accounts WHERE store_id=?").run(sid);

    const insertAccount = db.prepare(`
      INSERT INTO bank_accounts (
        id, store_id, account_name, bank_name, account_number, opening_balance, note, active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), COALESCE(?, COALESCE(?, datetime('now'))))
    `);

    const insertTransaction = db.prepare(`
      INSERT INTO bank_transactions (
        id, store_id, account_id, type, amount, reference, note, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), COALESCE(?, COALESCE(?, datetime('now'))))
    `);

    safeAccounts
      .map((row) => ({
        id: Number(row?.local_id),
        account_name: String(row?.account_name || "").trim(),
        bank_name: String(row?.bank_name || "").trim(),
        account_number: String(row?.account_number || "").trim(),
        opening_balance: Number(row?.opening_balance || 0),
        note: row?.note == null ? "" : String(row.note),
        active: Number(row?.active === undefined ? 1 : row.active) ? 1 : 0,
        created_at: row?.created_at || null,
        updated_at: row?.updated_at || row?.created_at || null,
      }))
      .filter((row) => row.id && row.account_name)
      .sort((a, b) => a.id - b.id)
      .forEach((row) => {
        insertAccount.run(
          row.id,
          sid,
          row.account_name,
          row.bank_name || "",
          row.account_number || "",
          row.opening_balance,
          row.note,
          row.active,
          row.created_at,
          row.updated_at,
          row.created_at
        );
      });

    safeTransactions
      .map((row) => ({
        id: Number(row?.local_id),
        account_id: Number(row?.local_account_id),
        type: String(row?.type || "credit").trim().toLowerCase() === "debit" ? "debit" : "credit",
        amount: Number(row?.amount || 0),
        reference: row?.reference == null ? "" : String(row.reference),
        note: row?.note == null ? "" : String(row.note),
        created_at: row?.created_at || null,
        updated_at: row?.updated_at || row?.created_at || null,
      }))
      .filter((row) => row.id && row.account_id && row.amount > 0)
      .sort((a, b) => a.id - b.id)
      .forEach((row) => {
        insertTransaction.run(
          row.id,
          sid,
          row.account_id,
          row.type,
          row.amount,
          row.reference,
          row.note,
          row.created_at,
          row.updated_at,
          row.created_at
        );
      });
  });

  run();
  return { ok: true };
}

async function triggerBankPull(storeId = effectiveStoreId()) {
  const sid = String(storeId || effectiveStoreId() || "").trim();
  if (!sid || !sync?.pullBankData) return { ok: false, message: "Bank pull not available" };

  const pulled = await sync.pullBankData({ storeId: sid });
  applyPulledBankDataToLocal({
    storeId: sid,
    accounts: pulled?.accounts || [],
    transactions: pulled?.transactions || [],
  });

  return {
    ok: true,
    accounts: Array.isArray(pulled?.accounts) ? pulled.accounts.length : 0,
    transactions: Array.isArray(pulled?.transactions) ? pulled.transactions.length : 0,
  };
}

let bankAutoPullTimer = null;

function startBankAutoPull() {
  try {
    if (bankAutoPullTimer) clearInterval(bankAutoPullTimer);
  } catch {}
  bankAutoPullTimer = setInterval(() => {
    if (!currentUser) return;
    Promise.resolve(triggerBankPull()).catch(() => {});
  }, 15000);
}

function stopBankAutoPull() {
  try {
    if (bankAutoPullTimer) clearInterval(bankAutoPullTimer);
  } catch {}
  bankAutoPullTimer = null;
}

function triggerFullSync(storeId = effectiveStoreId()) {
  const sid = String(storeId || effectiveStoreId() || "").trim();
  const store = getStoreSettingsForSync(sid);
  const categories = db.prepare("SELECT * FROM categories WHERE store_id=? ORDER BY name").all(sid);
  const products = db.prepare("SELECT * FROM products WHERE store_id=? ORDER BY name").all(sid);
  const customers = db.prepare("SELECT * FROM customers WHERE store_id=? ORDER BY id DESC").all(sid);
  const customerPayments = getCustomerPaymentsForSync(sid);
  const fiscalYears = getFiscalYearsForSync(sid);
  const bankAccounts = getBankAccountsForSync(sid);
  const bankTransactions = getBankTransactionsForSync(sid);
  const sales = getSalesForSync(sid);
  const saleItemsBySaleId = getSaleItemsMapForSync(sid);

  return sync.syncAllData({
    store,
    categories,
    products,
    customers,
    customerPayments,
    fiscalYears,
    bankAccounts,
    bankTransactions,
    sales,
    saleItemsBySaleId,
  });
}

// ---------- customer due ----------
function computeCustomerDueByYear(store_id, customer_id) {
  const fyStart = effectiveFyStartMonth();

  const dueSales = db.prepare(`
    SELECT id, fiscal_year, total, sale_type, status, created_at, payment_json
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

    if ((s.sale_type || 'sale') === 'refund') {
      y.refunds += Number(s.total || 0);
    } else {
      y.credit_sales += Number(s.total || 0);
      y.payments += Number(getSalePaidAmount(s) || 0);
    }
  }

  for (const p of payments) {
    const fy = p.fiscal_year || nowFiscalYear();
    const y = addYear(fy);
    y.payments += Number(p.amount || 0);
  }

  let overall = 0;
  const years = Array.from(yearMap.values())
    .map((y) => {
      const raw = Number(y.credit_sales || 0) + Number(y.refunds || 0) - Number(y.payments || 0);
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
    // drop old unique index if it exists
    db.exec("DROP INDEX IF EXISTS idx_categories_store_name_unique;");

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

    INSERT OR IGNORE INTO settings VALUES ('store_name', '');
    INSERT OR IGNORE INTO settings VALUES ('store_id', '');
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

    CREATE TABLE IF NOT EXISTS bank_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id TEXT NOT NULL,
      account_name TEXT NOT NULL,
      bank_name TEXT DEFAULT '',
      account_number TEXT DEFAULT '',
      opening_balance REAL DEFAULT 0,
      note TEXT DEFAULT '',
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS bank_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id TEXT NOT NULL,
      account_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      reference TEXT DEFAULT '',
      note TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (account_id) REFERENCES bank_accounts(id) ON DELETE CASCADE
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

  db.exec(`
    CREATE TABLE IF NOT EXISTS fiscal_years (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id TEXT NOT NULL,
      label TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  ensureCol("sales", "sale_type", "TEXT DEFAULT 'sale'");
  ensureCol("sales", "original_sale_id", "INTEGER");
  ensureCol("sales", "customer_id", "INTEGER");
  ensureCol("sales", "customer_name", "TEXT");
  ensureCol("sales", "cashier_id", "INTEGER");
  ensureCol("sales", "cashier_name", "TEXT");
  ensureCol("sales", "gross_profit", "REAL DEFAULT 0");

  ensureCol("sale_items", "cost", "REAL DEFAULT 0");
  ensureCol("sale_items", "profit", "REAL DEFAULT 0");
  ensureCol("bank_accounts", "bank_name", "TEXT DEFAULT ''");
  ensureCol("bank_accounts", "account_number", "TEXT DEFAULT ''");
  ensureCol("bank_accounts", "opening_balance", "REAL DEFAULT 0");
  ensureCol("bank_accounts", "note", "TEXT DEFAULT ''");
  ensureCol("bank_accounts", "active", "INTEGER DEFAULT 1");
  ensureCol("bank_accounts", "updated_at", "TEXT DEFAULT (datetime('now'))");
  ensureCol("bank_transactions", "reference", "TEXT DEFAULT ''");
  ensureCol("bank_transactions", "note", "TEXT DEFAULT ''");
  ensureCol("bank_transactions", "updated_at", "TEXT DEFAULT (datetime('now'))");

  db.prepare("UPDATE products SET store_id=? WHERE store_id IS NULL OR store_id=''").run(storeCtx.store_id);
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
    CREATE UNIQUE INDEX IF NOT EXISTS idx_fiscal_years_store_label_unique ON fiscal_years(store_id, label);
    CREATE INDEX IF NOT EXISTS idx_fiscal_years_store_dates ON fiscal_years(store_id, start_date, end_date);
    CREATE INDEX IF NOT EXISTS idx_bank_accounts_store_id ON bank_accounts(store_id);
    CREATE INDEX IF NOT EXISTS idx_bank_transactions_account_created ON bank_transactions(account_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_bank_transactions_store_id ON bank_transactions(store_id);
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

      const admin = db.prepare("SELECT id FROM users WHERE store_id=? AND lower(username)='admin'").get(sid);
      if (!admin) {
        db.prepare(`
          INSERT INTO users (store_id, username, name, role, pin_hash)
          VALUES (?,?,?,?,?)
        `).run(sid, "admin", "Admin", "admin", sha256("1234"));
      }

      Promise.resolve(triggerStoreMetaSync(sid)).catch(() => {});
      Promise.resolve(triggerFiscalYearsSync(sid)).catch(() => {});
      return { ok: true };
    } catch {
      return { ok: false, message: "Store ID already exists" };
    }
  });

  safeHandle("stores:setActive", async (_, { store_id }) => {
    if (!isSuperadmin()) return superadminOnly();

    const sid = String(store_id || "").trim();
    const st = db.prepare("SELECT * FROM stores WHERE store_id=?").get(sid);
    if (!st) return { ok: false, message: "Store not found" };

    currentUser.manage_store_id = sid;
    Promise.resolve(triggerBankPull(sid)).catch(() => {});
    startBankAutoPull();
    return { ok: true, store: st };
  });

  // -------------------- AUTH --------------------
  safeHandle("auth:current", () => currentUser);

  safeHandle("auth:login", (_, payload) => {
    const username = String(payload?.username || "").trim();
    const pin = String(payload?.pin || "").trim();
    const requestedStore = String(payload?.store_id || "").trim();

    if (username && username.toLowerCase() === "superadmin") {
      const s = getSettingsObject();
      const hash = getSuperadminPinHash();

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

      Promise.resolve(triggerBankPull(effectiveStoreId())).catch(() => {});
      startBankAutoPull();
      Promise.resolve(triggerBankPull(effectiveStoreId())).catch(() => {});
      startBankAutoPull();
      Promise.resolve(triggerBankPull(effectiveStoreId())).catch(() => {});
      startBankAutoPull();
      return { ok: true, user: currentUser };
    }

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
    stopBankAutoPull();
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
      const hash = getSuperadminPinHash();
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
  safeHandle("fiscalYears:list", () => {
    return listFiscalYearsForStore(effectiveStoreId());
  });

  safeHandle("fiscalYears:create", (_, payload = {}) => {
    if (!isAdmin()) return adminOnly();

    const sid = effectiveStoreId();
    const label = String(payload.label || '').trim();
    const start_date = normYmd(payload.start_date);
    const end_date = normYmd(payload.end_date);

    if (!label || !start_date || !end_date) {
      return { ok: false, message: 'Label, start date, and end date are required' };
    }

    if (start_date > end_date) {
      return { ok: false, message: 'Start date must be before end date' };
    }

    try {
      db.prepare(`
        INSERT INTO fiscal_years (store_id, label, start_date, end_date)
        VALUES (?, ?, ?, ?)
      `).run(sid, label, start_date, end_date);
      return { ok: true };
    } catch {
      return { ok: false, message: 'Financial year label already exists' };
    }
  });

  safeHandle("fiscalYears:update", (_, payload = {}) => {
    if (!isAdmin()) return adminOnly();

    const sid = effectiveStoreId();
    const original_label = String(payload.original_label || payload.label || '').trim();
    const next_label = String(payload.label || '').trim();
    const start_date = normYmd(payload.start_date);
    const end_date = normYmd(payload.end_date);
    const allow_inferred_create = Number(payload.allow_inferred_create || 0) ? 1 : 0;

    if (!original_label || !next_label || !start_date || !end_date) {
      return { ok: false, message: 'Label, start date, and end date are required' };
    }

    if (start_date > end_date) {
      return { ok: false, message: 'Start date must be before end date' };
    }

    const existing = db.prepare(`
      SELECT id, label
      FROM fiscal_years
      WHERE store_id=? AND label=?
    `).get(sid, original_label);

    const duplicate = db.prepare(`
      SELECT id
      FROM fiscal_years
      WHERE store_id=? AND label=?
    `).get(sid, next_label);

    if (existing) {
      if (duplicate && Number(duplicate.id) !== Number(existing.id)) {
        return { ok: false, message: 'Financial year label already exists' };
      }

      db.prepare(`
        UPDATE fiscal_years
        SET label=?, start_date=?, end_date=?
        WHERE store_id=? AND label=?
      `).run(next_label, start_date, end_date, sid, original_label);

      Promise.resolve(triggerFiscalYearsSync(sid)).catch(() => {});
      return { ok: true };
    }

    if (!allow_inferred_create) {
      return { ok: false, message: 'Only manual financial years can change label. For inferred years, keep the same label and save dates.' };
    }

    try {
      db.prepare(`
        INSERT INTO fiscal_years (store_id, label, start_date, end_date)
        VALUES (?, ?, ?, ?)
      `).run(sid, next_label, start_date, end_date);
      Promise.resolve(triggerFiscalYearsSync(sid)).catch(() => {});
      return { ok: true };
    } catch {
      return { ok: false, message: 'Financial year label already exists' };
    }
  });

  safeHandle("fiscalYears:delete", (_, label) => {
    if (!isAdmin()) return adminOnly();

    const sid = effectiveStoreId();
    db.prepare(`
      DELETE FROM fiscal_years
      WHERE store_id=? AND label=?
    `).run(sid, String(label || '').trim());

    Promise.resolve(triggerFiscalYearsSync(sid)).catch(() => {});
    return { ok: true };
  });


  // -------------------- BANK ACCOUNTS --------------------
  safeHandle("bankAccounts:list", async () => {
    if (!isAdmin()) return adminOnly();

    const sid = effectiveStoreId();
    await Promise.resolve(triggerBankPull(sid)).catch(() => {});
    const rows = db.prepare(`
      SELECT
        a.*,
        COALESCE(SUM(CASE WHEN t.type='credit' THEN t.amount ELSE 0 END), 0) AS total_credit,
        COALESCE(SUM(CASE WHEN t.type='debit' THEN t.amount ELSE 0 END), 0) AS total_debit
      FROM bank_accounts a
      LEFT JOIN bank_transactions t ON t.account_id = a.id
      WHERE a.store_id=? AND COALESCE(a.active,1)=1
      GROUP BY a.id
      ORDER BY lower(a.account_name) ASC, a.id DESC
    `).all(sid);

    return rows.map((row) => ({
      ...row,
      opening_balance: Number(row.opening_balance || 0),
      total_credit: Number(row.total_credit || 0),
      total_debit: Number(row.total_debit || 0),
      current_balance:
        Number(row.opening_balance || 0) + Number(row.total_credit || 0) - Number(row.total_debit || 0),
    }));
  });

  safeHandle("bankAccounts:create", (_, payload = {}) => {
    if (!isAdmin()) return adminOnly();

    const sid = effectiveStoreId();
    const account_name = String(payload.account_name || "").trim();
    const bank_name = String(payload.bank_name || "").trim();
    const account_number = String(payload.account_number || "").trim();
    const opening_balance = Number(payload.opening_balance || 0);
    const note = String(payload.note || "").trim();

    if (!account_name) return { ok: false, message: "Account name required" };
    if (!Number.isFinite(opening_balance)) return { ok: false, message: "Invalid opening balance" };

    const r = db.prepare(`
      INSERT INTO bank_accounts (
        store_id, account_name, bank_name, account_number, opening_balance, note, active, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'))
    `).run(sid, account_name, bank_name, account_number, opening_balance, note);

    Promise.resolve(triggerBankSync(sid)).catch(() => {});
    return { ok: true, id: r.lastInsertRowid };
  });

  safeHandle("bankAccounts:update", (_, payload = {}) => {
    if (!isAdmin()) return adminOnly();

    const sid = effectiveStoreId();
    const id = Number(payload.id);
    const account_name = String(payload.account_name || "").trim();
    const bank_name = String(payload.bank_name || "").trim();
    const account_number = String(payload.account_number || "").trim();
    const opening_balance = Number(payload.opening_balance || 0);
    const note = String(payload.note || "").trim();

    if (!id) return { ok: false, message: "Missing account id" };
    if (!account_name) return { ok: false, message: "Account name required" };
    if (!Number.isFinite(opening_balance)) return { ok: false, message: "Invalid opening balance" };

    db.prepare(`
      UPDATE bank_accounts
      SET account_name=?, bank_name=?, account_number=?, opening_balance=?, note=?, updated_at=datetime('now')
      WHERE id=? AND store_id=?
    `).run(account_name, bank_name, account_number, opening_balance, note, id, sid);

    Promise.resolve(triggerBankSync(sid)).catch(() => {});
    return { ok: true };
  });

  safeHandle("bankAccounts:delete", (_, id) => {
    if (!isAdmin()) return adminOnly();

    const sid = effectiveStoreId();
    const accountId = Number(id);
    if (!accountId) return { ok: false, message: "Missing account id" };

    const row = db.prepare("SELECT id FROM bank_accounts WHERE id=? AND store_id=?").get(accountId, sid);
    if (!row) return { ok: false, message: "Bank account not found" };

    db.prepare("DELETE FROM bank_transactions WHERE account_id=? AND store_id=?").run(accountId, sid);
    db.prepare("DELETE FROM bank_accounts WHERE id=? AND store_id=?").run(accountId, sid);
    Promise.resolve(triggerBankSync(sid)).catch(() => {});
    return { ok: true };
  });

  safeHandle("bankAccounts:transactions", async (_, accountId) => {
    if (!isAdmin()) return adminOnly();

    const sid = effectiveStoreId();
    await Promise.resolve(triggerBankPull(sid)).catch(() => {});
    const aid = Number(accountId);
    if (!aid) return [];

    return db.prepare(`
      SELECT *
      FROM bank_transactions
      WHERE store_id=? AND account_id=?
      ORDER BY datetime(created_at) DESC, id DESC
    `).all(sid, aid);
  });

  safeHandle("bankAccounts:createTransaction", (_, payload = {}) => {
    if (!isAdmin()) return adminOnly();

    const sid = effectiveStoreId();
    const account_id = Number(payload.account_id);
    const type = String(payload.type || "credit").trim().toLowerCase() === "debit" ? "debit" : "credit";
    const amount = Number(payload.amount || 0);
    const reference = String(payload.reference || "").trim();
    const note = String(payload.note || "").trim();
    const created_at = String(payload.created_at || "").trim() || null;

    if (!account_id) return { ok: false, message: "Bank account required" };
    if (!(amount > 0)) return { ok: false, message: "Amount must be greater than zero" };

    const account = db.prepare("SELECT id FROM bank_accounts WHERE id=? AND store_id=?").get(account_id, sid);
    if (!account) return { ok: false, message: "Bank account not found" };

    const r = db.prepare(`
      INSERT INTO bank_transactions (
        store_id, account_id, type, amount, reference, note, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), datetime('now'))
    `).run(sid, account_id, type, amount, reference, note, created_at);

    Promise.resolve(triggerBankSync(sid)).catch(() => {});
    return { ok: true, id: r.lastInsertRowid };
  });

  safeHandle("bankAccounts:updateTransaction", (_, payload = {}) => {
    if (!isAdmin()) return adminOnly();

    const sid = effectiveStoreId();
    const id = Number(payload.id);
    const account_id = Number(payload.account_id);
    const type = String(payload.type || "credit").trim().toLowerCase() === "debit" ? "debit" : "credit";
    const amount = Number(payload.amount || 0);
    const reference = String(payload.reference || "").trim();
    const note = String(payload.note || "").trim();
    const created_at = String(payload.created_at || "").trim() || null;

    if (!id) return { ok: false, message: "Missing transaction id" };
    if (!account_id) return { ok: false, message: "Bank account required" };
    if (!(amount > 0)) return { ok: false, message: "Amount must be greater than zero" };

    db.prepare(`
      UPDATE bank_transactions
      SET account_id=?, type=?, amount=?, reference=?, note=?, created_at=COALESCE(?, created_at), updated_at=datetime('now')
      WHERE id=? AND store_id=?
    `).run(account_id, type, amount, reference, note, created_at, id, sid);

    Promise.resolve(triggerBankSync(sid)).catch(() => {});
    return { ok: true };
  });

  safeHandle("bankAccounts:deleteTransaction", (_, id) => {
    if (!isAdmin()) return adminOnly();

    const sid = effectiveStoreId();
    const txId = Number(id);
    if (!txId) return { ok: false, message: "Missing transaction id" };

    db.prepare("DELETE FROM bank_transactions WHERE id=? AND store_id=?").run(txId, sid);
    Promise.resolve(triggerBankSync(sid)).catch(() => {});
    return { ok: true };
  });

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
    Promise.resolve(triggerCustomersSync(sid)).catch(() => {});
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

  safeHandle("customers:history", (_, {
    customer_id,
    range,
    fiscal_year,
    from_date,
    to_date,
  } = {}) => {
    const sid = effectiveStoreId();
    const cid = Number(customer_id);
    const fy = String(fiscal_year || "").trim();

    const salesWhere = ["store_id=?", "customer_id=?"];
    const salesParams = [sid, cid];

    const payWhere = ["store_id=?", "customer_id=?"];
    const payParams = [sid, cid];

    if (fy) {
      salesWhere.push("COALESCE(fiscal_year,'')=?");
      salesParams.push(fy);

      payWhere.push("fiscal_year=?");
      payParams.push(fy);
    }

    const salesDate = buildDateWhere("s", range, from_date, to_date);
    if (salesDate.clause !== "1=1") {
      salesWhere.push(salesDate.clause);
      salesParams.push(...salesDate.params);
    }

    const payDate = buildDateWhere("p", range, from_date, to_date);
    if (payDate.clause !== "1=1") {
      payWhere.push(payDate.clause);
      payParams.push(...payDate.params);
    }

    const sales = db.prepare(`
      SELECT * FROM sales s
      WHERE ${salesWhere.join(" AND ")}
      ORDER BY created_at DESC
    `).all(...salesParams);

    const payments = db.prepare(`
      SELECT * FROM customer_payments p
      WHERE ${payWhere.join(" AND ")}
      ORDER BY created_at DESC
    `).all(...payParams);

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

    Promise.resolve(triggerCustomerPaymentsSync(sid)).catch(() => {});
    Promise.resolve(triggerCustomersSync(sid)).catch(() => {});

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

    try {
      const fullSale = db.prepare("SELECT * FROM sales WHERE id=?").get(r.lastInsertRowid);
      Promise.resolve(sync.syncSale({ storeId: sid, storeName, sale: fullSale, items: [] })).catch(() => {});
    } catch {}

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
      Promise.resolve(sync.syncSale({ storeId: sid, storeName, sale: fullSale, items: saleItems })).catch(() => {});
      Promise.resolve(triggerInventorySync(sid)).catch(() => {});
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
      Promise.resolve(sync.syncSale({ storeId: sid, storeName, sale: refundSale, items: refundItems })).catch(() => {});
      Promise.resolve(triggerInventorySync(sid)).catch(() => {});
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

    Promise.resolve(triggerInventorySync(sid)).catch(() => {});
    Promise.resolve(triggerCatalogSync(sid)).catch(() => {});

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

    Promise.resolve(triggerInventorySync(sid)).catch(() => {});
    Promise.resolve(triggerCatalogSync(sid)).catch(() => {});

    return { ok: true };
  });

  safeHandle("products:delete", (_, id) => {
    if (!isAdmin()) return adminOnly();

    const sid = effectiveStoreId();
    db.prepare("DELETE FROM products WHERE id=? AND store_id=?").run(Number(id), sid);

    Promise.resolve(triggerInventorySync(sid)).catch(() => {});
    Promise.resolve(triggerCatalogSync(sid)).catch(() => {});

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
      Promise.resolve(triggerCatalogSync(sid)).catch(() => {});
      Promise.resolve(triggerInventorySync(sid)).catch(() => {});
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
    Promise.resolve(triggerCatalogSync(sid)).catch(() => {});
    Promise.resolve(triggerInventorySync(sid)).catch(() => {});
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
    Promise.resolve(triggerCatalogSync(sid)).catch(() => {});
    Promise.resolve(triggerInventorySync(sid)).catch(() => {});
    return { ok: true };
  });

  // -------------------- REPORTS --------------------
  safeHandle("reports:summary", (_, arg = {}) => {
    const sid = effectiveStoreId();
    const period = typeof arg === "string" ? arg : arg?.period || "today";
    const fy = String(arg?.fiscal_year || "").trim();
    const from_date = arg?.from_date;
    const to_date = arg?.to_date;

    const where = ["s.store_id=?", "s.status IN ('completed','due')"];
    const params = [sid];

    if (fy) {
      where.push("COALESCE(s.fiscal_year,'')=?");
      params.push(fy);
    }

    if (period === "today") {
      where.push("date(s.created_at)=date('now')");
    } else if (period === "week") {
      where.push("date(s.created_at)>=date('now','-6 days')");
    } else if (period === "month") {
      where.push("date(s.created_at)>=date('now','-29 days')");
    } else if (period === "custom") {
      const start = normYmd(from_date);
      const end = normYmd(to_date || from_date);
      if (start && end) {
        where.push("date(s.created_at) BETWEEN date(?) AND date(?)");
        params.push(start, end);
      }
    } else if (period === "year" && !fy) {
      where.push("date(s.created_at)>=date('now','-365 days')");
    }

    const whereSql = where.join(" AND ");

    const summary = db.prepare(`
      SELECT
        COUNT(*) AS transactions,
        SUM(CASE WHEN s.sale_type='sale' THEN s.total ELSE 0 END) AS revenue,
        SUM(CASE WHEN s.sale_type='refund' THEN s.total ELSE 0 END) AS refunds,
        SUM(s.gross_profit) AS gross_profit
      FROM sales s
      WHERE ${whereSql}
    `).get(...params);

    const topProducts = db.prepare(`
      SELECT
        si.product_name,
        SUM(si.quantity) AS qty_sold,
        SUM(si.subtotal) AS revenue,
        SUM(si.profit) AS profit
      FROM sale_items si
      JOIN sales s ON si.sale_id=s.id
      WHERE ${whereSql}
      GROUP BY si.product_id, si.product_name
      ORDER BY revenue DESC
      LIMIT 10
    `).all(...params);

    const byDay = db.prepare(`
      SELECT
        date(s.created_at) AS day,
        SUM(CASE WHEN s.sale_type='sale' THEN s.total ELSE 0 END) AS revenue,
        SUM(CASE WHEN s.sale_type='refund' THEN s.total ELSE 0 END) AS refunds,
        SUM(s.gross_profit) AS profit,
        COUNT(*) AS transactions
      FROM sales s
      WHERE ${whereSql}
      GROUP BY day
      ORDER BY day
    `).all(...params);

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

      Promise.resolve(triggerStoreMetaSync(sid)).catch(() => {});
      return { ok: true };
    }

    db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)").run(k, v);

    if (["supabase_url", "supabase_key", "store_id", "store_name"].includes(k)) {
      initSyncFromSettings();
      Promise.resolve(triggerStoreMetaSync((getSettingsObject().store_id || storeCtx.store_id || effectiveStoreId()))).catch(() => {});
    }

    return { ok: true };
  });


function parsePendingChangePayload(raw) {
  try {
    if (!raw) return {};
    if (typeof raw === "string") return JSON.parse(raw);
    if (typeof raw === "object") return raw;
    return {};
  } catch {
    return {};
  }
}

function findLocalProductForChange(sid, payload = {}, fallbackLocalId = null) {
  const explicitId = Number(payload.local_product_id || payload.product_id || fallbackLocalId || 0);
  const sku = String(payload.sku || "").trim();
  const barcode = String(payload.barcode || "").trim();

  if (explicitId) {
    const byId = db.prepare("SELECT * FROM products WHERE store_id=? AND id=?").get(sid, explicitId);
    if (byId) return byId;
  }

  if (sku) {
    const bySku = db.prepare("SELECT * FROM products WHERE store_id=? AND sku=?").get(sid, sku);
    if (bySku) return bySku;
  }

  if (barcode) {
    const byBarcode = db.prepare("SELECT * FROM products WHERE store_id=? AND barcode=?").get(sid, barcode);
    if (byBarcode) return byBarcode;
  }

  return null;
}

function applyPendingManagerChange(change, reviewerName = "") {
  const sid = effectiveStoreId();
  if (!change || String(change.store_id || "").trim() !== sid) {
    return { ok: false, message: "Change does not belong to the active store" };
  }

  const payload = parsePendingChangePayload(change.payload);
  const entityType = String(change.entity_type || "").trim().toLowerCase();

  if (!entityType) return { ok: false, message: "Invalid change request type" };

  if (entityType === "product_update") {
    const product = findLocalProductForChange(sid, payload, change.entity_local_id);
    if (!product) return { ok: false, message: "Product not found in desktop POS" };

    const nextName = payload.name === undefined ? product.name : String(payload.name || "").trim();
    const nextSku = payload.sku === undefined ? product.sku : String(payload.sku || "").trim();
    const nextCategory = payload.category === undefined ? product.category : String(payload.category || "").trim();
    const nextPrice = payload.price === undefined ? Number(product.price || 0) : Number(payload.price || 0);
    const nextCost = payload.cost === undefined ? Number(product.cost || 0) : Number(payload.cost || 0);
    const nextStock = payload.stock === undefined ? Number(product.stock || 0) : Number(payload.stock || 0);
    const nextThreshold = payload.low_stock_threshold === undefined
      ? Number(product.low_stock_threshold || 5)
      : Number(payload.low_stock_threshold || 5);
    const nextBarcode = payload.barcode === undefined ? String(product.barcode || "") : String(payload.barcode || "").trim();

    if (!nextName) return { ok: false, message: "Product name is required" };
    if (!Number.isFinite(nextPrice) || !Number.isFinite(nextCost) || !Number.isFinite(nextStock) || !Number.isFinite(nextThreshold)) {
      return { ok: false, message: "Invalid product values" };
    }

    db.prepare(`
      UPDATE products
      SET name=?, sku=?, category=?, price=?, cost=?, stock=?, low_stock_threshold=?, barcode=?, updated_at=datetime('now')
      WHERE id=? AND store_id=?
    `).run(nextName, nextSku, nextCategory, nextPrice, nextCost, nextStock, nextThreshold, nextBarcode, product.id, sid);

    Promise.resolve(triggerCatalogSync(sid)).catch(() => {});
    Promise.resolve(triggerInventorySync(sid)).catch(() => {});

    return {
      ok: true,
      message: `${nextName} updated`,
      summary: `Accepted by ${reviewerName || "store user"}`,
    };
  }

  if (entityType === "bank_account_upsert") {
    const localId = Number(payload.local_account_id || change.entity_local_id || 0);
    const accountName = String(payload.account_name || "").trim();
    const bankName = String(payload.bank_name || "").trim();
    const accountNumber = String(payload.account_number || "").trim();
    const openingBalance = Number(payload.opening_balance || 0);
    const note = String(payload.note || "").trim();
    const active = payload.active === undefined ? 1 : (payload.active ? 1 : 0);

    if (!accountName) return { ok: false, message: "Account name required" };
    if (!Number.isFinite(openingBalance)) return { ok: false, message: "Invalid opening balance" };

    if (localId) {
      const existing = db.prepare("SELECT id FROM bank_accounts WHERE id=? AND store_id=?").get(localId, sid);
      if (existing) {
        db.prepare(`
          UPDATE bank_accounts
          SET account_name=?, bank_name=?, account_number=?, opening_balance=?, note=?, active=?, updated_at=datetime('now')
          WHERE id=? AND store_id=?
        `).run(accountName, bankName, accountNumber, openingBalance, note, active, localId, sid);
      } else {
        db.prepare(`
          INSERT INTO bank_accounts (id, store_id, account_name, bank_name, account_number, opening_balance, note, active, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        `).run(localId, sid, accountName, bankName, accountNumber, openingBalance, note, active);
      }
    } else {
      db.prepare(`
        INSERT INTO bank_accounts (store_id, account_name, bank_name, account_number, opening_balance, note, active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `).run(sid, accountName, bankName, accountNumber, openingBalance, note, active);
    }

    Promise.resolve(triggerBankSync(sid)).catch(() => {});
    return { ok: true, message: `${accountName} saved` };
  }

  if (entityType === "bank_account_delete") {
    const localId = Number(payload.local_account_id || change.entity_local_id || 0);
    if (!localId) return { ok: false, message: "Missing local account id" };

    db.prepare("DELETE FROM bank_transactions WHERE store_id=? AND account_id=?").run(sid, localId);
    db.prepare("DELETE FROM bank_accounts WHERE store_id=? AND id=?").run(sid, localId);
    Promise.resolve(triggerBankSync(sid)).catch(() => {});
    return { ok: true, message: "Bank account deleted" };
  }

  if (entityType === "bank_transaction_upsert") {
    const localId = Number(payload.local_transaction_id || change.entity_local_id || 0);
    const accountId = Number(payload.local_account_id || payload.account_id || 0);
    const type = String(payload.type || "credit").trim().toLowerCase() === "debit" ? "debit" : "credit";
    const amount = Number(payload.amount || 0);
    const reference = String(payload.reference || "").trim();
    const note = String(payload.note || "").trim();
    const createdAt = String(payload.created_at || "").trim() || null;

    if (!accountId) return { ok: false, message: "Bank account required" };
    if (!(amount > 0)) return { ok: false, message: "Amount must be greater than zero" };

    const account = db.prepare("SELECT id FROM bank_accounts WHERE store_id=? AND id=?").get(sid, accountId);
    if (!account) return { ok: false, message: "Bank account not found in desktop POS" };

    if (localId) {
      const existing = db.prepare("SELECT id FROM bank_transactions WHERE store_id=? AND id=?").get(sid, localId);
      if (existing) {
        db.prepare(`
          UPDATE bank_transactions
          SET account_id=?, type=?, amount=?, reference=?, note=?, created_at=COALESCE(?, created_at), updated_at=datetime('now')
          WHERE id=? AND store_id=?
        `).run(accountId, type, amount, reference, note, createdAt, localId, sid);
      } else {
        db.prepare(`
          INSERT INTO bank_transactions (id, store_id, account_id, type, amount, reference, note, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), datetime('now'))
        `).run(localId, sid, accountId, type, amount, reference, note, createdAt);
      }
    } else {
      db.prepare(`
        INSERT INTO bank_transactions (store_id, account_id, type, amount, reference, note, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), datetime('now'))
      `).run(sid, accountId, type, amount, reference, note, createdAt);
    }

    Promise.resolve(triggerBankSync(sid)).catch(() => {});
    return { ok: true, message: "Bank transaction saved" };
  }

  if (entityType === "bank_transaction_delete") {
    const localId = Number(payload.local_transaction_id || change.entity_local_id || 0);
    if (!localId) return { ok: false, message: "Missing local transaction id" };

    db.prepare("DELETE FROM bank_transactions WHERE store_id=? AND id=?").run(sid, localId);
    Promise.resolve(triggerBankSync(sid)).catch(() => {});
    return { ok: true, message: "Bank transaction deleted" };
  }

  return { ok: false, message: `Unsupported change type: ${entityType}` };
}

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
      const store = getStoreSettingsForSync(sid);
      const products = db.prepare("SELECT * FROM products WHERE store_id=?").all(sid);
      await sync.syncInventory({ storeId: sid, storeName: store.store_name, products });
      return true;
    } catch {
      return false;
    }
  });

  safeHandle("sync:pushProducts", async () => {
    if (!isAdmin()) return adminOnly();

    try {
      const sid = effectiveStoreId();
      const store = getStoreSettingsForSync(sid);
      const products = db.prepare("SELECT * FROM products WHERE store_id=?").all(sid);
      const categories = db.prepare("SELECT * FROM categories WHERE store_id=?").all(sid);
      const ok = await sync.pushSharedCatalog({ storeId: sid, storeName: store.store_name, products, categories });
      return { ok: !!ok };
    } catch (e) {
      return { ok: false, message: e?.message || "Push failed" };
    }
  });

  safeHandle("sync:pushAll", async () => {
    if (!isAdmin()) return adminOnly();

    try {
      const sid = effectiveStoreId();
      await triggerFullSync(sid);
      return { ok: true };
    } catch (e) {
      return { ok: false, message: e?.message || "Full push failed" };
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


  safeHandle("sync:pullBank", async () => {
    try {
      return await triggerBankPull(effectiveStoreId());
    } catch (e) {
      return { ok: false, message: e?.message || "Bank pull failed" };
    }
  });

  safeHandle("managerChanges:listPending", async () => {
    try {
      if (!currentUser) return [];
      const sid = effectiveStoreId();
      return await sync.listPendingManagerChanges({ storeId: sid, status: "pending" });
    } catch (e) {
      console.error("[ManagerChanges] listPending failed:", e);
      return [];
    }
  });

  safeHandle("managerChanges:accept", async (_, payload = {}) => {
    try {
      if (!currentUser) return { ok: false, message: "Login required" };

      const sid = effectiveStoreId();
      const changeId = Number(payload.id || 0);
      if (!changeId) return { ok: false, message: "Missing change id" };

      const pending = await sync.listPendingManagerChanges({ storeId: sid, status: "pending" });
      const change = pending.find((row) => Number(row.id) === changeId);
      if (!change) return { ok: false, message: "Pending change not found" };

      const applyResult = applyPendingManagerChange(change, currentUser?.name || currentUser?.username || "");
      if (!applyResult?.ok) return applyResult;

      await sync.setPendingManagerChangeStatus({
        id: changeId,
        storeId: sid,
        status: "accepted",
        reviewedBy: currentUser?.username || currentUser?.name || "store-user",
        reviewNote: String(payload.review_note || applyResult.message || "Accepted in POS").trim(),
      });

      return { ok: true, message: applyResult.message || "Change accepted" };
    } catch (e) {
      console.error("[ManagerChanges] accept failed:", e);
      return { ok: false, message: e?.message || "Accept failed" };
    }
  });

  safeHandle("managerChanges:reject", async (_, payload = {}) => {
    try {
      if (!currentUser) return { ok: false, message: "Login required" };

      const sid = effectiveStoreId();
      const changeId = Number(payload.id || 0);
      if (!changeId) return { ok: false, message: "Missing change id" };

      await sync.setPendingManagerChangeStatus({
        id: changeId,
        storeId: sid,
        status: "rejected",
        reviewedBy: currentUser?.username || currentUser?.name || "store-user",
        reviewNote: String(payload.review_note || "Rejected in POS").trim(),
      });

      return { ok: true, message: "Change rejected" };
    } catch (e) {
      console.error("[ManagerChanges] reject failed:", e);
      return { ok: false, message: e?.message || "Reject failed" };
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

  // -------------------- UPDATER --------------------
  safeHandle("updater:check", async () => {
    if (isDev) return { ok: false, message: "Updater disabled in dev mode" };

    try {
      const result = await autoUpdater.checkForUpdates();
      return {
        ok: true,
        updateInfo: result?.updateInfo || null,
      };
    } catch (e) {
      return { ok: false, message: e?.message || "Failed to check updates" };
    }
  });

  safeHandle("updater:installNow", async () => {
    if (isDev) return { ok: false, message: "Updater disabled in dev mode" };

    try {
      autoUpdater.quitAndInstall();
      return { ok: true };
    } catch (e) {
      return { ok: false, message: e?.message || "Failed to install update" };
    }
  });

  safeHandle("app:getVersion", () => {
    return app.getVersion();
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
    loadEnvFiles();
    initDB();
    registerIpcHandlers();
    createWindow();} catch (e) {
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