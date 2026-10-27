import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import electronicsImage from "../../assets/images/electronic-set.png";
import { loadAdminSession } from "./Auth/adminAuthStorage";
import { formatMoney, formatShortDate } from "./adminHelpers";
import { getOrderStatusLabel } from "../Profile/ordersStorage";
import { supabase } from "../../lib/supabaseClient";
import { getShippingAccounting, getShippingPaymentLabel } from "../../shared/shippingPayment";
import {
  getShipmentProgressPercent,
  useShipmentBatches,
} from "../../shared/shipmentStorage";

const STATUS_FILTERS = [
  { key: "all", label: "All orders" },
  { key: "pending", label: "Pending" },
  { key: "processing", label: "Processing" },
  { key: "delivered", label: "Delivered" },
  { key: "cancelled", label: "Cancelled" },
];

const ORDER_TYPE_FILTERS = [
  { key: "all", label: "All" },
  { key: "preorder", label: "Pre-orders" },
  { key: "ready_stock", label: "Ready Stock" },
];

const SHIPMENT_FILTERS = [
  { key: "all", label: "All shipment" },
  { key: "air", label: "Air" },
  { key: "sea", label: "Sea" },
  { key: "both", label: "Both" },
];

const ORDER_STATUS_OPTIONS = [
  { value: "preorder_received", label: "Pre-order Received" },
  { value: "processing", label: "Processing" },
  { value: "shipped", label: "Shipped" },
  { value: "in_transit", label: "In Transit" },
  { value: "arrived_in_ghana", label: "Arrived in Ghana" },
  { value: "shipping_fee_pending", label: "Shipping Fee Pending" },
  { value: "ready_for_delivery", label: "Ready for Delivery" },
  { value: "completed", label: "Completed" },
  { value: "delivered", label: "Delivered" },
  { value: "cancelled", label: "Cancelled" },
];

function normalizeText(value) {
  return String(value ?? "").trim().toLowerCase();
}

function getOrderItemCount(order) {
  return Array.isArray(order?.items)
    ? order.items.reduce((sum, item) => sum + (Number(item.quantity) || 1), 0)
    : 0;
}

function getOrderSearchBlob(order) {
  const items = Array.isArray(order?.items) ? order.items : [];

  return [
    order?.id,
    order?.orderNumber,
    order?.batchNumber,
    order?.customerName,
    order?.customerEmail,
    order?.total,
    order?.status,
    order?.paymentStatus,
    order?.orderType,
    order?.order_type,
    order?.shipmentType,
    ...items.flatMap((item) => [item.name, item.slug, item.brand]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function getOrderStatusValue(order) {
  const status = normalizeText(order?.status);

  if (status === "cancelled" || status === "canceled") {
    return "cancelled";
  }

  if (status === "delivered" || status === "completed") {
    return "delivered";
  }

  if (status === "pending") {
    return "pending";
  }

  if (status === "pending_payment") {
    return "pending";
  }

  if (
    status === "preorder_received" ||
    status === "processing" ||
    status === "shipped" ||
    status === "in_transit" ||
    status === "arrived_in_ghana" ||
    status === "shipping_fee_pending" ||
    status === "ready_for_delivery"
  ) {
    return status;
  }

  return "processing";
}

function getOrderSummaryStatus(order) {
  return getOrderStatusValue(order);
}

function getPaymentStatusLabel(order) {
  return normalizeText(order?.paymentStatus) === "paid" ? "Paid" : "Pending";
}

function getOrderTypeValue(order) {
  return normalizeText(order?.orderType ?? order?.order_type) === "preorder" ? "preorder" : "ready_stock";
}

function getOrderTypeLabel(order) {
  return getOrderTypeValue(order) === "preorder" ? "Pre-Order" : "Ready Stock";
}

function getShipmentType(order) {
  const value = normalizeText(order?.shipmentType);

  if (value === "sea" || value === "sea freight") {
    return "sea";
  }

  if (value === "both") {
    return "both";
  }

  return "air";
}

function formatShipmentLabel(value) {
  switch (value) {
    case "sea":
      return "Sea";
    case "both":
      return "Both";
    default:
      return "Air";
  }
}

function getStatusTone(status) {
  switch (status) {
    case "preorder_received":
    case "shipping_fee_pending":
      return "amber";
    case "ready_for_delivery":
      return "blue";
    case "arrived_in_ghana":
      return "violet";
    case "shipped":
    case "in_transit":
      return "indigo";
    case "completed":
      return "green";
    case "delivered":
      return "green";
    case "processing":
      return "blue";
    case "pending":
      return "amber";
    case "cancelled":
      return "rose";
    default:
      return "slate";
  }
}

function getShipmentTone(shipment) {
  switch (shipment) {
    case "sea":
      return "teal";
    case "both":
      return "violet";
    default:
      return "indigo";
  }
}

function getSelectedOptionsLabel(item = {}) {
  const options = Array.isArray(item.selectedOptions) ? item.selectedOptions : [];

  if (options.length > 0) {
    return options
      .map((option) => {
        const label = option?.label ?? option?.name ?? option?.group ?? "Option";
        const value = option?.value ?? option?.selectedValue ?? option?.option ?? "";
        return value ? `${label}: ${value}` : label;
      })
      .filter(Boolean)
      .join(" • ");
  }

  return item.variant?.label || "";
}

function getItemUnitPrice(item = {}) {
  return Number(item.price ?? item.unitPrice ?? item.unit_price ?? 0) || 0;
}

function getItemQuantity(item = {}) {
  return Math.max(Number(item.quantity) || 1, 1);
}

function getItemSubtotal(item = {}) {
  const storedSubtotal = Number(item.lineSubtotal ?? item.line_subtotal);
  return Number.isFinite(storedSubtotal) && storedSubtotal > 0
    ? storedSubtotal
    : getItemUnitPrice(item) * getItemQuantity(item);
}

function SummaryCard({ label, value, note, tone = "blue" }) {
  return (
    <article className={`admin-orders-stat admin-orders-stat--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

function Pill({ children, tone = "slate" }) {
  return <span className={`admin-orders-pill admin-orders-pill--${tone}`}>{children}</span>;
}

function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="m5 7 5 5 5-5" />
    </svg>
  );
}

function AdminOrdersPage({ orders = [], authUser = null, onUpdateOrderStatus = () => {} }) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [orderTypeFilter, setOrderTypeFilter] = useState("all");
  const [shipmentFilter, setShipmentFilter] = useState("all");
  const [openOrderId, setOpenOrderId] = useState(null);
  const [isFilterMenuOpen, setIsFilterMenuOpen] = useState(false);
  const [statusModalOrderId, setStatusModalOrderId] = useState(null);
  const [statusDraft, setStatusDraft] = useState("processing");
  const [statusSaving, setStatusSaving] = useState(false);
  const [statusError, setStatusError] = useState("");
  const [shippingPaymentOrderId, setShippingPaymentOrderId] = useState(null);
  const [shippingNoticeSaving, setShippingNoticeSaving] = useState(false);
  const [shippingNoticeError, setShippingNoticeError] = useState("");
  const [shippingNoticeSuccess, setShippingNoticeSuccess] = useState("");
  const [paymentNoticeOrderId, setPaymentNoticeOrderId] = useState(null);
  const [paymentNoticeData, setPaymentNoticeData] = useState(null);
  const [paymentNoticeMessage, setPaymentNoticeMessage] = useState("");
  const [paymentNoticeLoading, setPaymentNoticeLoading] = useState(false);
  const [paymentNoticeSaving, setPaymentNoticeSaving] = useState(false);
  const [paymentNoticeError, setPaymentNoticeError] = useState("");
  const [paymentNoticeSuccess, setPaymentNoticeSuccess] = useState("");
  const [paymentNoticeEmailFailed, setPaymentNoticeEmailFailed] = useState(false);
  const [paymentNoticeOverrideRevealed, setPaymentNoticeOverrideRevealed] = useState(false);
  const [paymentNoticeOverride, setPaymentNoticeOverride] = useState(false);
  const [paymentNoticeOverrideReason, setPaymentNoticeOverrideReason] = useState("");

  const session = authUser ?? loadAdminSession();
  const activeStatusOrder = useMemo(
    () => orders.find((order) => order.id === statusModalOrderId) ?? null,
    [orders, statusModalOrderId],
  );
  const activeViewOrder = useMemo(
    () => orders.find((order) => order.id === openOrderId) ?? null,
    [orders, openOrderId],
  );
  const activeShippingOrder = useMemo(
    () => orders.find((order) => order.id === shippingPaymentOrderId) ?? null,
    [orders, shippingPaymentOrderId],
  );
  const activePaymentNoticeOrder = useMemo(
    () => orders.find((order) => order.id === paymentNoticeOrderId) ?? null,
    [orders, paymentNoticeOrderId],
  );
  const paymentNoticeRetryAvailable = Boolean(
    paymentNoticeEmailFailed && paymentNoticeData?.email?.retryAvailable,
  );
  const paymentNoticeOverrideRequired = Boolean(
    paymentNoticeData?.accounting?.outstanding > 0 &&
      paymentNoticeData?.cooldownActive &&
      !paymentNoticeRetryAvailable,
  );
  const paymentNoticeBlockedByOverride = paymentNoticeOverrideRequired && !paymentNoticeOverride;
  const paymentNoticeSubmitDisabled = Boolean(
    paymentNoticeLoading ||
      paymentNoticeSaving ||
      paymentNoticeData?.isCancelled ||
      !paymentNoticeData?.accounting?.outstanding ||
      (Boolean(paymentNoticeSuccess) && !paymentNoticeEmailFailed) ||
      paymentNoticeBlockedByOverride,
  );
  const shippingAccounting = getShippingAccounting(activeShippingOrder ?? {});
  const shippingOrderCancelled = ["cancelled", "canceled"].includes(
    String(activeShippingOrder?.status ?? "").trim().toLowerCase(),
  );
  const shippingNoticeIneligible = Boolean(
    activeShippingOrder
      && (shippingAccounting.outstandingShipping <= 0 || shippingOrderCancelled),
  );
  const hasOpenModal = Boolean(activeViewOrder || activeStatusOrder || activeShippingOrder || activePaymentNoticeOrder);
  const {
    shipmentsByOrderId,
    loading: shipmentsLoading,
    error: shipmentsError,
  } = useShipmentBatches({ orders });

  useEffect(() => {
    if (!hasOpenModal) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        if (activeViewOrder) setOpenOrderId(null);
        if (activeStatusOrder) setStatusModalOrderId(null);
        if (activeShippingOrder) setShippingPaymentOrderId(null);
        if (activePaymentNoticeOrder) setPaymentNoticeOrderId(null);
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeViewOrder, activeStatusOrder, activeShippingOrder, activePaymentNoticeOrder, hasOpenModal]);

  const summary = useMemo(() => {
    const totalOrders = orders.length;
    const pendingOrders = orders.filter((order) => getOrderSummaryStatus(order) === "pending").length;
    const processingOrders = orders.filter((order) => getOrderSummaryStatus(order) === "processing").length;
    const deliveredOrders = orders.filter((order) => {
      const status = getOrderSummaryStatus(order);
      return status === "delivered" || status === "completed";
    }).length;
    const cancelledOrders = orders.filter((order) => getOrderSummaryStatus(order) === "cancelled").length;
    const preorderOrders = orders.filter((order) => getOrderTypeValue(order) === "preorder").length;
    const readyStockOrders = Math.max(totalOrders - preorderOrders, 0);

    return {
      totalOrders,
      pendingOrders,
      processingOrders,
      deliveredOrders,
      cancelledOrders,
      preorderOrders,
      readyStockOrders,
    };
  }, [orders]);

  const filteredOrders = useMemo(() => {
    const search = normalizeText(query);

    return [...orders]
      .sort((left, right) => new Date(right.createdAt ?? 0) - new Date(left.createdAt ?? 0))
        .filter((order) => {
          const orderStatus = getOrderSummaryStatus(order);
          const orderType = getOrderTypeValue(order);
          const shipmentType = getShipmentType(order);

          if (statusFilter !== "all" && orderStatus !== statusFilter) {
            return false;
          }

          if (orderTypeFilter !== "all" && orderType !== orderTypeFilter) {
            return false;
          }

          if (shipmentFilter !== "all" && shipmentType !== shipmentFilter) {
            return false;
          }

        if (!search) {
          return true;
        }

        return getOrderSearchBlob(order).includes(search);
      });
   }, [orders, query, statusFilter, orderTypeFilter, shipmentFilter]);

  const openStatusModal = (order) => {
    setStatusModalOrderId(order.id);
    setStatusDraft(getOrderStatusValue(order));
    setStatusError("");
    setIsFilterMenuOpen(false);
  };

  const closeStatusModal = () => {
    setStatusModalOrderId(null);
    setStatusDraft("processing");
    setStatusSaving(false);
    setStatusError("");
  };

  const closeShippingModal = () => {
    setShippingPaymentOrderId(null);
    setShippingNoticeSaving(false);
    setShippingNoticeError("");
    setShippingNoticeSuccess("");
  };

  const closePaymentNoticeModal = () => {
    setPaymentNoticeOrderId(null);
    setPaymentNoticeData(null);
    setPaymentNoticeMessage("");
    setPaymentNoticeLoading(false);
    setPaymentNoticeSaving(false);
    setPaymentNoticeError("");
    setPaymentNoticeSuccess("");
    setPaymentNoticeEmailFailed(false);
    setPaymentNoticeOverrideRevealed(false);
    setPaymentNoticeOverride(false);
    setPaymentNoticeOverrideReason("");
  };

  const openPaymentNoticeModal = async (order) => {
    if (!order || paymentNoticeLoading || paymentNoticeSaving) {
      return;
    }

    setPaymentNoticeOrderId(order.id);
    setPaymentNoticeData(null);
    setPaymentNoticeMessage("");
    setPaymentNoticeLoading(true);
    setPaymentNoticeError("");
    setPaymentNoticeSuccess("");
    setPaymentNoticeEmailFailed(false);
    setPaymentNoticeOverrideRevealed(false);
    setPaymentNoticeOverride(false);
    setPaymentNoticeOverrideReason("");

    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !sessionData?.session?.access_token) {
        throw new Error(sessionError?.message || "Please sign in again to view this payment balance.");
      }

      const response = await fetch(`/api/admin/order-payment-notice?orderId=${encodeURIComponent(order.id)}`, {
        headers: { Authorization: `Bearer ${sessionData.session.access_token}` },
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result?.ok === false) {
        throw new Error(result?.message || "Unable to load the payment balance.");
      }

      const customerName = result.order?.customerName || "Customer";
      const orderNumber = result.order?.orderNumber || order.orderNumber || order.id;
      const outstanding = result.accounting?.outstanding ?? 0;
      setPaymentNoticeData(result);
      setPaymentNoticeEmailFailed(result.email?.status === "failed");
      setPaymentNoticeMessage(
        `Dear ${customerName},\n\nYour order ${orderNumber} with Nexus Import Hub has an outstanding payment of ${formatMoney(outstanding)}.\n\nKindly complete your payment so we can continue processing your order.\n\nYou can view your order and payment details by logging into your Nexus Import Hub account.\n\nThank you for shopping with Nexus Import Hub.`,
      );
    } catch (error) {
      setPaymentNoticeError(error instanceof Error ? error.message : "Unable to load the payment balance.");
    } finally {
      setPaymentNoticeLoading(false);
    }
  };

  const handleSendPaymentNotice = async () => {
    if (!activePaymentNoticeOrder || paymentNoticeSaving || !paymentNoticeMessage.trim()) {
      return;
    }

    const retryExisting = paymentNoticeEmailFailed && paymentNoticeData?.email?.retryAvailable;
    if (paymentNoticeOverride) {
      if (!paymentNoticeOverrideReason.trim()) {
        setPaymentNoticeError("Enter a reason before overriding the 24-hour reminder cooldown.");
        return;
      }
    }

    const confirmationMessage = retryExisting
      ? "Retry this failed payment reminder email?"
      : paymentNoticeOverride
        ? "Override the 24-hour reminder cooldown and create a new payment reminder?"
        : "Send this payment reminder to the customer?";
    if (!window.confirm(confirmationMessage)) {
      return;
    }

    setPaymentNoticeSaving(true);
    setPaymentNoticeError("");
    setPaymentNoticeSuccess("");

    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !sessionData?.session?.access_token) {
        throw new Error(sessionError?.message || "Please sign in again to send this notice.");
      }

      const response = await fetch("/api/admin/order-payment-notice", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionData.session.access_token}`,
        },
        body: JSON.stringify({
          orderId: activePaymentNoticeOrder.id,
          message: paymentNoticeMessage,
          retryEmail: retryExisting,
          overrideCooldown: paymentNoticeOverride && !retryExisting,
          overrideReason: paymentNoticeOverride && !retryExisting ? paymentNoticeOverrideReason.trim() : "",
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (result?.code === "reminder_queued" || result?.code === "reminder_cooldown") {
        setPaymentNoticeData((current) => ({
          ...current,
          ...result,
          cooldownUntil: result.cooldownUntil ?? current?.cooldownUntil,
          cooldownActive: result.code === "reminder_cooldown" ? true : current?.cooldownActive,
        }));
        setPaymentNoticeError(result.code === "reminder_cooldown" ? result.message : "");
        setPaymentNoticeSuccess(result.code === "reminder_queued" ? result.message : "");
        return;
      }
      if (!response.ok || result?.ok === false) {
        throw new Error(result?.message || "Unable to send the payment notice.");
      }

      setPaymentNoticeData((current) => ({
        ...current,
        ...result,
        email: result.email ?? current?.email,
        reminders: result.reminder
          ? [
              {
                id: result.reminder.id ?? result.notification?.id,
                createdAt: result.reminder.createdAt,
                status: result.email?.status ?? "queued",
                attempts: result.email?.attempts ?? 0,
                retryAvailable: result.email?.retryAvailable ?? false,
                administrator: result.reminder.administrator ?? null,
                overrideReason: result.reminder.overrideReason ?? null,
              },
              ...(current?.reminders ?? []).filter(
                (reminder) => reminder.id !== (result.reminder.id ?? result.notification?.id),
              ),
            ]
          : current?.reminders,
      }));
      const emailFailed = result.email?.status === "failed" || result.email?.ok === false;
      setPaymentNoticeEmailFailed(emailFailed);
      setPaymentNoticeOverrideRevealed(false);
      setPaymentNoticeOverride(false);
      setPaymentNoticeOverrideReason("");
      setPaymentNoticeSuccess(result.message || "Payment notice sent successfully.");
    } catch (error) {
      setPaymentNoticeError(error instanceof Error ? error.message : "Unable to send the payment notice.");
    } finally {
      setPaymentNoticeSaving(false);
    }
  };

  const handleSendShippingNotice = async () => {
    if (!activeShippingOrder || shippingNoticeSaving) {
      return;
    }

    setShippingNoticeSaving(true);
    setShippingNoticeError("");
    setShippingNoticeSuccess("");

    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !sessionData?.session?.access_token) {
        throw new Error(sessionError?.message || "Please sign in again to send this notice.");
      }

      const response = await fetch("/api/admin/shipping-payment-notice", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionData.session.access_token}`,
        },
        body: JSON.stringify({ orderId: activeShippingOrder.id }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result?.ok === false) {
        throw new Error(result?.message || "Unable to send the shipping payment notice.");
      }

      setShippingNoticeSuccess(
        result.email?.ok === false
          ? "In-app notification sent, but email delivery failed."
          : result.message || "Payment notice sent to the customer.",
      );
    } catch (error) {
      setShippingNoticeError(error instanceof Error ? error.message : "Unable to send the shipping payment notice.");
    } finally {
      setShippingNoticeSaving(false);
    }
  };

  const handleApplyStatus = async () => {
    if (!activeStatusOrder) {
      return;
    }

    setStatusSaving(true);
    setStatusError("");

    try {
      const result = await onUpdateOrderStatus(activeStatusOrder.id, statusDraft);

      if (!result?.ok) {
        setStatusError(result?.message || "Unable to update the order status.");
        return;
      }

      closeStatusModal();
    } finally {
      setStatusSaving(false);
    }
  };

  if (!session) {
    return <Navigate to="/admin/login" replace />;
  }

  return (
    <main className="admin-orders-page">
      <section className="admin-orders-shell">
        <header className="admin-orders-header">
          <div className="admin-orders-header__copy">
            <p>Admin section</p>
            <h1>Orders</h1>
            <span>Search, filter, and manage customer orders from one place.</span>
          </div>

        </header>

        <section className="admin-orders-panel">
          {shipmentsLoading ? (
            <p className="admin-orders-toolbar__note">Loading live shipment progress...</p>
          ) : null}
          {shipmentsError ? (
            <p className="admin-orders-toolbar__note">{shipmentsError}</p>
          ) : null}

          <div className="admin-orders-summary">
            <SummaryCard
              label="Total orders"
              value={summary.totalOrders}
              note="All storefront orders tracked in admin."
              tone="indigo"
            />
            <SummaryCard
              label="Pending orders"
              value={summary.pendingOrders}
              note="Orders waiting for a status update."
              tone="amber"
            />
            <SummaryCard
              label="Pre-orders"
              value={summary.preorderOrders}
              note="Orders placed through the preorder flow."
              tone="indigo"
            />
            <SummaryCard
              label="Ready stock"
              value={summary.readyStockOrders}
              note="Orders placed from stocked products."
              tone="blue"
            />
            <SummaryCard
              label="Processing"
              value={summary.processingOrders}
              note="Orders still moving toward delivery."
              tone="blue"
            />
            <SummaryCard
              label="Delivered"
              value={summary.deliveredOrders}
              note="Completed deliveries."
              tone="green"
            />
            <SummaryCard
              label="Cancelled"
              value={summary.cancelledOrders}
              note="Orders cancelled by admins."
              tone="rose"
            />
          </div>

          <div className="admin-orders-toolbar">
            <div className="admin-orders-toolbar__search">
              <label className="admin-orders-search">
                <span>Search orders</span>
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search orders"
                />
              </label>
            </div>

            <div className="admin-orders-toolbar__filters">
              <button
                type="button"
                className="admin-orders-filter-menu__trigger"
                onClick={() => setIsFilterMenuOpen((current) => !current)}
                aria-expanded={isFilterMenuOpen}
              >
                <div className="admin-orders-filter-menu__trigger-copy">
                  <span>Sorted by</span>
                  <strong>Newest first</strong>
                </div>
                <ChevronDownIcon />
              </button>

              {isFilterMenuOpen ? (
                <div className="admin-orders-filter-menu" role="menu" aria-label="Order filters">
                  <div className="admin-orders-filter-group">
                    <span>Order status</span>
                    <div className="admin-orders-filter-set admin-orders-filter-set--menu">
                      {STATUS_FILTERS.map((filter) => (
                        <button
                          key={filter.key}
                          type="button"
                          className={`admin-orders-filter${
                            statusFilter === filter.key ? " is-active" : ""
                          }`}
                          onClick={() => {
                            setStatusFilter(filter.key);
                            setIsFilterMenuOpen(false);
                          }}
                        >
                          {filter.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="admin-orders-filter-group">
                    <span>Order type</span>
                    <div className="admin-orders-filter-set admin-orders-filter-set--menu">
                      {ORDER_TYPE_FILTERS.map((filter) => (
                        <button
                          key={filter.key}
                          type="button"
                          className={`admin-orders-filter${
                            orderTypeFilter === filter.key ? " is-active" : ""
                          }`}
                          onClick={() => {
                            setOrderTypeFilter(filter.key);
                            setIsFilterMenuOpen(false);
                          }}
                        >
                          {filter.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="admin-orders-filter-group">
                    <span>Shipment</span>
                    <div className="admin-orders-filter-set admin-orders-filter-set--menu">
                      {SHIPMENT_FILTERS.map((filter) => (
                        <button
                          key={filter.key}
                          type="button"
                          className={`admin-orders-filter${
                            shipmentFilter === filter.key ? " is-active" : ""
                          }`}
                          onClick={() => {
                            setShipmentFilter(filter.key);
                            setIsFilterMenuOpen(false);
                          }}
                        >
                          {filter.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <button
                    type="button"
                    className="admin-orders-filter-menu__reset"
                    onClick={() => {
                      setStatusFilter("all");
                      setOrderTypeFilter("all");
                      setShipmentFilter("all");
                      setIsFilterMenuOpen(false);
                    }}
                  >
                    Reset filters
                  </button>
                </div>
              ) : null}
            </div>
          </div>

          <div className="admin-orders-table-wrap">
            {filteredOrders.length > 0 ? (
              <table className="admin-orders-table">
                <thead>
                  <tr>
                    <th>Order ID</th>
                    <th>Batch Number</th>
                    <th>Customer Name</th>
                    <th>Items</th>
                    <th>Amount</th>
                    <th>Payment</th>
                    <th>Shipping fee</th>
                    <th>Order Type</th>
                    <th>Shipment</th>
                    <th>Order Status</th>
                    <th>Date</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.map((order) => {
                    const summaryStatus = getOrderSummaryStatus(order);
                    const shipmentType = getShipmentType(order);
                    const shipment = shipmentsByOrderId.get(order.id) ?? null;
                    const orderCount = getOrderItemCount(order);
                    const shippingAccounting = getShippingAccounting(order);

                    return (
                        <tr key={order.id} className="admin-orders-row">
                          <td>
                            <strong>{order.orderNumber ?? order.id}</strong>
                            <small>{order.id}</small>
                          </td>
                          <td>{order.batchNumber ?? "N/A"}</td>
                          <td>
                            <strong>{order.customerName || "Guest checkout"}</strong>
                            <small>{order.customerEmail || "No email captured"}</small>
                          </td>
                            <td>{orderCount}</td>
                            <td>{formatMoney(order.total ?? 0)}</td>
                            <td>
                              <div className="admin-orders-payment-cell">
                                <Pill tone={normalizeText(order.paymentStatus) === "paid" ? "green" : "amber"}>
                                  {getPaymentStatusLabel(order)}
                                </Pill>
                                {normalizeText(order.paymentStatus) !== "paid" && getOrderSummaryStatus(order) !== "cancelled" ? (
                                  <button
                                    type="button"
                                    className="admin-orders-payment-notice-trigger"
                                    onClick={() => openPaymentNoticeModal(order)}
                                  >
                                    Pending Payment
                                  </button>
                                ) : null}
                              </div>
                            </td>
                            <td>
                              <button
                                type="button"
                                className={`admin-orders-shipping-status admin-orders-shipping-status--${shippingAccounting.status}`}
                                onClick={() => {
                                  if (shippingAccounting.status === "unpaid" || shippingAccounting.status === "partial") {
                                    setShippingPaymentOrderId(order.id);
                                    setShippingNoticeError("");
                                    setShippingNoticeSuccess("");
                                  }
                                }}
                                disabled={!['unpaid', 'partial'].includes(shippingAccounting.status)}
                              >
                                {getShippingPaymentLabel(shippingAccounting.status)}
                              </button>
                              {shippingAccounting.outstandingShipping > 0 ? (
                                <small>{formatMoney(shippingAccounting.outstandingShipping)} due</small>
                              ) : null}
                            </td>
                            <td>
                              <Pill tone={getOrderTypeValue(order) === "preorder" ? "amber" : "blue"}>
                                {getOrderTypeLabel(order)}
                              </Pill>
                            </td>
                            <td>
                              <Pill tone={getShipmentTone(shipmentType)}>
                                {formatShipmentLabel(shipmentType)}
                              </Pill>
                            <small>
                              {shipment
                                ? `${shipment.currentStatusLabel} • ${getShipmentProgressPercent(
                                    shipment.currentStep,
                                    shipment.currentStatus,
                                  )}%`
                                : "No shipment yet"}
                            </small>
                          </td>
                          <td>
                            <Pill tone={getStatusTone(summaryStatus)}>
                              {getOrderStatusLabel(summaryStatus)}
                            </Pill>
                          </td>
                          <td>{formatShortDate(order.createdAt)}</td>
                          <td>
                            <div className="admin-orders-actions">
                              <button
                                type="button"
                                className="admin-orders-action-button"
                                onClick={() => setOpenOrderId(order.id)}
                              >
                                View
                              </button>

                              <button
                                type="button"
                                className="admin-orders-action-button admin-orders-action-button--primary"
                                onClick={() => openStatusModal(order)}
                              >
                                Change status
                              </button>
                            </div>
                          </td>
                        </tr>

                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="admin-orders-empty">
                <h2>No orders match your filters</h2>
                <p>
                  Try a different search term, order status, or shipment type to
                  find the records you need.
                </p>
              </div>
            )}
          </div>
        </section>
      </section>

      {activeViewOrder ? (
        <div
          className="admin-orders-view-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-orders-view-modal-title"
        >
          <button
            type="button"
            className="admin-orders-view-modal__scrim"
            aria-label="Close order details"
            onClick={() => setOpenOrderId(null)}
          />

          <section className="admin-orders-view-modal__panel">
            <header className="admin-orders-view-modal__header">
              <div>
                <p>Order Details</p>
                <h2 id="admin-orders-view-modal-title">
                  {activeViewOrder.orderNumber ?? activeViewOrder.id}
                </h2>
                <div className="admin-orders-view-modal__badges">
                  <Pill tone={getOrderTypeValue(activeViewOrder) === "preorder" ? "amber" : "blue"}>
                    {getOrderTypeLabel(activeViewOrder)}
                  </Pill>
                  <span>Batch {activeViewOrder.batchNumber ?? "N/A"}</span>
                </div>
              </div>
              <button
                type="button"
                className="admin-orders-view-modal__close"
                aria-label="Close order details"
                onClick={() => setOpenOrderId(null)}
              >
                ×
              </button>
            </header>

            <div className="admin-orders-view-modal__body">
              <section className="admin-orders-view-modal__section">
                <h3>Items</h3>
                <div className="admin-orders-view-modal__items">
                  {Array.isArray(activeViewOrder.items) && activeViewOrder.items.length > 0 ? (
                    activeViewOrder.items.map((item, index) => (
                      <article className="admin-orders-view-modal__item" key={item.key ?? `${item.name}-${index}`}>
                        <div className="admin-orders-view-modal__image-wrap">
                          <img
                            src={item.image || electronicsImage}
                            alt={item.name || "Ordered product"}
                            onError={(event) => {
                              event.currentTarget.onerror = null;
                              event.currentTarget.src = electronicsImage;
                            }}
                          />
                        </div>
                        <div className="admin-orders-view-modal__item-copy">
                          <strong>{item.name || "Unnamed product"}</strong>
                          {getSelectedOptionsLabel(item) ? (
                            <span>{getSelectedOptionsLabel(item)}</span>
                          ) : null}
                          <small>Quantity: {getItemQuantity(item)}</small>
                        </div>
                        <div className="admin-orders-view-modal__item-prices">
                          <span>Unit Price: {formatMoney(getItemUnitPrice(item))}</span>
                          <strong>Subtotal: {formatMoney(getItemSubtotal(item))}</strong>
                        </div>
                      </article>
                    ))
                  ) : (
                    <p className="admin-orders-view-modal__empty">No line items available for this order.</p>
                  )}
                </div>
              </section>

              <div className="admin-orders-view-modal__columns">
                <section className="admin-orders-view-modal__section">
                  <h3>Customer</h3>
                  <dl className="admin-orders-view-modal__facts">
                    <div><dt>Name</dt><dd>{activeViewOrder.customerName || "Guest checkout"}</dd></div>
                    <div><dt>Email</dt><dd>{activeViewOrder.customerEmail || "No email captured"}</dd></div>
                    {activeViewOrder.shippingAddress?.phoneNumber ? (
                      <div><dt>Phone</dt><dd>{activeViewOrder.shippingAddress.phoneNumber}</dd></div>
                    ) : null}
                  </dl>
                </section>

                <section className="admin-orders-view-modal__section">
                  <h3>Delivery Details</h3>
                  {activeViewOrder.shippingAddress ? (
                    <dl className="admin-orders-view-modal__facts">
                      {activeViewOrder.shippingAddress.addressLabel ? <div><dt>Delivery method</dt><dd>{activeViewOrder.shippingAddress.addressLabel}</dd></div> : null}
                      {activeViewOrder.shippingAddress.region ? <div><dt>Region</dt><dd>{activeViewOrder.shippingAddress.region}</dd></div> : null}
                      {(activeViewOrder.shippingAddress.city || activeViewOrder.shippingAddress.deliveryLocation) ? <div><dt>City / Town</dt><dd>{activeViewOrder.shippingAddress.city || activeViewOrder.shippingAddress.deliveryLocation}</dd></div> : null}
                      {activeViewOrder.shippingAddress.deliveryLocation && activeViewOrder.shippingAddress.deliveryLocation !== activeViewOrder.shippingAddress.city ? <div><dt>Delivery location</dt><dd>{activeViewOrder.shippingAddress.deliveryLocation}</dd></div> : null}
                      {activeViewOrder.shippingAddress.streetAddress || activeViewOrder.shippingAddress.houseNumber || activeViewOrder.shippingAddress.landmark ? (
                        <div><dt>Address / Landmark</dt><dd>{[activeViewOrder.shippingAddress.houseNumber, activeViewOrder.shippingAddress.streetAddress, activeViewOrder.shippingAddress.landmark].filter(Boolean).join(", ")}</dd></div>
                      ) : null}
                      {activeViewOrder.shippingAddress.fullName || activeViewOrder.customerName ? <div><dt>Recipient</dt><dd>{activeViewOrder.shippingAddress.fullName || activeViewOrder.customerName}</dd></div> : null}
                      {activeViewOrder.shippingAddress.phoneNumber ? <div><dt>Phone</dt><dd>{activeViewOrder.shippingAddress.phoneNumber}</dd></div> : null}
                    </dl>
                  ) : (
                    <p className="admin-orders-view-modal__empty">Delivery information not available.</p>
                  )}
                </section>

                <section className="admin-orders-view-modal__section">
                  <h3>Order Information</h3>
                  <dl className="admin-orders-view-modal__facts">
                    <div><dt>Type</dt><dd>{getOrderTypeLabel(activeViewOrder)}</dd></div>
                    <div><dt>Status</dt><dd>{getOrderStatusLabel(getOrderSummaryStatus(activeViewOrder))}</dd></div>
                    <div><dt>Payment</dt><dd>{getPaymentStatusLabel(activeViewOrder)}</dd></div>
                    <div><dt>Shipment</dt><dd>{formatShipmentLabel(getShipmentType(activeViewOrder))}</dd></div>
                    <div><dt>Date</dt><dd>{formatShortDate(activeViewOrder.createdAt)}</dd></div>
                  </dl>
                </section>
              </div>

              <section className="admin-orders-view-modal__total">
                <div><span>Items subtotal</span><strong>{formatMoney(activeViewOrder.subtotal ?? 0)}</strong></div>
                <div><span>Shipping</span><strong>{formatMoney(activeViewOrder.shippingTotal ?? 0)}</strong></div>
                <div className="admin-orders-view-modal__grand-total"><span>Total</span><strong>{formatMoney(activeViewOrder.total ?? 0)}</strong></div>
              </section>
            </div>

            <footer className="admin-orders-view-modal__footer">
              <button
                type="button"
                className="admin-orders-modal__button admin-orders-modal__button--ghost"
                onClick={() => setOpenOrderId(null)}
              >
                Close
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {activeStatusOrder ? (
        <div
          className="admin-orders-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-orders-modal-title"
        >
          <button
            type="button"
            className="admin-orders-modal__scrim"
            aria-label="Close status modal"
            onClick={closeStatusModal}
          />

          <div className="admin-orders-modal__panel">
            <header className="admin-orders-modal__header">
              <div>
                <p>Change order status</p>
                <h2 id="admin-orders-modal-title">
                  {activeStatusOrder.orderNumber ?? activeStatusOrder.id}
                </h2>
                <span>Pick the new status and save the change.</span>
              </div>

              <button
                type="button"
                className="admin-orders-modal__close"
                onClick={closeStatusModal}
              >
                Close
              </button>
            </header>

              <div className="admin-orders-modal__body">
                <div className="admin-orders-modal__current">
                  <span>Current status</span>
                  <Pill tone={getStatusTone(getOrderStatusValue(activeStatusOrder))}>
                    {getOrderStatusLabel(getOrderStatusValue(activeStatusOrder))}
                  </Pill>
                </div>

              {statusError ? <p className="admin-orders-modal__error">{statusError}</p> : null}

              <p className="admin-orders-modal__section-label">Select new status</p>
              <div className="admin-orders-modal__choices" role="radiogroup" aria-label="Order status options">
                {ORDER_STATUS_OPTIONS.map((option) => {
                  const isActive = statusDraft === option.value;

                  return (
                    <label
                      key={option.value}
                      className={`admin-orders-status-option admin-orders-status-option--${option.value}${
                        isActive ? " is-active" : ""
                      }`}
                    >
                      <input
                        type="radio"
                        name="admin-order-status"
                        value={option.value}
                        checked={isActive}
                        onChange={() => setStatusDraft(option.value)}
                      />
                      <strong>{option.label}</strong>
                    </label>
                  );
                })}
              </div>
            </div>

            <footer className="admin-orders-modal__actions">
              <button
                type="button"
                className="admin-orders-modal__button admin-orders-modal__button--ghost"
                onClick={closeStatusModal}
              >
                Cancel
              </button>

              <button
                type="button"
                className="admin-orders-modal__button admin-orders-modal__button--primary"
                onClick={handleApplyStatus}
                disabled={statusSaving}
              >
                {statusSaving ? "Saving..." : "Save status"}
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {activePaymentNoticeOrder ? (
        <div className="admin-orders-modal" role="dialog" aria-modal="true" aria-labelledby="order-payment-modal-title">
          <button
            type="button"
            className="admin-orders-modal__scrim"
            aria-label="Close payment notice modal"
            onClick={closePaymentNoticeModal}
          />
          <div className="admin-orders-modal__panel admin-orders-payment-notice-modal">
            <header className="admin-orders-modal__header">
              <div>
                <p>Pending order payment</p>
                <h2 id="order-payment-modal-title">Send Payment Notice</h2>
                <span>{paymentNoticeData?.order?.orderNumber || activePaymentNoticeOrder.orderNumber || activePaymentNoticeOrder.id}</span>
              </div>
              <button type="button" className="admin-orders-modal__close" onClick={closePaymentNoticeModal}>Close</button>
            </header>
            <div className="admin-orders-modal__body">
              {paymentNoticeLoading ? <p className="admin-orders-modal__section-label">Rechecking the verified payment balance...</p> : null}
              {paymentNoticeData ? (
                <>
                  <div className="admin-orders-payment-notice-summary">
                    <div><span>Customer</span><strong>{paymentNoticeData.order.customerName}</strong></div>
                    <div><span>Email</span><strong>{paymentNoticeData.order.customerEmail}</strong></div>
                    <div><span>Order amount due</span><strong>{formatMoney(paymentNoticeData.accounting.orderAmountDue)}</strong></div>
                    <div><span>Verified order payments</span><strong>{formatMoney(paymentNoticeData.accounting.verifiedOrderPayments)}</strong></div>
                    <div className="is-emphasis"><span>Outstanding balance</span><strong>{formatMoney(paymentNoticeData.accounting.outstanding)}</strong></div>
                    <div><span>Payment status</span><strong>{paymentNoticeData.isCancelled ? "Cancelled" : paymentNoticeData.accounting.paymentStatus === "paid" ? "Paid" : "Pending"}</strong></div>
                  </div>
                  {paymentNoticeData.isCancelled ? <p className="admin-orders-modal__error">This order is cancelled and cannot receive payment reminders.</p> : paymentNoticeData.accounting.outstanding > 0 ? (
                    <label className="admin-orders-payment-notice-message">
                      <span>Reminder message</span>
                      <textarea value={paymentNoticeMessage} onChange={(event) => setPaymentNoticeMessage(event.target.value)} rows={5} />
                    </label>
                  ) : <p className="admin-orders-modal__success">This order has no outstanding order payment.</p>}
                  {paymentNoticeData.accounting.outstanding > 0 ? (
                    <div className="admin-orders-payment-notice-status" aria-live="polite">
                      <div>
                        <span className="admin-orders-modal__section-label">Latest reminder</span>
                        <strong className={`admin-orders-payment-notice-status__badge admin-orders-payment-notice-status__badge--${paymentNoticeData.email?.status || "not-sent"}`}>
                          {paymentNoticeData.email?.status === "sent"
                            ? "Sent"
                            : paymentNoticeData.email?.status === "queued"
                              ? "Queued"
                              : paymentNoticeData.email?.status === "failed"
                                ? "Failed"
                                : paymentNoticeData.notification
                                  ? "Created"
                                  : "Not sent"}
                        </strong>
                      </div>
                      <p>
                        {paymentNoticeData.email?.status === "sent"
                          ? "Email provider accepted the reminder."
                          : paymentNoticeData.email?.status === "queued"
                            ? "Waiting for email delivery."
                            : paymentNoticeData.email?.status === "failed" && paymentNoticeData.email?.retryAvailable
                              ? "Delivery failed; a retry is available."
                              : paymentNoticeData.email?.status === "failed"
                                ? "Delivery failed; retry is unavailable until the cooldown or limit allows it."
                                : paymentNoticeData.notification
                                  ? "Reminder record created; delivery status is unavailable."
                                  : "No reminder has been sent for this balance."}
                      </p>
                    </div>
                  ) : null}
                  {paymentNoticeData.reminders?.[0]?.createdAt ? (
                    <p className="admin-orders-modal__section-label admin-orders-payment-notice-last-reminder">
                      Last reminder: {new Date(paymentNoticeData.reminders[0].createdAt).toLocaleString()}.
                    </p>
                  ) : null}
                  {paymentNoticeData.reminders?.length > 0 ? (
                    <div className="admin-orders-payment-notice-history">
                      <div className="admin-orders-payment-notice-history__heading">
                        <span className="admin-orders-modal__section-label">Reminder history</span>
                        <small>{paymentNoticeData.reminders.length} record{paymentNoticeData.reminders.length === 1 ? "" : "s"}</small>
                      </div>
                      {paymentNoticeData.reminders.slice(0, 5).map((reminder) => (
                        <div key={reminder.id} className="admin-orders-payment-notice-history__row">
                          <div>
                            <strong>{reminder.createdAt ? new Date(reminder.createdAt).toLocaleString() : "Unknown date"}</strong>
                            {reminder.administrator ? <small>By {reminder.administrator}</small> : null}
                            {reminder.overrideReason ? <small>Override: {reminder.overrideReason}</small> : null}
                          </div>
                          <span className={`admin-orders-payment-notice-status__badge admin-orders-payment-notice-status__badge--${reminder.status || "not-sent"}`}>
                            {reminder.status === "sent" ? "Sent" : reminder.status === "queued" ? "Queued" : reminder.status === "failed" ? "Failed" : reminder.status || "Unknown"}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {paymentNoticeData.accounting.outstanding > 0 && paymentNoticeData.cooldownActive && !paymentNoticeData.email?.retryAvailable ? (
                    <div className="admin-orders-payment-notice-override">
                      {!paymentNoticeOverrideRevealed ? (
                        <button type="button" className="admin-orders-payment-notice-override__reveal" onClick={() => setPaymentNoticeOverrideRevealed(true)}>
                          Resend Anyway
                        </button>
                      ) : (
                        <>
                          <label>
                            <input
                              type="checkbox"
                              checked={paymentNoticeOverride}
                              onChange={(event) => {
                                setPaymentNoticeOverride(event.target.checked);
                                if (!event.target.checked) setPaymentNoticeOverrideReason("");
                              }}
                            />
                            <span>Override 24-hour cooldown</span>
                          </label>
                          <input
                            type="text"
                            value={paymentNoticeOverrideReason}
                            onChange={(event) => setPaymentNoticeOverrideReason(event.target.value)}
                            placeholder="Required reason for override"
                            aria-label="Reason for reminder cooldown override"
                          />
                          {!paymentNoticeOverride ? (
                            <small>Select the override option above to enable resending.</small>
                          ) : null}
                        </>
                      )}
                      {paymentNoticeData.cooldownUntil ? (
                        <small>
                          Cooldown active until {new Date(paymentNoticeData.cooldownUntil).toLocaleString()}.
                        </small>
                      ) : null}
                    </div>
                  ) : null}
                </>
              ) : null}
              {paymentNoticeError ? <p className="admin-orders-modal__error">{paymentNoticeError}</p> : null}
              {paymentNoticeSuccess ? <p className="admin-orders-modal__success">{paymentNoticeSuccess}</p> : null}
            </div>
            <footer className="admin-orders-modal__actions">
              <button type="button" className="admin-orders-modal__button admin-orders-modal__button--ghost" onClick={closePaymentNoticeModal}>Cancel</button>
              <button
                type="button"
                className="admin-orders-modal__button admin-orders-modal__button--primary"
                onClick={handleSendPaymentNotice}
                disabled={paymentNoticeSubmitDisabled}
                aria-disabled={paymentNoticeSubmitDisabled}
                title={paymentNoticeBlockedByOverride ? "Select the cooldown override and provide a reason to resend." : undefined}
              >
                <svg className="admin-orders-modal__button-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="m4 4 16 8-16 8 3-8-3-8Zm3.5 8h8.25" />
                </svg>
                <span>{paymentNoticeSaving ? "Sending..." : paymentNoticeRetryAvailable ? "Retry Email" : paymentNoticeBlockedByOverride ? "Enable Override to Resend" : paymentNoticeSuccess ? "Reminder Queued" : "Send Payment Reminder"}</span>
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {activeShippingOrder ? (
        <div className="admin-orders-modal admin-orders-shipping-modal" role="dialog" aria-modal="true" aria-labelledby="shipping-payment-modal-title">
          <button
            type="button"
            className="admin-orders-modal__scrim"
            aria-label="Close shipping payment modal"
            onClick={closeShippingModal}
          />
          <div className="admin-orders-modal__panel admin-orders-shipping-modal__panel">
            <header className="admin-orders-modal__header admin-orders-shipping-modal__header">
              <div className="admin-orders-shipping-modal__title">
                <span className="admin-orders-shipping-modal__icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" focusable="false">
                    <path d="M3.5 7.5h17v10h-17zM6 7.5 8 4.5h8l2 3M7 12h3m4 0h3M7 15h5" />
                  </svg>
                </span>
                <div>
                  <p>Shipping payment</p>
                  <h2 id="shipping-payment-modal-title">Send Shipping Payment Notice</h2>
                  <span>Remind the customer to complete their outstanding shipping payment.</span>
                </div>
              </div>
              <button
                type="button"
                className="admin-orders-modal__close admin-orders-shipping-modal__close"
                onClick={closeShippingModal}
                aria-label="Close shipping payment notice"
              >
                <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                  <path d="m5 5 10 10M15 5 5 15" />
                </svg>
              </button>
            </header>
            <div className="admin-orders-modal__body admin-orders-shipping-modal__body">
              {(() => {
                const accounting = getShippingAccounting(activeShippingOrder);
                const paymentStatus = accounting.outstandingShipping <= 0
                  ? "Paid"
                  : accounting.paidShipping > 0
                    ? "Partially Paid"
                    : "Unpaid";

                return (
                  <>
                    <dl className="admin-orders-shipping-modal__details">
                      <div><dt>Order number</dt><dd>{activeShippingOrder.orderNumber ?? activeShippingOrder.id}</dd></div>
                      <div><dt>Customer</dt><dd>{activeShippingOrder.customerName || "Guest checkout"}</dd></div>
                      <div><dt>Email</dt><dd>{activeShippingOrder.customerEmail || activeShippingOrder.guestEmail || "Not provided"}</dd></div>
                    </dl>
                    <section className="admin-orders-shipping-modal__summary" aria-label="Shipping payment summary">
                      <div><span>Shipping total</span><strong>{formatMoney(accounting.knownShipping)}</strong></div>
                      <div><span>Amount paid</span><strong>{formatMoney(accounting.paidShipping)}</strong></div>
                      <div className="is-due"><span>Balance due</span><strong>{formatMoney(accounting.outstandingShipping)}</strong></div>
                      <div><span>Payment status</span><strong>{paymentStatus}</strong></div>
                    </section>
                  </>
                );
              })()}
              {shippingNoticeIneligible && !shippingNoticeSuccess ? (
                <p className="admin-orders-modal__error">
                  {shippingOrderCancelled
                    ? "Cancelled orders cannot receive shipping payment notices."
                    : "Shipping is already paid or has no outstanding balance."}
                </p>
              ) : null}
              {shippingNoticeError ? <p className="admin-orders-modal__error">{shippingNoticeError}</p> : null}
              {shippingNoticeSuccess ? <p className="admin-orders-modal__success">{shippingNoticeSuccess}</p> : null}
              <p className="admin-orders-shipping-modal__info">
                <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm0-8v4m0-6h.01" /></svg>
                <span>The customer will receive a shipping payment reminder with a secure payment link.</span>
              </p>
            </div>
            <footer className="admin-orders-modal__actions admin-orders-shipping-modal__actions">
              <button type="button" className="admin-orders-modal__button admin-orders-modal__button--ghost" onClick={closeShippingModal}>Cancel</button>
              <button type="button" className="admin-orders-modal__button admin-orders-modal__button--primary" onClick={handleSendShippingNotice} disabled={shippingNoticeSaving || Boolean(shippingNoticeSuccess) || shippingNoticeIneligible}>
                <svg className="admin-orders-modal__button-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="m4 4 16 8-16 8 3-8-3-8Zm3.5 8h8.25" />
                </svg>
                <span>{shippingNoticeSaving ? "Sending..." : shippingNoticeSuccess ? "Notice sent" : "Send Payment Notice"}</span>
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </main>
  );
}

export default AdminOrdersPage;
