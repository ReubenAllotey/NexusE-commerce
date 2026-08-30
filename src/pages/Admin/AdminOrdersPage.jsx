import { Fragment, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { loadAdminSession } from "./Auth/adminAuthStorage";
import { formatMoney, formatShortDate } from "./adminHelpers";
import { getOrderStatusLabel } from "../Profile/ordersStorage";
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

  const session = authUser ?? loadAdminSession();
  const activeStatusOrder = useMemo(
    () => orders.find((order) => order.id === statusModalOrderId) ?? null,
    [orders, statusModalOrderId],
  );
  const {
    shipmentsByOrderId,
    loading: shipmentsLoading,
    error: shipmentsError,
  } = useShipmentBatches({ orders });

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

          <div className="admin-orders-header__actions">
            <Link to="/admin/dashboard" className="admin-orders-header__button">
              Go back to dashboard
            </Link>
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
                    const isExpanded = openOrderId === order.id;
                    const orderCount = getOrderItemCount(order);
                    const items = Array.isArray(order.items) ? order.items : [];

                    return (
                      <Fragment key={order.id}>
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
                              <Pill tone={normalizeText(order.paymentStatus) === "paid" ? "green" : "amber"}>
                                {getPaymentStatusLabel(order)}
                              </Pill>
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
                                {shipment?.stepLabel ?? "No live shipment row yet"}
                            </small>
                            <small>
                              {shipment
                                ? `${shipment.currentStatusLabel} • ${getShipmentProgressPercent(
                                    shipment.currentStep,
                                    shipment.currentStatus,
                                  )}%`
                                : "No live shipment row yet"}
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
                                onClick={() =>
                                  setOpenOrderId(isExpanded ? null : order.id)
                                }
                              >
                                {isExpanded ? "Hide" : "View"}
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

                        {isExpanded ? (
                          <tr className="admin-orders-details-row">
                            <td colSpan={11}>
                              <div className="admin-orders-details">
                                <div className="admin-orders-details__summary">
                                  <div>
                                    <span>Batch number</span>
                                    <strong>{order.batchNumber ?? "N/A"}</strong>
                                  </div>
                                  <div>
                                    <span>Status</span>
                                    <strong>
                                      <Pill tone={getStatusTone(summaryStatus)}>
                                        {getOrderStatusLabel(summaryStatus)}
                                      </Pill>
                                    </strong>
                                  </div>
                                  <div>
                                    <span>Shipment</span>
                                    <strong>
                                      <Pill tone={getShipmentTone(shipmentType)}>
                                        {formatShipmentLabel(shipmentType)}
                                      </Pill>
                                    </strong>
                                  </div>
                                  <div>
                                    <span>Order type</span>
                                    <strong>
                                      <Pill tone={getOrderTypeValue(order) === "preorder" ? "amber" : "blue"}>
                                        {getOrderTypeLabel(order)}
                                      </Pill>
                                    </strong>
                                  </div>
                                  <div>
                                    <span>Tracking step</span>
                                    <strong>
                                      {shipment?.stepLabel ?? "No live shipment row yet"}
                                    </strong>
                                  </div>
                                  <div>
                                    <span>Shipment progress</span>
                                    <strong>
                                      {shipment
                                        ? `${getShipmentProgressPercent(
                                            shipment.currentStep,
                                            shipment.currentStatus,
                                          )}%`
                                        : "0%"}
                                    </strong>
                                  </div>
                                  <div>
                                    <span>Payment</span>
                                    <strong>{getPaymentStatusLabel(order)}</strong>
                                  </div>
                                  <div>
                                    <span>Updated</span>
                                    <strong>{formatShortDate(order.updatedAt ?? order.createdAt)}</strong>
                                  </div>
                                </div>

                                {shipment?.latestEvent ? (
                                  <div className="admin-orders-details__items">
                                    <article className="admin-orders-item">
                                      <div>
                                        <strong>Latest shipment update</strong>
                                        <span>{shipment.latestEvent.title}</span>
                                      </div>
                                      <div>
                                        <strong>{formatShortDate(shipment.latestEvent.eventAt)}</strong>
                                        <span>{shipment.latestEvent.message || shipment.latestEvent.location}</span>
                                      </div>
                                    </article>
                                  </div>
                                ) : null}

                                <div className="admin-orders-details__items">
                                  {items.length > 0 ? (
                                    items.map((item) => (
                                      <article key={item.key} className="admin-orders-item">
                                        <div>
                                          <strong>{item.name}</strong>
                                          <span>{item.brand || "Store item"}</span>
                                        </div>
                                        <div>
                                          <strong>Qty {item.quantity}</strong>
                                          <span>{formatMoney(item.lineSubtotal ?? 0)}</span>
                                        </div>
                                      </article>
                                    ))
                                  ) : (
                                    <p>No line items available for this order.</p>
                                  )}
                                </div>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
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
    </main>
  );
}

export default AdminOrdersPage;
