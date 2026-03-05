import React, { useEffect, useState } from "react";

export default function Users() {
  const [me, setMe] = useState(null);
  const [pin, setPin] = useState("");
  const [rows, setRows] = useState([]);

  const [form, setForm] = useState({ name: "", role: "cashier", pin: "" });

  async function refresh() {
    setMe(await window.pos.auth.current());
    setRows(await window.pos.users.getAll());
  }

  useEffect(() => { refresh(); }, []);

  async function login() {
    const res = await window.pos.auth.login(pin);
    if (!res.ok) return alert(res.message || "Login failed");
    setPin("");
    refresh();
  }

  async function logout() {
    await window.pos.auth.logout();
    refresh();
  }

  async function createUser() {
    if (!form.name || !form.pin) return alert("Name and PIN required");
    await window.pos.users.create(form);
    setForm({ name: "", role: "cashier", pin: "" });
    refresh();
  }

  async function disableUser(u) {
    await window.pos.users.update({ id: u.id, name: u.name, role: u.role, active: !u.active });
    refresh();
  }

  return (
    <div style={{ padding: 16 }}>
      <h2>Users / Login</h2>

      <div style={{ padding: 12, border: "1px solid #333", marginBottom: 16 }}>
        <div>Current: {me ? `${me.name} (${me.role})` : "Not logged in"}</div>
        {!me ? (
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <input value={pin} onChange={e => setPin(e.target.value)} placeholder="Enter PIN" />
            <button onClick={login}>Login</button>
            <div style={{ opacity: 0.8, marginLeft: 8 }}>Default admin PIN: 1234</div>
          </div>
        ) : (
          <button onClick={logout} style={{ marginTop: 8 }}>Logout</button>
        )}
      </div>

      <h3>Manage users</h3>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <input placeholder="Name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
        <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
          <option value="cashier">cashier</option>
          <option value="admin">admin</option>
        </select>
        <input placeholder="PIN" value={form.pin} onChange={e => setForm({ ...form, pin: e.target.value })} />
        <button onClick={createUser}>Add</button>
      </div>

      <table width="100%" cellPadding="8" style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #333" }}>
            <th>Name</th><th>Role</th><th>Active</th><th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(u => (
            <tr key={u.id} style={{ borderBottom: "1px solid #222" }}>
              <td>{u.name}</td>
              <td>{u.role}</td>
              <td>{u.active ? "Yes" : "No"}</td>
              <td>
                <button onClick={() => disableUser(u)}>{u.active ? "Disable" : "Enable"}</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}