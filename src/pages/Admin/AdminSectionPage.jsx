import { useEffect, useState } from "react";
import { Link, Navigate, NavLink, useLocation } from "react-router-dom";
import BannerEditor from "./banners/bannerEditor";
import {
  formatDateTime,
  formatMoney,
  formatShortDate,
  getCategoryCounts,
  getNotificationMetrics,
  getRecentNotifications,
  getRecentOrders,
  getShipmentMetrics,
} from "./adminHelpers";
import { loadAdminSession } from "./Auth/adminAuthStorage";
import {
  getAnnouncementCategoryLabel,
  getAnnouncementStatus,
  getAnnouncementStatusLabel,
  useAnnouncements,
} from "./announcement/announcementStorage";
import { getNotificationCategoryLabel } from "../Profile/notificationsStorage";
import { getOrderStatusLabel } from "../Profile/ordersStorage";
import { useProducts } from "../Products/productData";
import MobileDrawer from "../../shared/mobileDrawer";
import { adminNavItems } from "./adminNavigation";

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </svg>
  );
}

function SectionCard({ title, value, note }) {
  return (
    <article className="admin-section-card">
      <strong>{value}</strong>
      <span>{title}</span>
      <small>{note}</small>
    </article>
  );
}

function AdminSectionPage({
  section,
  orders = [],
  notifications = [],
  notificationsLoading = false,
  notificationsError = "",
  siteBanner = null,
  onUpdateSiteBanner = () => {},
}) {
  const session = loadAdminSession();
  const location = useLocation();
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  useEffect(() => {
    setIsMenuOpen(false);
  }, [location.pathname]);

  if (!session) {
    return <Navigate to="/admin/login" replace />;
  }

  const { products: liveProducts } = useProducts();
  const {
    announcements: liveAnnouncements,
    loading: announcementsLoading,
    error: announcementsError,
  } = useAnnouncements({ includeArchived: true });
  const categoryCounts = getCategoryCounts(liveProducts);
  const shipmentMetrics = getShipmentMetrics(orders);
  const recentOrders = getRecentOrders(orders, 10);
  const recentNotifications = getRecentNotifications(notifications, 10);
  const notificationMetrics = getNotificationMetrics(notifications);
  const recentAnnouncements = [...liveAnnouncements]
    .sort(
      (left, right) =>
        new Date(right.updatedAt ?? right.createdAt ?? 0) -
        new Date(left.updatedAt ?? left.createdAt ?? 0),
    )
    .slice(0, 10);

  const content = (() => {
    switch (section) {
      case "orders":
        return (
          <div className="admin-section-list">
            {recentOrders.length > 0 ? (
              recentOrders.map((order) => (
                <article className="admin-section-row" key={order.id}>
                  <div>
                    <strong>{order.orderNumber}</strong>
                    <span>{order.customerName || "Guest checkout"}</span>
                    <small>{order.customerEmail || "No email captured"}</small>
                  </div>
                  <div className="admin-section-row__meta">
                    <strong>{formatMoney(order.total ?? 0)}</strong>
                    <span>{getOrderStatusLabel(order.status)}</span>
                    <small>{formatShortDate(order.createdAt)}</small>
                  </div>
                </article>
              ))
            ) : (
              <p className="admin-section-empty">No orders yet.</p>
            )}
          </div>
        );
      case "notifications":
        return (
          <div className="admin-section-list">
            {notificationsLoading ? (
              <p className="admin-section-empty">Loading notifications...</p>
            ) : notificationsError ? (
              <p className="admin-section-empty">{notificationsError}</p>
            ) : recentNotifications.length > 0 ? (
              recentNotifications.map((item) => (
                <article className="admin-section-row" key={item.id}>
                  <div>
                    <strong>{item.title}</strong>
                    <span>{item.message}</span>
                    <small>{formatDateTime(item.createdAt)}</small>
                  </div>
                  <div className="admin-section-row__meta">
                    <strong>{getNotificationCategoryLabel(item.category)}</strong>
                    <span>{(item.isRead ?? item.read) ? "Read" : "Unread"}</span>
                  </div>
                </article>
              ))
            ) : (
              <p className="admin-section-empty">No notifications yet.</p>
            )}
          </div>
        );
      case "announcements":
        return (
          <div className="admin-section-list">
            {announcementsLoading ? (
              <p className="admin-section-empty">Loading announcements...</p>
            ) : announcementsError ? (
              <p className="admin-section-empty">{announcementsError}</p>
            ) : recentAnnouncements.length > 0 ? (
              recentAnnouncements.map((item) => (
                <article className="admin-section-row" key={item.id}>
                  <div>
                    <strong>{item.title}</strong>
                    <span>{item.message}</span>
                    <small>{formatDateTime(item.createdAt)}</small>
                  </div>
                  <div className="admin-section-row__meta">
                    <strong>{getAnnouncementCategoryLabel(item.category)}</strong>
                    <span>{getAnnouncementStatusLabel(getAnnouncementStatus(item))}</span>
                  </div>
                </article>
              ))
            ) : (
              <p className="admin-section-empty">No announcements yet.</p>
            )}
          </div>
        );
      case "categories":
        return (
          <div className="admin-section-grid">
            {categoryCounts.map((category) => (
              <SectionCard
                key={category.name}
                title={`${category.count} products`}
                value={category.name}
                note="Tracked from the storefront catalog."
              />
            ))}
          </div>
        );
      case "products":
        return (
          <div className="admin-section-grid">
            {liveProducts.slice(0, 9).map((product) => (
              <article className="admin-section-banner" key={product.slug || product.name}>
                <strong>{product.name}</strong>
                <span>{product.category || "Uncategorized"}</span>
                <small>
                  {formatMoney(product.price ?? 0)} • {product.badge || "Catalog"}
                </small>
              </article>
            ))}
          </div>
        );
      case "banners":
        return <BannerEditor banner={siteBanner} onSave={onUpdateSiteBanner} />;
      case "shipment":
        return (
          <>
            <div className="admin-section-grid admin-section-grid--metrics">
              <SectionCard title="Total shipments" value={shipmentMetrics.totalShipments} note="All live orders." />
              <SectionCard title="In transit" value={shipmentMetrics.inTransitShipments} note="Currently on the move." />
              <SectionCard title="Delivered" value={shipmentMetrics.deliveredShipments} note="Completed deliveries." />
            </div>

            <div className="admin-section-list">
              {recentOrders.length > 0 ? (
                recentOrders.map((order) => (
                  <article className="admin-section-row" key={order.id}>
                    <div>
                      <strong>{order.orderNumber}</strong>
                      <span>{order.customerName || "Guest checkout"}</span>
                      <small>{formatShortDate(order.createdAt)}</small>
                    </div>
                    <div className="admin-section-row__meta">
                      <strong>{getOrderStatusLabel(order.status)}</strong>
                      <span>{formatMoney(order.total ?? 0)}</span>
                    </div>
                  </article>
                ))
              ) : (
                <p className="admin-section-empty">No shipment activity yet.</p>
              )}
            </div>
          </>
        );
      default:
        return (
          <p className="admin-section-empty">
            This section is ready. Use the sidebar to move around the admin console.
          </p>
        );
    }
  })();

  const titleMap = {
    orders: "Orders",
    products: "Products",
    notifications: "Notification",
    announcements: "Announcements",
    banners: "Banners",
    categories: "Categories",
    shipment: "Shipment",
  };

  const descriptionMap = {
    orders: "Browse the latest orders generated from the storefront.",
    products: "Review the storefront product catalog and live pricing.",
    notifications: `There are ${notificationMetrics.totalNotifications} notifications in the system.`,
    announcements: "Keep track of admin announcements visible in the console.",
    banners: "Update the homepage announcement and daily reflection banner.",
    categories: "Review the category mix used by the storefront catalog.",
    shipment: "Monitor delivery progress across live orders.",
  };

  const closeMenu = () => setIsMenuOpen(false);

  return (
    <main className="admin-section-page">
      <section className="admin-section-shell">
        <header className="admin-section-header">
          <button
            type="button"
            className="admin-section-header__menu-button"
            aria-label="Open admin navigation"
            aria-expanded={isMenuOpen}
            aria-controls="admin-section-mobile-menu"
            onClick={() => setIsMenuOpen((current) => !current)}
          >
            <MenuIcon />
            <span>Menu</span>
          </button>

          <div>
            <p>Admin section</p>
            <h1>{titleMap[section] ?? "Section"}</h1>
            <span>{descriptionMap[section] ?? "Admin content"}</span>
          </div>

          <Link to="/admin/dashboard" className="admin-section-header__link">
            Back to dashboard
          </Link>
        </header>

        <section className="admin-section-panel">{content}</section>
      </section>

      <MobileDrawer
        open={isMenuOpen}
        onClose={closeMenu}
        title="Admin navigation"
        className="admin-mobile-drawer"
        maxWidth="min(82vw, 320px)"
      >
        <nav className="admin-mobile-menu" id="admin-section-mobile-menu" aria-label="Admin sections">
          {adminNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `admin-mobile-menu__link${isActive ? " is-active" : ""}`
              }
              onClick={closeMenu}
            >
              {item.label}
            </NavLink>
          ))}

          <Link to="/admin/dashboard" className="admin-mobile-menu__link" onClick={closeMenu}>
            Back to dashboard
          </Link>
        </nav>
      </MobileDrawer>
    </main>
  );
}

export default AdminSectionPage;

