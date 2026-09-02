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
