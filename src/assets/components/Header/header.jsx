import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import logo from "../../../assets/images/nexuslogo.png";
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

function Header({ cartCount = 0, wishlistCount = 0, authUser = null, onLogout = () => {} }) {
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
  const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false);
  const [isCategoriesSheetOpen, setIsCategoriesSheetOpen] = useState(false);
  const [isMoreSheetOpen, setIsMoreSheetOpen] = useState(false);
  const mobileSearchInputRef = useRef(null);

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
    setIsMobileSearchOpen(false);
    setIsCategoriesSheetOpen(false);
    setIsMoreSheetOpen(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (isMobileSearchOpen) {
      mobileSearchInputRef.current?.focus();
    }
  }, [isMobileSearchOpen]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const hidden =
      location.pathname.startsWith("/admin") ||
      location.pathname.startsWith("/payment") ||
      location.pathname.startsWith("/receipt") ||
      location.pathname.startsWith("/account/set-password");

    document.body.dataset.mobileBottomNav = hidden ? "false" : "true";
  }, [location.pathname]);

  const isActivePath = (path) =>
    path === "/"
      ? location.pathname === path
      : location.pathname === path || location.pathname.startsWith(`${path}/`);

  const isCompanyActive = isActivePath("/about") || isActivePath("/contact");
  const isCategoriesActive =
    location.pathname === "/products" && location.search.includes("category=");
  const isAccountActive = authUser ? location.pathname.startsWith("/profile") : location.pathname.startsWith("/register");
  const accountHref = authUser ? "/profile/dashboard" : "/register/login";
  const accountLabel = authUser ? "Account" : "Sign In";
  const mobileAccountLabel = authUser ? "Profile" : "Get Started";
  const mobileAccountCompactLabel = authUser ? "Profile" : "Start";
  const isMoreActive = isMoreSheetOpen || isCompanyActive;
  const isMobileNavHidden =
    location.pathname.startsWith("/admin") ||
    location.pathname.startsWith("/payment") ||
    location.pathname.startsWith("/receipt") ||
    location.pathname.startsWith("/account/set-password");

  const handleSearchSubmit = (event) => {
    event.preventDefault();
    const term = searchValue.trim();
    navigate(term ? `/products?search=${encodeURIComponent(term)}` : "/products");
    setIsMobileSearchOpen(false);
  };

  const toggleTheme = () => {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  };

  return (
    <header className="nexus-header">
      <div className="site-shell nexus-header__inner">
        <Link to="/" className="nexus-header__brand" aria-label="Nexus Import Hub home">
          <img src={logo} alt="Nexus Imports" />
        </Link>

        <nav className="nexus-header__nav" aria-label="Primary">
          <Link to="/" className={isActivePath("/") ? "is-active" : ""}>
            Home
          </Link>
          <Link to="/products" className={isActivePath("/products") ? "is-active" : ""}>
            Shop
          </Link>
          <details className="nexus-header__group">
            <summary className={`nexus-header__trigger ${isCategoriesActive ? "is-active" : ""}`.trim()}>
              Categories
              <ChevronDownIcon />
            </summary>
            <div className="nexus-header__menu nexus-header__menu--mega" aria-label="Categories menu">
              {categoriesError ? (
                <div className="nexus-header__menu-empty">Unable to load categories.</div>
              ) : categoriesLoading && categoryMenuItems.length === 0 ? (
                <div className="nexus-header__menu-empty">Loading categories...</div>
              ) : categoryMenuItems.length > 0 ? (
                <div className="nexus-header__menu-grid">
                  {categoryMenuItems.map((item) => (
                    <Link className="nexus-header__menu-card" to={item.to} key={item.id}>
                      <span className="nexus-header__menu-thumb" aria-hidden="true">
                        <img src={item.image} alt="" loading="lazy" />
                      </span>
                      <span className="nexus-header__menu-copy">
                        <strong>{item.name}</strong>
                        <span>{item.count} products</span>
                      </span>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="nexus-header__menu-empty">No categories available.</div>
              )}
            </div>
          </details>
          <details className="nexus-header__group">
            <summary className={`nexus-header__trigger ${isCompanyActive ? "is-active" : ""}`.trim()}>
              Company
              <ChevronDownIcon />
            </summary>
            <div className="nexus-header__menu" aria-label="Company menu">
              <Link className="nexus-header__menu-parent" to="/about">
                About
              </Link>
              <Link className="nexus-header__menu-parent" to="/contact">
                Contact
              </Link>
            </div>
          </details>
        </nav>

        <form className="nexus-header__search" role="search" onSubmit={handleSearchSubmit}>
          <span className="nexus-header__search-icon" aria-hidden="true">
            <SearchIcon />
          </span>
          <input
            type="search"
            value={searchValue}
            onChange={(event) => setSearchValue(event.target.value)}
            placeholder="Search products..."
            aria-label="Search products or categories"
          />
          <button type="submit" aria-label="Search">
            <SearchIcon />
          </button>
        </form>

        <div className="nexus-header__actions">
          {authUser ? (
            <Link
              to="/profile/dashboard"
              className="nexus-header__signin"
              aria-label={`${authUser.name || "Account"} profile`}
            >
              <ProfileIcon />
              <span>{accountLabel}</span>
            </Link>
          ) : (
            <Link className="nexus-header__signin" to="/register/login">
              <ProfileIcon />
              <span>{accountLabel}</span>
            </Link>
          )}

          <Link
            to="/wishlist"
            className="nexus-header__icon-button nexus-header__icon-button--wishlist"
            aria-label={`Wishlist, ${wishlistCount} items`}
          >
            <HeartIcon />
            {wishlistCount > 0 ? <span className="nexus-header__badge">{wishlistCount}</span> : null}
          </Link>

          <Link
            to="/cart"
            className="nexus-header__icon-button nexus-header__icon-button--cart"
            aria-label={`Cart, ${cartCount} items`}
          >
            <CartIcon />
            {cartCount > 0 ? <span className="nexus-header__badge">{cartCount}</span> : null}
          </Link>

          <button
            type="button"
            className="nexus-header__icon-button nexus-header__icon-button--theme"
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
          </button>
        </div>

        <button
          type="button"
          className="nexus-header__mobile-search-button"
          onClick={() => setIsMobileSearchOpen((current) => !current)}
          aria-label="Search products"
          aria-expanded={isMobileSearchOpen}
          aria-controls="nexus-mobile-search-panel"
        >
          <SearchIcon />
        </button>

        {isMobileSearchOpen ? (
          <form
            id="nexus-mobile-search-panel"
            className="nexus-header__mobile-search-panel"
            role="search"
            onSubmit={handleSearchSubmit}
          >
            <span className="nexus-header__mobile-search-icon" aria-hidden="true">
              <SearchIcon />
            </span>
            <input
              ref={mobileSearchInputRef}
              type="search"
              value={searchValue}
              onChange={(event) => setSearchValue(event.target.value)}
              placeholder="Search products or categories..."
              aria-label="Search products or categories"
            />
            <button type="submit">Search</button>
          </form>
        ) : null}
      </div>

      {!isMobileNavHidden ? (
        <nav className="nexus-mobile-nav" aria-label="Mobile navigation">
          <Link
            to="/"
            className={`nexus-mobile-nav__item ${isActivePath("/") ? "is-active" : ""}`.trim()}
            aria-label="Home"
          >
            <HomeIcon />
            <span>Home</span>
          </Link>
          <button
            type="button"
            className={`nexus-mobile-nav__item ${isCategoriesActive || isCategoriesSheetOpen ? "is-active" : ""}`.trim()}
            onClick={() => setIsCategoriesSheetOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={isCategoriesSheetOpen}
            aria-controls="nexus-mobile-categories-sheet"
            aria-label="Categories"
          >
            <CategoriesIcon />
            <span>Categories</span>
          </button>
          <Link
            to="/products"
            className={`nexus-mobile-nav__item ${isActivePath("/products") ? "is-active" : ""}`.trim()}
            aria-label="Shop"
          >
            <ShopIcon />
            <span>Shop</span>
          </Link>
          <button
            type="button"
            className={`nexus-mobile-nav__item ${isMoreActive ? "is-active" : ""}`.trim()}
            onClick={() => setIsMoreSheetOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={isMoreSheetOpen}
            aria-controls="nexus-mobile-more-sheet"
            aria-label="More"
          >
            <MoreIcon />
            <span>More</span>
          </button>
          <Link
            to="/cart"
            className={`nexus-mobile-nav__item ${isActivePath("/cart") ? "is-active" : ""}`.trim()}
            aria-label={`Cart, ${cartCount} items`}
          >
            <span className="nexus-mobile-nav__badge-wrap">
              <CartIcon />
              {cartCount > 0 ? <span className="nexus-mobile-nav__badge">{cartCount}</span> : null}
            </span>
            <span>Cart</span>
          </Link>
          <Link
            to="/wishlist"
            className={`nexus-mobile-nav__item ${isActivePath("/wishlist") ? "is-active" : ""}`.trim()}
            aria-label={`Wishlist, ${wishlistCount} items`}
          >
            <span className="nexus-mobile-nav__badge-wrap">
              <HeartIcon />
              {wishlistCount > 0 ? <span className="nexus-mobile-nav__badge">{wishlistCount}</span> : null}
            </span>
            <span>Wishlist</span>
          </Link>
          <Link
            to={accountHref}
            className={`nexus-mobile-nav__item ${isAccountActive ? "is-active" : ""}`.trim()}
            aria-label={authUser ? "Profile" : "Get Started"}
          >
            <ProfileIcon />
            <span className="nexus-mobile-nav__label nexus-mobile-nav__label--wide">{mobileAccountLabel}</span>
            <span className="nexus-mobile-nav__label nexus-mobile-nav__label--compact">
              {mobileAccountCompactLabel}
            </span>
          </Link>
        </nav>
      ) : null}

      <MobileDrawer
        open={isCategoriesSheetOpen}
        onClose={() => setIsCategoriesSheetOpen(false)}
        title="Categories"
        className="nexus-mobile-categories-drawer"
        maxWidth="100%"
      >
        <div className="nexus-mobile-categories-sheet" id="nexus-mobile-categories-sheet">
          <div className="nexus-mobile-categories-sheet__header">
            <strong>Categories</strong>
          </div>
          <div className="nexus-mobile-categories-sheet__list">
            {categoriesError ? (
              <p className="nexus-mobile-categories-sheet__empty">Unable to load categories.</p>
            ) : categoriesLoading && categoryMenuItems.length === 0 ? (
              <p className="nexus-mobile-categories-sheet__empty">Loading categories...</p>
            ) : categoryMenuItems.length > 0 ? (
              categoryMenuItems.map((item) => (
                <Link
                  key={item.id}
                  to={item.to}
                  className="nexus-mobile-categories-sheet__item"
                  onClick={() => setIsCategoriesSheetOpen(false)}
                >
                  <span className="nexus-mobile-categories-sheet__thumb" aria-hidden="true">
                    <img src={item.image} alt="" loading="lazy" />
                  </span>
                  <span className="nexus-mobile-categories-sheet__copy">
                    <strong>{item.name}</strong>
                    <span>{item.count} products</span>
                  </span>
                </Link>
              ))
            ) : (
              <p className="nexus-mobile-categories-sheet__empty">No categories available.</p>
            )}
          </div>
        </div>
      </MobileDrawer>

      <MobileDrawer
        open={isMoreSheetOpen}
        onClose={() => setIsMoreSheetOpen(false)}
        title="More"
        className="nexus-mobile-more-drawer"
        maxWidth="100%"
      >
        <div className="nexus-mobile-more-sheet" id="nexus-mobile-more-sheet">
          <div className="nexus-mobile-more-sheet__header">
            <strong>More</strong>
          </div>
          <div className="nexus-mobile-more-sheet__list">
            <Link
              to="/about"
              className="nexus-mobile-more-sheet__item"
              onClick={() => setIsMoreSheetOpen(false)}
            >
              Company
            </Link>
            <Link
              to="/about"
              className="nexus-mobile-more-sheet__item"
              onClick={() => setIsMoreSheetOpen(false)}
            >
              About
            </Link>
            <Link
              to="/contact"
              className="nexus-mobile-more-sheet__item"
              onClick={() => setIsMoreSheetOpen(false)}
            >
              Contact
            </Link>
          </div>
        </div>
      </MobileDrawer>
    </header>
  );
}

export default Header;
