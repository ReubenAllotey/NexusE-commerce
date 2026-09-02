import { useEffect, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import logo from "../../../assets/images/nexuslogo.png";
import { supabase } from "../../../lib/supabaseClient";
import { clearAdminSession, loadAdminSession } from "../Auth/adminAuthStorage";
import {
  formatDateTime,
  formatMoney,
  formatShortDate,
  getOrderMetrics,
  getProductMetrics,
  getRecentOrders,
} from "../adminHelpers";
import { getOrderStatusLabel } from "../../Profile/ordersStorage";
import { useProducts } from "../../Products/productData";
import { getCategoryMetrics, useCategoryRecords } from "../../../shared/categoryStorage";
import MobileDrawer from "../../../shared/mobileDrawer";
import { adminNavItems } from "../adminNavigation";

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </svg>
  );
}

function MetricCard({ title, value, subtitle, tone = "blue", to, ariaLabel }) {
  return (
    <Link
      to={to}
      aria-label={ariaLabel}
      className={`admin-dashboard-metric admin-dashboard-metric--${tone}`}
    >
      <span>{title}</span>
      <strong>{value}</strong>
      <p>{subtitle}</p>
    </Link>
  );
}

function getOrderTypeLabel(order = {}) {
  const orderType = String(order.orderType ?? order.order_type ?? "ready_stock").toLowerCase();
  return orderType === "preorder" ? "Pre-order" : "Ready stock";
}

function getAttentionItems(orders = []) {
  const safeOrders = Array.isArray(orders) ? orders : [];
  const pendingPayments = safeOrders.filter(
    (order) => String(order.status ?? "").toLowerCase() === "pending_payment",
  ).length;
  const preorderShipping = safeOrders.filter(
    (order) =>
      getOrderTypeLabel(order) === "Pre-order" &&
      String(order.status ?? "").toLowerCase() === "shipping_fee_pending",
  ).length;
  const readyForDelivery = safeOrders.filter(
    (order) => String(order.status ?? "").toLowerCase() === "ready_for_delivery",
  ).length;

  return [
    pendingPayments > 0
      ? {
          key: "pending-payments",
          title: "Pending payments",
          description: `${pendingPayments} ${pendingPayments === 1 ? "order" : "orders"} awaiting payment`,
          to: "/admin/orders",
          tone: "amber",
          icon: "clock",
        }
      : null,
    preorderShipping > 0
      ? {
          key: "preorder-shipping",
          title: "Pre-order shipping fees",
          description: `${preorderShipping} ${preorderShipping === 1 ? "pre-order needs" : "pre-orders need"} shipping fees`,
          to: "/admin/orders",
          tone: "blue",
          icon: "truck",
        }
      : null,
    readyForDelivery > 0
      ? {
          key: "ready-for-delivery",
          title: "Ready for delivery",
          description: `${readyForDelivery} ${readyForDelivery === 1 ? "order is" : "orders are"} ready`,
          to: "/admin/orders",
          tone: "green",
          icon: "check",
        }
      : null,
  ].filter(Boolean);
}

function AttentionIcon({ name }) {
  if (name === "truck") {
    return <span aria-hidden="true">→</span>;
  }

  if (name === "check") {
    return <span aria-hidden="true">✓</span>;
  }

  return <span aria-hidden="true">!</span>;
}

const QUICK_ACTIONS = [
  { title: "Add Product", description: "List a new product", to: "/admin/products/add", icon: "+" },
  { title: "View Orders", description: "Manage customer orders", to: "/admin/orders", icon: "↗" },
  { title: "Create Announcement", description: "Send a store update", to: "/admin/announcements", icon: "!" },
  { title: "Add Category", description: "Organize your catalog", to: "/admin/categories", icon: "+" },
];

function AdminDashboard({
  orders = [],
  siteBanner = null,
  onLogout = clearAdminSession,
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const session = loadAdminSession();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const { products: liveProducts } = useProducts();
  const { records: categoryRecords } = useCategoryRecords();
  const [customerCount, setCustomerCount] = useState(null);
  const productMetrics = getProductMetrics(liveProducts);
  const categoryMetrics = getCategoryMetrics(categoryRecords);
  const orderMetrics = getOrderMetrics(orders);
  const recentOrders = getRecentOrders(orders, 6);
  const attentionItems = getAttentionItems(orders);
  const latestOrder = recentOrders[0] ?? null;
  const currentBatch = siteBanner?.announcement?.batchNumber?.trim() || "Not set";

  useEffect(() => {
    setIsMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    let isMounted = true;

    const loadCustomerCount = async () => {
      const { data: profiles, error } = await supabase
        .from("profiles")
        .select("id, role, account_type");

      if (isMounted) {
        const registeredCustomers = (profiles ?? []).filter((profile) => {
          const role = String(profile.role ?? "").trim().toLowerCase();
          const accountType = String(profile.account_type ?? "").trim().toLowerCase();

          // Treat legacy null values as customer/member defaults, but never count admins or guests.
          return (
            (role === "customer" || role === "") &&
            (accountType === "member" || accountType === "")
          );
        });

        setCustomerCount(error ? null : registeredCustomers.length);
      }
    };

    void loadCustomerCount();

    return () => {
      isMounted = false;
    };
  }, [session?.id]);

  if (!session) {
    return <Navigate to="/admin/login" replace />;
  }

  const handleLogout = () => {
    onLogout();
    navigate("/admin/login", { replace: true });
  };

  const closeMenu = () => setIsMenuOpen(false);

  return (
    <main className="admin-dashboard-page">
      <section className="admin-dashboard-shell">
        <aside className="admin-dashboard-sidebar">
          <Link
            to="/"
            className="admin-dashboard-brand"
            aria-label="Nexus home"
          >
            <span className="admin-dashboard-brand__mark">
              <img src={logo} alt="" className="admin-dashboard-brand__logo" />
            </span>
            <span className="admin-dashboard-brand__copy">
              <strong>Nexus Admin</strong>
              <small>Admin panel</small>
            </span>
          </Link>

          <nav className="admin-dashboard-nav" aria-label="Admin sections">
            {adminNavItems.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={`admin-dashboard-nav__link${
                  location.pathname === item.to ? " is-active" : ""
                }`}
                aria-current={
                  location.pathname === item.to ? "page" : undefined
                }
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <button
            type="button"
            className="admin-dashboard-sidebar__logout"
            onClick={handleLogout}
          >
            Sign out
          </button>
        </aside>

        <div className="admin-dashboard-main">
          <header className="admin-dashboard-topbar">
            <button
              type="button"
              className="admin-dashboard-menu-button"
              aria-label="Open admin navigation"
              aria-expanded={isMenuOpen}
              aria-controls="admin-mobile-menu"
              onClick={() => setIsMenuOpen((current) => !current)}
            >
              <MenuIcon />
              <span>Menu</span>
            </button>

            <div className="admin-dashboard-topbar__title">
              <p>Admin overview</p>
              <span>
                Last synced{" "}
                {latestOrder
                  ? formatDateTime(
                      latestOrder.updatedAt ?? latestOrder.createdAt,
                    )
                  : "just now"}
              </span>
            </div>

            <div className="admin-dashboard-topbar__actions">
              <span className="admin-dashboard-batch">
                <small>Current Batch</small>
                <strong>{currentBatch}</strong>
              </span>
              <button
                type="button"
                className="admin-dashboard-topbar__button"
                onClick={() => navigate("/products")}
              >
                View store
              </button>
            </div>
          </header>

          <div className="admin-dashboard-summary__label">Store snapshot</div>
          <div className="admin-dashboard-summary__metrics">
            <MetricCard
              title="Total Products"
              value={productMetrics.totalProducts}
              subtitle="Products currently listed in the storefront."
              tone="blue"
              to="/admin/products"
              ariaLabel="View products"
            />
            <MetricCard
              title="Total Orders"
              value={orderMetrics.totalOrders}
              subtitle="All customer orders recorded."
              tone="green"
              to="/admin/orders"
              ariaLabel="View orders"
            />
            <MetricCard
              title="Total Customers"
              value={customerCount ?? "—"}
              subtitle="Registered customer accounts."
              tone="amber"
              to="/admin/customers"
              ariaLabel="View customers"
            />
            <MetricCard
              title="Total Categories"
              value={categoryMetrics.totalCategories}
              subtitle="Product categories in the catalog."
              tone="slate"
              to="/admin/categories"
              ariaLabel="View categories"
            />
          </div>

          <div className="admin-dashboard-lower-grid">
            <section
              id="admin-orders"
              className="admin-dashboard-panel admin-dashboard-panel--orders"
            >
              <div className="admin-dashboard-panel__header">
                <div>
                  <h2>Recent Orders</h2>
                  <p>The latest checkout activity from the storefront.</p>
                </div>

                <Link to="/admin/orders" className="admin-dashboard-panel__link">
                  View all
                </Link>
              </div>

              {recentOrders.length > 0 ? (
                <div className="admin-dashboard-order-list">
                  {recentOrders.map((order) => (
                    <article className="admin-dashboard-order-row" key={order.id}>
                      <div className="admin-dashboard-order-row__main">
                        <strong>{order.orderNumber}</strong>
                        <span>{order.customerName || "Guest checkout"}</span>
                        <small
                          className={`admin-dashboard-order-row__type${
                            getOrderTypeLabel(order) === "Pre-order" ? " is-preorder" : ""
                          }`}
                        >
                          {getOrderTypeLabel(order)}
                        </small>
                        <small>
                          {order.customerEmail || "No email captured"}
                        </small>
                      </div>

                      <div className="admin-dashboard-order-row__meta">
                        <strong>{formatMoney(order.total ?? 0)}</strong>
                        <span>{getOrderStatusLabel(order.status)}</span>
                        <small>{formatShortDate(order.createdAt)}</small>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="admin-dashboard-empty">
                  <p>No orders yet.</p>
                  <span>
                    When a customer checks out, the order summary will appear here
                    automatically.
                  </span>
                </div>
              )}
            </section>

            <section className="admin-dashboard-panel admin-dashboard-attention" aria-labelledby="attention-needed-title">
              <div className="admin-dashboard-panel__header">
                <div>
                  <h2 id="attention-needed-title">Attention Needed</h2>
                  <p>Items that may require your action.</p>
                </div>
              </div>

              {attentionItems.length > 0 ? (
                <div className="admin-dashboard-attention__list">
                  {attentionItems.map((item) => (
                    <Link
                      key={item.key}
                      to={item.to}
                      className={`admin-dashboard-attention__item admin-dashboard-attention__item--${item.tone}`}
                    >
                      <span className="admin-dashboard-attention__icon">
                        <AttentionIcon name={item.icon} />
                      </span>
                      <span className="admin-dashboard-attention__copy">
                        <strong>{item.title}</strong>
                        <small>{item.description}</small>
                      </span>
                      <span className="admin-dashboard-attention__arrow" aria-hidden="true">→</span>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="admin-dashboard-attention__empty">
                  <strong>You're all caught up</strong>
                  <span>No items currently require your attention.</span>
                </div>
              )}
            </section>
          </div>

          <section className="admin-dashboard-panel admin-dashboard-quick-actions" aria-labelledby="quick-actions-title">
            <div className="admin-dashboard-panel__header">
              <div>
                <h2 id="quick-actions-title">Quick Actions</h2>
                <p>Common tools for keeping the storefront moving.</p>
              </div>
            </div>
            <div className="admin-dashboard-quick-actions__grid">
              {QUICK_ACTIONS.map((action) => (
                <Link
                  key={action.title}
                  to={action.to}
                  className="admin-dashboard-quick-action"
                >
                  <span className="admin-dashboard-quick-action__icon" aria-hidden="true">{action.icon}</span>
                  <span>
                    <strong>{action.title}</strong>
                    <small>{action.description}</small>
                  </span>
                </Link>
              ))}
            </div>
          </section>
        </div>
      </section>

      <MobileDrawer
        open={isMenuOpen}
        onClose={closeMenu}
        title="Admin navigation"
        className="admin-mobile-drawer"
        maxWidth="min(82vw, 320px)"
      >
        <nav className="admin-mobile-menu" id="admin-mobile-menu" aria-label="Admin sections">
          {adminNavItems.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={`admin-mobile-menu__link${
                location.pathname === item.to ? " is-active" : ""
              }`}
              aria-current={location.pathname === item.to ? "page" : undefined}
              onClick={closeMenu}
            >
              {item.label}
            </Link>
          ))}

          <button
            type="button"
            className="admin-mobile-menu__logout"
            onClick={() => {
              closeMenu();
              handleLogout();
            }}
          >
            Sign out
          </button>
        </nav>
      </MobileDrawer>
    </main>
  );
}

export default AdminDashboard;
