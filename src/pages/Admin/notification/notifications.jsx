import { useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { loadAdminSession } from "../Auth/adminAuthStorage";
import { supabase } from "../../../lib/supabaseClient";
import {
  getNotificationCategory,
  getNotificationCategoryLabel,
  getNotificationsForUser,
} from "../../Profile/notificationsStorage";

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

const EMAIL_QUEUE_TEST_CUSTOMER_ID = "c8659380-b662-4644-a977-b7157a50aac8";
const EMAIL_QUEUE_TEST_EMAIL = "kpakporeuben@gmail.com";
const EMAIL_QUEUE_TEST_SOURCE_KEY = "test-email-queue:20261021-reuben-001";

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
  onCreateNotification = async () => ({ ok: false, message: "Notification creation is unavailable." }),
}) {
  const session = loadAdminSession() ?? authUser;
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [readFilter, setReadFilter] = useState("all");
  const [queueTestState, setQueueTestState] = useState({ status: "idle", message: "", result: null });

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

  const runEmailQueueSmokeTest = async () => {
    if (queueTestState.status === "running") {
      return;
    }

    setQueueTestState({ status: "running", message: "Checking the approved test account...", result: null });

    try {
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("id, email, role, status")
        .eq("id", EMAIL_QUEUE_TEST_CUSTOMER_ID)
        .maybeSingle();

      if (profileError) throw new Error(profileError.message || "Unable to verify the test customer.");
      if (
        !profile ||
        profile.email?.toLowerCase() !== EMAIL_QUEUE_TEST_EMAIL ||
        profile.role !== "customer" ||
        profile.status !== "active"
      ) {
        throw new Error("The approved test customer is not an active customer with the expected email.");
      }

      const { data: existing, error: existingError } = await supabase
        .from("notifications")
        .select("id, user_id, source_key, title, message")
        .eq("source_key", EMAIL_QUEUE_TEST_SOURCE_KEY)
        .maybeSingle();

      if (existingError) throw new Error(existingError.message || "Unable to check the test source key.");

      let notification = existing;
      let created = false;

      if (!notification) {
        const result = await onCreateNotification({
          customer: { id: EMAIL_QUEUE_TEST_CUSTOMER_ID, email: EMAIL_QUEUE_TEST_EMAIL },
          category: "orders",
          title: "[TEST] Transactional email queue smoke test",
          message: "TEST ONLY: This notification verifies email queue creation. No payment, order, or shipment was changed.",
          sourceType: "order_status",
          sourceKey: EMAIL_QUEUE_TEST_SOURCE_KEY,
          actionUrl: "/profile/notifications",
          actionLabel: "View test notification",
          actionDescription: "Test notification only.",
        });

        if (!result?.ok || !result.notification) {
          throw new Error(result?.message || "The test notification could not be created.");
        }

        notification = result.notification;
        created = true;
      }

      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !sessionData?.session?.access_token) {
        throw new Error("The active admin session could not be verified for queue inspection.");
      }

      const verificationResponse = await fetch(
        `/api/admin/email-queue-smoke-test?sourceKey=${encodeURIComponent(EMAIL_QUEUE_TEST_SOURCE_KEY)}`,
        { headers: { Authorization: `Bearer ${sessionData.session.access_token}` } },
      );
      const verification = await verificationResponse.json().catch(() => ({}));

      if (!verificationResponse.ok || !verification.ok) {
        throw new Error(verification.message || "The notification was created, but queue verification failed.");
      }

      setQueueTestState({
        status: "success",
        message: created ? "Test notification created and queue record verified." : "Existing test notification and queue record verified; nothing new was created.",
        result: verification,
      });
    } catch (error) {
      setQueueTestState({ status: "error", message: error?.message || "Smoke test failed.", result: null });
    }
  };

  return (
    <main className="admin-orders-page">
      <section className="admin-orders-shell">
        <header className="admin-orders-header">
          <div className="admin-orders-header__copy">
            <p>Admin inbox</p>
            <h1>Notifications</h1>
            <span>Read shipment, payment, and order notifications generated by the live store flows.</span>
          </div>
          {import.meta.env.DEV && import.meta.env.VITE_EMAIL_QUEUE_SMOKE_TEST_ENABLED === "true" ? (
            <button
              type="button"
              className="admin-orders-header__button"
              onClick={runEmailQueueSmokeTest}
              disabled={queueTestState.status === "running"}
            >
              {queueTestState.status === "running" ? "Testing Email Queue..." : "Run Email Queue Test"}
            </button>
          ) : null}
        </header>

        {import.meta.env.DEV && import.meta.env.VITE_EMAIL_QUEUE_SMOKE_TEST_ENABLED === "true" && queueTestState.status !== "idle" ? (
          <p className={`admin-support-${queueTestState.status === "error" ? "error" : "empty"}`}>
            {queueTestState.message}
            {queueTestState.result ? ` Notification ID: ${queueTestState.result.notification?.id || "unknown"}. Queue status: ${queueTestState.result.queue?.status || "unknown"}.` : ""}
          </p>
        ) : null}

        <section className="admin-orders-panel">
          <div className="admin-orders-summary">
          <article className="admin-orders-stat admin-orders-stat--indigo">
            <span>Total Notifications</span>
            <strong>{totalNotifications}</strong>
            <small>All records visible to the admin account.</small>
          </article>
          <article className="admin-orders-stat admin-orders-stat--amber">
            <span>Unread</span>
            <strong>{unreadNotifications}</strong>
            <small>Notifications waiting to be reviewed.</small>
          </article>
          <article className="admin-orders-stat admin-orders-stat--blue">
            <span>Order Updates</span>
            <strong>{orderNotifications}</strong>
            <small>Order and payment-related updates.</small>
          </article>
          <article className="admin-orders-stat admin-orders-stat--teal">
            <span>Shipping Updates</span>
            <strong>{shippingNotifications}</strong>
            <small>Shipment events and delivery progress.</small>
          </article>
          </div>

          <div className="admin-support-toolbar">
            <label className="admin-support-search" htmlFor="admin-notification-search">
              <span>Search</span>
              <input
                id="admin-notification-search"
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search customer, title, or message"
              />
            </label>

            <label className="admin-support-filter" htmlFor="admin-notification-category">
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

            <label className="admin-support-filter" htmlFor="admin-notification-read">
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
          </div>

          {notificationsLoading ? (
            <p className="admin-support-empty">Loading notifications...</p>
          ) : notificationsError ? (
            <p className="admin-support-error">{notificationsError}</p>
          ) : null}

          <div className="admin-support-table-wrap">
            <table className="admin-support-table">
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

                    return (
                      <tr key={notification.id} className="admin-support-row">
                        <td>
                          <strong>{notification.customerName || "Customer"}</strong>
                          <small>{notification.customerEmail || "No email captured"}</small>
                        </td>
                        <td>
                          <strong>{notification.title}</strong>
                          <small>{notification.message}</small>
                        </td>
                        <td>
                          <strong>{getNotificationCategoryLabel(category)}</strong>
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
                          <div className="admin-support-actions">
                            {notification.actionUrl ? (
                              <Link
                                to={notification.actionUrl}
                                className="admin-support-action admin-support-action--primary"
                              >
                                {notification.actionLabel || "Open"}
                              </Link>
                            ) : (
                              <span className="admin-support-action admin-support-action--ghost">
                                No link
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
                    <tr className="admin-support-empty-row">
                      <td colSpan="6">
                        <div className="admin-support-empty">
                          <h2>No notifications found.</h2>
                          <p>Try another search term or change the filters.</p>
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
