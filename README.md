# 🏪 RetailPOS — Offline Point of Sale System

A fully offline, cross-platform POS system for retail stores built with **Electron + React + SQLite**.

## ✨ Features

- **🛒 Checkout** — Fast product search, barcode support, cart management, cash/card/other payments, change calculator, receipt
- **📦 Products** — Full product catalog with SKUs, categories, pricing, cost & margin tracking
- **🗃️ Inventory** — Live stock levels, low-stock alerts, stock adjustment, inventory value tracking
- **📊 Reports** — Revenue by day (bar chart), top products, transaction KPIs, low stock alerts
- **⚙️ Settings** — Store name, tax rate, currency, product categories, receipt footer

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ ([nodejs.org](https://nodejs.org))
- npm 9+

### Install & Run

```bash
# 1. Install dependencies
npm install

# 2. Rebuild native modules for Electron
npm run postinstall || npx electron-rebuild

# 3. Launch in development mode
npm run dev
```

### Build for Distribution

```bash
# Build for macOS (.dmg)
npm run build:mac

# Build for Windows (.exe installer)
npm run build:win

# Build for current platform
npm run build
```

Distributable files will appear in `dist-app/`.

## 🗂️ Project Structure

```
retail-pos/
├── src/
│   ├── main.js          # Electron main process + SQLite DB
│   ├── preload.js       # Secure IPC bridge (contextBridge)
│   └── renderer/
│       ├── App.jsx      # Root component + navigation
│       ├── styles.css   # Global CSS variables & base styles
│       └── pages/
│           ├── Checkout.jsx   # POS checkout screen
│           ├── Products.jsx   # Product management
│           ├── Inventory.jsx  # Stock management
│           ├── Reports.jsx    # Analytics dashboard
│           └── Settings.jsx   # Store configuration
├── index.html
├── vite.config.js
└── package.json
```

## 🗄️ Database

All data is stored locally in SQLite via `better-sqlite3`:
- **Location (macOS):** `~/Library/Application Support/RetailPOS/retailpos.db`
- **Location (Windows):** `%APPDATA%\RetailPOS\retailpos.db`
- No internet connection required — fully offline

### Tables
- `products` — Product catalog
- `sales` — Transaction records
- `sale_items` — Line items per sale
- `categories` — Product categories
- `settings` — Store configuration

## ⌨️ Keyboard Shortcuts

| Action | Shortcut |
|---|---|
| Focus search | Click search bar or F3 |
| Clear cart | Click "Clear all" |

## 🔧 Customization

Edit `src/main.js` to:
- Change the default tax rate seed
- Add more default categories
- Adjust the demo product seeds

Edit `src/renderer/styles.css` to change the color scheme (CSS variables in `:root`).

## 📝 License

MIT — free for personal and commercial use.
