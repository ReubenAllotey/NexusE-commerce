import { Link } from "react-router-dom";
import { useState } from "react";
import ProfileSectionShell from "./ProfileSectionShell";
import {
  getNotificationCategory,
  getNotificationCategoryLabel,
  getNotificationsForUser,
} from "./notificationsStorage";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "orders", label: "Orders" },
  { key: "announcement", label: "Announcement" },
  { key: "shipping", label: "Shipping" },
  { key: "more", label: "More" },
];

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

function Notifications({
  notifications = [],
  notificationsLoading = false,
  notificationsError = "",
  authUser = null,
  onMarkNotificationRead = () => {},
  onMarkAllNotificationsRead = () => {},
}) {
  const [selectedFilter, setSelectedFilter] = useState("all");

  const visibleNotifications = getNotificationsForUser(notifications, authUser)
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const totalNotifications = visibleNotifications.length;
  const unreadCount = visibleNotifications.filter(
    (item) => !(item.isRead ?? item.read),
  ).length;
  const orderUpdates = visibleNotifications.filter(
    (item) => getNotificationCategory(item) === "orders",
  ).length;
  const shippingUpdates = visibleNotifications.filter(
    (item) => getNotificationCategory(item) === "shipping",
  ).length;

  const filteredNotifications =
    selectedFilter === "all"
      ? visibleNotifications
      : visibleNotifications.filter(
          (item) => getNotificationCategory(item) === selectedFilter,
        );

  return (
    <ProfileSectionShell
      eyebrow="Alerts"
      title="Notifications"
      description="Stay updated with your orders, shipments, and company announcements."
    >
      <div className="notifications-stack">
        <div className="notifications-overview" aria-label="Notification summary">
          <article className="notifications-overview__card">
            <span>Total Notifications</span>
            <strong>{totalNotifications}</strong>
            <p>Everything you can see in your inbox.</p>
          </article>

          <article className="notifications-overview__card">
            <span>Unread</span>
            <strong>{unreadCount}</strong>
            <p>Messages waiting for your attention.</p>
          </article>

          <article className="notifications-overview__card">
            <span>Order Updates</span>
            <strong>{orderUpdates}</strong>
            <p>Order changes and shipping fee updates.</p>
          </article>

          <article className="notifications-overview__card">
            <span>Shipping Updates</span>
            <strong>{shippingUpdates}</strong>
            <p>Tracking progress and delivery changes.</p>
          </article>
        </div>

        <section className="notifications-panel">
          <div className="notifications-panel__header">
            <div>
              <p className="orders-panel__eyebrow">Inbox</p>
              <h2>Filter notifications</h2>
            </div>

            <button
              type="button"
              className="notifications-panel__action"
              onClick={onMarkAllNotificationsRead}
              disabled={unreadCount === 0}
            >
              Mark all as read
            </button>
          </div>

          <div className="notifications-filters" role="tablist" aria-label="Notification filters">
            {FILTERS.map((filter) => (
              <button
                key={filter.key}
                type="button"
                className={`notifications-filter${selectedFilter === filter.key ? " is-active" : ""}`}
                onClick={() => setSelectedFilter(filter.key)}
              >
                {filter.label}
                <span>
                  {filter.key === "all"
                    ? totalNotifications
                    : visibleNotifications.filter(
                        (item) => getNotificationCategory(item) === filter.key,
                      ).length}
                </span>
              </button>
            ))}
          </div>

          {notificationsLoading ? (
            <div className="notifications-empty">
              <h3>Loading notifications...</h3>
              <p>We are syncing your inbox from Supabase.</p>
            </div>
          ) : notificationsError ? (
            <div className="notifications-empty">
              <h3>Unable to load notifications</h3>
              <p>{notificationsError}</p>
            </div>
          ) : filteredNotifications.length > 0 ? (
            <ul className="notifications-list">
              {filteredNotifications.map((item) => {
                const category = getNotificationCategory(item);
                const isUnread = !(item.isRead ?? item.read);

                return (
                  <li
                    className={`notification-card${isUnread ? " is-unread" : ""}`}
                    key={item.id}
                  >
                    <button
                      type="button"
                      className="notification-card__body"
                      onClick={() => onMarkNotificationRead(item.id)}
                    >
                      <div className="notification-card__top">
                        <strong>{item.title}</strong>
                        <span>{formatDate(item.createdAt)}</span>
                      </div>

                      <p>{item.message}</p>

                      <div className="notification-card__meta">
                        <span className="notification-card__pill">
                          {getNotificationCategoryLabel(category)}
                        </span>
                        {item.orderNumber ? (
                          <span className="notification-card__ref">
                            Order {item.orderNumber}
                          </span>
                        ) : null}
                        {isUnread ? (
                          <span className="notification-card__state">Unread</span>
                        ) : (
                          <span className="notification-card__state is-read">
                            Read
                          </span>
                        )}
                      </div>
                    </button>

                    {item.actionUrl ? (
                      <div className="notification-card__cta-wrap">
                        {item.actionDescription ? (
                          <p className="notification-card__cta-note">
                            {item.actionDescription}
                          </p>
                        ) : null}
                        <Link
                          to={item.actionUrl}
                          className="notification-card__cta"
                          onClick={() => onMarkNotificationRead(item.id)}
                        >
                          {item.actionLabel || "Open payment link"}
                        </Link>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="notifications-empty">
              <h3>No notifications yet</h3>
              <p>
                When you get a new order update, shipping alert, or company
                announcement, it will appear here.
              </p>
            </div>
          )}
        </section>
      </div>
    </ProfileSectionShell>
  );
}

export default Notifications;
