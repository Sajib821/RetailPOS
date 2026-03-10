import React, { useEffect, useMemo, useState } from "react";
import { usePOS } from "../App";

export default function Users() {
  const { api, showToast, me, setMe } = usePOS();

  const [store, setStore] = useState({ store_id: "", store_name: "", currency: "BDT", is_superadmin: false });

  // LOGIN
  const [loginStoreId, setLoginStoreId] = useState(""); // only used when logging in as Superadmin (optional)
  const [loginUsername, setLoginUsername] = useState("");
  const [pin, setPin] = useState("");

  // SUPERADMIN store management
  const [stores, setStores] = useState([]);
  const [activeManageStoreId, setActiveManageStoreId] = useState(""); // for superadmin management
  const [newStore, setNewStore] = useState({ store_id: "", store_name: "", currency: "BDT" });

  // USERS list
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  // create user form (admin/superadmin)
  const [form, setForm] = useState({
    username: "",
    name: "",
    role: "cashier",
    pin: "",
  });

  // change own password (PIN)
  const [oldPin, setOldPin] = useState("");
  const [newPin, setNewPin] = useState("");

  const isSuper = me?.role === "superadmin";
  const isAdmin = me?.role === "admin" || isSuper;

  const styles = {
    page: { padding: 20, height: "100%", overflow: "auto" },
    wrap: { maxWidth: 1180, margin: "0 auto" },
    header: { display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, marginBottom: 14 },
    title: { margin: 0, fontSize: 28, fontWeight: 900, color: "var(--text)" },
    subtitle: { marginTop: 6, color: "var(--text2)", fontSize: 13, lineHeight: 1.4 },

    grid: { display: "grid", gridTemplateColumns: "420px 1fr", gap: 14 },
    card: {
      background: "rgba(255,255,255,0.04)",
      border: "1px solid var(--border)",
      borderRadius: 16,
      padding: 14,
      boxShadow: "var(--shadow)",
    },
    cardTitle: { margin: 0, fontSize: 14, letterSpacing: "0.02em", color: "var(--text2)", fontWeight: 900 },

    label: { fontSize: 12, color: "var(--text2)", marginBottom: 6, fontWeight: 900 },
    input: {
      width: "100%",
      padding: "10px 12px",
      borderRadius: 12,
      border: "1px solid var(--border)",
      background: "rgba(0,0,0,0.25)",
      color: "var(--text)",
      outline: "none",
      fontWeight: 900,
    },
    select: {
      width: "100%",
      padding: "10px 12px",
      borderRadius: 12,
      border: "1px solid var(--border)",
      background: "rgba(0,0,0,0.25)",
      color: "var(--text)",
      outline: "none",
      fontWeight: 900,
    },
    row2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 },

    actions: { display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" },
    btnPrimary: (disabled) => ({
      padding: "10px 12px",
      borderRadius: 12,
      border: "1px solid rgba(108,99,255,0.6)",
      background: disabled ? "rgba(255,255,255,0.06)" : "rgba(108,99,255,0.18)",
      color: disabled ? "var(--text3)" : "var(--accent)",
      cursor: disabled ? "not-allowed" : "pointer",
      fontWeight: 900,
      whiteSpace: "nowrap",
      opacity: disabled ? 0.65 : 1,
    }),
    btnGhost: {
      padding: "10px 12px",
      borderRadius: 12,
      border: "1px solid var(--border)",
      background: "transparent",
      color: "var(--text2)",
      cursor: "pointer",
      fontWeight: 900,
      whiteSpace: "nowrap",
    },
    btnDanger: {
      padding: "10px 12px",
      borderRadius: 12,
      border: "1px solid rgba(244,63,94,0.35)",
      background: "rgba(244,63,94,0.12)",
      color: "white",
      cursor: "pointer",
      fontWeight: 900,
      whiteSpace: "nowrap",
    },

    pill: {
      display: "inline-block",
      padding: "6px 10px",
      borderRadius: 999,
      fontSize: 12,
      border: "1px solid var(--border)",
      color: "var(--text2)",
      background: "rgba(255,255,255,0.04)",
      fontWeight: 900,
      whiteSpace: "nowrap",
    },

    hr: { height: 1, background: "rgba(255,255,255,0.06)", margin: "14px 0" },

    tableWrap: { overflow: "auto", borderRadius: 12, border: "1px solid var(--border)", marginTop: 12 },
    table: { width: "100%", borderCollapse: "separate", borderSpacing: 0 },
    th: {
      position: "sticky",
      top: 0,
      background: "rgba(0,0,0,0.35)",
      color: "var(--text2)",
      fontSize: 12,
      textAlign: "left",
      padding: "10px 12px",
      borderBottom: "1px solid var(--border)",
      fontWeight: 900,
    },
    td: {
      padding: "10px 12px",
      borderBottom: "1px solid rgba(255,255,255,0.06)",
      color: "var(--text)",
      fontSize: 13,
      verticalAlign: "middle",
    },
    empty: { padding: 14, color: "var(--text2)", fontSize: 13 },
  };

  // ---------- load store + me + list users ----------
  async function refresh(forceStoreId) {
    setLoading(true);
    try {
      const st = await api.store.get().catch(() => null);
      if (st) setStore(st);

      const current = await api.auth.current().catch(() => null);
      setMe(current || null);

      let selectedStoreId = forceStoreId || activeManageStoreId || st?.store_id || "";

      if (current?.role === "superadmin" && api?.stores?.list) {
        const list = await api.stores.list();
        setStores(list || []);
        if (!selectedStoreId && list?.length) selectedStoreId = list[0].store_id;
        if (!activeManageStoreId && selectedStoreId) setActiveManageStoreId(selectedStoreId);
      }

      const users = await loadUsersForActiveStore(current, selectedStoreId);
      setRows(users || []);
    } catch (e) {
      console.error(e);
      showToast("Failed to load users", "error");
    } finally {
      setLoading(false);
    }
  }

  async function loadUsersForActiveStore(currentUser, forcedStoreId = "") {
    const isSuperNow = currentUser?.role === "superadmin";
    if (isSuperNow && api?.users?.getAll) {
      const sid = forcedStoreId || activeManageStoreId || store.store_id;
      return await api.users.getAll({ store_id: sid });
    }
    return await api.users.getAll();
  }

  useEffect(() => { refresh(); }, []); // eslint-disable-line
  useEffect(() => {
    if (isSuper && activeManageStoreId) {
      refresh(activeManageStoreId);
    }
  }, [activeManageStoreId]); // eslint-disable-line

  // ---------- LOGIN ----------
  async function login() {
    if (!pin.trim()) return showToast("PIN required", "warning");

    const username = loginUsername.trim();

    const payload = {
      username: username || undefined,
      pin: pin.trim(),
      // only needed if logging in as Superadmin (optional)
      store_id: (username.toLowerCase() === "superadmin" && loginStoreId.trim()) ? loginStoreId.trim() : undefined,
    };

    const res = await api.auth.login(payload);
    if (!res?.ok) return showToast(res?.message || "Login failed", "error");

    showToast("Logged in ✅");
    setPin("");
    setOldPin("");
    setNewPin("");

    setMe(res.user || null);

    // if Superadmin, refresh stores and set active store
    await refresh();
  }

  async function logout() {
    await api.auth.logout();
    setMe(null);
    showToast("Logged out", "warning");
    await refresh();
  }

  // ---------- CHANGE OWN PIN ----------
  async function changeMyPin() {
    if (!me) return showToast("Login required", "warning");
    if (!oldPin.trim() || !newPin.trim()) return showToast("Old + New PIN required", "warning");

    const res = await api.auth.changePassword({ oldPin: oldPin.trim(), newPin: newPin.trim() });
    if (!res?.ok) return showToast(res?.message || "Failed to change PIN", "error");

    showToast("PIN changed ✅");
    setOldPin("");
    setNewPin("");
  }

  // ---------- SUPERADMIN: STORE SELECT + CREATE ----------
  async function setActiveStore() {
    if (!isSuper) return showToast("Superadmin only", "error");
    if (!api?.stores?.setActive) return showToast("stores API missing in preload", "error");

    const sid = activeManageStoreId.trim();
    if (!sid) return showToast("Select a store", "warning");

    const res = await api.stores.setActive({ store_id: sid });
    if (!res?.ok) return showToast(res?.message || "Failed to set store", "error");

    showToast(`Managing ${sid} ✅`);
    await refresh();
  }

  async function createStore() {
    if (!isSuper) return showToast("Superadmin only", "error");
    if (!api?.stores?.create) return showToast("stores API missing in preload", "error");

    if (!newStore.store_id.trim() || !newStore.store_name.trim()) {
      return showToast("Store ID + Store Name required", "warning");
    }

    const res = await api.stores.create({
      store_id: newStore.store_id.trim(),
      store_name: newStore.store_name.trim(),
      currency: (newStore.currency || "BDT").trim(),
    });

    if (!res?.ok) return showToast(res?.message || "Create store failed", "error");

    showToast("Store created ✅");
    setNewStore({ store_id: "", store_name: "", currency: "BDT" });

    const list = await api.stores.list();
    setStores(list || []);
  }

  // ---------- USERS CRUD ----------
  const canCreate = useMemo(() => form.username.trim() && form.name.trim() && String(form.pin).trim(), [form]);

  async function createUser() {
    if (!isAdmin) return showToast("Admin only", "error");
    if (!canCreate) return showToast("Username, name and PIN required", "warning");

    const payload = {
      username: form.username.trim(),
      name: form.name.trim(),
      role: form.role,
      pin: String(form.pin).trim(),
    };

    // superadmin can create user for selected store_id
    if (isSuper) payload.store_id = (activeManageStoreId || store.store_id || "").trim();

    const res = await api.users.create(payload);
    if (res?.ok === false) return showToast(res.message || "Create failed", "error");

    showToast("User created ✅");
    setForm({ username: "", name: "", role: "cashier", pin: "" });
    await refresh();
  }

  async function toggleActive(u) {
    if (!isAdmin) return showToast("Admin only", "error");

    // protect: don’t disable last admin
    const activeAdmins = rows.filter((x) => x.role === "admin" && x.active).length;
    if (u.role === "admin" && u.active && activeAdmins <= 1) {
      return showToast("You can’t disable the last admin", "warning");
    }

    const payload = { id: u.id, username: u.username, name: u.name, role: u.role, active: !u.active };
    if (isSuper) payload.store_id = (activeManageStoreId || store.store_id || "").trim();

    const res = await api.users.update(payload);
    if (res?.ok === false) return showToast(res.message || "Update failed", "error");

    await refresh();
  }

  async function changePinForUser(u) {
    if (!isAdmin) return showToast("Admin only", "error");

    const newPinValue = prompt(`Set new PIN for ${u.username} (${u.name}):`);
    if (!newPinValue) return;
    if (!/^\d{3,10}$/.test(newPinValue)) return showToast("PIN should be numbers (3–10 digits)", "warning");

    const payload = { id: u.id, pin: newPinValue };
    if (isSuper) payload.store_id = (activeManageStoreId || store.store_id || "").trim();

    const res = await api.users.setPin(payload);
    if (res?.ok === false) return showToast(res.message || "Change failed", "error");

    showToast("PIN updated ✅");
  }

  async function deleteUser(u) {
    if (!isAdmin) return showToast("Admin only", "error");
    if (!isSuper && me?.id === u.id) return showToast("You can’t delete the logged-in user", "warning");

    // prevent deleting last admin
    const activeAdmins = rows.filter((x) => x.role === "admin" && x.active).length;
    if (u.role === "admin" && activeAdmins <= 1) return showToast("You can’t delete the last admin", "warning");

    if (!confirm(`Delete user "${u.username}" (${u.name})?`)) return;

    // main.js accepts number OR {id,store_id} — we use store_id for superadmin
    const payload = isSuper
      ? { id: u.id, store_id: (activeManageStoreId || store.store_id || "").trim() }
      : u.id;

    const res = await api.users.delete(payload);
    if (res?.ok === false) return showToast(res.message || "Delete failed", "error");

    showToast("User deleted", "warning");
    await refresh();
  }

  return (
    <div style={styles.page}>
      <div style={styles.wrap}>
        <div style={styles.header}>
          <div>
            <h1 style={styles.title}>Users</h1>
            <div style={styles.subtitle}>
              Device store: <b>{store.store_name || "?"}</b> (Store ID: <b>{store.store_id || "?"}</b>) · Currency: <b>{store.currency || "BDT"}</b>
              {isSuper ? (
                <div style={{ marginTop: 6, color: "var(--text2)" }}>
                  Superadmin mode: you can manage users for any store using the store selector below.
                </div>
              ) : null}
            </div>
          </div>

          <div style={styles.pill}>
            {me ? `Current: ${me.username || me.name} (${me.role})` : "Not logged in"}
          </div>
        </div>

        <div style={styles.grid}>
          {/* LEFT: Login + Change PIN */}
          <div style={styles.card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={styles.cardTitle}>Login</div>
              <span style={styles.pill}>Admin: admin / 1234 · Superadmin: Superadmin / 1111</span>
            </div>

            {!me ? (
              <>
                <div style={{ marginTop: 12 }}>
                  <div style={styles.label}>Username (optional for PIN-only login)</div>
                  <input
                    value={loginUsername}
                    onChange={(e) => setLoginUsername(e.target.value)}
                    placeholder="admin or Superadmin"
                    style={styles.input}
                  />
                </div>

                <div style={{ marginTop: 10 }}>
                  <div style={styles.label}>PIN</div>
                  <input
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                    placeholder="1234"
                    style={styles.input}
                  />
                </div>

                {/* Store ID only needed when logging in as Superadmin (optional) */}
                <div style={{ marginTop: 10 }}>
                  <div style={styles.label}>Store ID (only for Superadmin, optional)</div>
                  <input
                    value={loginStoreId}
                    onChange={(e) => setLoginStoreId(e.target.value)}
                    placeholder="store_1"
                    style={styles.input}
                  />
                </div>

                <div style={styles.actions}>
                  <button onClick={login} style={styles.btnPrimary(false)}>Login</button>
                  <button
                    onClick={() => { setLoginUsername(""); setPin(""); setLoginStoreId(""); }}
                    style={styles.btnGhost}
                  >
                    Clear
                  </button>
                </div>

                <div style={{ marginTop: 10, color: "var(--text3)", fontSize: 12, lineHeight: 1.5 }}>
                  <b>PIN-only login:</b> leave username blank, enter PIN, login.  
                  If multiple users share the same PIN, it will ask you to use Username + PIN.
                </div>
              </>
            ) : (
              <>
                <div style={styles.actions}>
                  <button onClick={logout} style={styles.btnGhost}>Logout</button>
                </div>

                <div style={styles.hr} />

                <div style={styles.cardTitle}>Change my PIN</div>
                <div style={{ marginTop: 10 }}>
                  <div style={styles.label}>Old PIN</div>
                  <input value={oldPin} onChange={(e) => setOldPin(e.target.value)} placeholder="Old PIN" style={styles.input} />
                </div>
                <div style={{ marginTop: 10 }}>
                  <div style={styles.label}>New PIN</div>
                  <input value={newPin} onChange={(e) => setNewPin(e.target.value)} placeholder="New PIN" style={styles.input} />
                </div>
                <div style={styles.actions}>
                  <button onClick={changeMyPin} style={styles.btnPrimary(!oldPin.trim() || !newPin.trim())} disabled={!oldPin.trim() || !newPin.trim()}>
                    Change PIN
                  </button>
                  <button onClick={() => { setOldPin(""); setNewPin(""); }} style={styles.btnGhost}>Clear</button>
                </div>
              </>
            )}
          </div>

          {/* RIGHT: Store selector (Superadmin) + Manage users */}
          <div style={styles.card}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={styles.cardTitle}>Manage users</div>
              <div style={styles.pill}>{loading ? "Loading…" : `${rows.length} user${rows.length === 1 ? "" : "s"}`}</div>
            </div>

            {/* SUPERADMIN store block */}
            {isSuper ? (
              <>
                <div style={{ marginTop: 12, ...styles.row2 }}>
                  <div>
                    <div style={styles.label}>Active store (manage)</div>
                    <select
                      value={activeManageStoreId || store.store_id || ""}
                      onChange={(e) => setActiveManageStoreId(e.target.value)}
                      style={styles.select}
                    >
                      {(stores || []).map((s) => (
                        <option key={s.store_id} value={s.store_id}>
                          {s.store_id} — {s.store_name}
                        </option>
                      ))}
                      {stores?.length === 0 ? (
                        <option value={store.store_id || ""}>
                          {store.store_id || "store_1"} — (fallback)
                        </option>
                      ) : null}
                    </select>
                  </div>

                  <div>
                    <div style={styles.label}>&nbsp;</div>
                    <button onClick={setActiveStore} style={styles.btnPrimary(false)}>
                      Set Active Store
                    </button>
                  </div>
                </div>

                <div style={styles.hr} />

                <div style={styles.cardTitle}>Create new store (Superadmin)</div>
                <div style={{ marginTop: 10, ...styles.row2 }}>
                  <div>
                    <div style={styles.label}>Store ID</div>
                    <input
                      value={newStore.store_id}
                      onChange={(e) => setNewStore({ ...newStore, store_id: e.target.value })}
                      placeholder="store_2"
                      style={styles.input}
                    />
                  </div>
                  <div>
                    <div style={styles.label}>Store Name</div>
                    <input
                      value={newStore.store_name}
                      onChange={(e) => setNewStore({ ...newStore, store_name: e.target.value })}
                      placeholder="Dhaka Branch"
                      style={styles.input}
                    />
                  </div>
                </div>

                <div style={{ marginTop: 10, ...styles.row2 }}>
                  <div>
                    <div style={styles.label}>Currency</div>
                    <select
                      value={newStore.currency}
                      onChange={(e) => setNewStore({ ...newStore, currency: e.target.value })}
                      style={styles.select}
                    >
                      <option value="BDT">BDT (৳)</option>
                      <option value="USD">USD ($)</option>
                      <option value="GBP">GBP (£)</option>
                      <option value="EUR">EUR (€)</option>
                    </select>
                  </div>
                  <div>
                    <div style={styles.label}>&nbsp;</div>
                    <button onClick={createStore} style={styles.btnPrimary(!newStore.store_id.trim() || !newStore.store_name.trim())} disabled={!newStore.store_id.trim() || !newStore.store_name.trim()}>
                      Create Store
                    </button>
                  </div>
                </div>

                <div style={styles.hr} />
              </>
            ) : null}

            {/* CREATE USER */}
            {!isAdmin ? (
              <div style={{ marginTop: 12, color: "var(--text2)", fontSize: 13 }}>
                Admin only: login as an <b>admin</b> (or Superadmin) to create users, change PIN, disable or delete.
              </div>
            ) : (
              <>
                <div style={styles.cardTitle}>
                  Create user {isSuper ? `(for ${activeManageStoreId || store.store_id})` : `(this store only)`}
                </div>

                <div style={{ marginTop: 12, ...styles.row2 }}>
                  <div>
                    <div style={styles.label}>Username</div>
                    <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="cashier1" style={styles.input} />
                  </div>
                  <div>
                    <div style={styles.label}>Name</div>
                    <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Karim" style={styles.input} />
                  </div>
                </div>

                <div style={{ marginTop: 10, ...styles.row2 }}>
                  <div>
                    <div style={styles.label}>Role</div>
                    <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} style={styles.select}>
                      <option value="cashier">cashier</option>
                      <option value="admin">admin</option>
                    </select>
                  </div>
                  <div>
                    <div style={styles.label}>PIN</div>
                    <input value={form.pin} onChange={(e) => setForm({ ...form, pin: e.target.value })} placeholder="1111" style={styles.input} />
                  </div>
                </div>

                <div style={styles.actions}>
                  <button onClick={createUser} style={styles.btnPrimary(!canCreate)} disabled={!canCreate}>
                    Add user
                  </button>
                  <button onClick={() => setForm({ username: "", name: "", role: "cashier", pin: "" })} style={styles.btnGhost}>
                    Clear
                  </button>
                </div>
              </>
            )}

            {/* USERS TABLE */}
            <div style={styles.tableWrap}>
              {rows.length === 0 && !loading ? (
                <div style={styles.empty}>No users found.</div>
              ) : (
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Username</th>
                      <th style={styles.th}>Name</th>
                      <th style={styles.th}>Role</th>
                      <th style={styles.th}>Active</th>
                      <th style={{ ...styles.th, width: 340 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((u, idx) => (
                      <tr key={u.id} style={{ background: idx % 2 ? "rgba(255,255,255,0.02)" : "transparent" }}>
                        <td style={styles.td}><b>{u.username}</b></td>
                        <td style={styles.td}>{u.name}</td>
                        <td style={styles.td}>{u.role}</td>
                        <td style={styles.td}>{u.active ? "Yes" : "No"}</td>
                        <td style={{ ...styles.td, textAlign: "right" }}>
                          <button onClick={() => toggleActive(u)} style={styles.btnGhost} disabled={!isAdmin}>
                            {u.active ? "Disable" : "Enable"}
                          </button>
                          <button onClick={() => changePinForUser(u)} style={{ ...styles.btnGhost, marginLeft: 8 }} disabled={!isAdmin}>
                            Change PIN
                          </button>
                          <button onClick={() => deleteUser(u)} style={{ ...styles.btnDanger, marginLeft: 8 }} disabled={!isAdmin}>
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div style={{ marginTop: 10, color: "var(--text3)", fontSize: 12, lineHeight: 1.5 }}>
              <b>Rule:</b> Users are store-scoped. A cashier created for Store A cannot log in to Store B.
              {isSuper ? <div>As Superadmin, select a store above to manage its users.</div> : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}