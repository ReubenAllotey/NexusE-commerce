import { useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { loadAdminSession } from "../Auth/adminAuthStorage";
import {
  getNotificationCategory,
  getNotificationCategoryLabel,
  getNotificationsForUser,
} from "../../Profile/notificationsStorage";
import { resolveAdminNotificationAction } from "./adminNotificationActions";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "orders", label: "Orders" },
  { key: "shipping", label: "Shipping" },
  { key: "announcement", label: "Announcement" },
  { key: "more", label: "More" },
];

const READ_FILTERS = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "read", label: "Read" },
];

function NotificationIcon({ name, size = 18 }) {
  const paths = {
    bell: <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9" /><path d="M10 21h4" /></>,
    refresh: <><path d="M20 11a8 8 0 1 0 1 4" /><path d="M20 4v7h-7" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
    orders: <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M8 9h8M8 13h5M8 17h3" /></>,
    shipping: <><path d="M3 6h11v10H3zM14 10h4l3 3v3h-7z" /><circle cx="7" cy="18" r="2" /><circle cx="18" cy="18" r="2" /></>,
    unread: <><circle cx="12" cy="12" r="8" /><path d="M12 8v4l2.5 2" /></>,
    eye: <><path d="M2.5 12s3.5-5 9.5-5 9.5 5 9.5 5-3.5 5-9.5 5-9.5-5-9.5-5Z" /><circle cx="12" cy="12" r="2.25" /></>,
  };

  return (
    <svg aria-hidden="true" className="admin-notifications-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {paths[name] || paths.bell}
    </svg>
  );
}

function formatDate(value) {
  if (!value) {
    return "Recently";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function AdminNotificationsPage({
  notifications = [],
  notificationsLoading = false,
  notificationsError = "",
  authUser = null,
  onRefreshNotifications = async () => {},
}) {
  const session = loadAdminSession() ?? authUser;
  const handleRefreshNotifications = async () => {
    await onRefreshNotifications();
  };
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [readFilter, setReadFilter] = useState("all");

  if (!session) {
    return <Navigate to="/admin/login" replace />;
  }

  const visibleNotifications = useMemo(
    () =>
      getNotificationsForUser(notifications, session)
        .slice()
        .sort(
          (left, right) =>
            new Date(right.createdAt ?? 0) - new Date(left.createdAt ?? 0),
        ),
    [notifications, session],
  );

  const filteredNotifications = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    return visibleNotifications.filter((notification) => {
      const category = getNotificationCategory(notification);
      const isUnread = !(notification.isRead ?? notification.read);
      const blob = [
        notification.customerName,
        notification.customerEmail,
        notification.title,
        notification.message,
        notification.orderNumber,
        notification.batchNumber,
        notification.paymentReference,
        notification.actionLabel,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      const matchesSearch = !term || blob.includes(term);
      const matchesCategory = categoryFilter === "all" || category === categoryFilter;
      const matchesRead =
        readFilter === "all" ||
        (readFilter === "read" && !isUnread) ||
        (readFilter === "unread" && isUnread);

      return matchesSearch && matchesCategory && matchesRead;
    });
  }, [categoryFilter, readFilter, searchTerm, visibleNotifications]);

  const totalNotifications = visibleNotifications.length;
  const unreadNotifications = visibleNotifications.filter(
    (item) => !(item.isRead ?? item.read),
  ).length;
  const orderNotifications = visibleNotifications.filter(
    (item) => getNotificationCategory(item) === "orders",
  ).length;
  const shippingNotifications = visibleNotifications.filter(
    (item) => getNotificationCategory(item) === "shipping",
  ).length;
  const hasActiveFilters = Boolean(searchTerm.trim()) || categoryFilter !== "all" || readFilter !== "all";

  return (
    <main className="admin-notifications-page">
      <section className="admin-notifications-shell">
        <header className="admin-notifications-header">
          <div>
            <p>Admin inbox</p>
            <h1>Notifications</h1>
            <span>Monitor customer orders, payments, and shipment updates in one place.</span>
          </div>
          <button type="button" className="admin-notifications-refresh" onClick={handleRefreshNotifications} disabled={notificationsLoading}>
            <NotificationIcon name="refresh" size={16} />
            {notificationsLoading ? "Refreshing" : "Refresh"}
          </button>
        </header>

        <section className="admin-notifications-stats">
          <article><span><NotificationIcon name="bell" />Total Notifications</span><strong>{totalNotifications}</strong><small>All records visible to the admin account.</small></article>
          <article><span><NotificationIcon name="unread" />Unread</span><strong>{unreadNotifications}</strong><small>Notifications waiting to be reviewed.</small></article>
          <article><span><NotificationIcon name="orders" />Order &amp; Payment Updates</span><strong>{orderNotifications}</strong><small>Order and payment-related updates.</small></article>
          <article><span><NotificationIcon name="shipping" />Shipping Updates</span><strong>{shippingNotifications}</strong><small>Shipment events and delivery progress.</small></article>
        </section>

        <section className="admin-notifications-panel">
          <div className="admin-notifications-toolbar">
            <label htmlFor="admin-notification-search">
              <span>Search</span>
              <div className="admin-notifications-input-wrap"><NotificationIcon name="search" size={16} />
              <input
                id="admin-notification-search"
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search customer, title, or message"
              />
              </div>
            </label>

            <label htmlFor="admin-notification-category">
              <span>Category</span>
              <select
                id="admin-notification-category"
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value)}
              >
                {FILTERS.map((filter) => (
                  <option key={filter.key} value={filter.key}>
                    {filter.label}
                  </option>
                ))}
              </select>
            </label>

            <label htmlFor="admin-notification-read">
              <span>Status</span>
              <select
                id="admin-notification-read"
                value={readFilter}
                onChange={(event) => setReadFilter(event.target.value)}
              >
                {READ_FILTERS.map((filter) => (
                  <option key={filter.key} value={filter.key}>
                    {filter.label}
                  </option>
                ))}
              </select>
            </label>
            {hasActiveFilters ? <button type="button" className="admin-notifications-clear" onClick={() => { setSearchTerm(""); setCategoryFilter("all"); setReadFilter("all"); }}>Clear filters</button> : null}
          </div>

          {notificationsLoading ? (
            <p className="admin-notifications-state">Loading notifications...</p>
          ) : notificationsError ? (
            <p className="admin-notifications-state admin-notifications-state--error">{notificationsError}</p>
          ) : null}

          <div className="admin-notifications-table-wrap">
            <table className="admin-notifications-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Title</th>
                  <th>Category</th>
                  <th>Status</th>
                  <th>Date</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {!notificationsLoading && !notificationsError && filteredNotifications.length > 0 ? (
                  filteredNotifications.map((notification) => {
                    const isUnread = !(notification.isRead ?? notification.read);
                    const category = getNotificationCategory(notification);
                    const adminAction = resolveAdminNotificationAction(notification);

                    return (
                      <tr key={notification.id} className={`admin-notifications-row${isUnread ? " is-unread" : ""}`}>
                        <td>
                          <strong>{notification.customerName || "Customer"}</strong>
                          <small>{notification.customerEmail || "No email captured"}</small>
                        </td>
                        <td>
                          <strong>{notification.title}</strong>
                          <small>{notification.message}</small>
                        </td>
                        <td>
                          <strong className={`admin-notifications-category admin-notifications-category--${category}`}>{getNotificationCategoryLabel(category)}</strong>
                          <small>{notification.orderNumber || notification.batchNumber || notification.paymentReference || notification.sourceType}</small>
                        </td>
                        <td>
                          <strong>{isUnread ? "Unread" : "Read"}</strong>
                          <small>{isUnread ? "Waiting for review" : "Already opened"}</small>
                        </td>
                        <td>
                          <strong>{formatDate(notification.createdAt)}</strong>
                          <small>{notification.actionDescription || "Supabase notification"}</small>
                        </td>
                        <td>
                          <div className="admin-notifications-actions">
                            {adminAction.actionUrl ? (
                              <Link
                                to={adminAction.actionUrl}
                                className="admin-notifications-action admin-notifications-action--primary"
                                aria-label={`${adminAction.actionLabel}: ${notification.title || "notification"}`}
                              >
                                <NotificationIcon name="eye" size={15} />
                                {adminAction.actionLabel}
                              </Link>
                            ) : (
                              <span
                                className="admin-notifications-action--none"
                                title={adminAction.actionDescription}
                              >
                                {adminAction.actionLabel}
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  !notificationsLoading &&
                  !notificationsError && (
                    <tr className="admin-notifications-empty-row">
                      <td colSpan="6">
                        <div className="admin-notifications-empty">
                          <NotificationIcon name={hasActiveFilters ? "search" : "bell"} size={30} />
                          <h2>{hasActiveFilters ? "No matching notifications" : "No notifications yet"}</h2>
                          <p>{hasActiveFilters ? "No matching notifications. Try adjusting your search or filters." : "Order, payment, and shipment updates will appear here when they are generated."}</p>
                          <button type="button" className="admin-notifications-empty__refresh" onClick={hasActiveFilters ? () => { setSearchTerm(""); setCategoryFilter("all"); setReadFilter("all"); } : handleRefreshNotifications}>{hasActiveFilters ? "Clear filters" : "Refresh"}</button>
                        </div>
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>
        </section>

      </section>
    </main>
  );
}

export default AdminNotificationsPage;
