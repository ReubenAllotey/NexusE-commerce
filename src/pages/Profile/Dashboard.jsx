import { Link } from "react-router-dom";
import ProfileSectionShell from "./ProfileSectionShell";
import { getNotificationsForUser } from "./notificationsStorage";
import { isOwnedOrder } from "./ordersStorage";
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

function formatOrderStatus(status) {
  if (status === "delivered") {
    return "Delivered";
  }

  return "In transit";
}

function Dashboard({
  orders = [],
  notifications = [],
  notificationsLoading = false,
  notificationsError = "",
  authUser = null,
}) {
  const sessionUser = authUser;
  const visibleOrders = sessionUser
    ? orders
        .filter((order) => isOwnedOrder(order, sessionUser))
        .slice()
        .sort(
          (a, b) =>
            new Date(b.updatedAt ?? b.createdAt ?? 0) -
            new Date(a.updatedAt ?? a.createdAt ?? 0),
        )
    : [];
  const visibleNotifications = getNotificationsForUser(notifications, sessionUser);
  const { primaryShipment: activeShipment } = useShipmentBatches({
    orders: visibleOrders,
  });
  const hasShipmentTracking = Boolean(activeShipment);

  const activeOrders = visibleOrders.filter(
    (order) => order.status !== "delivered",
  ).length;
  const shipments = activeShipment ? 1 : 0;
  const paymentCount = visibleOrders.length;
  const recentOrders = visibleOrders.slice(0, 3);
  const recentNotifications = visibleNotifications.slice(0, 3);
  const latestOrder = visibleOrders[0] ?? null;
  const currentMilestone = activeShipment
    ? `${activeShipment.batchNumber} · ${activeShipment.stepLabel}`
    : "Awaiting your first tracked shipment";
  const shipmentSteps =
    activeShipment?.stepStates ??
    SHIPMENT_STEPS.map((step) => ({
      ...step,
      state: "pending",
    }));

  const stats = [
    {
      label: "Active Orders",
      value: activeOrders,
      to: "/profile/orders",
      note: "Orders still being processed or shipped.",
    },
    {
      label: "Shipments",
      value: shipments,
      to: "/profile/shipments",
      note: "Packages currently in transit.",
    },
    {
      label: "Notifications",
      value: notificationsLoading ? "..." : visibleNotifications.length,
      to: "/profile/notifications",
      note: "Recent order and admin updates.",
    },
    {
      label: "Payments",
      value: paymentCount,
      to: "/profile/payments",
      note: "Completed payments tied to your orders.",
    },
  ];

  return (
    <ProfileSectionShell
      eyebrow="Account overview"
      title={`Welcome ${sessionUser?.name || "Reuben"}`}
      description="A quick snapshot of your orders, delivery status, notifications, and account actions."
    >
      <div className="dashboard-stack">
        <div className="dashboard-stats" aria-label="Account summary">
          {stats.map((item) => (
            <Link key={item.label} to={item.to} className="dashboard-stat">
              <strong>{item.value}</strong>
              <span>{item.label}</span>
              <small>{item.note}</small>
            </Link>
          ))}
        </div>

        <section className="dashboard-panel">
          <div className="dashboard-panel__header">
            <h2>Current Shipment Progress</h2>
            <Link to="/profile/shipments">View tracking</Link>
          </div>

          {hasShipmentTracking ? (
            <div className="dashboard-progress" aria-label="Shipment progress">
              <div className="dashboard-progress__meta">
                <div>
                  <strong>{currentMilestone}</strong>
                  <span>Your latest admin-tracked shipment is being shown here.</span>
                </div>
              </div>

              <ShipmentTrack stepStates={shipmentSteps} />
            </div>
          ) : (
            <div className="dashboard-empty">
              <p>No shipment tracking yet.</p>
              <span>Your shipment progress will appear here once the admin creates a tracking batch.</span>
            </div>
          )}
        </section>

        <div className="dashboard-grid">
          <section className="dashboard-panel">
            <div className="dashboard-panel__header">
              <h2>Recent Notifications</h2>
              <Link to="/profile/notifications">View All</Link>
            </div>

            {notificationsLoading ? (
              <div className="dashboard-empty">
                <p>Loading notifications...</p>
                <span>We are syncing your inbox from Supabase.</span>
              </div>
            ) : notificationsError ? (
              <div className="dashboard-empty">
                <p>Unable to load notifications.</p>
                <span>{notificationsError}</span>
              </div>
            ) : recentNotifications.length > 0 ? (
              <ul className="dashboard-list">
                {recentNotifications.map((item) => (
                  <li key={item.id}>
                    <strong>{item.title}</strong>
                    <span>{item.message}</span>
                    <span>{formatDate(item.createdAt)}</span>
                    {item.actionUrl ? (
                      <Link to={item.actionUrl} className="dashboard-notification-link">
                        {item.actionLabel || "Open payment link"}
                      </Link>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="dashboard-empty">
                <p>No notifications yet.</p>
                <span>Admin notices and order updates will appear here.</span>
              </div>
            )}
          </section>

          <section className="dashboard-panel">
            <div className="dashboard-panel__header">
              <h2>Recent Orders</h2>
              <Link to="/profile/history">View All Orders</Link>
            </div>

            {recentOrders.length > 0 ? (
              <ul className="dashboard-orders">
                {recentOrders.map((order) => (
                  <li key={order.id}>
                    <strong>Order {order.orderNumber}</strong>
                    <span>{formatOrderStatus(order.status)}</span>
                    <span>{formatDate(order.createdAt)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="dashboard-empty">
                <p>No orders yet.</p>
                <span>Place your first order to start tracking activity.</span>
              </div>
            )}
          </section>
        </div>

        <section className="dashboard-panel">
          <div className="dashboard-panel__header">
            <h2>Quick Actions</h2>
            <Link to="/profile/settings">Account settings</Link>
          </div>

          <div className="dashboard-actions">
            <Link to="/products" className="dashboard-action">
              Place Order
            </Link>
            <Link to="/profile/shipments" className="dashboard-action">
              Track Shipment
            </Link>
            <Link to="/profile/payments" className="dashboard-action">
              Pay Now
            </Link>
            <Link to="/profile/support" className="dashboard-action">
              Support
            </Link>
          </div>
        </section>
      </div>
    </ProfileSectionShell>
  );
}

export default Dashboard;
