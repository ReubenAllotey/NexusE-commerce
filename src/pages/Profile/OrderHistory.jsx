import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import ProfileSectionShell from "./ProfileSectionShell";
import { loadSessionUser } from "../register/authStorage";
import {
  getOrderStatusLabel,
  isDeliveredOrder,
  isInTransitOrder,
  isOwnedOrder,
} from "./ordersStorage";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "delivered", label: "Delivered" },
  { key: "in_transit", label: "In transit" },
];

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

function getOrderItemCount(order) {
  return Array.isArray(order.items)
    ? order.items.reduce((sum, item) => sum + (item.quantity ?? 1), 0)
    : 0;
}

function getCompletionDate(order) {
  return order?.deliveredAt ?? order?.updatedAt ?? order?.createdAt ?? null;
}

function getHistoryStatus(order) {
  const paymentStatus = String(order?.paymentStatus ?? "").toLowerCase();

  if (paymentStatus === "paid" || paymentStatus === "successful") {
    return "Completed";
  }

  if (paymentStatus === "pending" || paymentStatus === "pending_payment") {
    return "Pending payment";
  }

  if (paymentStatus === "failed") {
    return "Failed";
  }

  return getOrderStatusLabel(order?.status);
}

function OrderHistory({ orders = [], authUser = null }) {
  const sessionUser = authUser ?? loadSessionUser();
  const [selectedFilter, setSelectedFilter] = useState("all");
  const [activeOrderId, setActiveOrderId] = useState(null);

  const visibleOrders = orders
    .filter((order) => {
      return isOwnedOrder(order, sessionUser);
    })
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const filteredOrders =
    selectedFilter === "all"
      ? visibleOrders
      : visibleOrders.filter((order) =>
          selectedFilter === "delivered"
            ? isDeliveredOrder(order)
            : isInTransitOrder(order),
        );

  useEffect(() => {
    const firstOrderId = filteredOrders[0]?.id ?? null;

    if (!firstOrderId) {
      setActiveOrderId(null);
      return;
    }

    if (!filteredOrders.some((order) => order.id === activeOrderId)) {
      setActiveOrderId(firstOrderId);
    }
  }, [filteredOrders, activeOrderId]);

  const summary = {
    total: visibleOrders.length,
    delivered: visibleOrders.filter(isDeliveredOrder).length,
    inTransit: visibleOrders.filter(isInTransitOrder).length,
    spent: visibleOrders.reduce(
      (sum, order) => sum + (order.total ?? 0),
      0,
    ),
  };

  const latestCompletedOrder =
    visibleOrders.find((order) => isDeliveredOrder(order)) ?? null;

  return (
    <ProfileSectionShell
      eyebrow="Past purchases"
      title="Order History"
      description="Review completed purchases, archived order details, and previous totals."
    >
      <div className="orders-summary" aria-label="Order history summary">
        <article className="orders-summary__card">
          <span className="orders-summary__label">Total Orders</span>
          <strong className="orders-summary__value">{summary.total}</strong>
          <p className="orders-summary__note">Every order from this account.</p>
        </article>

        <article className="orders-summary__card">
          <span className="orders-summary__label">Delivered</span>
          <strong className="orders-summary__value">{summary.delivered}</strong>
          <p className="orders-summary__note">Completed purchases in your archive.</p>
        </article>

        <article className="orders-summary__card">
          <span className="orders-summary__label">In Transit</span>
          <strong className="orders-summary__value">{summary.inTransit}</strong>
          <p className="orders-summary__note">Orders still moving to delivery.</p>
        </article>

        <article className="orders-summary__card">
          <span className="orders-summary__label">Lifetime Spend</span>
          <strong className="orders-summary__value">
            {formatMoney(summary.spent)}
          </strong>
          <p className="orders-summary__note">Total value across all orders.</p>
        </article>
      </div>

      <section className="orders-panel">
        <div className="orders-panel__header">
          <div>
            <p className="orders-panel__eyebrow">Latest completed order</p>
            <h2>
              {latestCompletedOrder
                ? `Order ${latestCompletedOrder.orderNumber}`
                : "No completed orders yet"}
            </h2>
          </div>

          <span>
            {latestCompletedOrder
              ? formatDate(getCompletionDate(latestCompletedOrder))
              : "Waiting for a delivered purchase"}
          </span>
        </div>

        {latestCompletedOrder ? (
          <article className="orders-card is-active">
            <div className="orders-card__header">
              <div>
                <p>{latestCompletedOrder.orderNumber}</p>
                <strong>
                  {getOrderItemCount(latestCompletedOrder)} item
                  {getOrderItemCount(latestCompletedOrder) === 1 ? "" : "s"} completed
                </strong>
              </div>

              <span className="orders-card__status is-delivered">
                {getOrderStatusLabel(latestCompletedOrder.status)}
              </span>
            </div>

            <div className="orders-card__meta">
              <div>
                <span>Placed</span>
                <strong>{formatDate(latestCompletedOrder.createdAt)}</strong>
              </div>
              <div>
                <span>Delivered</span>
                <strong>{formatDate(latestCompletedOrder.deliveredAt)}</strong>
              </div>
              <div>
                <span>Total</span>
                <strong>{formatMoney(latestCompletedOrder.total ?? 0)}</strong>
              </div>
            </div>

            <div className="orders-card__actions">
              <button
                type="button"
                className="orders-card__button"
                onClick={() =>
                  setActiveOrderId(
                    activeOrderId === latestCompletedOrder.id
                      ? null
                      : latestCompletedOrder.id,
                  )
                }
              >
                {activeOrderId === latestCompletedOrder.id
                  ? "Hide details"
                  : "View details"}
              </button>

              <Link
                to="/profile/orders"
                className="orders-card__button orders-card__button--ghost"
              >
                View live orders
              </Link>
            </div>

            {activeOrderId === latestCompletedOrder.id ? (
              <div className="orders-card__details">
                <div className="orders-card__details-header">
                  <h3>Items in this order</h3>
                  <span>
                    {latestCompletedOrder.items.length} line item
                    {latestCompletedOrder.items.length === 1 ? "" : "s"}
                  </span>
                </div>

                <ul className="orders-items">
                  {(Array.isArray(latestCompletedOrder.items)
                    ? latestCompletedOrder.items
                    : []
                  ).map((item) => (
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
                        {item.variant?.color || item.variant?.size ? (
                          <span>
                            {[item.variant.color, item.variant.size]
                              .filter(Boolean)
                              .join(" / ")}
                          </span>
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
                    <strong>{formatMoney(latestCompletedOrder.subtotal ?? 0)}</strong>
                  </div>
                  <div>
                    <span>Shipping</span>
                    <strong>{formatMoney(latestCompletedOrder.shippingTotal ?? 0)}</strong>
                  </div>
                  <div>
                    <span>Grand total</span>
                    <strong>{formatMoney(latestCompletedOrder.total ?? 0)}</strong>
                  </div>
                </div>
              </div>
            ) : null}
          </article>
        ) : (
          <div className="orders-empty">
            <h3>No completed orders yet</h3>
            <p>
              Once an order is delivered, it will appear here as part of your
              purchase history.
            </p>
          </div>
        )}
      </section>

      <section className="orders-panel">
        <div className="orders-panel__header">
          <div>
            <p className="orders-panel__eyebrow">Archive</p>
            <h2>Browse order history</h2>
          </div>

          <span>
            {filteredOrders.length} record{filteredOrders.length === 1 ? "" : "s"}
          </span>
        </div>

        <div
          className="notifications-filters"
          role="tablist"
          aria-label="Order history filters"
        >
          {FILTERS.map((filter) => {
            const count =
              filter.key === "all"
                ? visibleOrders.length
                : visibleOrders.filter((order) =>
                    filter.key === "delivered"
                      ? isDeliveredOrder(order)
                      : isInTransitOrder(order),
                  ).length;

            return (
              <button
                key={filter.key}
                type="button"
                className={`notifications-filter${
                  selectedFilter === filter.key ? " is-active" : ""
                }`}
                onClick={() => setSelectedFilter(filter.key)}
              >
                {filter.label}
                <span>{count}</span>
              </button>
            );
          })}
        </div>

        {filteredOrders.length > 0 ? (
          <div className="orders-list">
            {filteredOrders.map((order) => {
              const isActive = activeOrderId === order.id;
              const delivered = isDeliveredOrder(order);
              const items = Array.isArray(order.items) ? order.items : [];
              const orderCount = getOrderItemCount(order);
              const completionDate = getCompletionDate(order);

              return (
                <article
                  key={order.id}
                  className={`orders-card${isActive ? " is-active" : ""}`}
                >
                  <div className="orders-card__header">
                    <div>
                      <p>{order.orderNumber}</p>
                      <strong>
                        {orderCount} item{orderCount === 1 ? "" : "s"} purchased on{" "}
                        {formatDate(order.createdAt)}
                      </strong>
                    </div>

                    <span
                      className={`orders-card__status ${
                        delivered ? "is-delivered" : "is-transit"
                      }`}
                    >
                      {getHistoryStatus(order)}
                    </span>
                  </div>

                  <div className="orders-card__meta">
                    <div>
                      <span>Placed</span>
                      <strong>{formatDate(order.createdAt)}</strong>
                    </div>
                    <div>
                      <span>Completed</span>
                      <strong>{formatDate(completionDate)}</strong>
                    </div>
                    <div>
                      <span>Total</span>
                      <strong>{formatMoney(order.total ?? 0)}</strong>
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
                    ) : (
                      <Link
                        to="/profile/notifications"
                        className="orders-card__button orders-card__button--ghost"
                      >
                        See update
                      </Link>
                    )}
                  </div>

                  {isActive ? (
                    <div className="orders-card__details">
                      <div className="orders-card__details-header">
                        <h3>Items in this order</h3>
                        <span>
                          {items.length} line item{items.length === 1 ? "" : "s"}
                        </span>
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
                              {item.variant?.color || item.variant?.size ? (
                                <span>
                                  {[item.variant.color, item.variant.size]
                                    .filter(Boolean)
                                    .join(" / ")}
                                </span>
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
                          <strong>{formatMoney(order.shippingTotal ?? 0)}</strong>
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
            <h3>No orders match this filter</h3>
            <p>
              Try a different filter to browse all purchases, delivered orders,
              or shipments still in progress.
            </p>
          </div>
        )}
      </section>
    </ProfileSectionShell>
  );
}

export default OrderHistory;
