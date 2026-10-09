import { useEffect, useMemo, useState } from "react";
import ProfileSectionShell from "./ProfileSectionShell";
import { supabase } from "../../lib/supabaseClient";
import { formatGhanaCedis, loadInvoiceHistory } from "../payment/paymentStorage";

function formatDate(value) {
  if (!value) return "Recently";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function Invoices({ authUser = null }) {
  const [state, setState] = useState({ loading: true, error: "", receipts: [], summary: null });
  const [search, setSearch] = useState("");
  const [actionState, setActionState] = useState({ id: "", error: "" });

  useEffect(() => {
    let active = true;
    setState({ loading: true, error: "", receipts: [], summary: null });
    void loadInvoiceHistory({ authUser }).then((result) => {
      if (!active) return;
      setState(result.ok
        ? { loading: false, error: "", receipts: result.receipts, summary: result.summary }
        : { loading: false, error: result.message, receipts: [], summary: null });
    });
    return () => { active = false; };
  }, [authUser?.id]);

  const visibleReceipts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return state.receipts.filter((receipt) => !query || `${receipt.receiptNumber} ${receipt.orderNumber}`.toLowerCase().includes(query));
  }, [search, state.receipts]);

  const handleReceiptAction = async (receipt, mode) => {
    const popup = mode === "view" && typeof window !== "undefined" ? window.open("", "_blank") : null;
    setActionState({ id: receipt.id, error: "" });
    try {
      const { data, error } = await supabase.auth.getSession();
      const token = data?.session?.access_token ?? "";
      if (error || !token) throw new Error("Please sign in again to access this receipt.");
      const response = await fetch(`/api/receipts/${encodeURIComponent(receipt.paymentReference)}/pdf`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/pdf" } });
      if (!response.ok) throw new Error("Unable to generate this receipt right now.");
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      if (mode === "view" && popup) {
        popup.location.href = url;
        popup.focus();
        window.setTimeout(() => window.URL.revokeObjectURL(url), 60000);
      } else {
        const link = document.createElement("a");
        link.href = url;
        link.download = receipt.filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(url);
      }
    } catch (error) {
      popup?.close();
      setActionState({ id: receipt.id, error: error.message || "Unable to access this receipt." });
    } finally {
      setActionState((current) => current.id === receipt.id ? { ...current, id: "" } : current);
    }
  };

  const summary = state.summary ?? { totalReceipts: 0, totalAmountPaid: 0, completedOrders: 0 };

  return (
    <ProfileSectionShell eyebrow="Billing records" title="My Invoices" description="View and download receipts for your successful orders.">
      {state.loading ? <div className="orders-empty"><h3>Loading receipts...</h3><p>We are securely loading your verified payments.</p></div> : null}
      {!state.loading && state.error ? <div className="orders-empty"><h3>Unable to load invoices</h3><p>{state.error}</p></div> : null}
      {!state.loading && !state.error ? (
        <>
          <div className="orders-summary invoice-summary" aria-label="Invoice summary">
            <article className="orders-summary__card"><span className="orders-summary__label">Total Receipts</span><strong className="orders-summary__value">{summary.totalReceipts}</strong><p className="orders-summary__note">Verified payment records.</p></article>
            <article className="orders-summary__card"><span className="orders-summary__label">Total Amount Paid</span><strong className="orders-summary__value">{formatGhanaCedis(summary.totalAmountPaid)}</strong><p className="orders-summary__note">Successful payments on this account.</p></article>
            <article className="orders-summary__card"><span className="orders-summary__label">Completed Orders</span><strong className="orders-summary__value">{summary.completedOrders}</strong><p className="orders-summary__note">Orders marked completed or delivered.</p></article>
          </div>
          <section className="orders-panel invoice-panel">
            <div className="orders-panel__header"><div><p className="orders-panel__eyebrow">Receipt archive</p><h2>Successful payments</h2></div><span>{visibleReceipts.length} record{visibleReceipts.length === 1 ? "" : "s"}</span></div>
            <label className="invoice-search" htmlFor="invoice-search"><span>Search receipts</span><input id="invoice-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Receipt or order number" /></label>
            {visibleReceipts.length > 0 ? (
              <div className="invoice-table-wrap"><table className="invoice-table"><thead><tr><th>Receipt Number</th><th>Order Number</th><th>Date</th><th>Amount Paid</th><th>Payment Status</th><th>Order Status</th><th>Action</th></tr></thead><tbody>{visibleReceipts.map((receipt) => <tr key={receipt.id}><td><strong>{receipt.receiptNumber}</strong><small>{receipt.paymentPurpose === "shipping" ? "Shipping payment" : "Order payment"}</small></td><td><strong>{receipt.orderNumber}</strong>{receipt.coveredOrderNumbers && receipt.coveredOrderNumbers !== receipt.orderNumber ? <small>Covered: {receipt.coveredOrderNumbers}</small> : null}</td><td>{formatDate(receipt.date)}</td><td>{formatGhanaCedis(receipt.amountPaid)}</td><td><span className="invoice-status is-paid">Paid</span></td><td>{receipt.orderStatus}</td><td><div className="invoice-actions"><button type="button" onClick={() => handleReceiptAction(receipt, "view")} disabled={actionState.id === receipt.id}>View Receipt</button><button type="button" className="is-secondary" onClick={() => handleReceiptAction(receipt, "download")} disabled={actionState.id === receipt.id}>Download PDF</button></div></td></tr>)}</tbody></table></div>
            ) : <div className="orders-empty"><h3>No receipts available yet.</h3><p>Your receipts will appear here after successful payment.</p></div>}
            {actionState.error ? <p className="invoice-error" role="alert">{actionState.error}</p> : null}
          </section>
        </>
      ) : null}
    </ProfileSectionShell>
  );
}

export default Invoices;
