import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import ProfileSectionShell from "./ProfileSectionShell";
import {
  getOrderTypeLabel,
  getOrderStatusLabel,
  isDeliveredOrder,
  isInTransitOrder,
  isPreorderOrder,
  isOwnedOrder,
} from "./ordersStorage";
import {
  getShipmentProgressPercent,
  useShipmentBatches,
} from "../../shared/shipmentStorage";

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

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function formatOrderStatus(status) {
  return getOrderStatusLabel(status);
}

function getShipmentProgress(order, shipment) {
  if (shipment) {
    return shipment.progressPercent ?? 0;
  }

  if (isDeliveredOrder(order)) {
    return 100;
  }

  if (isInTransitOrder(order)) {
    return 68;
  }

  return 34;
}

function getShipmentStatusLabel(order, shipment) {
  if (shipment?.currentStatus === "delivered") {
    return "Delivered";
  }

  if (shipment?.currentStatus === "out_for_delivery") {
    return "Out for delivery";
  }

  if (shipment?.currentStatus === "arrived_in_ghana") {
    return "Arrived in Ghana";
  }

  if (shipment?.currentStatus === "in_transit") {
    return "In transit";
  }

  if (shipment?.currentStatus === "shipped_from_china") {
    return "Shipped from China";
  }

  if (shipment?.currentStatus === "preparing") {
    return "Preparing";
  }

  if (isDeliveredOrder(order)) {
    return "Delivered";
  }

  if (isInTransitOrder(order)) {
    return "In transit";
  }

  return "Preparing";
}

function MyOrders({
  orders = [],
  authUser = null,
}) {
  const [activeOrderId, setActiveOrderId] = useState(null);

  const visibleOrders = orders.filter((order) => isOwnedOrder(order, authUser));

  useEffect(() => {
    const firstOrderId = visibleOrders[0]?.id ?? null;

    if (!firstOrderId) {
      setActiveOrderId(null);
      return;
    }

    if (!visibleOrders.some((order) => order.id === activeOrderId)) {
      setActiveOrderId(firstOrderId);
    }
  }, [visibleOrders, activeOrderId]);

  const {
    shipmentsByOrderId,
    loading: shipmentsLoading,
    error: shipmentsError,
  } = useShipmentBatches({ orders: visibleOrders });

  const summary = {
    total: visibleOrders.length,
    inTransit: visibleOrders.filter(isInTransitOrder).length,
    delivered: visibleOrders.filter(isDeliveredOrder).length,
  };

  return (
    <ProfileSectionShell
      eyebrow="Orders"
      title="My Orders"
      description="View and track all your orders."
    >
      <div className="orders-summary" aria-label="Order summary">
        <article className="orders-summary__card">
          <span className="orders-summary__label">Total Orders</span>
          <strong className="orders-summary__value">{summary.total}</strong>
          <p className="orders-summary__note">All orders placed from this account.</p>
        </article>

        <article className="orders-summary__card">
          <span className="orders-summary__label">In Transit</span>
          <strong className="orders-summary__value">{summary.inTransit}</strong>
          <p className="orders-summary__note">Orders that are on the way.</p>
        </article>

        <article className="orders-summary__card">
          <span className="orders-summary__label">Delivered</span>
          <strong className="orders-summary__value">{summary.delivered}</strong>
          <p className="orders-summary__note">Orders marked as complete.</p>
        </article>
      </div>

      {shipmentsLoading ? (
        <p className="orders-panel__eyebrow">Loading live shipment updates...</p>
      ) : null}
      {shipmentsError ? (
        <p className="orders-panel__eyebrow">{shipmentsError}</p>
      ) : null}

      <section className="orders-panel">
        <div className="orders-panel__header">
          <div>
            <p className="orders-panel__eyebrow">Order history</p>
            <h2>Recent orders</h2>
          </div>
          <span>{summary.total} record{summary.total === 1 ? "" : "s"}</span>
        </div>

        {visibleOrders.length > 0 ? (
          <div className="orders-list">
            {visibleOrders.map((order) => {
              const isActive = activeOrderId === order.id;
              const delivered = isDeliveredOrder(order);
              const preorder = isPreorderOrder(order);
              const items = Array.isArray(order.items) ? order.items : [];
              const orderCount = items.reduce(
                (sum, item) => sum + (item.quantity ?? 1),
                0,
              );
              const shipment = shipmentsByOrderId.get(order.id) ?? null;
              const shipmentLabel = getShipmentStatusLabel(order, shipment);
              const shipmentProgress = shipment
                ? getShipmentProgressPercent(
                    shipment.currentStep ?? 0,
                    shipment.currentStatus ?? "",
                  )
                : getShipmentProgress(order, shipment);

              return (
                <article
                  key={order.id}
                  className={`orders-card${isActive ? " is-active" : ""}`}
                >
                  <div className="orders-card__header">
                    <div>
                      <p>{order.orderNumber}</p>
                      <strong>
                        {orderCount} item{orderCount === 1 ? "" : "s"} placed on{" "}
                        {formatDate(order.createdAt)}
                      </strong>
                    </div>

                    <span
                      className={`orders-card__status ${
                        delivered ? "is-delivered" : "is-transit"
                      }`}
                    >
                      {formatOrderStatus(order.status)}
                    </span>
                    <span className={`orders-card__type${preorder ? " is-preorder" : ""}`}>
                      {getOrderTypeLabel(order)}
                    </span>
                  </div>

                  <div className="orders-card__meta">
                    <div>
                      <span>Customer</span>
                      <strong>{order.customerName}</strong>
                    </div>
                    <div>
                      <span>Total</span>
                      <strong>{formatMoney(order.total ?? 0)}</strong>
                    </div>
                    <div>
                      <span>Updated</span>
                      <strong>{formatDate(order.updatedAt)}</strong>
                    </div>
                    <div>
                      <span>Shipment</span>
                      <strong>{shipment?.stepLabel ?? shipmentLabel}</strong>
                    </div>
                    <div>
                      <span>Order type</span>
                      <strong>{getOrderTypeLabel(order)}</strong>
                    </div>
                    <div>
                      <span>Tracking</span>
                      <strong>{shipmentProgress}%</strong>
                    </div>
                  </div>

                  <div className="orders-card__actions">
                    <button
                      type="button"
                      className="orders-card__button"
                      onClick={() =>
                        setActiveOrderId(isActive ? null : order.id)
                      }
                    >
                      {isActive ? "Hide details" : "View details"}
                    </button>

                    {!delivered ? (
                      <Link
                        to="/profile/shipments"
                        className="orders-card__button orders-card__button--ghost"
                      >
                        Track shipment
                      </Link>
                    ) : null}
                  </div>

                  {shipment?.latestEvent ? (
                    <div className="orders-card__details">
                      <div className="orders-card__details-header">
                        <h3>Latest shipment update</h3>
                        <span>{shipment.latestEvent.title}</span>
                      </div>
                      <p>{shipment.latestEvent.message || shipment.latestEvent.location}</p>
                    </div>
                  ) : null}

                  {isActive ? (
                    <div className="orders-card__details">
                      <div className="orders-card__details-header">
                        <h3>Items in this order</h3>
                        <span>{order.items.length} line item{order.items.length === 1 ? "" : "s"}</span>
                      </div>

                      <ul className="orders-items">
                        {items.map((item) => (
                          <li className="orders-item" key={item.key}>
                            <div className="orders-item__media">
                              <img
                                src={item.image}
                                alt={item.name}
                                className={item.imageClassName ?? ""}
                              />
                            </div>

                            <div className="orders-item__details">
                              <strong>{item.name}</strong>
                              <span>{item.brand}</span>
                              {item.variant?.label || item.variant?.color || item.variant?.size ? (
                                <span>
                                  {item.variant.label ||
                                    [item.variant.color, item.variant.size]
                                      .filter(Boolean)
                                      .join(" / ")}
                                </span>
                              ) : null}
                              {preorder && item.estimatedArrival ? (
                                <span>Estimated arrival {item.estimatedArrival}</span>
                              ) : null}
                              <span>Qty {item.quantity}</span>
                            </div>

                            <div className="orders-item__price">
                              <strong>{formatMoney(item.lineSubtotal)}</strong>
                              <span>Shipping {formatMoney(item.lineShipping)}</span>
                            </div>
                          </li>
                        ))}
                      </ul>

                      <div className="orders-card__totals">
                        <div>
                          <span>Subtotal</span>
                          <strong>{formatMoney(order.subtotal ?? 0)}</strong>
                        </div>
                        <div>
                          <span>Shipping</span>
                          <strong>{preorder ? "To be confirmed" : formatMoney(order.shippingTotal ?? 0)}</strong>
                        </div>
                        <div>
                          <span>Estimated arrival</span>
                          <strong>{order.estimatedArrival || "To be confirmed"}</strong>
                        </div>
                        <div>
                          <span>Grand total</span>
                          <strong>{formatMoney(order.total ?? 0)}</strong>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        ) : (
          <div className="orders-empty">
            <h3>No orders yet</h3>
            <p>
              Place your first order and it will appear here with live tracking
              details.
            </p>
            <Link to="/products" className="orders-empty__button">
              Start shopping
            </Link>
          </div>
        )}
      </section>
    </ProfileSectionShell>
  );
}

export default MyOrders;
