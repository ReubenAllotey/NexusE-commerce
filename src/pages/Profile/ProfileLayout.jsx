import {
  Navigate,
  NavLink,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { useEffect, useState } from "react";
import {
  AccountSettings,
  Addresses,
  Dashboard as DashboardSection,
  Invoices,
  Logout,
  MyOrders,
  Notifications,
  OrderHistory,
  Payments,
  Shipments,
  Support,
  Wishlist,
  profileSections,
} from "./index";
import MobileDrawer from "../../shared/mobileDrawer";

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </svg>
  );
}

const profileSectionComponents = {
  dashboard: DashboardSection,
  orders: MyOrders,
  shipments: Shipments,
  notifications: Notifications,
  history: OrderHistory,
  wishlist: Wishlist,
  addresses: Addresses,
  payments: Payments,
  invoices: Invoices,
  support: Support,
  settings: AccountSettings,
  logout: Logout,
};

function ProfileSidebar({ onLogout }) {
  return (
    <aside className="profile-sidebar">
      <div className="profile-sidebar__header">
        <p>My account</p>
        <h2>Profile</h2>
      </div>

      <nav className="profile-sidebar__nav" aria-label="Profile sections">
        {profileSections.map((section) => (
          <NavLink
            key={section.slug}
            to={`/profile/${section.slug}`}
            end
            className={({ isActive }) =>
              `profile-sidebar__link${isActive ? " is-active" : ""}`
            }
            onClick={section.slug === "logout" ? onLogout : undefined}
          >
            {section.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}

function ProfileLayout({
  authUser = null,
  addresses = [],
  orders = [],
  notifications = [],
  notificationsLoading = false,
  notificationsError = "",
  wishlistItems = [],
  onAddToCart = () => {},
  onToggleWishlist = () => {},
  onSaveAddress = () => {},
  onDeleteAddress = () => {},
  onSetDefaultAddress = () => {},
  onCreateNotification = () => {},
  onMarkNotificationRead = () => {},
  onMarkAllNotificationsRead = () => {},
  onUpdateAuthUser = () => {},
  onLogout = () => {},
  siteBanner = null,
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  if (!authUser) {
    return <Navigate to="/register/login" replace />;
  }

  const pathParts = location.pathname.split("/").filter(Boolean);
  const sectionSlug = pathParts[0] === "profile" ? pathParts[1] ?? "dashboard" : "dashboard";
  const SectionComponent = profileSectionComponents[sectionSlug];

  const handleLogout = async () => {
    await onLogout();
    navigate("/register/login", { replace: true });
  };

  useEffect(() => {
    setIsMenuOpen(false);
  }, [location.pathname]);

  const closeMenu = () => setIsMenuOpen(false);

  if (location.pathname === "/profile" || location.pathname === "/profile/") {
    return <Navigate to="/profile/dashboard" replace />;
  }

  if (!SectionComponent) {
    return <Navigate to="/profile/dashboard" replace />;
  }

  return (
    <main className="profile-page">
      <div className="profile-shell">
        <button
          type="button"
          className="profile-menu-button"
          aria-label="Open profile navigation"
          aria-expanded={isMenuOpen}
          aria-controls="profile-mobile-menu"
          onClick={() => setIsMenuOpen((current) => !current)}
        >
          <MenuIcon />
          <span>Profile Menu</span>
        </button>

        <div className="profile-hero">
          <p>Signed in as</p>
          <strong>{authUser.name}</strong>
          <span>{authUser.email}</span>
        </div>

        {authUser.mustChangePassword ? (
          <p className="profile-hero__notice">
            Your account was created for guest checkout. Please change your password in Account Settings to keep access to your orders.
          </p>
        ) : null}

        <section className="profile-layout">
          <ProfileSidebar onLogout={handleLogout} />

          <div className="profile-content">
            <SectionComponent
              addresses={addresses}
              orders={orders}
              notifications={notifications}
              notificationsLoading={notificationsLoading}
              notificationsError={notificationsError}
              wishlistItems={wishlistItems}
              authUser={authUser}
              siteBanner={siteBanner}
              onAddToCart={onAddToCart}
              onToggleWishlist={onToggleWishlist}
              onSaveAddress={onSaveAddress}
              onDeleteAddress={onDeleteAddress}
              onSetDefaultAddress={onSetDefaultAddress}
              onCreateNotification={onCreateNotification}
              onMarkNotificationRead={onMarkNotificationRead}
              onMarkAllNotificationsRead={onMarkAllNotificationsRead}
              onUpdateAuthUser={onUpdateAuthUser}
            />
          </div>
        </section>
      </div>

      <MobileDrawer
        open={isMenuOpen}
        onClose={closeMenu}
        title="Profile navigation"
        className="profile-mobile-drawer"
        maxWidth="min(82vw, 320px)"
      >
        <nav className="profile-mobile-menu" id="profile-mobile-menu" aria-label="Profile sections">
          {profileSections
            .filter((section) => section.slug !== "logout")
            .map((section) => (
              <NavLink
                key={section.slug}
                to={`/profile/${section.slug}`}
                end
                className={({ isActive }) =>
                  `profile-mobile-menu__link${isActive ? " is-active" : ""}`
                }
                onClick={closeMenu}
              >
                {section.label}
              </NavLink>
            ))}

          <button
            type="button"
            className="profile-mobile-menu__logout"
            onClick={() => {
              closeMenu();
              handleLogout();
            }}
          >
            Logout
          </button>
        </nav>
      </MobileDrawer>
    </main>
  );
}

export default ProfileLayout;
