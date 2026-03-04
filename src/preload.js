// src/preload.js — UPDATED version with sync support
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pos', {
  products: {
    getAll: () => ipcRenderer.invoke('products:getAll'),
    search: (q) => ipcRenderer.invoke('products:search', q),
    create: (p) => ipcRenderer.invoke('products:create', p),
    update: (p) => ipcRenderer.invoke('products:update', p),
    delete: (id) => ipcRenderer.invoke('products:delete', id),
  },
  categories: {
    getAll: () => ipcRenderer.invoke('categories:getAll'),
    create: (c) => ipcRenderer.invoke('categories:create', c),
  },
  sales: {
    create: (data) => ipcRenderer.invoke('sales:create', data),
    getAll: (opts) => ipcRenderer.invoke('sales:getAll', opts),
    getItems: (id) => ipcRenderer.invoke('sales:getItems', id),
  },
  reports: {
    summary: (opts) => ipcRenderer.invoke('reports:summary', opts),
  },
  settings: {
    getAll: () => ipcRenderer.invoke('settings:getAll'),
    set: (key, value) => ipcRenderer.invoke('settings:set', { key, value }),
  },
  sync: {
    test: () => ipcRenderer.invoke('sync:test'),
    pushInventory: () => ipcRenderer.invoke('sync:pushInventory'),
  },
});
