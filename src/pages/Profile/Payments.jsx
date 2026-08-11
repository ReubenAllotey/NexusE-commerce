import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import ProfileSectionShell from "./ProfileSectionShell";
import { loadPaymentHistory } from "../payment/paymentStorage";

function formatMoney(value) {
  return new Intl.NumberFormat("en-GH", {
    style: "currency",
    currency: "GHS",
    currencyDisplay: "symbol",
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  }).format(Number(value) || 0);
}

function formatDate(value) {
  if (!value) {
    return "Recently";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Recently";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function getStatusTone(status) {
  switch (String(status ?? "").toLowerCase()) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "processing":
      return "processing";
    default:
      return "pending";
  }
}

function Payments({ authUser = null }) {
  const [state, setState] = useState({
    loading: true,
    error: "",
    payments: [],
  });

  useEffect(() => {
    let active = true;
    setState({
      loading: true,
      error: "",
      payments: [],
    });

    const load = async () => {
      const result = await loadPaymentHistory({ authUser });

      if (!active) {
        return;
      }

      if (result.ok) {
        setState({
          loading: false,
          error: "",
          payments: result.payments ?? [],
        });
        return;
      }

      setState({
        loading: false,
        error: result.message || "Unable to load payment history.",
        payments: [],
      });
    };

    void load();

    return () => {
      active = false;
    };
  }, [authUser?.id, authUser?.role, authUser?.status]);

  const summary = state.payments.reduce(
    (accumulator, payment) => {
      if (payment.paymentTone === "completed") {
        accumulator.completed += 1;
        accumulator.completedAmount += Number(payment.amountPaid) || 0;
      } else if (payment.paymentTone === "failed") {
        accumulator.failed += 1;
      } else if (payment.paymentTone === "processing") {
        accumulator.processing += 1;
      } else {
        accumulator.pending += 1;
      }

      return accumulator;
    },
    {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      completedAmount: 0,
    },
  );

  return (
    <ProfileSectionShell
      eyebrow="Billing"
      title="Payment"
      description="Track pending and completed payments linked to your orders."
    >
      {state.loading ? (
        <div className="orders-empty">
          <h3>Loading payment history...</h3>
          <p>We are loading your payments from Supabase.</p>
        </div>
      ) : state.error ? (
        <div className="orders-empty">
          <h3>Unable to load payment history</h3>
          <p>{state.error}</p>
          <Link to="/products" className="orders-empty__button">
            Continue shopping
          </Link>
        </div>
      ) : (
        <>
          <div className="orders-summary payment-summary" aria-label="Payment summary">
            <article className="orders-summary__card payment-summary__card">
              <span className="orders-summary__label">Pending</span>
              <strong className="orders-summary__value">{summary.pending}</strong>
              <p className="orders-summary__note">Payments still awaiting confirmation.</p>
            </article>

            <article className="orders-summary__card payment-summary__card">
              <span className="orders-summary__label">Completed Payment</span>
              <strong className="orders-summary__value">{summary.completed}</strong>
              <p className="orders-summary__note">
                Paid totals amounting to {formatMoney(summary.completedAmount)}.
              </p>
            </article>
          </div>

          <section className="orders-panel payment-panel">
            <div className="orders-panel__header">
              <div>
                <p className="orders-panel__eyebrow">Payment records</p>
                <h2>Orders and payment status</h2>
              </div>

              <span>
                {state.payments.length} record{state.payments.length === 1 ? "" : "s"}
              </span>
            </div>

            {state.payments.length > 0 ? (
              <div className="payment-table-wrap">
                <table className="payment-table">
                  <thead>
                    <tr>
                      <th>Order ID</th>
                      <th>Number of items</th>
                      <th>Amount paid</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.payments.map((payment) => (
                      <tr key={payment.id}>
                        <td>
                          <strong>{payment.orderNumber}</strong>
                          <span>{formatDate(payment.createdAt)}</span>
                        </td>
                        <td>{payment.itemCount}</td>
                        <td>{formatMoney(payment.amountPaid)}</td>
                        <td>
                          <span className={`payment-table__status is-${getStatusTone(payment.paymentTone)}`}>
                            {payment.paymentLabel}
                          </span>
                          <small>{payment.orderStatus ? `Order ${payment.orderStatus}` : "Payment history"}</small>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="orders-empty">
                <h3>No payment records yet</h3>
                <p>
                  When you place and pay for an order, the payment summary and table
                  will appear here.
                </p>
                <Link to="/products" className="orders-empty__button">
                  Start shopping
                </Link>
              </div>
            )}
          </section>
        </>
      )}
    </ProfileSectionShell>
  );
}

export default Payments;
