import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { loadPaymentReceipt, loadPaymentSession, formatGhanaCedis, getMobileNetworkLabel, getPaymentMethodLabel } from "../payment/paymentStorage";
import {
  getShipmentProgressPercent,
  getShipmentStepLabel,
  loadShipmentForOrder,
} from "../../shared/shipmentStorage";

function formatDate(value) {
  if (!value) {
    return "Recently";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Recently";
  }

  return new Intl.DateTimeFormat("en-GH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function buildReceiptText(receipt) {
  const lines = [
    "Nexus Imports Receipt",
    `Order Number: ${receipt.orderNumber}`,
    `Payment Reference: ${receipt.paymentReference}`,
    `Payment Method: ${receipt.paymentNetwork ? getMobileNetworkLabel(receipt.paymentNetwork) : getPaymentMethodLabel(receipt.paymentMethod)}`,
    `Payment Status: ${receipt.paymentStatus}`,
    `Amount Paid: ${formatGhanaCedis(receipt.amountPaid)}`,
    `Order Status: ${receipt.orderStatus}`,
    `Created: ${formatDate(receipt.createdAt)}`,
    "",
    "Items:",
    ...(Array.isArray(receipt.items)
      ? receipt.items.map(
          (item) =>
            `- ${item.name} x${item.quantity ?? 1} ${formatGhanaCedis((Number(item.lineSubtotal) || 0) + (Number(item.lineShipping) || 0))}`,
        )
      : []),
  ];

  if (receipt.shipment) {
    lines.push(
      "",
      "Shipment:",
      `- Batch Number: ${receipt.shipment.batchNumber}`,
      `- Step: ${receipt.shipment.stepLabel || getShipmentStepLabel(receipt.shipment.currentStep ?? 0)}`,
      `- Progress: ${getShipmentProgressPercent(receipt.shipment.currentStep ?? 0, receipt.shipment.currentStatus ?? "")}%`,
      `- Status: ${receipt.shipment.currentStatusLabel}`,
    );
  }

  return lines.join("\n");
}

function buildSessionReceipt(session = {}) {
  if (!session || typeof session !== "object") {
    return null;
  }

  const items = Array.isArray(session.cartRows)
    ? session.cartRows.map((row) => ({
        key: row.key ?? row.product?.slug ?? row.product?.name,
        name: row.product?.name ?? "Unnamed product",
        quantity: row.quantity ?? 1,
        lineSubtotal: Number(row.lineSubtotal) || 0,
        lineShipping: Number(row.lineShipping) || 0,
      }))
    : [];

  if (!session.paymentReference && items.length === 0) {
    return null;
  }

  return {
    paymentReference: session.paymentReference ?? "PAY-PENDING",
    orderNumber: session.orderNumber ?? "ORD-PENDING",
    paymentMethod: session.paymentMethod ?? "mobile-money",
    paymentNetwork: session.paymentNetwork ?? "",
    paymentPhoneNumber: session.paymentPhoneNumber ?? "",
    paymentStatus: session.status === "successful" ? "Successful" : session.status === "failed" ? "Failed" : "Pending",
    amountPaid: Number(session.amount ?? session.totals?.totalPrice ?? 0),
    orderStatus: session.status === "successful" ? "processing" : session.status === "failed" ? "cancelled" : "pending",
    items,
    createdAt: session.createdAt ?? new Date().toISOString(),
  };
}

function ReceiptLoading() {
  return (
    <main className="receipt-page">
      <div className="receipt-shell">
        <section className="shipping-empty">
          <h1>Loading receipt...</h1>
          <p>We are fetching the payment, order, and order items from Supabase.</p>
        </section>
      </div>
    </main>
  );
}

function ReceiptEmpty({ message = "We could not find a saved receipt for this payment." }) {
  return (
    <main className="receipt-page">
      <div className="receipt-shell">
        <section className="shipping-empty">
          <h1>Receipt not found</h1>
          <p>{message}</p>
          <div className="shipping-empty__actions">
            <Link to="/profile/payments" className="shipping-empty__button">
              View payments
            </Link>
            <Link to="/products" className="shipping-empty__button shipping-empty__button--ghost">
              Continue shopping
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}

function Receipt() {
  const params = useParams();
  const [authUser, setAuthUser] = useState(null);
  const session = useMemo(() => loadPaymentSession(authUser?.id ?? ""), [authUser?.id]);
  const receiptReference = params.reference ?? session?.paymentReference ?? "";
  const [receiptState, setReceiptState] = useState({
    loading: Boolean(receiptReference),
    error: "",
    receipt: null,
  });
  const [shipmentState, setShipmentState] = useState({
    loading: false,
    error: "",
    shipment: null,
  });

  useEffect(() => {
    let active = true;

    const restoreAuthUser = async () => {
      const { data, error } = await supabase.auth.getSession();

      if (!active) {
        return;
      }

      if (error || !data?.session?.user) {
        setAuthUser(null);
        return;
      }

      setAuthUser({
        id: data.session.user.id,
        email: data.session.user.email ?? "",
      });
    };

    void restoreAuthUser();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    if (!receiptReference) {
      setReceiptState({
        loading: false,
        error: "",
        receipt: null,
      });
      return () => {
        active = false;
      };
    }

    setReceiptState({
      loading: true,
      error: "",
      receipt: null,
    });

    const loadReceipt = async () => {
      const result = await loadPaymentReceipt(receiptReference, { authUser });

      if (!active) {
        return;
      }

      if (result.ok) {
        setReceiptState({
          loading: false,
          error: "",
          receipt: result.receipt ?? null,
        });
        return;
      }

      const fallbackReceipt = buildSessionReceipt(session);

      if (fallbackReceipt) {
        setReceiptState({
          loading: false,
          error: "",
          receipt: fallbackReceipt,
        });
        return;
      }

      setReceiptState({
        loading: false,
        error: result.message || "Unable to load the receipt right now.",
        receipt: null,
      });
    };

    void loadReceipt();

    return () => {
      active = false;
    };
  }, [authUser, receiptReference, session]);

  useEffect(() => {
    let active = true;
    const orderId = receiptState.receipt?.orderId ?? "";

    if (!orderId) {
      setShipmentState({
        loading: false,
        error: "",
        shipment: null,
      });
      return () => {
        active = false;
      };
    }

    setShipmentState({
      loading: true,
      error: "",
      shipment: null,
    });

    const loadShipment = async () => {
      const result = await loadShipmentForOrder(orderId);

      if (!active) {
        return;
      }

      if (result.ok) {
        setShipmentState({
          loading: false,
          error: "",
          shipment: result.shipment ?? null,
        });
        return;
      }

      setShipmentState({
        loading: false,
        error: result.message || "Unable to load shipment progress right now.",
        shipment: null,
      });
    };

    void loadShipment();

    return () => {
      active = false;
    };
  }, [receiptState.receipt?.orderId]);

  const handleDownload = () => {
    if (!receiptState.receipt || typeof window === "undefined") {
      return;
    }

    const blob = new Blob([buildReceiptText(receiptRecord)], { type: "text/plain;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `${receiptRecord.orderNumber || "receipt"}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  };

  if (receiptState.loading) {
    return <ReceiptLoading />;
  }

  if (receiptState.error) {
    return <ReceiptEmpty message={receiptState.error} />;
  }

  if (!receiptState.receipt) {
    return <ReceiptEmpty />;
  }

  const record = receiptState.receipt;
  const liveShipment = shipmentState.shipment;
  const receiptRecord = liveShipment ? { ...record, shipment: liveShipment } : record;

  return (
    <main className="receipt-page">
      <div className="receipt-shell">
        <header className="receipt-header">
          <div>
            <p>Payment receipt</p>
            <h1>Receipt</h1>
          </div>

          <div className="receipt-header__meta">
            <span>{formatDate(record.createdAt)}</span>
            <strong>{formatGhanaCedis(record.amountPaid)}</strong>
          </div>
        </header>

        <section className="receipt-card">
          <div className="receipt-card__summary">
            <div>
              <span>Order Number</span>
              <strong>{record.orderNumber}</strong>
            </div>
            <div>
              <span>Payment Reference</span>
              <strong>{record.paymentReference}</strong>
            </div>
            <div>
              <span>Payment Method</span>
              <strong>
                {record.paymentNetwork
                  ? getMobileNetworkLabel(record.paymentNetwork)
                  : getPaymentMethodLabel(record.paymentMethod)}
              </strong>
            </div>
            <div>
              <span>Payment Status</span>
              <strong>{record.paymentStatus}</strong>
            </div>
          </div>

          {shipmentState.loading ? (
            <p className="receipt-card__note">Loading live shipment status...</p>
          ) : null}

          {shipmentState.error ? (
            <p className="receipt-card__note">{shipmentState.error}</p>
          ) : null}

          {liveShipment ? (
            <div className="receipt-card__summary">
              <div>
                <span>Shipment Batch</span>
                <strong>{liveShipment.batchNumber}</strong>
              </div>
              <div>
                <span>Shipment Step</span>
                <strong>{liveShipment.stepLabel || getShipmentStepLabel(liveShipment.currentStep ?? 0)}</strong>
              </div>
              <div>
                <span>Shipment Progress</span>
                <strong>
                  {getShipmentProgressPercent(
                    liveShipment.currentStep ?? 0,
                    liveShipment.currentStatus ?? "",
                  )}
                  %
                </strong>
              </div>
              <div>
                <span>Shipment Status</span>
                <strong>{liveShipment.currentStatusLabel}</strong>
              </div>
            </div>
          ) : null}

          <div className="receipt-card__body">
            <div className="receipt-card__items">
              <h2>Items</h2>
              {Array.isArray(record.items) && record.items.length > 0 ? (
                <ul>
                  {record.items.map((item) => (
                    <li key={item.key ?? `${item.name}-${item.quantity}`}>
                      <strong>{item.name}</strong>
                      <span>
                        {item.quantity ?? 1} x{" "}
                        {formatGhanaCedis((Number(item.lineSubtotal) || 0) + (Number(item.lineShipping) || 0))}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No item details were saved with this receipt.</p>
              )}
            </div>

            <div className="receipt-card__totals">
              <span>Total Paid</span>
              <strong>{formatGhanaCedis(record.amountPaid)}</strong>
            </div>
          </div>

          <div className="receipt-card__actions">
            <button type="button" className="payment-button payment-button--primary" onClick={handleDownload}>
              Download Receipt
            </button>
            <Link to="/profile/orders" className="payment-button payment-button--ghost">
              View Order
            </Link>
            <Link to="/products" className="payment-button payment-button--ghost">
              Continue Shopping
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}

export default Receipt;
