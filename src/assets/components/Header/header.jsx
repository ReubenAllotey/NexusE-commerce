import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { getCategoryProductsPath } from "../../../pages/Home/catalogData";
import { getCategoryProductCount, useCategoryTree } from "../../../shared/categoryStorage";
import { useProducts } from "../../../pages/Products/productData";
import MobileDrawer from "../../../shared/mobileDrawer";

function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function HeartIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 20.8s-7.8-5.4-9.5-10.4C1 6.8 3.1 3.2 6.9 2.7c2.5-.3 4.4.8 5.8 2.8 1.4-2 3.3-3.1 5.8-2.8 3.8.5 5.9 4.1 4.4 7.7-1.7 5-9.5 10.4-9.5 10.4Z" />
    </svg>
  );
}

function CartIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 4h2.5l2 11h11.2l1.6-7H8" />
      <path d="M8.4 15h9.9" />
      <circle cx="10.4" cy="20" r="1.4" />
      <circle cx="18.1" cy="20" r="1.4" />
    </svg>
  );
}

function ProfileIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M15 17H9" />
      <path d="M18 17H6l1.5-2V10a4.5 4.5 0 0 1 9 0v5l1.5 2Z" />
      <path d="M10 18a2 2 0 0 0 4 0" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2.5 12h2M19.5 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M19.5 14.5A8.5 8.5 0 0 1 9.5 4.5 8.5 8.5 0 1 0 19.5 14.5Z" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 11.5 12 5l8 6.5V20H4z" />
      <path d="M9 20v-6h6v6" />
    </svg>
  );
}

function ShopIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16l-1.2 12H5.2L4 7Z" />
      <path d="M8 7a4 4 0 0 1 8 0" />
    </svg>
  );
}

function CategoriesIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 5h5v5H5zM14 5h5v5h-5zM5 14h5v5H5zM14 14h5v5h-5z" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 12h.01M12 12h.01M18 12h.01" />
    </svg>
  );
}

function flattenCategories(categories = [], parentName = "") {
  return (Array.isArray(categories) ? categories : []).flatMap((category) => {
    const current = {
      ...category,
      parentName,
    };

    const children = flattenCategories(Array.isArray(category.children) ? category.children : [], category.name);

    return [current, ...children];
  });
}

function Header({
  cartCount = 0,
  wishlistCount = 0,
  notificationCount = 0,
  authUser = null,
  onLogout = () => {},
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { tree: categoryTree, loading: categoriesLoading, error: categoriesError } = useCategoryTree();
  const { products: catalogProducts } = useProducts();
  const [searchValue, setSearchValue] = useState("");
  const [theme, setTheme] = useState(() => {
    if (typeof window === "undefined") {
      return "light";
    }
    return window.localStorage.getItem("nexus-theme") || "light";
  });
  const [isCategoriesSheetOpen, setIsCategoriesSheetOpen] = useState(false);

  const categoryLinks = categoryTree.map((category) => ({
    label: category.name,
    to: getCategoryProductsPath(category.slug),
    children: Array.isArray(category.children) ? category.children : [],
  }));
  const categoryMenuItems = useMemo(
    () =>
      flattenCategories(categoryTree)
        .filter((category) => Boolean(category?.slug))
        .map((category) => ({
          ...category,
          to: getCategoryProductsPath(category.slug),
          count: getCategoryProductCount(category, catalogProducts),
        })),
    [catalogProducts, categoryTree],
  );

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    document.documentElement.dataset.theme = theme;
    document.body.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem("nexus-theme", theme);
  }, [theme]);

  useEffect(() => {
    setIsCategoriesSheetOpen(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const hidden =
      location.pathname.startsWith("/admin") ||
      location.pathname.startsWith("/payment") ||
      location.pathname.startsWith("/receipt") ||
      location.pathname.startsWith("/account/set-password") ||
      location.pathname.startsWith("/register");

    document.body.dataset.mobileBottomNav = hidden ? "false" : "true";
  }, [location.pathname]);

  const handleSearchSubmit = (event) => {
    event.preventDefault();
    const term = searchValue.trim();
    navigate(term ? `/products?search=${encodeURIComponent(term)}` : "/products");
  };
  const toggleTheme = () => {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  };
  const isActivePath = (path) =>
    path === "/"
      ? location.pathname === path
      : location.pathname === path || location.pathname.startsWith(`${path}/`);
  const isCompanyActive = isActivePath("/about") || isActivePath("/contact");
  const isBottomNavHidden =
    location.pathname.startsWith("/admin") ||
    location.pathname.startsWith("/payment") ||
    location.pathname.startsWith("/receipt") ||
    location.pathname.startsWith("/account/set-password") ||
    location.pathname.startsWith("/register");
  const isAccountActive = authUser
    ? location.pathname.startsWith("/profile")
    : location.pathname.startsWith("/register");
  const accountHref = authUser ? "/profile/dashboard" : "/register/login";
  const accountLabel = authUser ? "Account" : "Sign In";
  const isCategoriesActive =
    location.pathname === "/products" && location.search.includes("category=");

  return (
    <header className="site-header">
      <div className="site-shell site-header__inner">
        <Link to="/" className="site-brand" aria-label="Exclusive home">
          Nexus Imports
        </Link>

        <nav className="site-nav" aria-label="Primary">
          <Link to="/" className={isActivePath("/") ? "is-active" : ""}>
            Home
          </Link>
          <Link
            to="/products"
            className={`site-nav__link ${isActivePath("/products") ? "is-active" : ""}`.trim()}
          >
            Shop
          </Link>
          <details className="site-nav__group">
            <summary className="site-nav__trigger">
              Categories
              <ChevronDownIcon />
            </summary>
            <div className="site-nav__menu site-nav__menu--mega" aria-label="Categories menu">
              {categoriesError ? (
                <div className="site-nav__menu-empty">Unable to load categories.</div>
              ) : categoriesLoading && categoryLinks.length === 0 ? (
                <div className="site-nav__menu-empty">Loading categories...</div>
              ) : categoryMenuItems.length > 0 ? (
                <div className="site-nav__menu-grid">
                  {categoryMenuItems.map((item) => (
                    <Link className="site-nav__menu-card" to={item.to} key={item.id}>
                      <span className="site-nav__menu-thumb" aria-hidden="true">
                        <img src={item.image} alt="" loading="lazy" />
                      </span>
                      <span className="site-nav__menu-copy">
                        <strong>{item.name}</strong>
                        <span>{item.count} products</span>
                      </span>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="site-nav__menu-empty">No categories available.</div>
              )}
            </div>
          </details>
          <details className="site-nav__group">
            <summary className={`site-nav__trigger ${isCompanyActive ? "is-active" : ""}`.trim()}>
              Company
              <ChevronDownIcon />
            </summary>
            <div className="site-nav__menu" aria-label="Company menu">
              <Link className="site-nav__menu-parent" to="/about">
                About
              </Link>
              <Link className="site-nav__menu-parent" to="/contact">
                Contact
              </Link>
            </div>
          </details>
        </nav>

        <form className="site-search" role="search" onSubmit={handleSearchSubmit}>
          <span className="site-search__icon" aria-hidden="true">
            <SearchIcon />
          </span>
          <input
            type="search"
            value={searchValue}
            onChange={(event) => setSearchValue(event.target.value)}
            placeholder="Search products or categories..."
            aria-label="Search products, brands, categories"
          />
        </form>

        <div className="site-actions">
          <Link
            to="/products"
            className="site-header__mobile-search"
            aria-label="Search products"
          >
            <SearchIcon />
          </Link>
          <Link
            to="/wishlist"
            className="site-actions__icon-button site-actions__icon-button--wishlist"
            aria-label={`Wishlist, ${wishlistCount} items`}
          >
            <HeartIcon />
            {wishlistCount > 0 ? <span className="site-actions__badge">{wishlistCount}</span> : null}
          </Link>
          <button
            type="button"
            className="site-actions__icon-button site-actions__icon-button--theme"
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
          </button>
        </div>
      </div>

      {!isBottomNavHidden ? (
        <nav className="site-mobile-tabs" aria-label="Mobile navigation">
          <Link
            to="/"
            className={`site-mobile-tabs__item ${isActivePath("/") ? "is-active" : ""}`.trim()}
          >
            <HomeIcon />
            <span>Home</span>
          </Link>
          <Link
            to="/products"
            className={`site-mobile-tabs__item ${isActivePath("/products") ? "is-active" : ""}`.trim()}
          >
            <ShopIcon />
            <span>Shop</span>
          </Link>
          <button
            type="button"
            className={`site-mobile-tabs__item ${isCategoriesActive || isCategoriesSheetOpen ? "is-active" : ""}`.trim()}
            onClick={() => setIsCategoriesSheetOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={isCategoriesSheetOpen}
            aria-controls="mobile-category-sheet"
          >
            <CategoriesIcon />
            <span>Categories</span>
          </button>
          <Link
            to={accountHref}
            className={`site-mobile-tabs__item ${isAccountActive ? "is-active" : ""}`.trim()}
          >
            <ProfileIcon />
            <span>{accountLabel}</span>
          </Link>
          <Link
            to="/cart"
            className={`site-mobile-tabs__item ${isActivePath("/cart") ? "is-active" : ""}`.trim()}
          >
            <span className="site-mobile-tabs__badge-wrap">
              <CartIcon />
              {cartCount > 0 ? <span className="site-mobile-tabs__badge">{cartCount}</span> : null}
            </span>
            <span>Cart</span>
          </Link>
        </nav>
      ) : null}

      <MobileDrawer
        open={isCategoriesSheetOpen}
        onClose={() => setIsCategoriesSheetOpen(false)}
        title="Categories"
        className="site-mobile-categories-drawer"
        maxWidth="100%"
      >
        <div className="site-mobile-categories-sheet" id="mobile-category-sheet">
          <div className="site-mobile-categories-sheet__header">
            <strong>Categories</strong>
          </div>
          <div className="site-mobile-categories-sheet__list">
            {categoriesError ? (
              <p className="site-mobile-categories-sheet__empty">Unable to load categories.</p>
            ) : categoriesLoading && categoryMenuItems.length === 0 ? (
              <p className="site-mobile-categories-sheet__empty">Loading categories...</p>
            ) : categoryMenuItems.length > 0 ? (
              categoryMenuItems.map((item) => (
                <Link
                  key={item.id}
                  to={item.to}
                  className="site-mobile-categories-sheet__item"
                  onClick={() => setIsCategoriesSheetOpen(false)}
                >
                  <span className="site-mobile-categories-sheet__thumb" aria-hidden="true">
                    <img src={item.image} alt="" loading="lazy" />
                  </span>
                  <span className="site-mobile-categories-sheet__copy">
                    <strong>{item.name}</strong>
                    <span>{item.count} products</span>
                  </span>
                </Link>
              ))
            ) : (
              <p className="site-mobile-categories-sheet__empty">No categories available.</p>
            )}
          </div>
        </div>
      </MobileDrawer>
    </header>
  );
}

export default Header;
