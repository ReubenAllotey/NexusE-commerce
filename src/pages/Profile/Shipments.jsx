import { Link } from "react-router-dom";
import ProfileSectionShell from "./ProfileSectionShell";
import { loadSessionUser } from "../register/authStorage";
import { isDeliveredOrder, isInTransitOrder, isOwnedOrder } from "./ordersStorage";
import { SHIPMENT_STEPS, useShipmentBatches } from "../../shared/shipmentStorage";
import ShipmentTrack from "../../shared/ShipmentTrack";

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

function formatMoney(value) {
  return new Intl.NumberFormat("en-GH", {
    style: "currency",
    currency: "GHS",
    currencyDisplay: "symbol",
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  }).format(Number(value) || 0);
}

function getShipmentLabel(order, shipment) {
  if (shipment?.currentStatus) {
    if (shipment.currentStatus === "delivered") {
      return "Delivered";
    }

    if (shipment.currentStatus === "out_for_delivery") {
      return "Out for delivery";
    }

    if (shipment.currentStatus === "arrived_in_ghana") {
      return "Arrived in Ghana";
    }

    if (shipment.currentStatus === "in_transit") {
      return "In transit";
    }
  }

  if (isDeliveredOrder(order)) {
    return "Delivered";
  }

  if (isInTransitOrder(order)) {
    return "In transit";
  }

  return "Preparing";
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

function getEstimatedDeliveryDate(order, shipment) {
  const baseDate = new Date(order?.updatedAt ?? order?.createdAt ?? Date.now());
  const offsetDays = shipment?.currentStatus === "delivered" || isDeliveredOrder(order) ? 0 : 5;
  baseDate.setDate(baseDate.getDate() + offsetDays);
  return baseDate;
}

function Shipments({ orders = [], authUser = null }) {
  const sessionUser = authUser ?? loadSessionUser();

  const visibleOrders = orders
    .filter((order) => {
      return isOwnedOrder(order, sessionUser);
    })
    .slice()
    .sort((a, b) => new Date(b.updatedAt ?? b.createdAt ?? 0) - new Date(a.updatedAt ?? a.createdAt ?? 0));

  const {
    shipments: shipmentSummaries,
    shipmentsByOrderId,
    loading: shipmentsLoading,
    error: shipmentsError,
  } = useShipmentBatches({ orders: visibleOrders });

  const activeShipments = visibleOrders.filter((order) => {
    const shipment = shipmentsByOrderId.get(order.id);
    return shipment ? shipment.currentStatus !== "delivered" : !isDeliveredOrder(order);
  });
  const deliveredShipments = visibleOrders.filter((order) => {
    const shipment = shipmentsByOrderId.get(order.id);
    return shipment ? shipment.currentStatus === "delivered" : isDeliveredOrder(order);
  });
  const totalItems = visibleOrders.reduce(
    (sum, order) =>
      sum +
      (Array.isArray(order.items)
        ? order.items.reduce((lineSum, item) => lineSum + (item.quantity ?? 1), 0)
        : 0),
    0,
  );

  const featuredSummary = shipmentSummaries[0] ?? null;
  const featuredOrder = featuredSummary?.orders?.[0] ?? visibleOrders[0] ?? null;

  const stats = [
    {
      label: "Total Shipments",
      value: visibleOrders.length,
      note: "All tracked orders in your account.",
    },
    {
      label: "In Transit",
      value: activeShipments.length,
      note: "Orders currently moving.",
    },
    {
      label: "Delivered",
      value: deliveredShipments.length,
      note: "Orders completed successfully.",
    },
    {
      label: "Items Tracked",
      value: totalItems,
      note: "Individual units across every shipment.",
    },
  ];

  const getShipmentTimeline = (order) => {
    const summary = shipmentsByOrderId.get(order.id) ?? null;

    if (summary) {
      return summary.stepStates;
    }

    const fallbackIndex = isDeliveredOrder(order)
      ? SHIPMENT_STEPS.length - 1
      : isInTransitOrder(order)
        ? 3
        : 0;

    return SHIPMENT_STEPS.map((step, index) => ({
      ...step,
      state:
        index < fallbackIndex
          ? "done"
          : index === fallbackIndex
            ? "active"
            : "pending",
    }));
  };

  return (
    <ProfileSectionShell
      eyebrow="Delivery"
      title="Shipments"
      description="Follow shipping progress, tracking updates, and expected delivery dates."
    >
      <div className="shipments-stack">
        {shipmentsError ? (
          <div className="shipment-empty">
            <h3>Unable to load shipment progress</h3>
            <p>{shipmentsError}</p>
          </div>
        ) : null}

        {shipmentsLoading ? (
          <div className="shipment-empty">
            <h3>Loading shipment progress</h3>
            <p>We are fetching live shipment updates from Supabase.</p>
          </div>
        ) : null}

        <div className="shipment-stats" aria-label="Shipment summary">
          {stats.map((item) => (
            <article className="shipment-stat" key={item.label}>
              <strong>{item.value}</strong>
              <span>{item.label}</span>
              <small>{item.note}</small>
            </article>
          ))}
        </div>

        <section className="shipment-panel shipment-panel--featured">
          <div className="shipment-panel__header">
            <div>
              <p className="orders-panel__eyebrow">Latest update</p>
              <h2>
                {featuredSummary
                  ? `Batch ${featuredSummary.batchNumber}`
                  : featuredOrder
                    ? `Order ${featuredOrder.orderNumber}`
                    : "No shipments yet"}
              </h2>
            </div>
            {featuredSummary || featuredOrder ? (
              <span>{getShipmentLabel(featuredOrder, featuredSummary)}</span>
            ) : (
              <span>Waiting for your first order</span>
            )}
          </div>

          {featuredSummary || featuredOrder ? (
            <div className="shipment-feature">
              <div className="shipment-feature__progress">
                <div className="shipment-progress__meta">
                  <div>
                    <strong>
                      {featuredSummary?.stepLabel ?? getShipmentLabel(featuredOrder, featuredSummary)}
                    </strong>
                    <span>
                      {featuredSummary?.body ||
                        featuredSummary?.latestEvent?.message ||
                        (getShipmentLabel(featuredOrder, featuredSummary) === "Delivered"
                          ? "Your order has reached the customer."
                          : "Your order is on the move between hubs.")}
                    </span>
                  </div>
                  <strong>
                    {getShipmentProgress(featuredOrder, featuredSummary)}%
                  </strong>
                </div>

                <div className="shipment-progress__track" aria-hidden="true">
                  <span
                    className="shipment-progress__fill"
                    style={{
                      width: `${getShipmentProgress(featuredOrder, featuredSummary)}%`,
                    }}
                  />
                </div>

                <ShipmentTrack
                  stepStates={featuredSummary?.stepStates ?? getShipmentTimeline(featuredOrder)}
                />

                {featuredSummary?.latestEvent ? (
                  <div className="shipment-feature__details">
                    <div>
                      <span>Latest event</span>
                      <strong>{featuredSummary.latestEvent.title}</strong>
                    </div>
                    <div>
                      <span>Event note</span>
                      <strong>{featuredSummary.latestEvent.message || featuredSummary.latestEvent.location}</strong>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="shipment-feature__details">
                <div>
                  <span>Customer</span>
                  <strong>{featuredOrder?.customerName}</strong>
                </div>
                <div>
                  <span>Placed on</span>
                  <strong>{formatDate(featuredOrder?.createdAt)}</strong>
                </div>
                <div>
                  <span>Delivery target</span>
                  <strong>{formatDate(getEstimatedDeliveryDate(featuredOrder, featuredSummary))}</strong>
                </div>
                <div>
                  <span>Order total</span>
                  <strong>{formatMoney(featuredOrder?.total ?? 0)}</strong>
                </div>
              </div>
            </div>
          ) : (
            <div className="shipment-empty">
              <p>No shipment data yet.</p>
              <span>Once you place an order, its tracking details will appear here.</span>
              <Link to="/products" className="shipment-empty__button">
                Shop now
              </Link>
            </div>
          )}
        </section>

        <section className="shipment-panel">
          <div className="shipment-panel__header">
            <div>
              <p className="orders-panel__eyebrow">Tracked orders</p>
              <h2>Shipment list</h2>
            </div>
            <span>{visibleOrders.length} order{visibleOrders.length === 1 ? "" : "s"}</span>
          </div>

          {visibleOrders.length > 0 ? (
            <div className="shipment-cards">
              {visibleOrders.map((order) => {
                const itemCount = Array.isArray(order.items)
                  ? order.items.reduce((sum, item) => sum + (item.quantity ?? 1), 0)
                  : 0;
                const shipment = shipmentsByOrderId.get(order.id) ?? null;

                return (
                  <article className="shipment-card" key={order.id}>
                    <div className="shipment-card__header">
                      <div>
                        <p>{order.orderNumber}</p>
                        <strong>{shipment?.stepLabel ?? getShipmentLabel(order, shipment)}</strong>
                      </div>
                      <span>{getShipmentProgress(order, shipment)}%</span>
                    </div>

                    <div className="shipment-card__bar" aria-hidden="true">
                      <span
                        style={{
                          width: `${getShipmentProgress(order, shipment)}%`,
                        }}
                      />
                    </div>

                    <ShipmentTrack stepStates={shipment?.stepStates ?? getShipmentTimeline(order)} compact />

                    {shipment?.latestEvent ? (
                      <div className="shipment-card__meta">
                        <div style={{ gridColumn: "1 / -1" }}>
                          <span>Latest update</span>
                          <strong>{shipment.latestEvent.title}</strong>
                          <small>{shipment.latestEvent.message || shipment.latestEvent.location}</small>
                        </div>
                      </div>
                    ) : null}

                    <div className="shipment-card__meta">
                      <div>
                        <span>Items</span>
                        <strong>{itemCount}</strong>
                      </div>
                      <div>
                        <span>Updated</span>
                        <strong>{formatDate(shipment?.updatedAt ?? order.updatedAt)}</strong>
                      </div>
                      <div>
                        <span>Target date</span>
                        <strong>{formatDate(getEstimatedDeliveryDate(order, shipment))}</strong>
                      </div>
                    </div>

                    <div className="shipment-card__actions">
                      <Link to="/profile/orders" className="shipment-card__button">
                        View order
                      </Link>
                      <Link to="/profile/notifications" className="shipment-card__link">
                        See notifications
                      </Link>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="shipment-empty">
              <p>No shipments to track yet.</p>
              <span>Orders you place will show up here with live progress.</span>
            </div>
          )}
        </section>
      </div>
    </ProfileSectionShell>
  );
}

export default Shipments;
