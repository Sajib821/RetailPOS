import React, { useEffect, useMemo, useState } from "react";
import { usePOS } from "../App";


function ConfirmDialog({
  open,
  title = "Confirm delete",
  message = "Are you sure?",
  confirmText = "Delete",
  cancelText = "Cancel",
  busy = false,
  onConfirm,
  onCancel,
}) {
  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.62)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10000,
        padding: 16,
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel?.();
      }}
    >
      <div
        style={{
          width: 460,
          maxWidth: "100%",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 18,
          boxShadow: "var(--shadow)",
          padding: 18,
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 18, fontWeight: 900, color: "var(--text)" }}>{title}</div>
        <div style={{ marginTop: 10, color: "var(--text2)", lineHeight: 1.55, whiteSpace: "pre-line" }}>
          {message}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}>
          <button
            onClick={onCancel}
            disabled={busy}
            style={{
              padding: "10px 14px",
              borderRadius: 12,
              border: "1px solid var(--border)",
              background: "rgba(255,255,255,0.03)",
              color: "var(--text)",
              fontWeight: 800,
              cursor: busy ? "not-allowed" : "pointer",
              opacity: busy ? 0.7 : 1,
            }}
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            style={{
              padding: "10px 14px",
              borderRadius: 12,
              border: "1px solid rgba(244,63,94,0.35)",
              background: "rgba(244,63,94,0.12)",
              color: "#fecdd3",
              fontWeight: 900,
              cursor: busy ? "not-allowed" : "pointer",
              opacity: busy ? 0.7 : 1,
            }}
          >
            {busy ? "Deleting..." : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}


const symMap = { BDT: "৳", USD: "$", GBP: "£", EUR: "€" };

function toMoney(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function normDateTimeLocal(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function BankAccounts() {
  const { api, showToast, store, me } = usePOS();
  const isAdmin = me?.role === "admin" || me?.role === "superadmin";
  const currency = store?.currency || "BDT";
  const sym = symMap[currency] || "৳";
  const fmt = (n) => `${sym}${toMoney(n).toFixed(2)}`;

  const [accounts, setAccounts] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [entries, setEntries] = useState([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [savingAccount, setSavingAccount] = useState(false);
  const [savingEntry, setSavingEntry] = useState(false);
  const [confirmState, setConfirmState] = useState(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const [accountForm, setAccountForm] = useState({
    id: null,
    account_name: "",
    bank_name: "",
    account_number: "",
    opening_balance: "",
    note: "",
  });

  const [entryForm, setEntryForm] = useState({
    id: null,
    type: "credit",
    amount: "",
    note: "",
    reference: "",
    created_at: normDateTimeLocal(new Date()),
  });

  const selectedAccount = useMemo(
    () => accounts.find((a) => Number(a.id) === Number(selectedId)) || null,
    [accounts, selectedId]
  );

  const ledgerRows = useMemo(() => {
    const sorted = [...entries].sort((a, b) => {
      const aTs = new Date(a.created_at || 0).getTime();
      const bTs = new Date(b.created_at || 0).getTime();
      if (aTs !== bTs) return aTs - bTs;
      return Number(a.id || 0) - Number(b.id || 0);
    });

    let running = toMoney(selectedAccount?.opening_balance || 0);

    const asc = sorted.map((row) => {
      const amount = toMoney(row.amount);
      if (row.type === "credit") running += amount;
      else running -= amount;
      return { ...row, running_balance: running };
    });

    return asc.reverse();
  }, [entries, selectedAccount]);

  const totals = useMemo(() => {
    const opening = toMoney(selectedAccount?.opening_balance || 0);
    const credit = entries
      .filter((row) => row.type === "credit")
      .reduce((sum, row) => sum + toMoney(row.amount), 0);
    const debit = entries
      .filter((row) => row.type === "debit")
      .reduce((sum, row) => sum + toMoney(row.amount), 0);
    const balance = opening + credit - debit;
    return { opening, credit, debit, balance };
  }, [entries, selectedAccount]);

  async function loadAccounts(preferredId = null) {
    if (!api.bankAccounts?.list) return;
    setLoadingAccounts(true);
    try {
      const rows = await api.bankAccounts.list();
      const next = Array.isArray(rows) ? rows : [];
      setAccounts(next);

      const resolvedId =
        preferredId ??
        (next.some((row) => Number(row.id) === Number(selectedId)) ? selectedId : next[0]?.id || null);

      setSelectedId(resolvedId || null);

      if (resolvedId) {
        await loadEntries(resolvedId);
      } else {
        setEntries([]);
      }
    } catch (e) {
      console.error(e);
      showToast("Failed to load bank accounts", "error");
      setAccounts([]);
      setEntries([]);
    } finally {
      setLoadingAccounts(false);
    }
  }

  async function loadEntries(accountId = selectedId) {
    if (!accountId || !api.bankAccounts?.transactions) {
      setEntries([]);
      return;
    }

    setLoadingEntries(true);
    try {
      const rows = await api.bankAccounts.transactions(accountId);
      setEntries(Array.isArray(rows) ? rows : []);
    } catch (e) {
      console.error(e);
      showToast("Failed to load bank transactions", "error");
      setEntries([]);
    } finally {
      setLoadingEntries(false);
    }
  }

  useEffect(() => {
    if (!isAdmin) return;
    loadAccounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, store?.store_id]);

  async function pickAccount(accountId) {
    setSelectedId(accountId);
    resetEntryForm();
    await loadEntries(accountId);
  }

  function resetAccountForm() {
    setAccountForm({
      id: null,
      account_name: "",
      bank_name: "",
      account_number: "",
      opening_balance: "",
      note: "",
    });
  }

  function resetEntryForm() {
    setEntryForm({
      id: null,
      type: "credit",
      amount: "",
      note: "",
      reference: "",
      created_at: normDateTimeLocal(new Date()),
    });
  }

  async function saveAccount() {
    if (!isAdmin) return showToast("Admin only", "error");

    const payload = {
      ...accountForm,
      account_name: String(accountForm.account_name || "").trim(),
      bank_name: String(accountForm.bank_name || "").trim(),
      account_number: String(accountForm.account_number || "").trim(),
      note: String(accountForm.note || "").trim(),
      opening_balance: Number(accountForm.opening_balance || 0),
    };

    if (!payload.account_name) return showToast("Account name is required", "warning");
    if (!Number.isFinite(payload.opening_balance)) {
      return showToast("Enter valid opening balance", "warning");
    }

    setSavingAccount(true);
    try {
      const res = payload.id
        ? await api.bankAccounts.update(payload)
        : await api.bankAccounts.create(payload);

      if (res?.ok === false) return showToast(res.message || "Save failed", "error");

      showToast(payload.id ? "Bank account updated ✅" : "Bank account created ✅");
      const nextId = payload.id || res?.id || null;
      resetAccountForm();
      await loadAccounts(nextId || selectedId);
    } catch (e) {
      console.error(e);
      showToast("Save failed", "error");
    } finally {
      setSavingAccount(false);
    }
  }

  function editAccount(row) {
    setAccountForm({
      id: row.id,
      account_name: row.account_name || "",
      bank_name: row.bank_name || "",
      account_number: row.account_number || "",
      opening_balance: String(toMoney(row.opening_balance || 0)),
      note: row.note || "",
    });
  }

  async function deleteAccount(row) {
    if (!isAdmin) return showToast("Admin only", "error");
    if (!row?.id) return;
    if (!window.confirm(`Delete bank account "${row.account_name}"?\n\nAll related transactions will also be deleted.`)) {
      return;
    }

    try {
      const res = await api.bankAccounts.delete(row.id);
      if (res?.ok === false) return showToast(res.message || "Delete failed", "error");
      showToast("Bank account deleted", "warning");
      resetAccountForm();
      resetEntryForm();
      const nextSelected = Number(selectedId) === Number(row.id) ? null : selectedId;
      await loadAccounts(nextSelected);
    } catch (e) {
      console.error(e);
      showToast("Delete failed", "error");
    }
  }

  async function saveEntry() {
    if (!isAdmin) return showToast("Admin only", "error");
    if (!selectedAccount) return showToast("Select a bank account", "warning");

    const payload = {
      ...entryForm,
      account_id: selectedAccount.id,
      amount: Number(entryForm.amount || 0),
      note: String(entryForm.note || "").trim(),
      reference: String(entryForm.reference || "").trim(),
      created_at: entryForm.created_at ? new Date(entryForm.created_at).toISOString() : new Date().toISOString(),
    };

    if (!["credit", "debit"].includes(payload.type)) {
      return showToast("Select entry type", "warning");
    }
    if (!Number.isFinite(payload.amount) || payload.amount <= 0) {
      return showToast("Enter valid amount", "warning");
    }

    setSavingEntry(true);
    try {
      const res = payload.id
        ? await api.bankAccounts.updateTransaction(payload)
        : await api.bankAccounts.createTransaction(payload);

      if (res?.ok === false) return showToast(res.message || "Save failed", "error");

      showToast(payload.id ? "Transaction updated ✅" : "Transaction added ✅");
      resetEntryForm();
      await loadAccounts(selectedAccount.id);
      await loadEntries(selectedAccount.id);
    } catch (e) {
      console.error(e);
      showToast("Save failed", "error");
    } finally {
      setSavingEntry(false);
    }
  }

  function editEntry(row) {
    setEntryForm({
      id: row.id,
      type: row.type || "credit",
      amount: String(toMoney(row.amount || 0)),
      note: row.note || "",
      reference: row.reference || "",
      created_at: normDateTimeLocal(row.created_at || new Date()),
    });
  }

  async function performDeleteEntry(row) {
    setConfirmBusy(true);
    try {
      const res = await api.bankAccounts.deleteTransaction(row.id);
      if (res?.ok === false) return showToast(res.message || "Delete failed", "error");
      showToast("Transaction deleted", "warning");
      resetEntryForm();
      await loadAccounts(selectedAccount?.id || null);
      if (selectedAccount?.id) await loadEntries(selectedAccount.id);
      setConfirmState(null);
    } catch (e) {
      console.error(e);
      showToast("Delete failed", "error");
    } finally {
      setConfirmBusy(false);
    }
  }

  function deleteEntry(row) {
    if (!isAdmin) return showToast("Admin only", "error");
    if (!row?.id) return;
    setConfirmState({
      title: "Delete transaction",
      message: `Delete this ${row.type} transaction?`,
      confirmText: "Delete transaction",
      onConfirm: () => performDeleteEntry(row),
    });
  }

  const input = {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid var(--border)",
    background: "rgba(0,0,0,0.25)",
    color: "var(--text)",
    outline: "none",
    fontWeight: 700,
  };

  const card = {
    background: "rgba(255,255,255,0.04)",
    border: "1px solid var(--border)",
    borderRadius: 18,
    boxShadow: "var(--shadow)",
    padding: 16,
  };

  const label = { marginBottom: 6, color: "var(--text2)", fontSize: 12, fontWeight: 800 };

  const btnPrimary = (disabled = false) => ({
    padding: "10px 14px",
    borderRadius: 12,
    border: "1px solid rgba(108,99,255,0.6)",
    background: "rgba(108,99,255,0.18)",
    color: "var(--accent)",
    fontWeight: 900,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.65 : 1,
  });

  const btnGhost = () => ({
    padding: "10px 14px",
    borderRadius: 12,
    border: "1px solid var(--border)",
    background: "rgba(255,255,255,0.03)",
    color: "var(--text)",
    fontWeight: 800,
    cursor: "pointer",
  });

  const btnDanger = () => ({
    padding: "10px 14px",
    borderRadius: 12,
    border: "1px solid rgba(244,63,94,0.35)",
    background: "rgba(244,63,94,0.12)",
    color: "#fecdd3",
    fontWeight: 800,
    cursor: "pointer",
  });

  if (!isAdmin) {
    return (
      <div style={{ padding: 20, height: "100%", overflow: "auto" }}>
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          <div style={card}>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900, color: "var(--text)" }}>
              Bank Accounts
            </h1>
            <div style={{ marginTop: 8, color: "var(--text2)" }}>
              Only admin or superadmin can access bank accounts.
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 20, height: "100%", overflow: "auto" }}>
      <div style={{ maxWidth: 1360, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, marginBottom: 14 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900, color: "var(--text)" }}>Bank Accounts</h1>
            <div style={{ marginTop: 6, color: "var(--text2)", fontSize: 13 }}>
              Add bank accounts manually, post debit and credit entries, and track running balance.
            </div>
          </div>
          <button style={btnGhost()} onClick={() => loadAccounts(selectedId)}>
            {loadingAccounts ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: 16 }}>
          <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
            <div style={card}>
              <div style={{ fontWeight: 900, marginBottom: 12, color: "var(--text)" }}>
                {accountForm.id ? `Edit account #${accountForm.id}` : "Add bank account"}
              </div>

              <div>
                <div style={label}>Account name</div>
                <input
                  value={accountForm.account_name}
                  onChange={(e) => setAccountForm((prev) => ({ ...prev, account_name: e.target.value }))}
                  placeholder="Main current account"
                  style={input}
                />
              </div>

              <div style={{ marginTop: 10 }}>
                <div style={label}>Bank name</div>
                <input
                  value={accountForm.bank_name}
                  onChange={(e) => setAccountForm((prev) => ({ ...prev, bank_name: e.target.value }))}
                  placeholder="Bank name"
                  style={input}
                />
              </div>

              <div style={{ marginTop: 10 }}>
                <div style={label}>Account number</div>
                <input
                  value={accountForm.account_number}
                  onChange={(e) => setAccountForm((prev) => ({ ...prev, account_number: e.target.value }))}
                  placeholder="Account number"
                  style={input}
                />
              </div>

              <div style={{ marginTop: 10 }}>
                <div style={label}>Opening / current balance</div>
                <input
                  value={accountForm.opening_balance}
                  onChange={(e) => setAccountForm((prev) => ({ ...prev, opening_balance: e.target.value }))}
                  placeholder="0"
                  style={input}
                />
              </div>

              <div style={{ marginTop: 10 }}>
                <div style={label}>Note</div>
                <textarea
                  value={accountForm.note}
                  onChange={(e) => setAccountForm((prev) => ({ ...prev, note: e.target.value }))}
                  placeholder="Optional note"
                  style={{ ...input, minHeight: 84, resize: "vertical" }}
                />
              </div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
                <button style={btnPrimary(savingAccount)} onClick={saveAccount} disabled={savingAccount}>
                  {savingAccount ? "Saving..." : accountForm.id ? "Update account" : "Save account"}
                </button>
                <button style={btnGhost()} onClick={resetAccountForm}>Clear</button>
              </div>
            </div>

            <div style={card}>
              <div style={{ fontWeight: 900, marginBottom: 10, color: "var(--text)" }}>Bank accounts</div>
              <div style={{ display: "grid", gap: 10 }}>
                {accounts.length === 0 ? (
                  <div style={{ color: "var(--text2)", fontSize: 13 }}>No bank account added yet.</div>
                ) : (
                  accounts.map((row) => {
                    const active = Number(selectedId) === Number(row.id);
                    return (
                      <div
                        key={row.id}
                        onClick={() => pickAccount(row.id)}
                        style={{
                          borderRadius: 14,
                          border: active ? "1px solid rgba(108,99,255,0.5)" : "1px solid var(--border)",
                          background: active ? "rgba(108,99,255,0.10)" : "rgba(255,255,255,0.02)",
                          padding: 12,
                          cursor: "pointer",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                          <div>
                            <div style={{ fontWeight: 900, color: "var(--text)" }}>{row.account_name}</div>
                            <div style={{ color: "var(--text2)", fontSize: 12, marginTop: 4 }}>
                              {row.bank_name || "-"}{row.account_number ? ` • ${row.account_number}` : ""}
                            </div>
                          </div>
                          <div style={{ fontWeight: 900, color: "var(--text)" }}>{fmt(row.current_balance)}</div>
                        </div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                          <button
                            style={btnGhost()}
                            onClick={(e) => {
                              e.stopPropagation();
                              editAccount(row);
                            }}
                          >
                            Edit
                          </button>
                          <button
                            style={btnDanger()}
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteAccount(row);
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
            <div style={card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 22, fontWeight: 900, color: "var(--text)" }}>
                    {selectedAccount?.account_name || "Select a bank account"}
                  </div>
                  <div style={{ marginTop: 6, color: "var(--text2)", fontSize: 13 }}>
                    {selectedAccount
                      ? `${selectedAccount.bank_name || ""}${selectedAccount.account_number ? ` • ${selectedAccount.account_number}` : ""}`.trim() || "No bank/account number"
                      : "Choose an account from the left panel to add debit or credit transactions."}
                  </div>
                </div>
                {selectedAccount && (
                  <div style={{ textAlign: "right" }}>
                    <div style={{ color: "var(--text2)", fontSize: 12, fontWeight: 800 }}>Current balance</div>
                    <div style={{ fontSize: 24, fontWeight: 900, color: "var(--text)" }}>{fmt(totals.balance)}</div>
                  </div>
                )}
              </div>

              {selectedAccount && (
                <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
                  {[
                    { label: "Opening balance", value: fmt(totals.opening) },
                    { label: "Total credit", value: fmt(totals.credit) },
                    { label: "Total debit", value: fmt(totals.debit) },
                    { label: "Remaining balance", value: fmt(totals.balance) },
                  ].map((box) => (
                    <div key={box.label} style={{ border: "1px solid var(--border)", borderRadius: 14, padding: 12, background: "rgba(255,255,255,0.03)" }}>
                      <div style={{ color: "var(--text2)", fontSize: 12, fontWeight: 800 }}>{box.label}</div>
                      <div style={{ marginTop: 8, fontSize: 18, fontWeight: 900, color: "var(--text)" }}>{box.value}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={card}>
              <div style={{ fontWeight: 900, marginBottom: 12, color: "var(--text)" }}>
                {entryForm.id ? `Edit transaction #${entryForm.id}` : "Add bank statement entry"}
              </div>

              {!selectedAccount ? (
                <div style={{ color: "var(--text2)", fontSize: 13 }}>
                  Select an account first.
                </div>
              ) : (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                    <div>
                      <div style={label}>Type</div>
                      <select
                        value={entryForm.type}
                        onChange={(e) => setEntryForm((prev) => ({ ...prev, type: e.target.value }))}
                        style={input}
                      >
                        <option value="credit">Credit</option>
                        <option value="debit">Debit</option>
                      </select>
                    </div>
                    <div>
                      <div style={label}>Amount</div>
                      <input
                        value={entryForm.amount}
                        onChange={(e) => setEntryForm((prev) => ({ ...prev, amount: e.target.value }))}
                        placeholder="0"
                        style={input}
                      />
                    </div>
                    <div>
                      <div style={label}>Date & time</div>
                      <input
                        type="datetime-local"
                        value={entryForm.created_at}
                        onChange={(e) => setEntryForm((prev) => ({ ...prev, created_at: e.target.value }))}
                        style={input}
                      />
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
                    <div>
                      <div style={label}>Reference</div>
                      <input
                        value={entryForm.reference}
                        onChange={(e) => setEntryForm((prev) => ({ ...prev, reference: e.target.value }))}
                        placeholder="Cheque no / slip no / ref"
                        style={input}
                      />
                    </div>
                    <div>
                      <div style={label}>Note</div>
                      <input
                        value={entryForm.note}
                        onChange={(e) => setEntryForm((prev) => ({ ...prev, note: e.target.value }))}
                        placeholder="Optional note"
                        style={input}
                      />
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
                    <button style={btnPrimary(savingEntry)} onClick={saveEntry} disabled={savingEntry}>
                      {savingEntry ? "Saving..." : entryForm.id ? "Update transaction" : "Save transaction"}
                    </button>
                    <button style={btnGhost()} onClick={resetEntryForm}>Clear</button>
                  </div>
                </>
              )}
            </div>

            <div style={card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12 }}>
                <div style={{ fontWeight: 900, color: "var(--text)" }}>Statement</div>
                {selectedAccount && (
                  <div style={{ color: "var(--text2)", fontSize: 12 }}>
                    {loadingEntries ? "Loading transactions..." : `${ledgerRows.length} transaction(s)`}
                  </div>
                )}
              </div>

              {!selectedAccount ? (
                <div style={{ color: "var(--text2)", fontSize: 13 }}>No account selected.</div>
              ) : ledgerRows.length === 0 ? (
                <div style={{ color: "var(--text2)", fontSize: 13 }}>No transaction added yet.</div>
              ) : (
                <div style={{ border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ background: "rgba(255,255,255,0.03)" }}>
                        <th style={th()}>Date</th>
                        <th style={th()}>Type</th>
                        <th style={th()}>Reference / note</th>
                        <th style={{ ...th(), textAlign: "right" }}>Credit</th>
                        <th style={{ ...th(), textAlign: "right" }}>Debit</th>
                        <th style={{ ...th(), textAlign: "right" }}>Balance</th>
                        <th style={{ ...th(), textAlign: "right" }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledgerRows.map((row, idx) => (
                        <tr
                          key={row.id}
                          style={{
                            borderTop: idx ? "1px solid rgba(255,255,255,0.06)" : "none",
                            background: idx % 2 ? "rgba(255,255,255,0.02)" : "transparent",
                          }}
                        >
                          <td style={td()}>{new Date(row.created_at || Date.now()).toLocaleString()}</td>
                          <td style={td()}>
                            <span
                              style={{
                                display: "inline-flex",
                                padding: "4px 8px",
                                borderRadius: 999,
                                fontSize: 12,
                                fontWeight: 900,
                                background: row.type === "credit" ? "rgba(74,222,128,0.12)" : "rgba(245,158,11,0.12)",
                                color: row.type === "credit" ? "#86efac" : "#fcd34d",
                                border: row.type === "credit" ? "1px solid rgba(74,222,128,0.25)" : "1px solid rgba(245,158,11,0.25)",
                              }}
                            >
                              {row.type === "credit" ? "Credit" : "Debit"}
                            </span>
                          </td>
                          <td style={td()}>
                            <div style={{ fontWeight: 700, color: "var(--text)" }}>{row.reference || "-"}</div>
                            <div style={{ marginTop: 4, color: "var(--text2)", fontSize: 12 }}>{row.note || "No note"}</div>
                          </td>
                          <td style={{ ...td(), textAlign: "right", fontWeight: 900, color: "#86efac" }}>
                            {row.type === "credit" ? fmt(row.amount) : "-"}
                          </td>
                          <td style={{ ...td(), textAlign: "right", fontWeight: 900, color: "#fcd34d" }}>
                            {row.type === "debit" ? fmt(row.amount) : "-"}
                          </td>
                          <td style={{ ...td(), textAlign: "right", fontWeight: 900 }}>{fmt(row.running_balance)}</td>
                          <td style={{ ...td(), textAlign: "right" }}>
                            <button style={btnGhost()} onClick={() => editEntry(row)}>Edit</button>
                            <button style={{ ...btnDanger(), marginLeft: 8 }} onClick={() => deleteEntry(row)}>Delete</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={!!confirmState}
        title={confirmState?.title}
        message={confirmState?.message}
        confirmText={confirmState?.confirmText}
        busy={confirmBusy}
        onCancel={() => {
          if (confirmBusy) return;
          setConfirmState(null);
        }}
        onConfirm={() => confirmState?.onConfirm?.()}
      />
    </div>
  );
}

function th() {
  return {
    textAlign: "left",
    padding: "10px 12px",
    color: "var(--text2)",
    fontSize: 12,
    fontWeight: 900,
    borderBottom: "1px solid var(--border)",
  };
}

function td() {
  return {
    padding: "10px 12px",
    color: "var(--text)",
    fontSize: 13,
    verticalAlign: "top",
  };
}
