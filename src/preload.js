// src/preload.js — exposes secure IPC API to renderer
const { contextBridge, ipcRenderer } = require("electron");

function on(channel, callback) {
  if (typeof callback !== "function") return () => {};
  const wrapped = (_event, data) => callback(data);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

contextBridge.exposeInMainWorld("pos", {
  // Store info (current store_id / name / currency / etc)
  store: {
    get: () => ipcRenderer.invoke("store:get"),
  },

  // Stores (Superadmin only)
  stores: {
    list: () => ipcRenderer.invoke("stores:list"),
    create: (payload) => ipcRenderer.invoke("stores:create", payload),
    setActive: (payload) => ipcRenderer.invoke("stores:setActive", payload),
  },

  // Auth
  auth: {
    current: () => ipcRenderer.invoke("auth:current"),

    // Supports:
    // login({username:"superadmin", pin:"1111", store_id:"store_2"})
    // login({username:"admin", pin:"1234"})
    // login({pin:"1234"})
    // login("admin","1234")
    login: (username, pin) => {
      const payload =
        typeof username === "object" && username !== null ? username : { username, pin };
      return ipcRenderer.invoke("auth:login", payload);
    },

    // Supports:
    // changePassword({oldPin:"1234", newPin:"9999"})
    // changePassword("1234","9999")
    changePassword: (oldPin, newPin) => {
      const payload =
        typeof oldPin === "object" && oldPin !== null ? oldPin : { oldPin, newPin };
      return ipcRenderer.invoke("auth:changePassword", payload);
    },

    logout: () => ipcRenderer.invoke("auth:logout"),
  },

  // Users
  users: {
    // Superadmin can pass: { store_id: "store_2" }
    getAll: (payload) => ipcRenderer.invoke("users:getAll", payload || {}),
    create: (u) => ipcRenderer.invoke("users:create", u),
    update: (u) => ipcRenderer.invoke("users:update", u),
    setPin: (payload) => ipcRenderer.invoke("users:setPin", payload),

    // delete supports: delete(12) OR delete({id:12, store_id:"store_2"})
    delete: (payload) => ipcRenderer.invoke("users:delete", payload),
  },

  // Customers
  customers: {
    getAll: () => ipcRenderer.invoke("customers:getAll"),
    search: (q) => ipcRenderer.invoke("customers:search", q),
    create: (c) => ipcRenderer.invoke("customers:create", c),
    update: (c) => ipcRenderer.invoke("customers:update", c),
    delete: (id) => ipcRenderer.invoke("customers:delete", id),
    sales: (customerId) => ipcRenderer.invoke("customers:sales", customerId),

    // Supports:
    // dueSummary(5)
    // dueSummary({ customer_id: 5 })
    dueSummary: (arg) => {
      const payload =
        typeof arg === "object" && arg !== null ? arg : { customer_id: arg };
      return ipcRenderer.invoke("customers:dueSummary", payload);
    },

    history: (payload) => ipcRenderer.invoke("customers:history", payload),
    addPayment: (payload) => ipcRenderer.invoke("customers:addPayment", payload),
  },

  // Products
  products: {
    getAll: () => ipcRenderer.invoke("products:getAll"),
    search: (q) => ipcRenderer.invoke("products:search", q),
    create: (p) => ipcRenderer.invoke("products:create", p),
    update: (p) => ipcRenderer.invoke("products:update", p),
    delete: (id) => ipcRenderer.invoke("products:delete", id),
  },

  // Categories
  categories: {
    getAll: () => ipcRenderer.invoke("categories:getAll"),
    create: (c) => ipcRenderer.invoke("categories:create", c),
    update: (c) => ipcRenderer.invoke("categories:update", c),
    delete: (id) => ipcRenderer.invoke("categories:delete", id),
  },

  // Sales
  sales: {
    create: (payload) => ipcRenderer.invoke("sales:create", payload),
    getAll: (opts) => ipcRenderer.invoke("sales:getAll", opts || {}),
    getItems: (id) => ipcRenderer.invoke("sales:getItems", id),
    getOne: (id) => ipcRenderer.invoke("sales:getOne", id),
    refund: (payload) => ipcRenderer.invoke("sales:refund", payload),

    // previous year / historical sales import
    addHistorical: (payload) => ipcRenderer.invoke("sales:addHistorical", payload),
  },

  // Reports
  reports: {
    // supports summary("today") or summary({ period: "today" })
    summary: (periodOrPayload) => {
      if (typeof periodOrPayload === "object" && periodOrPayload !== null) {
        return ipcRenderer.invoke("reports:summary", periodOrPayload);
      }
      return ipcRenderer.invoke("reports:summary", { period: periodOrPayload });
    },
  },

  // Settings
  settings: {
    getAll: () => ipcRenderer.invoke("settings:getAll"),
    set: (key, value) => ipcRenderer.invoke("settings:set", { key, value }),
  },

  // Sync
  sync: {
    test: () => ipcRenderer.invoke("sync:test"),
    pushInventory: () => ipcRenderer.invoke("sync:pushInventory"),
    pullProducts: () => ipcRenderer.invoke("sync:pullProducts"),
    pushProducts: () => ipcRenderer.invoke("sync:pushProducts"),
  },

  // Receipt (PDF save + email)
  receipt: {
    savePdf: (payload) => ipcRenderer.invoke("receipt:savePdf", payload),
    sendEmail: (payload) => ipcRenderer.invoke("receipt:sendEmail", payload),
  },

  // Auto updater
  updater: {
    check: () => ipcRenderer.invoke("updater:check"),
    installNow: () => ipcRenderer.invoke("updater:installNow"),
    onMessage: (callback) => on("updater:message", callback),
    onProgress: (callback) => on("updater:progress", callback),
  },

  // App info
  app: {
    getVersion: () => ipcRenderer.invoke("app:getVersion"),
  },
});