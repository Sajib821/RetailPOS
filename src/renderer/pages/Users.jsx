import React, { useEffect, useMemo, useState } from "react";
import { usePOS } from "../App";

function Users() {
  const { api, showToast, me, setMe } = usePOS();

  // Login inputs
  const [loginUsername, setLoginUsername] = useState("");
  const [pin, setPin] = useState("");

  // Change my password
  const [oldPin, setOldPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [newPin2, setNewPin2] = useState("");

  // Data
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  // Create user form (admin only)
  const [form, setForm] = useState({ name: "", username: "", role: "cashier", pin: "" });

  const styles = {
    page: { padding: 20, height: "100%", overflow: "auto" },
    wrap: { maxWidth: 1100, margin: "0 auto" },
    header: {
      display: "flex",
      alignItems: "flex-end",
      justifyContent: "space-between",
      gap: 12,
      marginBottom: 14,
    },
    title: { margin: 0, fontSize: 28, fontWeight: 800, color: "var(--text)" },
    subtitle: { marginTop: 6, color: "var(--text2)", fontSize: 13 },

    grid: { display: "grid", gridTemplateColumns: "420px 1fr", gap: 14 },
    leftCol: { display: "flex", flexDirection: "column", gap: 14 },

    card: {
      background: "rgba(255,255,255,0.04)",
      border: "1px solid var(--border)",
      borderRadius: 16,
      padding: 14,
      boxShadow: "var(--shadow)",
    },
    cardTitle: { margin: 0, fontSize: 14, letterSpacing: "0.02em", color: "var(--text2)", fontWeight: 700 },

    label: { fontSize: 12, color: "var(--text2)", marginBottom: 6, fontWeight: 600 },
    input: {
      width: "100%",
      padding: "10px 12px",
      borderRadius: 12,
      border: "1px solid var(--border)",
      background: "rgba(0,0,0,0.25)",
      color: "var(--text)",
      outline: "none",
    },
    select: {
      width: "100%",
      padding: "10px 12px",
      borderRadius: 12,
      border: "1px solid var(--border)",
      background: "rgba(0,0,0,0.25)",
      color: "var(--text)",
      outline: "none",
    },
    row2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 },

    actions: { display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" },
    btnPrimary: {
      padding: "10px 12px",
      borderRadius: 12,
      border: "1px solid rgba(108,99,255,0.6)",
      background: "rgba(108,99,255,0.18)",
      color: "var(--accent)",
      cursor: "pointer",
      fontWeight: 800,
      whiteSpace: "nowrap",
    },
    btnGhost: {
      padding: "10px 12px",
      borderRadius: 12,
      border: "1px solid var(--border)",
      background: "transparent",
      color: "var(--text2)",
      cursor: "pointer",
      fontWeight: 800,
      whiteSpace: "nowrap",
    },
    btnDanger: {
      padding: "10px 12px",
      borderRadius: 12,
      border: "1px solid rgba(244,63,94,0.35)",
      background: "rgba(244,63,94,0.12)",
      color: "white",
      cursor: "pointer",
      fontWeight: 800,
      whiteSpace: "nowrap",
    },

    pill: {
      display: "inline-block",
      padding: "4px 8px",
      borderRadius: 999,
      fontSize: 12,
      border: "1px solid var(--border)",
      color: "var(--text2)",
      background: "rgba(255,255,255,0.04)",
    },

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
      fontWeight: 800,
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

  async function refresh() {
    setLoading(true);
    try {
      const current = await api.auth.current();
      setMe(current || null);

      const users = await api.users.getAll();
      setRows(users || []);
    } catch {
      showToast("Failed to load users", "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  async function login() {
    const res = await api.auth.login({ username: loginUsername, pin });
    if (!res?.ok) return showToast(res?.message || "Login failed", "error");

    showToast("Logged in");
    setPin("");
    setLoginUsername("");
    setMe(res.user);

    const users = await api.users.getAll();
    setRows(users || []);
  }

  async function logout() {
    await api.auth.logout();
    showToast("Logged out", "warning");
    setMe(null);
    setOldPin(""); setNewPin(""); setNewPin2("");
    refresh();
  }

  async function changeMyPassword() {
    if (!me) return showToast("Login required", "warning");
    if (!oldPin || !newPin || !newPin2) return showToast("Fill all password fields", "warning");
    if (newPin !== newPin2) return showToast("New passwords do not match", "error");
    if (newPin.length < 3 || newPin.length > 30) return showToast("Password must be 3–30 characters", "warning");

    const res = await api.auth.changePassword({ oldPin, newPin });
    if (!res?.ok) return showToast(res?.message || "Change password failed", "error");

    showToast("Password updated");
    setOldPin(""); setNewPin(""); setNewPin2("");
  }

  const isAdmin = me?.role === "admin";

  const canCreate = useMemo(
    () => form.name.trim() && form.username.trim() && String(form.pin).trim(),
    [form]
  );

  async function createUser() {
    if (!isAdmin) return showToast("Admin only", "error");
    if (!canCreate) return showToast("Name, Username and PIN required", "error");

    const res = await api.users.create({
      name: form.name,
      username: form.username,
      role: form.role,
      pin: form.pin,
    });

    if (res?.ok === false) return showToast(res.message || "Failed", "error");

    showToast("User created");
    setForm({ name: "", username: "", role: "cashier", pin: "" });
    refresh();
  }

  async function toggleActive(u) {
    if (!isAdmin) return showToast("Admin only", "error");

    const activeAdmins = rows.filter(x => x.role === "admin" && x.active).length;
    if (u.role === "admin" && u.active && activeAdmins <= 1) {
      return showToast("You can’t disable the last admin", "warning");
    }

    const res = await api.users.update({
      id: u.id,
      name: u.name,
      username: u.username,
      role: u.role,
      active: !u.active,
    });

    if (res?.ok === false) return showToast(res.message || "Failed", "error");
    refresh();
  }

  async function changePinAdmin(u) {
    if (!isAdmin) return showToast("Admin only", "error");
    const newP = prompt(`Set new PIN/password for ${u.username || u.name}:`);
    if (!newP) return;
    if (newP.length < 3 || newP.length > 30) return showToast("Password must be 3–30 characters", "warning");

    const res = await api.users.setPin({ id: u.id, pin: newP });
    if (res?.ok === false) return showToast(res.message || "Failed", "error");
    showToast("Password updated");
  }

  async function deleteUser(u) {
    if (!isAdmin) return showToast("Admin only", "error");
    if (me?.id === u.id) return showToast("You can’t delete the currently logged in user", "warning");

    const activeAdmins = rows.filter(x => x.role === "admin" && x.active).length;
    if (u.role === "admin" && activeAdmins <= 1) {
      return showToast("You can’t delete the last admin", "warning");
    }

    if (!confirm(`Delete user "${u.username || u.name}"?`)) return;

    const res = await api.users.delete(u.id);
    if (res?.ok === false) return showToast(res.message || "Failed", "error");
    showToast("User deleted", "warning");
    refresh();
  }

  return (
    <div style={styles.page}>
      <div style={styles.wrap}>
        <div style={styles.header}>
          <div>
            <h1 style={styles.title}>Users</h1>
            <div style={styles.subtitle}>Login using Username + PIN. Users can change their own password.</div>
          </div>
          <div style={styles.pill}>
            {me ? `Current: ${me.name} (${me.role})` : "Not logged in"}
          </div>
        </div>

        <div style={styles.grid}>
          {/* LEFT COLUMN */}
          <div style={styles.leftCol}>
            {/* Login */}
            <div style={styles.card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={styles.cardTitle}>Login</div>
                <span style={styles.pill}>Default admin: username <b>admin</b>, PIN <b>1234</b></span>
              </div>

              {!me ? (
                <>
                  <div style={{ marginTop: 12 }}>
                    <div style={styles.label}>Username</div>
                    <input
                      value={loginUsername}
                      onChange={(e) => setLoginUsername(e.target.value)}
                      placeholder="admin"
                      style={styles.input}
                    />
                  </div>

                  <div style={{ marginTop: 10 }}>
                    <div style={styles.label}>PIN / Password</div>
                    <input
                      value={pin}
                      onChange={(e) => setPin(e.target.value)}
                      placeholder="Enter PIN"
                      style={styles.input}
                    />
                  </div>

                  <div style={styles.actions}>
                    <button onClick={login} style={styles.btnPrimary}>Login</button>
                    <button onClick={() => { setPin(""); setLoginUsername(""); }} style={styles.btnGhost}>Clear</button>
                  </div>
                </>
              ) : (
                <div style={styles.actions}>
                  <button onClick={logout} style={styles.btnGhost}>Logout</button>
                </div>
              )}
            </div>

            {/* Change my password (only when logged in) */}
            {me && (
              <div style={styles.card}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={styles.cardTitle}>Change my password</div>
                  <span style={styles.pill}>{me.username || me.name}</span>
                </div>

                <div style={{ marginTop: 12 }}>
                  <div style={styles.label}>Old password</div>
                  <input value={oldPin} onChange={(e) => setOldPin(e.target.value)} style={styles.input} />
                </div>

                <div style={{ marginTop: 10 }}>
                  <div style={styles.label}>New password</div>
                  <input value={newPin} onChange={(e) => setNewPin(e.target.value)} style={styles.input} />
                </div>

                <div style={{ marginTop: 10 }}>
                  <div style={styles.label}>Confirm new password</div>
                  <input value={newPin2} onChange={(e) => setNewPin2(e.target.value)} style={styles.input} />
                </div>

                <div style={styles.actions}>
                  <button onClick={changeMyPassword} style={styles.btnPrimary}>Update password</button>
                  <button onClick={() => { setOldPin(""); setNewPin(""); setNewPin2(""); }} style={styles.btnGhost}>Clear</button>
                </div>
              </div>
            )}
          </div>

          {/* RIGHT COLUMN */}
          <div style={styles.card}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={styles.cardTitle}>Manage users</div>
              <div style={styles.pill}>{loading ? "Loading…" : `${rows.length} user${rows.length === 1 ? "" : "s"}`}</div>
            </div>

            {!isAdmin ? (
              <div style={{ marginTop: 12, color: "var(--text2)", fontSize: 13 }}>
                Admin only: login as an <b>admin</b> to create users, change PIN, or delete users.
              </div>
            ) : (
              <>
                <div style={{ marginTop: 12, ...styles.row2 }}>
                  <div>
                    <div style={styles.label}>Name</div>
                    <input
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder="Cashier name"
                      style={styles.input}
                    />
                  </div>
                  <div>
                    <div style={styles.label}>Role</div>
                    <select
                      value={form.role}
                      onChange={(e) => setForm({ ...form, role: e.target.value })}
                      style={styles.select}
                    >
                      <option value="cashier">cashier</option>
                      <option value="admin">admin</option>
                    </select>
                  </div>
                </div>

                <div style={{ marginTop: 10, ...styles.row2 }}>
                  <div>
                    <div style={styles.label}>Username</div>
                    <input
                      value={form.username}
                      onChange={(e) => setForm({ ...form, username: e.target.value })}
                      placeholder="cashier_1"
                      style={styles.input}
                    />
                  </div>
                  <div>
                    <div style={styles.label}>PIN / Password</div>
                    <input
                      value={form.pin}
                      onChange={(e) => setForm({ ...form, pin: e.target.value })}
                      placeholder="Set password"
                      style={styles.input}
                    />
                  </div>
                </div>

                <div style={styles.actions}>
                  <button
                    onClick={createUser}
                    style={{ ...styles.btnPrimary, opacity: canCreate ? 1 : 0.55 }}
                    disabled={!canCreate}
                  >
                    Add user
                  </button>
                  <button onClick={() => setForm({ name: "", username: "", role: "cashier", pin: "" })} style={styles.btnGhost}>
                    Clear
                  </button>
                </div>
              </>
            )}

            <div style={styles.tableWrap}>
              {rows.length === 0 && !loading ? (
                <div style={styles.empty}>No users found.</div>
              ) : (
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Name</th>
                      <th style={styles.th}>Username</th>
                      <th style={styles.th}>Role</th>
                      <th style={styles.th}>Active</th>
                      <th style={{ ...styles.th, width: 360 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((u, idx) => (
                      <tr key={u.id} style={{ background: idx % 2 ? "rgba(255,255,255,0.02)" : "transparent" }}>
                        <td style={styles.td}>{u.name}</td>
                        <td style={styles.td}>{u.username || "—"}</td>
                        <td style={styles.td}>{u.role}</td>
                        <td style={styles.td}>{u.active ? "Yes" : "No"}</td>
                        <td style={{ ...styles.td, textAlign: "right" }}>
                          <button onClick={() => toggleActive(u)} style={styles.btnGhost} disabled={!isAdmin}>
                            {u.active ? "Disable" : "Enable"}
                          </button>
                          <button onClick={() => changePinAdmin(u)} style={{ ...styles.btnGhost, marginLeft: 8 }} disabled={!isAdmin}>
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

            <div style={{ marginTop: 10, color: "var(--text2)", fontSize: 12 }}>
              Tip: Log in before selling so sales can record the cashier.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Users;