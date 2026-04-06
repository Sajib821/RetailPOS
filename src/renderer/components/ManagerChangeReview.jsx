import { useCallback, useEffect, useMemo, useState } from "react";

function formatDateTime(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString();
}

function describeChange(change) {
  const payload = change && typeof change.payload === "object" && change.payload ? change.payload : {};
  const type = String(change?.entity_type || "").trim().toLowerCase();

  if (type === "product_update") {
    return {
      title:
        change?.title ||
        payload.name ||
        payload.product_name ||
        payload.sku ||
        `Product #${payload.local_product_id || change?.entity_local_id || ""}`,
      lines: [
        payload.price !== undefined ? `Price → ${payload.price}` : null,
        payload.cost !== undefined ? `Cost → ${payload.cost}` : null,
        payload.stock !== undefined ? `Stock → ${payload.stock}` : null,
        payload.low_stock_threshold !== undefined
          ? `Low stock threshold → ${payload.low_stock_threshold}`
          : null,
        payload.category ? `Category → ${payload.category}` : null,
      ].filter(Boolean),
    };
  }

  if (type === "bank_account_upsert") {
    return {
      title: change?.title || payload.account_name || "Bank account change",
      lines: [
        payload.bank_name ? `Bank → ${payload.bank_name}` : null,
        payload.account_number ? `Account no. → ${payload.account_number}` : null,
        payload.opening_balance !== undefined ? `Opening balance → ${payload.opening_balance}` : null,
        payload.active !== undefined ? `Active → ${payload.active ? "Yes" : "No"}` : null,
      ].filter(Boolean),
    };
  }

  if (type === "bank_account_delete") {
    return {
      title: change?.title || "Delete bank account",
      lines: [payload.account_name ? `Account → ${payload.account_name}` : null].filter(Boolean),
    };
  }

  if (type === "bank_transaction_upsert") {
    return {
      title: change?.title || "Bank transaction change",
      lines: [
        payload.local_account_id ? `Account ID → ${payload.local_account_id}` : null,
        payload.type ? `Type → ${payload.type}` : null,
        payload.amount !== undefined ? `Amount → ${payload.amount}` : null,
        payload.reference ? `Reference → ${payload.reference}` : null,
        payload.note ? `Note → ${payload.note}` : null,
      ].filter(Boolean),
    };
  }

  if (type === "bank_transaction_delete") {
    return {
      title: change?.title || "Delete bank transaction",
      lines: [
        payload.local_transaction_id || change?.entity_local_id
          ? `Transaction ID → ${payload.local_transaction_id || change?.entity_local_id}`
          : null,
      ].filter(Boolean),
    };
  }

  return {
    title: change?.title || change?.entity_type || "Pending change",
    lines: [JSON.stringify(payload)],
  };
}

export default function ManagerChangeReview({ api, me, store, showToast }) {
  const [changes, setChanges] = useState([]);
  const [open, setOpen] = useState(false);
  const [loadingId, setLoadingId] = useState(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!api?.managerChanges?.listPending || !me || !store?.store_id) {
      setChanges([]);
      setOpen(false);
      return;
    }

    try {
      const rows = await api.managerChanges.listPending();
      const next = Array.isArray(rows) ? rows : [];
      setChanges(next);
      if (next.length) setOpen(true);
    } catch (e) {
      console.error("Manager change review refresh failed:", e);
    }
  }, [api, me, store?.store_id]);

  useEffect(() => {
    refresh();
    if (!me || !store?.store_id) return undefined;

    const timer = setInterval(refresh, 15000);
    return () => clearInterval(timer);
  }, [me, refresh, store?.store_id]);

  const pendingCount = changes.length;

  const summaryText = useMemo(() => {
    if (!pendingCount) return "";
    if (pendingCount === 1) return "1 manager change is waiting for review.";
    return `${pendingCount} manager changes are waiting for review.`;
  }, [pendingCount]);

  async function handleAccept(change) {
    if (!api?.managerChanges?.accept || busy) return;
    setBusy(true);
    setLoadingId(change.id);

    try {
      const res = await api.managerChanges.accept({ id: change.id });
      if (!res?.ok) throw new Error(res?.message || "Accept failed");
      showToast?.(res.message || "Manager change accepted", "success");
      await refresh();
    } catch (e) {
      console.error(e);
      showToast?.(e?.message || "Accept failed", "error");
    } finally {
      setBusy(false);
      setLoadingId(null);
    }
  }

  async function handleReject(change) {
    if (!api?.managerChanges?.reject || busy) return;
    setBusy(true);
    setLoadingId(change.id);

    try {
      const res = await api.managerChanges.reject({ id: change.id });
      if (!res?.ok) throw new Error(res?.message || "Reject failed");
      showToast?.(res.message || "Manager change rejected", "warning");
      await refresh();
    } catch (e) {
      console.error(e);
      showToast?.(e?.message || "Reject failed", "error");
    } finally {
      setBusy(false);
      setLoadingId(null);
    }
  }

  if (!me || !store?.store_id) return null;

  return (
    <>
      {pendingCount > 0 && !open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{
            position: "fixed",
            right: 24,
            top: 24,
            zIndex: 9999,
            background: "rgba(245,158,11,0.18)",
            border: "1px solid rgba(245,158,11,0.45)",
            color: "#fde68a",
            padding: "10px 14px",
            borderRadius: 12,
            fontWeight: 900,
            cursor: "pointer",
            boxShadow: "var(--shadow)",
          }}
        >
          ⚠ Review {pendingCount} manager change{pendingCount === 1 ? "" : "s"}
        </button>
      ) : null}

      {open ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 10000,
            background: "rgba(2,6,23,0.68)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <div
            style={{
              width: "min(920px, 100%)",
              maxHeight: "85vh",
              overflow: "auto",
              borderRadius: 18,
              background: "var(--surface)",
              border: "1px solid var(--border)",
              boxShadow: "var(--shadow)",
              padding: 20,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: 16,
                marginBottom: 18,
              }}
            >
              <div>
                <div style={{ fontSize: 24, fontWeight: 900, color: "var(--text)" }}>
                  Manager review required
                </div>
                <div style={{ fontSize: 13, color: "var(--text2)", marginTop: 6 }}>
                  {summaryText || "No pending manager changes."}
                </div>
                <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 4 }}>
                  Store: {store.store_name || store.store_id}
                </div>
              </div>

              <div style={{ display: "flex", gap: 10 }}>
                <button
                  type="button"
                  onClick={refresh}
                  disabled={busy}
                  style={{
                    height: 40,
                    padding: "0 14px",
                    borderRadius: 10,
                    border: "1px solid var(--border)",
                    background: "transparent",
                    color: "var(--text)",
                    fontWeight: 800,
                    cursor: "pointer",
                  }}
                >
                  Refresh
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={busy}
                  style={{
                    height: 40,
                    padding: "0 14px",
                    borderRadius: 10,
                    border: "1px solid var(--border)",
                    background: "transparent",
                    color: "var(--text2)",
                    fontWeight: 800,
                    cursor: "pointer",
                  }}
                >
                  Later
                </button>
              </div>
            </div>

            {!changes.length ? (
              <div
                style={{
                  borderRadius: 14,
                  border: "1px dashed var(--border)",
                  padding: 24,
                  color: "var(--text2)",
                  textAlign: "center",
                }}
              >
                No pending manager changes for this store.
              </div>
            ) : (
              <div style={{ display: "grid", gap: 12 }}>
                {changes.map((change) => {
                  const desc = describeChange(change);
                  const isLoading = Number(loadingId) === Number(change.id);
                  return (
                    <div
                      key={change.id}
                      style={{
                        borderRadius: 14,
                        border: "1px solid var(--border)",
                        background: "rgba(255,255,255,0.03)",
                        padding: 16,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          justifyContent: "space-between",
                          gap: 16,
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 16, fontWeight: 900, color: "var(--text)" }}>
                            {desc.title}
                          </div>
                          <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 4 }}>
                            Type: {change.entity_type} • Requested by: {change.requested_by || "Manager"} • {formatDateTime(change.requested_at)}
                          </div>

                          {desc.lines.length ? (
                            <div style={{ display: "grid", gap: 4, marginTop: 10 }}>
                              {desc.lines.map((line, idx) => (
                                <div key={idx} style={{ fontSize: 13, color: "var(--text)" }}>
                                  • {line}
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>

                        <div style={{ display: "flex", gap: 10, flexShrink: 0 }}>
                          <button
                            type="button"
                            onClick={() => handleReject(change)}
                            disabled={busy}
                            style={{
                              height: 40,
                              padding: "0 14px",
                              borderRadius: 10,
                              border: "1px solid rgba(244,63,94,0.35)",
                              background: "rgba(244,63,94,0.12)",
                              color: "#fecdd3",
                              fontWeight: 900,
                              cursor: "pointer",
                            }}
                          >
                            {isLoading ? "Working..." : "Reject"}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleAccept(change)}
                            disabled={busy}
                            style={{
                              height: 40,
                              padding: "0 14px",
                              borderRadius: 10,
                              border: "1px solid rgba(74,222,128,0.35)",
                              background: "rgba(74,222,128,0.12)",
                              color: "#bbf7d0",
                              fontWeight: 900,
                              cursor: "pointer",
                            }}
                          >
                            {isLoading ? "Working..." : "Accept"}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
