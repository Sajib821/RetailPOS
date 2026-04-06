import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  createContext,
  useContext,
} from "react";

import Checkout from "./pages/Checkout";
import Products from "./pages/Products";
import Inventory from "./pages/Inventory";
import Reports from "./pages/Reports";
import Settings from "./pages/Settings";
import Customers from "./pages/Customers";
import Users from "./pages/Users";
import SalesHistory from "./pages/SalesHistory";
import CustomerAccounts from "./pages/CustomerAccounts";
import BankAccounts from "./pages/BankAccounts";
import ManagerChangeReview from "./components/ManagerChangeReview";

export const POSContext = createContext(null);
export const usePOS = () => useContext(POSContext);

function createMockAPI() {
  let mockSettings = {
    store_name: "Store 1",
    store_id: "store_1",
    currency: "BDT",
    fy_start_month: "7",
    receipt_footer: "Thank you!",
    supabase_url: "",
    supabase_key: "",
    contact: "Phone: 01800000000\nEmail: support@store.com\nAddress: Dhaka",
  };

  let mockStore = {
    store_id: "store_1",
    store_name: "Store 1",
    currency: "BDT",
    fy_start_month: 7,
    is_superadmin: false,
  };

  const mock = {
    stores: [
      { store_id: "store_1", store_name: "Store 1", currency: "BDT" },
      { store_id: "store_2", store_name: "Store 2", currency: "BDT" },
    ],
    usersByStore: {
      store_1: [
        {
          id: 1,
          store_id: "store_1",
          name: "Admin",
          username: "admin",
          role: "admin",
          active: 1,
          pin: "1234",
        },
      ],
      store_2: [
        {
          id: 2,
          store_id: "store_2",
          name: "Admin",
          username: "admin",
          role: "admin",
          active: 1,
          pin: "1234",
        },
      ],
    },
    productsByStore: {
      store_1: [],
      store_2: [],
    },
    categoriesByStore: {
      store_1: [],
      store_2: [],
    },
    customersByStore: {
      store_1: [],
      store_2: [],
    },
    salesByStore: {
      store_1: [],
      store_2: [],
    },
    saleItemsBySaleId: {},
    customerPaymentsByStore: {
      store_1: [],
      store_2: [],
    },
    fiscalYearsByStore: {
      store_1: [],
      store_2: [],
    },
    bankAccountsByStore: {
      store_1: [],
      store_2: [],
    },
    bankTransactionsByAccount: {},
    me: null,
  };

  const id = () => Date.now() + Math.floor(Math.random() * 1000);
  const currentStoreId = () => mockStore.store_id || mockSettings.store_id || "store_1";

  const ensureStore = (storeId) => {
    const sid = storeId || "store_1";
    if (!mock.usersByStore[sid]) mock.usersByStore[sid] = [];
    if (!mock.productsByStore[sid]) mock.productsByStore[sid] = [];
    if (!mock.categoriesByStore[sid]) mock.categoriesByStore[sid] = [];
    if (!mock.customersByStore[sid]) mock.customersByStore[sid] = [];
    if (!mock.salesByStore[sid]) mock.salesByStore[sid] = [];
    if (!mock.customerPaymentsByStore[sid]) mock.customerPaymentsByStore[sid] = [];
    if (!mock.fiscalYearsByStore[sid]) mock.fiscalYearsByStore[sid] = [];
    if (!mock.bankAccountsByStore[sid]) mock.bankAccountsByStore[sid] = [];
  };

  const setActiveStore = (storeObj) => {
    if (!storeObj) return;
    ensureStore(storeObj.store_id);

    mockStore = {
      store_id: storeObj.store_id,
      store_name: storeObj.store_name,
      currency: storeObj.currency || "BDT",
      fy_start_month: Number(mockSettings.fy_start_month || 7) || 7,
      is_superadmin: mock.me?.role === "superadmin",
    };

    mockSettings.store_id = mockStore.store_id;
    mockSettings.store_name = mockStore.store_name;
    mockSettings.currency = mockStore.currency;
  };

  const syncStoreFromSettings = () => {
    const sid = mockSettings.store_id || "store_1";
    ensureStore(sid);

    const fromStores = mock.stores.find((s) => s.store_id === sid);
    mockStore = {
      store_id: sid,
      store_name: mockSettings.store_name || fromStores?.store_name || "Store 1",
      currency: mockSettings.currency || fromStores?.currency || "BDT",
      fy_start_month: Number(mockSettings.fy_start_month || 7) || 7,
      is_superadmin: mock.me?.role === "superadmin",
    };
  };

  const getUsers = (sid = currentStoreId()) => {
    ensureStore(sid);
    return mock.usersByStore[sid];
  };

  const getProducts = (sid = currentStoreId()) => {
    ensureStore(sid);
    return mock.productsByStore[sid];
  };

  const getCategories = (sid = currentStoreId()) => {
    ensureStore(sid);
    return mock.categoriesByStore[sid];
  };

  const getCustomers = (sid = currentStoreId()) => {
    ensureStore(sid);
    return mock.customersByStore[sid];
  };

  const getSales = (sid = currentStoreId()) => {
    ensureStore(sid);
    return mock.salesByStore[sid];
  };

  const getPayments = (sid = currentStoreId()) => {
    ensureStore(sid);
    return mock.customerPaymentsByStore[sid];
  };


  const getBankAccounts = (sid = currentStoreId()) => {
    ensureStore(sid);
    return mock.bankAccountsByStore[sid];
  };

  const getBankTransactions = (accountId) => {
    const key = String(accountId || "");
    if (!mock.bankTransactionsByAccount[key]) mock.bankTransactionsByAccount[key] = [];
    return mock.bankTransactionsByAccount[key];
  };

  const summarizeBankAccount = (account) => {
    const opening = Number(account?.opening_balance || 0);
    const txs = getBankTransactions(account?.id);
    const totalCredit = txs
      .filter((row) => row.type === "credit")
      .reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const totalDebit = txs
      .filter((row) => row.type === "debit")
      .reduce((sum, row) => sum + Number(row.amount || 0), 0);

    return {
      ...account,
      opening_balance: opening,
      total_credit: totalCredit,
      total_debit: totalDebit,
      current_balance: opening + totalCredit - totalDebit,
    };
  };

  const parseDateLoose = (s) => {
    if (!s) return new Date();
    if (typeof s !== "string") return new Date(s);
    if (s.includes("T")) return new Date(s);
    const d = new Date(s.replace(" ", "T"));
    return Number.isNaN(d.getTime()) ? new Date() : d;
  };

  const fiscalYearFromDate = (dateObj, startMonth = 7) => {
    const y = dateObj.getFullYear();
    const m = dateObj.getMonth() + 1;
    return m >= startMonth ? `${y}-${y + 1}` : `${y - 1}-${y}`;
  };

  const nowFiscalYear = () => {
    return fiscalYearFromDate(new Date(), Number(mockSettings.fy_start_month || 7) || 7);
  };

  const normYmd = (v) => {
    const raw = String(v || '').trim();
    if (!raw) return '';
    const d = new Date(raw.includes('T') ? raw : `${raw}T00:00:00`);
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
  };

  const inferFiscalYearDates = (label, startMonth = 7) => {
    const m = String(label || '').trim().match(/^(\d{4})-(\d{4})$/);
    if (!m) return { start_date: '', end_date: '' };

    const startYear = Number(m[1]);
    const endYear = Number(m[2]);
    const start = new Date(Date.UTC(startYear, Math.max(0, Number(startMonth || 7) - 1), 1));
    const end = new Date(Date.UTC(endYear, Math.max(0, Number(startMonth || 7) - 1), 0));

    return {
      start_date: start.toISOString().slice(0, 10),
      end_date: end.toISOString().slice(0, 10),
    };
  };

  const parseSalePaymentJson = (sale) => {
    try {
      const raw = sale?.payment_json;
      if (!raw) return {};
      if (typeof raw === 'string') return JSON.parse(raw);
      if (typeof raw === 'object' && raw !== null) return raw;
      return {};
    } catch {
      return {};
    }
  };

  const getSalePaidAmount = (sale) => {
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
  };

  const listFiscalYearsForStore = (sid = currentStoreId()) => {
    ensureStore(sid);

    const byLabel = new Map();
    (mock.fiscalYearsByStore[sid] || []).forEach((row) => {
      const label = String(row.label || '').trim();
      if (!label) return;
      byLabel.set(label, { ...row, inferred: 0 });
    });

    const labels = new Set();
    getSales(sid).forEach((s) => {
      if (String(s.fiscal_year || '').trim()) labels.add(String(s.fiscal_year || '').trim());
    });
    getPayments(sid).forEach((p) => {
      if (String(p.fiscal_year || '').trim()) labels.add(String(p.fiscal_year || '').trim());
    });

    labels.forEach((label) => {
      if (byLabel.has(label)) return;
      const inferred = inferFiscalYearDates(label, Number(mockSettings.fy_start_month || 7) || 7);
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
  };

  const inCustomRange = (value, fromDate, toDate) => {
    const ts = new Date(value).getTime();
    if (Number.isNaN(ts)) return false;

    const start = normYmd(fromDate);
    const end = normYmd(toDate || fromDate);
    if (!start || !end) return true;

    const startTs = new Date(`${start}T00:00:00`).getTime();
    const endTs = new Date(`${end}T23:59:59`).getTime();
    return ts >= startTs && ts <= endTs;
  };

  const computeCustomerDueByYear = (storeId, customerId) => {
    const sales = getSales(storeId).filter(
      (s) => Number(s.customer_id) === Number(customerId) && s.status === "due"
    );
    const payments = getPayments(storeId).filter(
      (p) => Number(p.customer_id) === Number(customerId)
    );

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

    sales.forEach((s) => {
      const fy =
        s.fiscal_year ||
        fiscalYearFromDate(
          parseDateLoose(s.created_at),
          Number(mockSettings.fy_start_month || 7) || 7
        );

      const row = addYear(fy);
      if ((s.sale_type || "sale") === "refund") row.refunds += Number(s.total || 0);
      else {
        row.credit_sales += Number(s.total || 0);
        row.payments += Number(getSalePaidAmount(s) || 0);
      }
    });

    payments.forEach((p) => {
      const fy = p.fiscal_year || nowFiscalYear();
      const row = addYear(fy);
      row.payments += Number(p.amount || 0);
    });

    let overall_due = 0;
    const years = Array.from(yearMap.values())
      .map((y) => {
        const raw =
          Number(y.credit_sales || 0) +
          Number(y.refunds || 0) -
          Number(y.payments || 0);
        y.due = Math.max(0, raw);
        overall_due += y.due;
        return y;
      })
      .sort((a, b) => (a.fiscal_year > b.fiscal_year ? -1 : 1));

    return { overall_due, years };
  };

  syncStoreFromSettings();

  return {
    store: {
      get: async () => ({
        ...mockStore,
        is_superadmin: mock.me?.role === "superadmin",
      }),
    },

    settings: {
      getAll: async () => ({ ...mockSettings }),
      set: async (key, value) => {
        mockSettings[key] = String(value ?? "");
        if (["store_id", "store_name", "currency", "fy_start_month"].includes(key)) {
          syncStoreFromSettings();
        }
        return { ok: true };
      },
    },

    stores: {
      list: async () => mock.stores.map((s) => ({ ...s })),
      create: async ({ store_id, store_name, currency }) => {
        const sid = String(store_id || "").trim();
        const sn = String(store_name || "").trim();
        const cur = String(currency || "BDT").trim();

        if (!sid || !sn) return { ok: false, message: "Missing store id/name" };
        if (mock.stores.find((s) => s.store_id === sid)) {
          return { ok: false, message: "Store already exists" };
        }

        mock.stores.push({ store_id: sid, store_name: sn, currency: cur });
        ensureStore(sid);

        if (!mock.usersByStore[sid].some((u) => u.username === "admin")) {
          mock.usersByStore[sid].push({
            id: id(),
            store_id: sid,
            name: "Admin",
            username: "admin",
            role: "admin",
            active: 1,
            pin: "1234",
          });
        }

        return { ok: true };
      },

      setActive: async ({ store_id }) => {
        const sid = String(store_id || "").trim();
        const s = mock.stores.find((x) => x.store_id === sid);
        if (!s) return { ok: false, message: "Store not found" };

        if (mock.me?.role === "superadmin") {
          mock.me = { ...mock.me, manage_store_id: sid };
        }

        setActiveStore(s);
        return { ok: true, store: { ...s } };
      },
    },

    auth: {
      current: async () => (mock.me ? { ...mock.me } : null),

      login: async ({ username, pin, store_id } = {}) => {
        const u = String(username || "").trim();
        const p = String(pin || "").trim();
        const requestedStore = String(store_id || "").trim();

        if (u.toLowerCase() === "superadmin") {
          if (p !== "1111") return { ok: false, message: "Invalid Superadmin PIN" };

          mock.me = {
            id: 999,
            username: "superadmin",
            name: "Superadmin",
            role: "superadmin",
          };

          if (requestedStore) {
            const s = mock.stores.find((x) => x.store_id === requestedStore);
            if (!s) return { ok: false, message: "Store not found for Superadmin" };
            mock.me.manage_store_id = requestedStore;
            setActiveStore(s);
          } else {
            syncStoreFromSettings();
          }

          mockStore.is_superadmin = true;
          return { ok: true, user: { ...mock.me } };
        }

        const sid = requestedStore || currentStoreId();
        ensureStore(sid);
        const users = getUsers(sid);

        if (u && p) {
          const found = users.find(
            (x) =>
              String(x.username || "").toLowerCase() === u.toLowerCase() &&
              String(x.pin || "") === p &&
              Number(x.active) === 1
          );

          if (!found) return { ok: false, message: "Invalid username or PIN for this store" };

          mock.me = {
            id: found.id,
            store_id: sid,
            username: found.username,
            name: found.name,
            role: found.role,
          };

          setActiveStore(
            mock.stores.find((s) => s.store_id === sid) || {
              store_id: sid,
              store_name: sid,
              currency: "BDT",
            }
          );

          return { ok: true, user: { ...mock.me } };
        }

        if (!u && p) {
          const matches = users.filter(
            (x) => String(x.pin || "") === p && Number(x.active) === 1
          );

          if (matches.length === 0) {
            return { ok: false, message: "No user found with that PIN in this store" };
          }

          if (matches.length > 1) {
            return { ok: false, message: "Multiple users share this PIN. Use username + PIN." };
          }

          const only = matches[0];
          mock.me = {
            id: only.id,
            store_id: sid,
            username: only.username,
            name: only.name,
            role: only.role,
          };

          setActiveStore(
            mock.stores.find((s) => s.store_id === sid) || {
              store_id: sid,
              store_name: sid,
              currency: "BDT",
            }
          );

          return { ok: true, user: { ...mock.me } };
        }

        return { ok: false, message: "Provide username + PIN or PIN only" };
      },

      logout: async () => {
        mock.me = null;
        mockStore.is_superadmin = false;
        return { ok: true };
      },

      changePassword: async ({ oldPin, newPin } = {}) => {
        if (!mock.me) return { ok: false, message: "Login required" };

        if (mock.me.role === "superadmin") {
          if (String(oldPin || "") !== "1111") {
            return { ok: false, message: "Old Superadmin PIN incorrect" };
          }
          return { ok: true };
        }

        const sid = mock.me.store_id || currentStoreId();
        const users = getUsers(sid);
        const idx = users.findIndex((u) => u.id === mock.me.id);
        if (idx < 0) return { ok: false, message: "User not found" };
        if (String(users[idx].pin || "") !== String(oldPin || "")) {
          return { ok: false, message: "Old PIN incorrect" };
        }

        users[idx] = { ...users[idx], pin: String(newPin || "") };
        return { ok: true };
      },
    },

    users: {
      getAll: async (payload = {}) => {
        const sid =
          mock.me?.role === "superadmin" && payload?.store_id
            ? String(payload.store_id).trim()
            : currentStoreId();

        return getUsers(sid).map((u) => ({
          id: u.id,
          store_id: u.store_id,
          username: u.username,
          name: u.name,
          role: u.role,
          active: u.active,
          created_at: u.created_at || new Date().toISOString(),
        }));
      },

      create: async (payload = {}) => {
        const sid =
          mock.me?.role === "superadmin" && payload?.store_id
            ? String(payload.store_id).trim()
            : currentStoreId();

        const users = getUsers(sid);
        const username = String(payload.username || "").trim().toLowerCase();
        const name = String(payload.name || "").trim();
        const role = String(payload.role || "cashier").trim();
        const pin = String(payload.pin || "1234").trim();

        if (!username || !name || !pin) {
          return { ok: false, message: "Missing username/name/pin" };
        }

        if (users.find((u) => String(u.username).toLowerCase() === username)) {
          return { ok: false, message: "Username already exists" };
        }

        users.unshift({
          id: id(),
          store_id: sid,
          username,
          name,
          role,
          active: 1,
          pin,
          created_at: new Date().toISOString(),
        });

        return { ok: true };
      },

      update: async (payload = {}) => {
        const sid =
          mock.me?.role === "superadmin" && payload?.store_id
            ? String(payload.store_id).trim()
            : currentStoreId();

        const users = getUsers(sid);
        const idx = users.findIndex((u) => Number(u.id) === Number(payload.id));
        if (idx < 0) return { ok: false, message: "User not found" };

        const username = String(payload.username || "").trim().toLowerCase();
        if (
          users.some(
            (u) =>
              Number(u.id) !== Number(payload.id) &&
              String(u.username || "").toLowerCase() === username
          )
        ) {
          return { ok: false, message: "Username already exists" };
        }

        users[idx] = {
          ...users[idx],
          username,
          name: String(payload.name || "").trim(),
          role: String(payload.role || "cashier").trim(),
          active: payload.active ? 1 : 0,
        };

        return { ok: true };
      },

      setPin: async (payload = {}) => {
        const sid =
          mock.me?.role === "superadmin" && payload?.store_id
            ? String(payload.store_id).trim()
            : currentStoreId();

        const users = getUsers(sid);
        const idx = users.findIndex((u) => Number(u.id) === Number(payload.id));
        if (idx < 0) return { ok: false, message: "User not found" };

        users[idx] = { ...users[idx], pin: String(payload.pin || "1234") };
        return { ok: true };
      },

      delete: async (payload) => {
        const sid =
          typeof payload === "object" && payload?.store_id
            ? String(payload.store_id).trim()
            : currentStoreId();

        const userId = typeof payload === "object" ? Number(payload?.id) : Number(payload);
        const users = getUsers(sid);

        mock.usersByStore[sid] = users.filter((u) => Number(u.id) !== userId);
        return { ok: true };
      },
    },

    fiscalYears: {
      list: async () => listFiscalYearsForStore(currentStoreId()).map((x) => ({ ...x })),
      create: async ({ label, start_date, end_date } = {}) => {
        const cleanLabel = String(label || '').trim();
        const start = normYmd(start_date);
        const end = normYmd(end_date);
        if (!cleanLabel || !start || !end) return { ok: false, message: 'Label, start date, and end date are required' };
        if (start > end) return { ok: false, message: 'Start date must be before end date' };

        ensureStore(currentStoreId());
        const rows = mock.fiscalYearsByStore[currentStoreId()];
        if (rows.some((r) => String(r.label || '').trim() === cleanLabel)) {
          return { ok: false, message: 'Financial year label already exists' };
        }

        rows.unshift({
          id: id(),
          label: cleanLabel,
          start_date: start,
          end_date: end,
          created_at: new Date().toISOString(),
        });
        return { ok: true };
      },
      delete: async (label) => {
        ensureStore(currentStoreId());
        mock.fiscalYearsByStore[currentStoreId()] = (mock.fiscalYearsByStore[currentStoreId()] || []).filter(
          (r) => String(r.label || '').trim() !== String(label || '').trim()
        );
        return { ok: true };
      },
    },

    customers: {
      getAll: async () => getCustomers().map((c) => ({ ...c })),

      search: async (q) => {
        const term = String(q || "").trim().toLowerCase();
        const rows = getCustomers();

        if (!term) return rows.map((c) => ({ ...c }));

        return rows
          .filter((c) => {
            const s = `${c.name || ""} ${c.phone || ""} ${c.email || ""}`.toLowerCase();
            return s.includes(term);
          })
          .map((c) => ({ ...c }));
      },

      create: async (c) => {
        const row = {
          id: id(),
          store_id: currentStoreId(),
          name: c.name || "",
          phone: c.phone || "",
          email: c.email || "",
          address: c.address || "",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        getCustomers().unshift(row);
        return { ok: true, id: row.id };
      },

      update: async (c) => {
        const rows = getCustomers();
        const idx = rows.findIndex((x) => Number(x.id) === Number(c.id));
        if (idx < 0) return { ok: false, message: "Customer not found" };

        rows[idx] = {
          ...rows[idx],
          ...c,
          updated_at: new Date().toISOString(),
        };

        return { ok: true };
      },

      delete: async (idValue) => {
        const rows = getCustomers();
        const next = rows.filter((x) => Number(x.id) !== Number(idValue));
        mock.customersByStore[currentStoreId()] = next;
        return { ok: true };
      },

      sales: async (customerId) => {
        return getSales()
          .filter((s) => Number(s.customer_id) === Number(customerId))
          .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
          .map((s) => ({ ...s }));
      },

      dueSummary: async (arg) => {
        const customerId =
          typeof arg === "object" && arg !== null ? arg.customer_id : arg;

        const customer = getCustomers().find((x) => Number(x.id) === Number(customerId));
        if (!customer) return { ok: false, message: "Customer not found" };

        const due = computeCustomerDueByYear(currentStoreId(), Number(customerId));
        return { ok: true, customer: { ...customer }, ...due };
      },

      history: async ({ customer_id, range, fiscal_year, from_date, to_date } = {}) => {
        const sales = getSales()
          .filter((s) => Number(s.customer_id) === Number(customer_id))
          .filter((s) => {
            if (fiscal_year && String(s.fiscal_year || "") !== String(fiscal_year)) return false;
            if (range === "today") {
              return new Date(s.created_at).toDateString() === new Date().toDateString();
            }
            if (range === "7d") {
              return new Date(s.created_at).getTime() >= Date.now() - 6 * 24 * 60 * 60 * 1000;
            }
            if (range === "month") {
              return new Date(s.created_at).getTime() >= Date.now() - 29 * 24 * 60 * 60 * 1000;
            }
            if (range === "custom") {
              return inCustomRange(s.created_at, from_date, to_date);
            }
            return true;
          })
          .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));

        const payments = getPayments()
          .filter((p) => Number(p.customer_id) === Number(customer_id))
          .filter((p) => {
            if (fiscal_year && String(p.fiscal_year || "") !== String(fiscal_year)) return false;
            if (range === "today") {
              return new Date(p.created_at).toDateString() === new Date().toDateString();
            }
            if (range === "7d") {
              return new Date(p.created_at).getTime() >= Date.now() - 6 * 24 * 60 * 60 * 1000;
            }
            if (range === "month") {
              return new Date(p.created_at).getTime() >= Date.now() - 29 * 24 * 60 * 60 * 1000;
            }
            if (range === "custom") {
              return inCustomRange(p.created_at, from_date, to_date);
            }
            return true;
          })
          .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));

        return {
          ok: true,
          sales: sales.map((x) => ({ ...x })),
          payments: payments.map((x) => ({ ...x })),
        };
      },

      addPayment: async ({ customer_id, amount, fiscal_year, method, note } = {}) => {
        const customer = getCustomers().find((x) => Number(x.id) === Number(customer_id));
        if (!customer) return { ok: false, message: "Customer not found" };

        const row = {
          id: id(),
          store_id: currentStoreId(),
          customer_id: Number(customer_id),
          fiscal_year: fiscal_year || nowFiscalYear(),
          amount: Number(amount || 0),
          method: method || "cash",
          note: note || "",
          created_at: new Date().toISOString(),
          cashier_id: mock.me?.id || null,
          cashier_name: mock.me?.name || null,
        };

        getPayments().unshift(row);

        const due = computeCustomerDueByYear(currentStoreId(), Number(customer_id));
        const yearRow = due.years.find((y) => y.fiscal_year === row.fiscal_year) || { due: 0 };

        return {
          ok: true,
          payment_id: row.id,
          emailed: false,
          email_message: null,
          due_year: yearRow.due,
          due_total: due.overall_due,
        };
      },
    },

    products: {
      getAll: async () => getProducts().map((p) => ({ ...p })),

      search: async (q) => {
        const term = String(q || "").trim().toLowerCase();
        const rows = getProducts();

        if (!term) return rows.map((p) => ({ ...p }));

        return rows
          .filter((p) => {
            const s = `${p.name || ""} ${p.sku || ""} ${p.barcode || ""}`.toLowerCase();
            return s.includes(term);
          })
          .map((p) => ({ ...p }));
      },

      create: async (p) => {
        const row = {
          id: id(),
          store_id: currentStoreId(),
          name: p.name || "",
          sku: p.sku || "",
          category: p.category || "",
          price: Number(p.price || 0),
          cost: Number(p.cost || 0),
          stock: Number(p.stock || 0),
          low_stock_threshold: Number(p.low_stock_threshold || 5),
          barcode: p.barcode || "",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        getProducts().push(row);
        return { ok: true, id: row.id };
      },

      update: async (p) => {
        const rows = getProducts();
        const idx = rows.findIndex((x) => Number(x.id) === Number(p.id));
        if (idx < 0) return { ok: false, message: "Product not found" };

        rows[idx] = {
          ...rows[idx],
          ...p,
          updated_at: new Date().toISOString(),
        };

        return { ok: true };
      },

      delete: async (idValue) => {
        mock.productsByStore[currentStoreId()] = getProducts().filter(
          (x) => Number(x.id) !== Number(idValue)
        );
        return { ok: true };
      },
    },

    categories: {
      getAll: async () => getCategories().map((c) => ({ ...c })),

      create: async (c) => {
        const name = String(c?.name || "").trim();
        if (!name) return { ok: false, message: "Category name required" };

        if (
          getCategories().some(
            (x) => String(x.name || "").toLowerCase() === name.toLowerCase()
          )
        ) {
          return { ok: false, message: "Category already exists in this store" };
        }

        getCategories().push({
          id: id(),
          store_id: currentStoreId(),
          name,
          color: c?.color || "#6366f1",
        });

        return { ok: true };
      },

      update: async (c) => {
        const rows = getCategories();
        const idx = rows.findIndex((x) => Number(x.id) === Number(c.id));
        if (idx < 0) return { ok: false, message: "Category not found" };

        const oldName = rows[idx].name;
        rows[idx] = { ...rows[idx], ...c };

        if (oldName !== c.name) {
          mock.productsByStore[currentStoreId()] = getProducts().map((p) =>
            p.category === oldName ? { ...p, category: c.name } : p
          );
        }

        return { ok: true };
      },

      delete: async (idValue) => {
        const rows = getCategories();
        const old = rows.find((x) => Number(x.id) === Number(idValue));
        mock.categoriesByStore[currentStoreId()] = rows.filter(
          (x) => Number(x.id) !== Number(idValue)
        );

        if (old) {
          mock.productsByStore[currentStoreId()] = getProducts().map((p) =>
            p.category === old.name ? { ...p, category: "" } : p
          );
        }

        return { ok: true };
      },
    },

    sales: {
      create: async ({ sale, items } = {}) => {
        const saleId = id();
        const fy = fiscalYearFromDate(new Date(), Number(mockSettings.fy_start_month || 7) || 7);

        const row = {
          id: saleId,
          store_id: currentStoreId(),
          store_name: mockStore.store_name,
          fiscal_year: fy,
          total: Number(sale?.total || 0),
          subtotal: Number(sale?.subtotal || 0),
          tax: Number(sale?.tax || 0),
          discount: Number(sale?.discount || 0),
          payment_method: sale?.payment_method || "cash",
          status: sale?.status || "completed",
          payment_json: sale?.payment_json || null,
          note: sale?.note || null,
          sale_type: "sale",
          original_sale_id: null,
          customer_id: sale?.customer_id || null,
          customer_name: sale?.customer_name || null,
          cashier_id: mock.me?.id || null,
          cashier_name: mock.me?.name || null,
          gross_profit: 0,
          created_at: new Date().toISOString(),
        };

        getSales().unshift(row);
        mock.saleItemsBySaleId[saleId] = Array.isArray(items) ? items.map((it) => ({ ...it })) : [];

        return { ok: true, saleId };
      },

      getAll: async ({ limit = 200, offset = 0 } = {}) => {
        return getSales().slice(offset, offset + limit).map((s) => ({ ...s }));
      },

      getItems: async (saleId) => {
        return Array.isArray(mock.saleItemsBySaleId[saleId])
          ? mock.saleItemsBySaleId[saleId].map((x) => ({ ...x }))
          : [];
      },

      getOne: async (saleId) => {
        const sale = getSales().find((s) => Number(s.id) === Number(saleId)) || null;
        const items = Array.isArray(mock.saleItemsBySaleId[saleId])
          ? mock.saleItemsBySaleId[saleId].map((x) => ({ ...x }))
          : [];
        return { sale, items };
      },

      refund: async ({ original_sale_id } = {}) => {
        const refundSaleId = id();
        const original = getSales().find((s) => Number(s.id) === Number(original_sale_id));

        getSales().unshift({
          id: refundSaleId,
          store_id: currentStoreId(),
          store_name: mockStore.store_name,
          fiscal_year: original?.fiscal_year || nowFiscalYear(),
          total: -1,
          subtotal: -1,
          tax: 0,
          discount: 0,
          payment_method: "refund",
          status: "completed",
          payment_json: null,
          note: `Refund for #${original_sale_id}`,
          sale_type: "refund",
          original_sale_id: Number(original_sale_id),
          customer_id: original?.customer_id || null,
          customer_name: original?.customer_name || null,
          cashier_id: mock.me?.id || null,
          cashier_name: mock.me?.name || null,
          gross_profit: 0,
          created_at: new Date().toISOString(),
        });

        mock.saleItemsBySaleId[refundSaleId] = [];
        return { ok: true, refundSaleId };
      },

      addHistorical: async ({ customer_id, fiscal_year, total, status, created_at, note } = {}) => {
        const customer = getCustomers().find((c) => Number(c.id) === Number(customer_id));
        if (!customer) return { ok: false, message: "Customer not found" };

        const saleId = id();
        getSales().unshift({
          id: saleId,
          store_id: currentStoreId(),
          store_name: mockStore.store_name,
          fiscal_year: fiscal_year || nowFiscalYear(),
          total: Number(total || 0),
          subtotal: Number(total || 0),
          tax: 0,
          discount: 0,
          payment_method: "history",
          status: status || "due",
          payment_json: null,
          note: note || "Historical sale",
          sale_type: "sale",
          original_sale_id: null,
          customer_id: customer.id,
          customer_name: customer.name,
          cashier_id: mock.me?.id || null,
          cashier_name: mock.me?.name || null,
          gross_profit: 0,
          created_at: created_at || new Date().toISOString(),
        });

        mock.saleItemsBySaleId[saleId] = [];
        return { ok: true, saleId };
      },
    },

    bankAccounts: {
      list: async () => {
        return getBankAccounts()
          .map((row) => summarizeBankAccount({ ...row }))
          .sort((a, b) => String(a.account_name || "").localeCompare(String(b.account_name || "")));
      },

      create: async ({ account_name, bank_name, account_number, opening_balance, note } = {}) => {
        const row = {
          id: id(),
          store_id: currentStoreId(),
          account_name: String(account_name || "").trim(),
          bank_name: String(bank_name || "").trim(),
          account_number: String(account_number || "").trim(),
          opening_balance: Number(opening_balance || 0),
          note: String(note || "").trim(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        if (!row.account_name) return { ok: false, message: "Account name required" };

        getBankAccounts().unshift(row);
        mock.bankTransactionsByAccount[String(row.id)] = [];
        return { ok: true, id: row.id };
      },

      update: async ({ id: accountId, account_name, bank_name, account_number, opening_balance, note } = {}) => {
        const rows = getBankAccounts();
        const idx = rows.findIndex((row) => Number(row.id) === Number(accountId));
        if (idx < 0) return { ok: false, message: "Bank account not found" };

        rows[idx] = {
          ...rows[idx],
          account_name: String(account_name || "").trim(),
          bank_name: String(bank_name || "").trim(),
          account_number: String(account_number || "").trim(),
          opening_balance: Number(opening_balance || 0),
          note: String(note || "").trim(),
          updated_at: new Date().toISOString(),
        };

        if (!rows[idx].account_name) return { ok: false, message: "Account name required" };
        return { ok: true };
      },

      delete: async (accountId) => {
        mock.bankAccountsByStore[currentStoreId()] = getBankAccounts().filter(
          (row) => Number(row.id) !== Number(accountId)
        );
        delete mock.bankTransactionsByAccount[String(accountId)];
        return { ok: true };
      },

      transactions: async (accountId) => {
        return getBankTransactions(accountId)
          .slice()
          .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
          .map((row) => ({ ...row }));
      },

      createTransaction: async ({ account_id, type, amount, note, reference, created_at } = {}) => {
        const account = getBankAccounts().find((row) => Number(row.id) === Number(account_id));
        if (!account) return { ok: false, message: "Bank account not found" };

        const row = {
          id: id(),
          store_id: currentStoreId(),
          account_id: Number(account_id),
          type: type === "debit" ? "debit" : "credit",
          amount: Number(amount || 0),
          note: String(note || "").trim(),
          reference: String(reference || "").trim(),
          created_at: created_at || new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        if (row.amount <= 0) return { ok: false, message: "Amount must be greater than zero" };

        getBankTransactions(account_id).unshift(row);
        return { ok: true, id: row.id };
      },

      updateTransaction: async ({ id: entryId, account_id, type, amount, note, reference, created_at } = {}) => {
        const rows = getBankTransactions(account_id);
        const idx = rows.findIndex((row) => Number(row.id) === Number(entryId));
        if (idx < 0) return { ok: false, message: "Transaction not found" };

        rows[idx] = {
          ...rows[idx],
          type: type === "debit" ? "debit" : "credit",
          amount: Number(amount || 0),
          note: String(note || "").trim(),
          reference: String(reference || "").trim(),
          created_at: created_at || rows[idx].created_at,
          updated_at: new Date().toISOString(),
        };

        if (rows[idx].amount <= 0) return { ok: false, message: "Amount must be greater than zero" };
        return { ok: true };
      },

      deleteTransaction: async (entryId) => {
        const account = getBankAccounts().find((row) =>
          getBankTransactions(row.id).some((tx) => Number(tx.id) === Number(entryId))
        );

        if (!account) return { ok: false, message: "Transaction not found" };

        mock.bankTransactionsByAccount[String(account.id)] = getBankTransactions(account.id).filter(
          (row) => Number(row.id) !== Number(entryId)
        );
        return { ok: true };
      },
    },

    reports: {
      summary: async (arg = {}) => {
        const period = typeof arg === "string" ? arg : arg?.period || "today";
        const fiscalYear = String(arg?.fiscal_year || "").trim();
        const fromDate = arg?.from_date;
        const toDate = arg?.to_date;
        const rows = getSales().filter((s) => ["completed", "due"].includes(String(s.status || "").toLowerCase()));

        const filtered = rows.filter((s) => {
          const created = new Date(s.created_at).getTime();
          const now = Date.now();

          if (fiscalYear && String(s.fiscal_year || "") !== fiscalYear) return false;
          if (period === "today") return new Date(s.created_at).toDateString() === new Date().toDateString();
          if (period === "week") return created >= now - 6 * 24 * 60 * 60 * 1000;
          if (period === "month") return created >= now - 29 * 24 * 60 * 60 * 1000;
          if (period === "year" && !fiscalYear) return created >= now - 365 * 24 * 60 * 60 * 1000;
          if (period === "custom") return inCustomRange(s.created_at, fromDate, toDate);
          return true;
        });

        const revenue = filtered
          .filter((s) => s.sale_type !== "refund")
          .reduce((a, s) => a + Number(s.total || 0), 0);

        const refunds = filtered
          .filter((s) => s.sale_type === "refund")
          .reduce((a, s) => a + Number(s.total || 0), 0);

        const byDayMap = new Map();
        filtered.forEach((s) => {
          const key = String(s.created_at || '').slice(0, 10);
          const row = byDayMap.get(key) || { day: key, revenue: 0, refunds: 0, profit: 0, transactions: 0 };
          if ((s.sale_type || 'sale') === 'refund') row.refunds += Number(s.total || 0);
          else row.revenue += Number(s.total || 0);
          row.profit += Number(s.gross_profit || 0);
          row.transactions += 1;
          byDayMap.set(key, row);
        });

        const itemMap = new Map();
        filtered.forEach((s) => {
          const items = mock.saleItemsBySaleId[s.id] || [];
          items.forEach((it) => {
            const key = `${it.product_id || it.product_name}`;
            const row = itemMap.get(key) || { product_name: it.product_name, qty_sold: 0, revenue: 0, profit: 0 };
            row.qty_sold += Number(it.quantity || 0);
            row.revenue += Number(it.subtotal || 0);
            row.profit += Number(it.profit || 0);
            itemMap.set(key, row);
          });
        });

        return {
          summary: {
            transactions: filtered.length,
            revenue,
            refunds,
            gross_profit: filtered.reduce((a, s) => a + Number(s.gross_profit || 0), 0),
          },
          topProducts: Array.from(itemMap.values()).sort((a, b) => Number(b.revenue || 0) - Number(a.revenue || 0)).slice(0, 10),
          byDay: Array.from(byDayMap.values()).sort((a, b) => String(a.day).localeCompare(String(b.day))),
          lowStock: getProducts().filter(
            (p) => Number(p.stock || 0) <= Number(p.low_stock_threshold || 5)
          ),
        };
      },
    },

    sync: {
      test: async () => false,
      pullProducts: async () => ({ ok: true, counts: { products: 0, categories: 0 } }),
      pushProducts: async () => ({ ok: true }),
      pushInventory: async () => true,
      pushAll: async () => ({ ok: true }),
    },

    receipt: {
      savePdf: async () => ({ ok: true }),
      sendEmail: async () => ({ ok: false, message: "SMTP not configured (mock)" }),
    },
  };
}

const NAV = [
  { id: "checkout", label: "Checkout", icon: "🛒" },
  { id: "products", label: "Products", icon: "📦", adminOnly: true },
  { id: "inventory", label: "Inventory", icon: "🗃️" },
  { id: "reports", label: "Reports", icon: "📊" },
  { id: "sales", label: "Sales", icon: "🧾" },
  { id: "customers", label: "Customers", icon: "👥" },
  { id: "accounts", label: "Accounts", icon: "💳" },
  { id: "users", label: "Users", icon: "👤" },
  { id: "banking", label: "Bank", icon: "🏦", adminOnly: true },
  { id: "settings", label: "Settings", icon: "⚙️", adminOnly: true },
];

export default function App() {
  const [page, setPage] = useState("checkout");
  const [api] = useState(() => {
    if (typeof window !== "undefined" && window.pos) return window.pos;
    return createMockAPI();
  });

  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);

  const [store, setStore] = useState({
    store_id: "",
    store_name: "",
    currency: "BDT",
    fy_start_month: 7,
    is_superadmin: false,
  });

  const [storeName, setStoreName] = useState("RetailPOS");
  const [me, setMe] = useState(null);

  const [authChecked, setAuthChecked] = useState(false);
  const [loginForm, setLoginForm] = useState({
    username: "",
    pin: "",
    store_id: "",
  });
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState("");

  const showToast = useCallback((msg, type = "success") => {
    setToast({ msg, type });

    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }

    toastTimerRef.current = setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 3000);
  }, []);

  const refreshAppState = useCallback(async () => {
    try {
      const [st, s, cur] = await Promise.all([
        api.store?.get?.().catch(() => null),
        api.settings?.getAll?.().catch(() => null),
        api.auth?.current?.().catch(() => null),
      ]);

      if (st) {
        setStore((prev) => ({
          ...prev,
          ...st,
          fy_start_month: Number(st.fy_start_month || prev.fy_start_month || 7) || 7,
        }));

        if (st.store_name) setStoreName(st.store_name);
      }

      if (s) {
        if (s.store_name) setStoreName(s.store_name);
        setStore((prev) => ({
          ...prev,
          store_id: s.store_id || prev.store_id,
          store_name: s.store_name || prev.store_name,
          currency: s.currency || prev.currency,
          fy_start_month: Number(s.fy_start_month || prev.fy_start_month || 7) || 7,
        }));
      }

      setMe(cur || null);
    } catch (e) {
      console.error("App init error:", e);
    } finally {
      setAuthChecked(true);
    }
  }, [api]);

  useEffect(() => {
    refreshAppState();

    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, [refreshAppState]);

  const handleLogin = async () => {
    setLoginLoading(true);
    setLoginError("");

    try {
      const res = await api.auth?.login?.({
        username: loginForm.username,
        pin: loginForm.pin,
        store_id: loginForm.store_id || undefined,
      });

      if (!res?.ok) {
        setLoginError(res?.message || "Login failed");
        return;
      }

      setMe(res.user || null);
      setLoginForm({ username: "", pin: "", store_id: "" });
      await refreshAppState();
      showToast("Logged in successfully");
    } catch (e) {
      console.error(e);
      setLoginError("Login failed");
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await api.auth?.logout?.();
      setMe(null);
      setPage("checkout");
      setLoginForm({ username: "", pin: "", store_id: "" });
      showToast("Logged out");
    } catch (e) {
      console.error(e);
      showToast("Logout failed", "error");
    }
  };

  const pages = useMemo(
    () => ({
      checkout: Checkout,
      products: Products,
      inventory: Inventory,
      reports: Reports,
      sales: SalesHistory,
      customers: Customers,
      accounts: CustomerAccounts,
      banking: BankAccounts,
      users: Users,
      settings: Settings,
    }),
    []
  );

  const PageComponent = pages[page] || Checkout;
  const isAdminOrSuper = me?.role === "admin" || me?.role === "superadmin";
  const navItems = NAV.filter((n) => !n.adminOnly || isAdminOrSuper);

  if (!authChecked) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "var(--bg)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--text)",
        }}
      >
        <div
          style={{
            width: 380,
            borderRadius: 18,
            padding: 24,
            background: "rgba(255,255,255,0.04)",
            border: "1px solid var(--border)",
            boxShadow: "var(--shadow)",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 36, marginBottom: 12 }}>🏪</div>
          <div style={{ fontSize: 20, fontWeight: 900, marginBottom: 6 }}>RetailPOS</div>
          <div style={{ color: "var(--text2)", fontSize: 14 }}>Loading application...</div>
        </div>
      </div>
    );
  }

  if (!me) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background:
            "radial-gradient(circle at top, rgba(108,99,255,0.16), transparent 35%), var(--bg)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 420,
            borderRadius: 22,
            padding: 24,
            background: "rgba(255,255,255,0.05)",
            border: "1px solid var(--border)",
            boxShadow: "var(--shadow)",
          }}
        >
          <div style={{ textAlign: "center", marginBottom: 18 }}>
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: 18,
                margin: "0 auto 14px",
                background: "var(--accent)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 28,
                boxShadow: "0 0 24px rgba(108,99,255,0.35)",
              }}
            >
              🏪
            </div>
            <div style={{ fontSize: 24, fontWeight: 900, color: "var(--text)" }}>RetailPOS Login</div>
            <div style={{ color: "var(--text2)", marginTop: 6, fontSize: 14 }}>
              Please log in before accessing the system.
            </div>
          </div>

          <div style={{ display: "grid", gap: 12 }}>
            <div>
              <div style={labelStyle}>Username</div>
              <input
                value={loginForm.username}
                onChange={(e) =>
                  setLoginForm((prev) => ({ ...prev, username: e.target.value }))
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleLogin();
                }}
                placeholder="Enter username"
                style={inputStyle}
              />
            </div>

            <div>
              <div style={labelStyle}>PIN</div>
              <input
                type="password"
                value={loginForm.pin}
                onChange={(e) =>
                  setLoginForm((prev) => ({ ...prev, pin: e.target.value }))
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleLogin();
                }}
                placeholder="Enter PIN"
                style={inputStyle}
              />
            </div>

            <div>
              <div style={labelStyle}>Store ID (optional)</div>
              <input
                value={loginForm.store_id}
                onChange={(e) =>
                  setLoginForm((prev) => ({ ...prev, store_id: e.target.value }))
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleLogin();
                }}
                placeholder="Optional for superadmin"
                style={inputStyle}
              />
            </div>

            {loginError ? (
              <div
                style={{
                  background: "rgba(244,63,94,0.12)",
                  border: "1px solid rgba(244,63,94,0.28)",
                  color: "#fecdd3",
                  padding: "10px 12px",
                  borderRadius: 12,
                  fontSize: 13,
                  fontWeight: 700,
                }}
              >
                {loginError}
              </div>
            ) : null}

            <button
              onClick={handleLogin}
              disabled={loginLoading}
              style={{
                height: 46,
                borderRadius: 12,
                border: "1px solid rgba(108,99,255,0.45)",
                background: "rgba(108,99,255,0.20)",
                color: "var(--accent)",
                fontWeight: 900,
                cursor: loginLoading ? "not-allowed" : "pointer",
                opacity: loginLoading ? 0.65 : 1,
              }}
            >
              {loginLoading ? "Logging in..." : "Login"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <POSContext.Provider
      value={{
        api,
        showToast,
        me,
        setMe,
        store,
        setStore,
        storeName,
        refreshAppState,
      }}
    >
      <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
        <nav
          style={{
            width: 72,
            background: "var(--surface)",
            borderRight: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            padding: "16px 0",
            gap: 4,
            flexShrink: 0,
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: "var(--accent)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 20,
              marginBottom: 16,
              boxShadow: "0 0 20px rgba(108,99,255,0.4)",
            }}
            title={storeName}
          >
            🏪
          </div>

          {navItems.map((n) => (
            <button
              key={n.id}
              onClick={() => setPage(n.id)}
              title={n.label}
              style={{
                width: 52,
                height: 52,
                borderRadius: 12,
                background: page === n.id ? "rgba(108,99,255,0.2)" : "transparent",
                border: page === n.id ? "1px solid rgba(108,99,255,0.5)" : "1px solid transparent",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 2,
                cursor: "pointer",
                transition: "all 0.15s",
                color: page === n.id ? "var(--accent)" : "var(--text2)",
              }}
            >
              <span style={{ fontSize: 18 }}>{n.icon}</span>
              <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.03em" }}>
                {n.label}
              </span>
            </button>
          ))}

          <button
            onClick={handleLogout}
            title="Logout"
            style={{
              marginTop: "auto",
              width: 52,
              height: 52,
              borderRadius: 12,
              background: "transparent",
              border: "1px solid transparent",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 2,
              cursor: "pointer",
              color: "var(--text2)",
            }}
          >
            <span style={{ fontSize: 18 }}>🚪</span>
            <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.03em" }}>
              Logout
            </span>
          </button>

          <div
            style={{
              color: "var(--text3)",
              fontSize: 10,
              textAlign: "center",
              lineHeight: 1.4,
              marginTop: 10,
            }}
          >
            <Clock />
          </div>
        </nav>

        <main style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <PageComponent />
        </main>
      </div>

      <ManagerChangeReview api={api} me={me} store={store} showToast={showToast} />


      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: 24,
            right: 24,
            zIndex: 9999,
            background:
              toast.type === "error"
                ? "var(--danger)"
                : toast.type === "warning"
                ? "var(--accent3)"
                : "#1a2e1a",
            border: `1px solid ${
              toast.type === "error"
                ? "#f43f5e44"
                : toast.type === "warning"
                ? "#f59e0b44"
                : "var(--accent2)"
            }`,
            color: "white",
            padding: "12px 20px",
            borderRadius: 10,
            boxShadow: "var(--shadow)",
            fontWeight: 700,
            fontSize: 14,
            maxWidth: 360,
          }}
        >
          {toast.type === "error" ? "❌ " : toast.type === "warning" ? "⚠️ " : "✅ "}
          {toast.msg}
        </div>
      )}
    </POSContext.Provider>
  );
}

function Clock() {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <>
      <div className="mono" style={{ fontSize: 11 }}>
        {time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
      </div>
      <div style={{ fontSize: 9 }}>
        {time.toLocaleDateString([], { month: "short", day: "numeric" })}
      </div>
    </>
  );
}

const labelStyle = {
  fontSize: 12,
  color: "var(--text2)",
  marginBottom: 6,
  fontWeight: 900,
};

const inputStyle = {
  width: "100%",
  height: 44,
  borderRadius: 12,
  border: "1px solid var(--border)",
  background: "rgba(0,0,0,0.22)",
  color: "var(--text)",
  padding: "0 12px",
  outline: "none",
  fontWeight: 700,
};