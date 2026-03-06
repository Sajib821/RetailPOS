// src/preload.js

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("pos", {
receipt: {
  savePdf: ({ html, fileName }) => ipcRenderer.invoke("receipt:savePdf", { html, fileName }),
  sendEmail: (payload) => ipcRenderer.invoke("receipt:sendEmail", payload),
},
receipt: {
  savePdf: ({ html, fileName }) => ipcRenderer.invoke("receipt:savePdf", { html, fileName }),
  sendEmail: (payload) => ipcRenderer.invoke("receipt:sendEmail", payload),
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
  },

  // Sales
  sales: {
    create: (payload) => ipcRenderer.invoke("sales:create", payload),
    getAll: (opts) => ipcRenderer.invoke("sales:getAll", opts || {}),
    getItems: (id) => ipcRenderer.invoke("sales:getItems", id),
    getOne: (id) => ipcRenderer.invoke("sales:getOne", id),
    refund: (payload) => ipcRenderer.invoke("sales:refund", payload),
  },

  // Reports
  reports: {
    summary: (period) => ipcRenderer.invoke("reports:summary", { period }),
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

  // Customers
  customers: {
    getAll: () => ipcRenderer.invoke("customers:getAll"),
    search: (q) => ipcRenderer.invoke("customers:search", q),
    create: (c) => ipcRenderer.invoke("customers:create", c),
    update: (c) => ipcRenderer.invoke("customers:update", c),
    delete: (id) => ipcRenderer.invoke("customers:delete", id),
    sales: (customerId) => ipcRenderer.invoke("customers:sales", customerId),
  },

  // Auth
  auth: {
    current: () => ipcRenderer.invoke("auth:current"),

    // Supports: login("admin","1234") OR login({ username:"admin", pin:"1234" })
    login: (username, pin) => {
      const payload =
        typeof username === "object" && username !== null
          ? username
          : { username, pin };
      return ipcRenderer.invoke("auth:login", payload);
    },

    // Supports: changePassword(oldPin, newPin) OR changePassword({ oldPin, newPin })
    changePassword: (oldPin, newPin) => {
      const payload =
        typeof oldPin === "object" && oldPin !== null
          ? oldPin
          : { oldPin, newPin };
      return ipcRenderer.invoke("auth:changePassword", payload);
    },

    logout: () => ipcRenderer.invoke("auth:logout"),
  },

  // Users
  users: {
    getAll: () => ipcRenderer.invoke("users:getAll"),
    create: (u) => ipcRenderer.invoke("users:create", u),
    update: (u) => ipcRenderer.invoke("users:update", u),
    setPin: (payload) => ipcRenderer.invoke("users:setPin", payload),
    delete: (id) => ipcRenderer.invoke("users:delete", id),
  },
});