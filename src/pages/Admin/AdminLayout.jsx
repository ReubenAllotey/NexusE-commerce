import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import logo from "../../assets/images/nexuslogo.png";
import MobileDrawer from "../../shared/mobileDrawer";
import { clearAdminSession } from "./Auth/adminAuthStorage";
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

function isRouteActive(pathname, route) {
  return pathname === route || pathname.startsWith(`${route}/`);
}

function AdminNavigation({ pathname, mobile = false, onNavigate = () => {} }) {
  return (
    <nav
      className={mobile ? "admin-mobile-menu" : "admin-dashboard-nav"}
      aria-label="Admin sections"
    >
      {adminNavItems.map((item) => {
        const active = isRouteActive(pathname, item.to);

        return (
          <Link
            key={item.to}
            to={item.to}
            className={`${mobile ? "admin-mobile-menu__link" : "admin-dashboard-nav__link"}${
              active ? " is-active" : ""
            }`}
            aria-current={active ? "page" : undefined}
            onClick={onNavigate}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function AdminLayout({ children, onLogout = clearAdminSession }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  useEffect(() => {
    setIsMenuOpen(false);
  }, [location.pathname]);

  const handleLogout = () => {
    onLogout();
    navigate("/admin/login", { replace: true });
  };

  return (
    <main className="admin-layout-page">
      <section className="admin-layout-shell">
        <aside className="admin-dashboard-sidebar">
          <Link to="/" className="admin-dashboard-brand" aria-label="Nexus home">
            <span className="admin-dashboard-brand__mark">
              <img src={logo} alt="" className="admin-dashboard-brand__logo" />
            </span>
            <span className="admin-dashboard-brand__copy">
              <strong>Nexus Admin</strong>
              <small>Admin panel</small>
            </span>
          </Link>

          <AdminNavigation pathname={location.pathname} />

          <button
            type="button"
            className="admin-dashboard-sidebar__logout"
            onClick={handleLogout}
          >
            Sign out
          </button>
        </aside>

        <div className="admin-layout-content">
          <button
            type="button"
            className="admin-dashboard-menu-button admin-layout-menu-button"
            aria-label="Open admin navigation"
            aria-expanded={isMenuOpen}
            aria-controls="admin-mobile-menu"
            onClick={() => setIsMenuOpen((current) => !current)}
          >
            <MenuIcon />
            <span>Menu</span>
          </button>
          {children}
        </div>
      </section>

      <MobileDrawer
        open={isMenuOpen}
        onClose={() => setIsMenuOpen(false)}
        title="Admin navigation"
        className="admin-mobile-drawer"
        maxWidth="min(82vw, 320px)"
      >
        <div id="admin-mobile-menu">
          <AdminNavigation
            pathname={location.pathname}
            mobile
            onNavigate={() => setIsMenuOpen(false)}
          />
          <button
            type="button"
            className="admin-mobile-menu__logout"
            onClick={() => {
              setIsMenuOpen(false);
              handleLogout();
            }}
          >
            Sign out
          </button>
        </div>
      </MobileDrawer>
    </main>
  );
}

export default AdminLayout;
