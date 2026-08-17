import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import Header from "./assets/components/Header/header";
import { supabase } from "./lib/supabaseClient";
import Home from "./pages/Home/home";
import About from "./pages/About/about";
import Contact from "./pages/Contact/contact";
import Products from "./pages/Products/products";
import ProductView from "./pages/Products/productView";
import Cart from "./pages/cart/cart";
import ShippingAddress from "./pages/ShippingAddress/ShippingAddress";
import WishlistPage from "./pages/wishlist/wishlist";
import Signup from "./pages/register/signup";
import Login from "./pages/register/login";
import PasswordSetup from "./pages/register/PasswordSetup";
import AdminLogin from "./pages/Admin/Auth/adminLogin";
import SiteBannerStrip from "./pages/Home/siteBannerStrip";
import { useProducts } from "./pages/Products/productData";
import ProfileLayout from "./pages/Profile/ProfileLayout";
import {
  loadOrders,
  updateOrderById,
  updateOrderStatus,
} from "./pages/Profile/ordersStorage";
import {
  createAddress,
  deleteAddress,
  loadAddresses,
  updateAddress,
  setDefaultAddress,
} from "./pages/Profile/addressesStorage";
import {
  addCartLine,
  clearCartState,
  clearGuestCartDraft,
  clearGuestWishlistDraft,
  loadCartState,
  loadWishlistState,
  removeCartLine,
  setCartLineQuantity,
  toggleWishlistItem,
} from "./shared/cartWishlistStorage";
import {
  createNotification,
  loadNotifications,
  markNotificationAsRead,
  markAllNotificationsRead,
} from "./pages/Profile/notificationsStorage";
import {
  clearSessionUser,
  saveSessionUser,
} from "./pages/register/authStorage";
import {
  clearCheckoutDraft,
  clearPaymentSession,
} from "./pages/payment/paymentStorage";
import {
  clearAdminSession,
  saveAdminSession,
  isActiveAdminProfile,
} from "./pages/Admin/Auth/adminAuthStorage";
import {
  defaultSiteBanner,
  loadStoredSiteBanner,
  normalizeSiteBanner,
  saveStoredSiteBanner,
} from "./shared/siteBannerStorage";

const AdminDashboard = lazy(() => import("./pages/Admin/dashboard/adminDashboard"));
const AdminOrdersPage = lazy(() => import("./pages/Admin/AdminOrdersPage"));
const AdminSectionPage = lazy(() => import("./pages/Admin/AdminSectionPage"));
const AnnouncementPage = lazy(() => import("./pages/Admin/announcement/announcementPage"));
const AdminProductsPage = lazy(() => import("./pages/Admin/products/products"));
const AddProductPage = lazy(() => import("./pages/Admin/products/addProduct"));
const EditProductPage = lazy(() => import("./pages/Admin/products/editProduct"));
const SupportInboxPage = lazy(() => import("./pages/Admin/notification/supportInbox"));
const AdminNotificationsPage = lazy(() => import("./pages/Admin/notification/notifications"));
const CategoriesPage = lazy(() => import("./pages/Admin/categories/categories"));
const CustomersPage = lazy(() => import("./pages/Admin/customers/customers"));
const FlashySalesPage = lazy(() => import("./pages/Admin/flashySales/flashySales"));
const MonthlyReportsPage = lazy(() => import("./pages/Admin/monthlyReports/monthlyReports"));
const ShipmentPage = lazy(() => import("./pages/Admin/shipment/shipment"));
const PaymentPage = lazy(() => import("./pages/payment/payment"));
const PendingPaymentPage = lazy(() => import("./pages/payment/pendingpayment"));
const SuccessPaymentPage = lazy(() => import("./pages/payment/successpayment"));
const FailedPaymentPage = lazy(() => import("./pages/payment/failedpayment"));
const ReceiptPage = lazy(() => import("./pages/receipt/receipt"));

function formatMoney(value) {
  const safeValue = Number(value) || 0;

  return new Intl.NumberFormat("en-GH", {
    style: "currency",
    currency: "GHS",
    currencyDisplay: "symbol",
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  }).format(safeValue);
}

function mapProfileToAuthUser(profile = {}, sessionUser = null) {
  const sessionMetadata = sessionUser?.user_metadata ?? sessionUser?.userMetadata ?? {};
  return {
    id: profile.id ?? sessionUser?.user?.id ?? sessionUser?.id ?? "",
    name:
      profile.full_name ??
      sessionUser?.user_metadata?.full_name ??
      sessionUser?.user_metadata?.name ??
      profile.name ??
      "",
    email: profile.email ?? sessionUser?.email ?? "",
    createdAt: profile.created_at ?? profile.createdAt ?? "",
    updatedAt: profile.updated_at ?? profile.updatedAt ?? "",
    accountType: profile.account_type ?? profile.accountType ?? "member",
    mustChangePassword: Boolean(
      profile.must_change_password ??
        profile.mustChangePassword ??
        sessionMetadata.must_change_password ??
        sessionMetadata.mustChangePassword ??
        false,
    ),
    photoUrl: profile.photo_url ?? profile.photoUrl ?? null,
    phoneNumber: profile.phone_number ?? profile.phoneNumber ?? null,
    dateOfBirth: profile.date_of_birth ?? profile.dateOfBirth ?? null,
    gender: profile.gender ?? null,
    role: profile.role ?? "customer",
    status: profile.status ?? "active",
  };
}

function isCustomerProtectedPath(pathname = "") {
  return pathname.startsWith("/profile");
}

function AuthStateScreen({
  title,
  message,
  actionLabel = "",
  actionTo = "",
}) {
  return (
    <main className="auth-state-page">
      <section className="auth-state-card" aria-live="polite">
        <p>{title}</p>
        <h1>{message}</h1>
        {actionLabel && actionTo ? (
          <Link to={actionTo} className="auth-state-card__link">
            {actionLabel}
          </Link>
        ) : null}
      </section>
    </main>
  );
}

function RouteLoadingScreen({ label }) {
  return (
    <main className="admin-route-loading">
      <span>{label}</span>
    </main>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

function resolveDrawerItem(item, productLookup = new Map()) {
  if (item?.name && item?.price && item?.image) {
    return item;
  }

  return item?.slug ? productLookup.get(item.slug) ?? null : null;
}

function getCartItemKey(item, fallbackSlug = "") {
  return item?.cartKey ?? item?.variantKey ?? item?.slug ?? fallbackSlug;
}

function getVariantLabel(item = {}) {
  const selectedOptionLabels = Array.isArray(item?.selectedOptions)
    ? item.selectedOptions
        .map((option) => option?.label ?? option?.value ?? "")
        .filter(Boolean)
        .join(" / ")
    : "";
  const label = item?.variant?.label ?? item?.variantLabel ?? selectedOptionLabels ?? "";

  if (label) {
    return label;
  }

  return [item?.variant?.color, item?.variant?.size].filter(Boolean).join(" / ");
}

function CartDrawer({
  cartItems = [],
  productLookup = new Map(),
  isOpen = false,
  onClose = () => {},
}) {
  const drawerItems = cartItems
    .map((item) => {
      const product = resolveDrawerItem(item, productLookup);

      if (!product) {
        return null;
      }

      const quantity = item.quantity ?? 1;

      return {
        key: getCartItemKey(item, product.slug ?? product.name),
        product,
        quantity,
        lineTotal: product.price * quantity,
        variant: item.variant ?? null,
        selectedOptions: item.selectedOptions ?? [],
        variantLabel: getVariantLabel(item),
      };
    })
    .filter(Boolean);

  const itemCount = drawerItems.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = drawerItems.reduce((sum, item) => sum + item.lineTotal, 0);

  return (
    <div className={`cart-drawer${isOpen ? " is-open" : ""}`} aria-hidden={!isOpen}>
      <aside className="cart-drawer__panel" aria-label="Shopping cart preview">
        <header className="cart-drawer__header">
          <div>
            <p>Added to cart</p>
            <h2>{itemCount} item{itemCount === 1 ? "" : "s"}</h2>
          </div>

          <button
            type="button"
            className="cart-drawer__close"
            onClick={onClose}
            aria-label="Close cart preview"
          >
            <CloseIcon />
          </button>
        </header>

        <div className="cart-drawer__items">
          {drawerItems.length > 0 ? (
            drawerItems.map(({ key, product, quantity, lineTotal, variant }) => (
              <article className="cart-drawer__item" key={key}>
                <div className="cart-drawer__image">
                  <img src={product.image} alt={product.name} className={product.imageClassName ?? ""} />
                </div>

                <div className="cart-drawer__details">
                  <div>
                    <strong>{product.name}</strong>
                    <span>{product.brand}</span>
                    {variantLabel || variant?.color || variant?.size ? (
                      <span>{variantLabel || [variant.color, variant.size].filter(Boolean).join(" / ")}</span>
                    ) : null}
                  </div>

                  <div className="cart-drawer__meta">
                    <span>Qty {quantity}</span>
                    <strong>{formatMoney(lineTotal)}</strong>
                  </div>
                </div>
              </article>
            ))
          ) : (
            <div className="cart-drawer__empty">
              <p>Your cart is empty.</p>
              <span>Add a product to see it here.</span>
            </div>
          )}
        </div>

        <footer className="cart-drawer__footer">
          <div className="cart-drawer__summary">
            <span>Subtotal</span>
            <strong>{formatMoney(subtotal)}</strong>
          </div>

          <button type="button" className="cart-drawer__continue" onClick={onClose}>
            Continue Shopping
          </button>

          <Link to="/cart" className="cart-drawer__checkout" onClick={onClose}>
            Proceed to Checkout
          </Link>
        </footer>
      </aside>
    </div>
  );
}

function AppShell({
  cartCount,
  cartItems,
  cartLoading,
  cartError,
  productLookup,
  addresses,
  orders,
  notifications,
  notificationsLoading,
  notificationsError,
  siteBanner,
  wishlistItems,
  wishlistLoading,
  wishlistError,
  authUser,
  authSession,
  authReady,
  authError,
  ordersLoading,
  ordersError,
  onAddToCart,
  onToggleWishlist,
  onSaveAddress,
  onDeleteAddress,
  onSetDefaultAddress,
  onUpdateCartQuantity,
  onRemoveCartItem,
  onClearCart,
  onCreateNotification,
  onReplaceOrders,
  onMarkNotificationRead,
  onMarkAllNotificationsRead,
  onUpdateOrderStatus,
  onUpdateOrder,
  onUpdateSiteBanner,
  onUpdateAuthUser,
  onLogout,
  onAdminLogin,
  onAdminLogout,
  isCartDrawerOpen,
  onCloseCartDrawer,
  onLogin,
  onSignup,
}) {
  const location = useLocation();
  const isAdminUser = isActiveAdminProfile(authUser);
  const hasProfileError = Boolean(authSession && !authUser && authError);
  const hasOrderError = Boolean(ordersError);
  const unreadNotificationCount = notifications.filter(
    (notification) => !(notification.isRead ?? notification.read),
  ).length;

  const customerGuard = (content) => {
    if (!authReady) {
      return <RouteLoadingScreen label="Restoring your account..." />;
    }

    if (hasProfileError) {
      return (
        <AuthStateScreen
          title="Profile loading error"
          message={authError}
          actionLabel="Go to login"
          actionTo="/register/login"
        />
      );
    }

    if (ordersLoading) {
      return <RouteLoadingScreen label="Loading your orders..." />;
    }

    if (hasOrderError) {
      return (
        <AuthStateScreen
          title="Order loading error"
          message={ordersError}
          actionLabel="Go to home"
          actionTo="/"
        />
      );
    }

    if (!authUser) {
      return <Navigate to="/register/login" replace />;
    }

    return content;
  };

  const adminGuard = (content) => {
    if (!authReady) {
      return <RouteLoadingScreen label="Restoring admin access..." />;
    }

    if (hasProfileError) {
      return (
        <AuthStateScreen
          title="Profile loading error"
          message={authError}
          actionLabel="Go to admin login"
          actionTo="/admin/login"
        />
      );
    }

    if (ordersLoading) {
      return <RouteLoadingScreen label="Loading admin orders..." />;
    }

    if (hasOrderError) {
      return (
        <AuthStateScreen
          title="Order loading error"
          message={ordersError}
          actionLabel="Go to admin login"
          actionTo="/admin/login"
        />
      );
    }

    if (!isAdminUser) {
      return <Navigate to="/admin/login" replace />;
    }

    return content;
  };

  if (location.pathname.startsWith("/admin")) {
    if (!authReady) {
      return <RouteLoadingScreen label="Restoring admin access..." />;
    }

    if (hasProfileError) {
      return (
        <AuthStateScreen
          title="Profile loading error"
          message={authError}
          actionLabel="Go to admin login"
          actionTo="/admin/login"
        />
      );
    }

    if (ordersLoading) {
      return <RouteLoadingScreen label="Loading admin orders..." />;
    }

    if (hasOrderError) {
      return (
        <AuthStateScreen
          title="Order loading error"
          message={ordersError}
          actionLabel="Go to admin login"
          actionTo="/admin/login"
        />
      );
    }

    return (
      <Suspense
        fallback={
          <main className="admin-route-loading">
            <span>Loading admin page...</span>
          </main>
        }
      >
        <Routes>
          <Route
            path="/admin"
            element={
              <Navigate
                to={isAdminUser ? "/admin/dashboard" : "/admin/login"}
                replace
              />
            }
          />
          <Route
            path="/admin/login"
            element={
              isAdminUser ? (
                <Navigate to="/admin/dashboard" replace />
              ) : (
                <AdminLogin authUser={authUser} authReady={authReady} />
              )
            }
          />
          <Route path="/admin/auth" element={<Navigate to="/admin/login" replace />} />
          <Route
            path="/admin/auth/login"
            element={
              isAdminUser ? (
                <Navigate to="/admin/dashboard" replace />
              ) : (
                <AdminLogin authUser={authUser} authReady={authReady} />
              )
            }
          />
          <Route
            path="/admin/dashboard"
            element={adminGuard(
              <AdminDashboard
                orders={orders}
                onLogout={onAdminLogout}
              />,
            )}
          />
          <Route
            path="/admin/orders"
            element={adminGuard(
              <AdminOrdersPage
                orders={orders}
                authUser={authUser}
                onUpdateOrderStatus={onUpdateOrderStatus}
              />,
            )}
          />
          <Route
            path="/admin/products"
            element={adminGuard(<AdminProductsPage orders={orders} />)}
          />
          <Route
            path="/admin/products/add"
            element={adminGuard(<AddProductPage />)}
          />
          <Route
            path="/admin/products/:productSlug/edit"
            element={adminGuard(<EditProductPage />)}
          />
          <Route
            path="/admin/support-inbox"
            element={adminGuard(<SupportInboxPage />)}
          />
          <Route
            path="/admin/notifications"
            element={adminGuard(
              <AdminNotificationsPage
                notifications={notifications}
                notificationsLoading={notificationsLoading}
                notificationsError={notificationsError}
                authUser={authUser}
              />,
            )}
          />
          <Route
            path="/admin/notification"
            element={<Navigate to="/admin/notifications" replace />}
          />
          <Route
            path="/admin/announcements"
            element={adminGuard(
              <AnnouncementPage
                orders={orders}
                onCreateNotification={onCreateNotification}
                siteBanner={siteBanner}
                onUpdateSiteBanner={onUpdateSiteBanner}
              />,
            )}
          />
          <Route
            path="/admin/banners"
            element={adminGuard(
              <AdminSectionPage
                section="banners"
                siteBanner={siteBanner}
                onUpdateSiteBanner={onUpdateSiteBanner}
              />,
            )}
          />
          <Route
            path="/admin/categories"
            element={adminGuard(<CategoriesPage orders={orders} />)}
          />
          <Route
            path="/admin/customers"
            element={adminGuard(<CustomersPage orders={orders} />)}
          />
          <Route
            path="/admin/flashy-sales"
            element={adminGuard(<FlashySalesPage />)}
          />
          <Route
            path="/admin/monthlyReports"
            element={adminGuard(<MonthlyReportsPage orders={orders} />)}
          />
          <Route
            path="/admin/shipment"
            element={adminGuard(
              <ShipmentPage
                orders={orders}
                authUser={authUser}
                siteBanner={siteBanner}
              />,
            )}
          />
          <Route path="/admin/*" element={<Navigate to="/admin/login" replace />} />
        </Routes>
      </Suspense>
    );
  }

  return (
    <>
      {location.pathname === "/" ? (
        <SiteBannerStrip banner={siteBanner} />
      ) : null}
      <Header
        cartCount={cartCount}
        wishlistCount={wishlistItems.length}
        notificationCount={unreadNotificationCount}
        authUser={authUser}
        onLogout={onLogout}
      />
      <CartDrawer
        cartItems={cartItems}
        productLookup={productLookup}
        isOpen={isCartDrawerOpen}
        onClose={onCloseCartDrawer}
      />
      <Routes>
        <Route
          path="/"
          element={
            <Home
              onAddToCart={onAddToCart}
              onToggleWishlist={onToggleWishlist}
              wishlistItems={wishlistItems}
            />
          }
        />
        <Route
          path="/about"
          element={<About />}
        />
        <Route
          path="/contact"
          element={<Contact />}
        />
        <Route
          path="/products/:productSlug"
          element={
            <ProductView
              onAddToCart={onAddToCart}
              onToggleWishlist={onToggleWishlist}
              wishlistItems={wishlistItems}
              siteBanner={siteBanner}
            />
          }
        />
        <Route
          path="/products"
          element={
            <Products
              onAddToCart={onAddToCart}
              onToggleWishlist={onToggleWishlist}
              wishlistItems={wishlistItems}
            />
          }
        />
        <Route
          path="/cart"
          element={
            <Cart
              cartItems={cartItems}
              loading={cartLoading}
              error={cartError}
              onUpdateCartQuantity={onUpdateCartQuantity}
              onRemoveCartItem={onRemoveCartItem}
              onClearCart={onClearCart}
            />
          }
        />
        <Route
          path="/shipping-address"
          element={
            <ShippingAddress
              cartItems={cartItems}
              addresses={addresses}
              authUser={authUser}
              onSaveAddress={onSaveAddress}
            />
          }
        />
        <Route
          path="/payment"
          element={
            <PaymentPage
              cartItems={cartItems}
              orders={orders}
              ordersLoading={ordersLoading}
              ordersError={ordersError}
              authUser={authUser}
              siteBanner={siteBanner}
              onClearCart={onClearCart}
              onReplaceOrders={onReplaceOrders}
              onUpdateOrder={onUpdateOrder}
            />
          }
        />
        <Route
          path="/payment/pending"
          element={
            <PendingPaymentPage
              cartItems={cartItems}
              orders={orders}
              ordersLoading={ordersLoading}
              ordersError={ordersError}
              authUser={authUser}
              siteBanner={siteBanner}
              onUpdateOrder={onUpdateOrder}
              onClearCart={onClearCart}
            />
          }
        />
        <Route
          path="/payment/success"
          element={
            <SuccessPaymentPage
              cartItems={cartItems}
              orders={orders}
              ordersLoading={ordersLoading}
              ordersError={ordersError}
              authUser={authUser}
              siteBanner={siteBanner}
              onUpdateOrder={onUpdateOrder}
              onClearCart={onClearCart}
            />
          }
        />
        <Route
          path="/payment/callback"
          element={
            <SuccessPaymentPage
              cartItems={cartItems}
              orders={orders}
              ordersLoading={ordersLoading}
              ordersError={ordersError}
              authUser={authUser}
              siteBanner={siteBanner}
              onUpdateOrder={onUpdateOrder}
              onClearCart={onClearCart}
            />
          }
        />
        <Route
          path="/payment/failed"
          element={
            <FailedPaymentPage
              cartItems={cartItems}
              orders={orders}
              ordersLoading={ordersLoading}
              ordersError={ordersError}
              authUser={authUser}
              siteBanner={siteBanner}
              onUpdateOrder={onUpdateOrder}
              onClearCart={onClearCart}
            />
          }
        />
        <Route
          path="/receipt/:reference?"
          element={<ReceiptPage />}
        />
        <Route
          path="/wishlist"
          element={
            <WishlistPage
              wishlistItems={wishlistItems}
              loading={wishlistLoading}
              error={wishlistError}
              onAddToCart={onAddToCart}
              onToggleWishlist={onToggleWishlist}
            />
          }
        />
        <Route
          path="/profile/*"
          element={customerGuard(
            <ProfileLayout
              authUser={authUser}
              addresses={addresses}
              orders={orders}
              notifications={notifications}
              notificationsLoading={notificationsLoading}
              notificationsError={notificationsError}
              wishlistItems={wishlistItems}
              onAddToCart={onAddToCart}
              onToggleWishlist={onToggleWishlist}
              onSaveAddress={onSaveAddress}
              onDeleteAddress={onDeleteAddress}
              onSetDefaultAddress={onSetDefaultAddress}
              onCreateNotification={onCreateNotification}
              onMarkNotificationRead={onMarkNotificationRead}
              onMarkAllNotificationsRead={onMarkAllNotificationsRead}
              onUpdateAuthUser={onUpdateAuthUser}
              onLogout={onLogout}
              siteBanner={siteBanner}
            />,
          )}
        />
        <Route
          path="/profile/addresses"
          element={customerGuard(
            <ProfileLayout
              authUser={authUser}
              addresses={addresses}
              orders={orders}
              notifications={notifications}
              notificationsLoading={notificationsLoading}
              notificationsError={notificationsError}
              wishlistItems={wishlistItems}
              onAddToCart={onAddToCart}
              onToggleWishlist={onToggleWishlist}
              onSaveAddress={onSaveAddress}
              onDeleteAddress={onDeleteAddress}
              onSetDefaultAddress={onSetDefaultAddress}
              onCreateNotification={onCreateNotification}
              onMarkNotificationRead={onMarkNotificationRead}
              onMarkAllNotificationsRead={onMarkAllNotificationsRead}
              onUpdateAuthUser={onUpdateAuthUser}
              onLogout={onLogout}
              siteBanner={siteBanner}
            />,
          )}
        />
        <Route path="/register" element={<Signup onSignup={onSignup} />} />
        <Route
          path="/register/signup"
          element={<Signup onSignup={onSignup} />}
        />
        <Route path="/register/login" element={<Login onLogin={onLogin} />} />
        <Route path="/account/set-password" element={<PasswordSetup />} />
      </Routes>
    </>
  );
}

function App() {
  const {
    products: liveProducts,
  } = useProducts();
  const [cartItems, setCartItems] = useState([]);
  const [addresses, setAddresses] = useState(null);
  const [orders, setOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersError, setOrdersError] = useState("");
  const [notifications, setNotifications] = useState([]);
  const [notificationsLoading, setNotificationsLoading] = useState(true);
  const [notificationsError, setNotificationsError] = useState("");
  const [siteBanner, setSiteBanner] = useState(() => defaultSiteBanner);
  const [wishlistItems, setWishlistItems] = useState([]);
  const [isCartDrawerOpen, setIsCartDrawerOpen] = useState(false);
  const [authSession, setAuthSession] = useState(null);
  const [authUser, setAuthUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState("");
  const [cartLoading, setCartLoading] = useState(true);
  const [cartError, setCartError] = useState("");
  const [wishlistLoading, setWishlistLoading] = useState(true);
  const [wishlistError, setWishlistError] = useState("");
  const authRequestIdRef = useRef(0);
  const orderRequestIdRef = useRef(0);
  const notificationRequestIdRef = useRef(0);
  const addressRequestIdRef = useRef(0);
  const cartRequestIdRef = useRef(0);
  const wishlistRequestIdRef = useRef(0);
  const productLookup = useMemo(
    () => {
      const map = new Map();

      for (const product of liveProducts) {
        if (!product) {
          continue;
        }

        const slugKey = String(product.slug ?? "").trim().toLowerCase();
        const idKey = String(product.id ?? "").trim();
        const nameKey = String(product.name ?? "").trim().toLowerCase();

        if (slugKey) {
          map.set(slugKey, product);
        }

        if (idKey) {
          map.set(idKey, product);
        }

        if (nameKey) {
          map.set(nameKey, product);
        }
      }

      return map;
    },
    [liveProducts],
  );
  const productLookupByName = useMemo(
    () =>
      new Map(
        liveProducts.map((product) => [String(product.name ?? "").trim().toLowerCase(), product]),
      ),
    [liveProducts],
  );

  useEffect(() => {
    let active = true;

    const refreshSiteBanner = async () => {
      const banner = await loadStoredSiteBanner();

      if (!active) {
        return;
      }

      setSiteBanner(normalizeSiteBanner(banner ?? defaultSiteBanner));
    };

    void refreshSiteBanner();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!isCartDrawerOpen || typeof window === "undefined") {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setIsCartDrawerOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isCartDrawerOpen]);

  useEffect(() => {
    let isMounted = true;

    const restoreSession = async (session) => {
      const requestId = ++authRequestIdRef.current;

      if (!session?.user) {
        if (!isMounted || requestId !== authRequestIdRef.current) {
          return;
        }

        clearSessionUser();
        clearAdminSession();
        clearPaymentSession();
        clearCheckoutDraft();
        setAuthSession(null);
        setAuthUser(null);
        setAuthError("");
        setAuthReady(true);
        return;
      }

      if (!isMounted || requestId !== authRequestIdRef.current) {
        return;
      }

      setAuthReady(false);
      setAuthError("");
      setAuthSession(session);

      try {
        const { data: profile, error } = await supabase
          .from("profiles")
          .select(
            "id, full_name, email, phone_number, photo_url, date_of_birth, gender, role, account_type, status, created_at, updated_at",
          )
          .eq("id", session.user.id)
          .maybeSingle();

        if (!isMounted || requestId !== authRequestIdRef.current) {
          return;
        }

        if (error) {
          throw error;
        }

        if (!profile) {
          clearSessionUser();
          clearAdminSession();
          setAuthUser(null);
          setAuthError("We signed you in, but your profile could not be loaded.");
          setAuthReady(true);
          return;
        }

        const mappedProfile = mapProfileToAuthUser(profile, session.user);
        setAuthUser(mappedProfile);
        saveSessionUser(mappedProfile);

        if (isActiveAdminProfile(mappedProfile)) {
          saveAdminSession(mappedProfile);
        } else {
          clearAdminSession();
        }

        setAuthError("");
        setAuthReady(true);
      } catch (error) {
        if (!isMounted || requestId !== authRequestIdRef.current) {
          return;
        }

        clearSessionUser();
        clearAdminSession();
        setAuthUser(null);
        setAuthError(
          error?.message || "Profile loading failed. Please sign in again.",
        );
        setAuthReady(true);
      }
    };

    const initialize = async () => {
      const { data, error } = await supabase.auth.getSession();

      if (!isMounted) {
        return;
      }

      if (error) {
        setAuthError(error.message || "Unable to restore your session.");
        setAuthReady(true);
        return;
      }

      await restoreSession(data?.session ?? null);
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      void restoreSession(session);
    });

    void initialize();

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!authReady) {
      return undefined;
    }

    let isMounted = true;
    const requestId = ++orderRequestIdRef.current;
    setOrdersLoading(true);
    setOrdersError("");

    const refreshOrders = async () => {
      if (!authUser) {
        if (!isMounted || requestId !== orderRequestIdRef.current) {
          return;
        }

        setOrders([]);
        setOrdersLoading(false);
        return;
      }

      try {
        const result = await loadOrders({ authUser });

        if (!isMounted || requestId !== orderRequestIdRef.current) {
          return;
        }

        if (result.ok) {
          setOrders(result.orders ?? []);
          setOrdersError("");
        } else {
          setOrders([]);
          setOrdersError(result.message || "Unable to load your orders.");
        }
      } catch (error) {
        if (!isMounted || requestId !== orderRequestIdRef.current) {
          return;
        }

        setOrders([]);
        setOrdersError(error?.message || "Unable to load your orders.");
      } finally {
        if (isMounted && requestId === orderRequestIdRef.current) {
          setOrdersLoading(false);
        }
      }
    };

    void refreshOrders();

    return () => {
      isMounted = false;
      orderRequestIdRef.current += 1;
    };
  }, [authReady, authUser?.id, authUser?.role, authUser?.status]);

  useEffect(() => {
    if (!authReady) {
      return undefined;
    }

    let isMounted = true;
    const requestId = ++notificationRequestIdRef.current;
    setNotificationsLoading(true);
    setNotificationsError("");

    const refreshNotifications = async () => {
      if (!authUser) {
        if (!isMounted || requestId !== notificationRequestIdRef.current) {
          return;
        }

        setNotifications([]);
        setNotificationsLoading(false);
        return;
      }

      try {
        const result = await loadNotifications({ authUser });

        if (!isMounted || requestId !== notificationRequestIdRef.current) {
          return;
        }

        if (result.ok) {
          setNotifications(result.notifications ?? []);
          setNotificationsError("");
        } else {
          setNotifications([]);
          setNotificationsError(result.message || "Unable to load your notifications.");
        }
      } catch (error) {
        if (!isMounted || requestId !== notificationRequestIdRef.current) {
          return;
        }

        setNotifications([]);
        setNotificationsError(error?.message || "Unable to load your notifications.");
      } finally {
        if (isMounted && requestId === notificationRequestIdRef.current) {
          setNotificationsLoading(false);
        }
      }
    };

    void refreshNotifications();

    return () => {
      isMounted = false;
      notificationRequestIdRef.current += 1;
    };
  }, [authReady, authUser?.id, authUser?.role, authUser?.status]);

  useEffect(() => {
    if (!authReady) {
      return undefined;
    }

    if (!authUser) {
      addressRequestIdRef.current += 1;
      setAddresses([]);
      return undefined;
    }

    let isMounted = true;
    const requestId = ++addressRequestIdRef.current;
    setAddresses(null);

    const refreshAddresses = async () => {
      try {
        const result = await loadAddresses();

        if (!isMounted || requestId !== addressRequestIdRef.current) {
          return;
        }

        if (result.ok) {
          setAddresses(result.addresses);
          return;
        }

        setAddresses([]);
      } catch {
        if (!isMounted || requestId !== addressRequestIdRef.current) {
          return;
        }

        setAddresses([]);
      }
    };

    void refreshAddresses();

    return () => {
      isMounted = false;
    };
  }, [authReady, authUser?.id]);

  useEffect(() => {
    if (!authReady) {
      return undefined;
    }

    let isMounted = true;
    const requestId = ++cartRequestIdRef.current;
    setCartLoading(true);
    setCartError("");

    const refreshCart = async () => {
      const result = await loadCartState(liveProducts);

      if (!isMounted || requestId !== cartRequestIdRef.current) {
        return;
      }

      setCartItems(result.ok ? result.items ?? [] : []);
      setCartError(result.ok ? "" : result.message || "Unable to load your cart.");
      setCartLoading(false);
    };

    void refreshCart();

    return () => {
      isMounted = false;
      cartRequestIdRef.current += 1;
    };
  }, [authReady, authUser?.id, liveProducts]);

  useEffect(() => {
    if (!authReady) {
      return undefined;
    }

    let isMounted = true;
    const requestId = ++wishlistRequestIdRef.current;
    setWishlistLoading(true);
    setWishlistError("");

    const refreshWishlist = async () => {
      const result = await loadWishlistState(liveProducts);

      if (!isMounted || requestId !== wishlistRequestIdRef.current) {
        return;
      }

      setWishlistItems(result.ok ? result.items ?? [] : []);
      setWishlistError(result.ok ? "" : result.message || "Unable to load your wishlist.");
      setWishlistLoading(false);
    };

    void refreshWishlist();

    return () => {
      isMounted = false;
      wishlistRequestIdRef.current += 1;
    };
  }, [authReady, authUser?.id, liveProducts]);

  const handleAuthProfileUpdate = (nextUser) => {
    const mappedProfile = mapProfileToAuthUser(nextUser ?? {});
    setAuthUser(mappedProfile);
    saveSessionUser(mappedProfile);

    if (isActiveAdminProfile(mappedProfile)) {
      saveAdminSession(mappedProfile);
    } else {
      clearAdminSession();
    }

    return { ok: true, user: mappedProfile };
  };

  const handleSignup = handleAuthProfileUpdate;

  const handleLogin = handleAuthProfileUpdate;

  const handleAdminLogin = handleAuthProfileUpdate;

  const handleLogout = async () => {
    clearSessionUser();
    clearAdminSession();
    clearPaymentSession();
    clearCheckoutDraft();
    addressRequestIdRef.current += 1;
    cartRequestIdRef.current += 1;
    wishlistRequestIdRef.current += 1;
    notificationRequestIdRef.current += 1;
    clearGuestCartDraft();
    clearGuestWishlistDraft();
    setAddresses([]);
    setCartItems([]);
    setWishlistItems([]);
    setNotifications([]);
    setCartLoading(false);
    setWishlistLoading(false);
    setNotificationsLoading(false);
    setCartError("");
    setWishlistError("");
    setNotificationsError("");
    setAuthUser(null);
    setAuthSession(null);
    setAuthError("");

    try {
      await supabase.auth.signOut();
    } catch {
      // Intentionally ignore sign-out failures after local cleanup.
    }
  };

  const handleUpdateAuthUser = (nextUser) => {
    const mappedProfile = mapProfileToAuthUser(nextUser ?? {});
    setAuthUser(mappedProfile);
    saveSessionUser(mappedProfile);

    if (isActiveAdminProfile(mappedProfile)) {
      saveAdminSession(mappedProfile);
    } else {
      clearAdminSession();
    }

    return mappedProfile;
  };

  const handleAdminLogout = async () => {
    await handleLogout();
  };

  const handleSaveAddress = async (fields) => {
    const trimmedId = String(fields?.id ?? "").trim();
    const result = trimmedId
      ? await updateAddress(trimmedId, fields)
      : await createAddress(fields);

    if (result.ok) {
      setAddresses(result.addresses);
    }

    return result;
  };

  const handleDeleteAddress = async (addressId) => {
    const result = await deleteAddress(addressId);

    if (result.ok) {
      setAddresses(result.addresses);
    }

    return result;
  };

  const handleSetDefaultAddress = async (addressId) => {
    const result = await setDefaultAddress(addressId);

    if (result.ok) {
      setAddresses(result.addresses);
    }

    return result;
  };

  const handleMarkNotificationRead = async (notificationId, isRead = true) => {
    const result = await markNotificationAsRead(notificationId, isRead, {
      authUser,
    });

    if (!result.ok) {
      return result;
    }

    if (result.notification) {
      setNotifications((current) =>
        current.map((notification) =>
          notification.id === result.notification.id
            ? { ...notification, ...result.notification }
            : notification,
        ),
      );
    }

    return result;
  };

  const handleMarkAllNotificationsRead = async () => {
    const result = await markAllNotificationsRead({ authUser });

    if (!result.ok) {
      return result;
    }

    if (Array.isArray(result.notifications) && result.notifications.length > 0) {
      setNotifications((current) =>
        current.map((notification) => {
          const updated = result.notifications.find(
            (item) => item.id === notification.id,
          );

          return updated ? { ...notification, ...updated } : notification;
        }),
      );
    } else {
      setNotifications((current) =>
        current.map((notification) =>
          notification.userId === authUser?.id || notification.customerId === authUser?.id
            ? {
                ...notification,
                read: true,
                isRead: true,
                readAt: notification.readAt ?? new Date().toISOString(),
              }
            : notification,
        ),
      );
    }

    return result;
  };

  const handleAddToCart = (productOrSlug, quantity = 1, variantSelection = {}) => {
    if (!productOrSlug) {
      return;
    }

    const safeQuantity = Math.max(Number(quantity) || 0, 1);
    const safeVariant =
      variantSelection && typeof variantSelection === "object"
        ? variantSelection
        : {};

    const product =
      typeof productOrSlug === "string"
        ? productLookup.get(String(productOrSlug).trim().toLowerCase()) ??
          productLookup.get(String(productOrSlug).trim()) ??
          liveProducts.find(
            (item) =>
              String(item?.slug ?? "").trim().toLowerCase() ===
                String(productOrSlug).trim().toLowerCase() ||
              String(item?.name ?? "").trim().toLowerCase() ===
                String(productOrSlug).trim().toLowerCase() ||
              String(item?.id ?? "").trim() === String(productOrSlug).trim(),
          ) ??
          null
        : productOrSlug;
    if (!product) {
      return;
    }

    const syncCart = async () => {
        const result = await addCartLine({
          product,
          quantity: safeQuantity,
          selectedColor: safeVariant.color ?? "",
          selectedSize: safeVariant.size ?? "",
          selectedOptions: Array.isArray(safeVariant.selectedOptions) ? safeVariant.selectedOptions : [],
          variantKey: safeVariant.variantKey ?? "",
          products: liveProducts,
        });

      if (result.ok) {
        setCartItems(result.items ?? []);
        setCartError("");
        setIsCartDrawerOpen(true);
        return;
      }

      setCartError(result.message || "Unable to add the product to your cart.");
    };

    void syncCart();
  };

  const handleUpdateCartQuantity = (productSlug, quantity) => {
    const target = cartItems.find((item) => getCartItemKey(item) === productSlug);

    if (!target) {
      return;
    }

    const targetProduct = {
      id: target.productId ?? target.id ?? "",
      slug: target.slug ?? "",
      name: target.name ?? "",
    };

    const syncCartQuantity = async () => {
      const result = await setCartLineQuantity({
        product: targetProduct,
        quantity,
        selectedColor: target.selectedColor ?? target.variant?.color ?? "",
        selectedSize: target.selectedSize ?? target.variant?.size ?? "",
        selectedOptions: target.selectedOptions ?? target.variant?.options ?? [],
        variantKey: target.variantKey ?? "",
        products: liveProducts,
      });

      if (result.ok) {
        setCartItems(result.items ?? []);
        setCartError("");
        return;
      }

      setCartError(result.message || "Unable to update the cart item.");
    };

    void syncCartQuantity();
  };

  const handleRemoveCartItem = (productSlug) => {
    const target = cartItems.find((item) => getCartItemKey(item) === productSlug);

    if (!target) {
      return;
    }

    const targetProduct = {
      id: target.productId ?? target.id ?? "",
      slug: target.slug ?? "",
      name: target.name ?? "",
    };

    const syncCartRemoval = async () => {
      const result = await removeCartLine({
        product: targetProduct,
        selectedColor: target.selectedColor ?? target.variant?.color ?? "",
        selectedSize: target.selectedSize ?? target.variant?.size ?? "",
        selectedOptions: target.selectedOptions ?? target.variant?.options ?? [],
        variantKey: target.variantKey ?? "",
        products: liveProducts,
      });

      if (result.ok) {
        setCartItems(result.items ?? []);
        setCartError("");
        return;
      }

      setCartError(result.message || "Unable to remove the cart item.");
    };

    void syncCartRemoval();
  };

  const handleClearCart = () => {
    const syncCartClear = async () => {
      const result = await clearCartState({ products: liveProducts });

      if (result.ok) {
        setCartItems(result.items ?? []);
        setCartError("");
        return;
      }

      setCartError(result.message || "Unable to clear the cart.");
    };

    void syncCartClear();
  };

  const handleUpdateOrder = (orderId, updates = {}) => {
    let updatedOrder = null;

    setOrders((current) => {
      const target = current.find((order) => order.id === orderId);
      if (!target) {
        return current;
      }

      updatedOrder = { ...target, ...updates };
      return updateOrderById(current, orderId, updates);
    });

    return updatedOrder
      ? { ok: true, order: updatedOrder }
      : { ok: false, message: "Order not found." };
  };

  const handleAdminUpdateOrderStatus = async (orderId, status) => {
    const result = await updateOrderStatus(orderId, status);

    if (!result.ok) {
      return result;
    }

    setOrders((current) =>
      updateOrderById(current, orderId, {
        ...result.order,
        status: result.order.status,
        deliveredAt: result.order.deliveredAt ?? null,
        updatedAt: result.order.updatedAt,
      }),
    );

    return result;
  };

  const handleCreateNotification = async (fields) => {
    const { title, message, customer, category } = fields ?? {};

    if (!title?.trim() || !message?.trim()) {
      return { ok: false, message: "Please add a title and message." };
    }

    const pendingPayload = {
      ...fields,
      title,
      message,
      category: category ?? "announcement",
    };

    if (customer?.id) {
      const result = await createNotification(
        {
          ...pendingPayload,
          customer,
        },
        {
          authUser,
        },
      );

      if (result.ok && result.notification) {
        setNotifications((current) => [result.notification, ...current]);
      }

      return result;
    }

    const { data: customerRows, error } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .eq("role", "customer")
      .eq("status", "active");

    if (error) {
      return { ok: false, message: error.message || "Unable to load announcement recipients." };
    }

    const recipients = Array.isArray(customerRows) ? customerRows : [];
    const createdNotifications = [];

    for (const recipient of recipients) {
      const result = await createNotification(
        {
          ...pendingPayload,
          customer: {
            id: recipient.id,
            name: recipient.full_name,
            email: recipient.email,
          },
        },
        {
          authUser,
        },
      );

      if (!result.ok || !result.notification) {
        return result;
      }

      createdNotifications.push(result.notification);
    }

    if (createdNotifications.length > 0) {
      setNotifications((current) => [
        ...createdNotifications,
        ...current.filter(
          (notification) =>
            !createdNotifications.some((created) => created.id === notification.id),
        ),
      ]);
    }

    return {
      ok: true,
      notifications: createdNotifications,
    };
  };

  const handleUpdateSiteBanner = async (fields = {}) => {
    const nextBanner = normalizeSiteBanner({
      ...(siteBanner ?? defaultSiteBanner),
      ...fields,
      updatedAt: new Date().toISOString(),
    });

    const result = await saveStoredSiteBanner(nextBanner);

    if (result.ok && result.banner) {
      setSiteBanner(result.banner);
    }

    return result;
  };

  const handleToggleWishlist = (itemName) => {
    const normalizedName = String(itemName ?? "").trim().toLowerCase();
    const product =
      productLookupByName.get(normalizedName) ??
      liveProducts.find(
        (item) =>
          String(item.name ?? "").trim().toLowerCase() === normalizedName ||
          String(item.slug ?? "").trim().toLowerCase() === normalizedName,
      ) ??
      null;

    if (!product) {
      return;
    }

    const syncWishlist = async () => {
      const result = await toggleWishlistItem({
        product,
        products: liveProducts,
      });

      if (result.ok) {
        setWishlistItems(result.items ?? []);
        setWishlistError("");
        return;
      }

      setWishlistError(result.message || "Unable to update the wishlist.");
    };

    void syncWishlist();
  };

  const cartCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <BrowserRouter>
      <AppShell
        cartCount={cartCount}
        cartItems={cartItems}
        cartLoading={cartLoading}
        cartError={cartError}
        addresses={addresses}
        orders={orders}
        notifications={notifications}
        notificationsLoading={notificationsLoading}
        notificationsError={notificationsError}
        siteBanner={siteBanner}
        wishlistItems={wishlistItems}
        wishlistLoading={wishlistLoading}
        wishlistError={wishlistError}
        productLookup={productLookup}
        authUser={authUser}
        authSession={authSession}
        authReady={authReady}
        authError={authError}
        ordersLoading={ordersLoading}
        ordersError={ordersError}
        onAddToCart={handleAddToCart}
        onToggleWishlist={handleToggleWishlist}
        onSaveAddress={handleSaveAddress}
        onDeleteAddress={handleDeleteAddress}
        onSetDefaultAddress={handleSetDefaultAddress}
        onUpdateCartQuantity={handleUpdateCartQuantity}
        onRemoveCartItem={handleRemoveCartItem}
        onClearCart={handleClearCart}
        onCreateNotification={handleCreateNotification}
        onReplaceOrders={setOrders}
        onMarkNotificationRead={handleMarkNotificationRead}
        onMarkAllNotificationsRead={handleMarkAllNotificationsRead}
        onUpdateOrderStatus={handleAdminUpdateOrderStatus}
        onUpdateOrder={handleUpdateOrder}
        onUpdateSiteBanner={handleUpdateSiteBanner}
        onUpdateAuthUser={handleUpdateAuthUser}
        onLogout={handleLogout}
        onAdminLogout={handleAdminLogout}
        isCartDrawerOpen={isCartDrawerOpen}
        onCloseCartDrawer={() => setIsCartDrawerOpen(false)}
        onLogin={handleLogin}
        onSignup={handleSignup}
      />
    </BrowserRouter>
  );
}

export default App;
