import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { getCategoryProductsPath } from "../../../pages/Home/catalogData";
import { getCategoryProductCount, useCategoryTree } from "../../../shared/categoryStorage";
import MobileDrawer from "../../../shared/mobileDrawer";
import { useProducts } from "../../../pages/Products/productData";

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

function flattenCategoryTree(records = []) {
  const flattened = [];

  const visit = (category, parentName = "") => {
    flattened.push({
      ...category,
      parentName,
    });

    const children = Array.isArray(category?.children) ? category.children : [];

    children.forEach((child) => visit(child, category?.name ?? ""));
  };

  records.forEach((category) => visit(category));

  return flattened;
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
  const { products: catalogProducts, loading: productsLoading } = useProducts();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isCategoriesOpen, setIsCategoriesOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const categoriesMenuRef = useRef(null);
  const [theme, setTheme] = useState(() => {
    if (typeof window === "undefined") {
      return "light";
    }
    return window.localStorage.getItem("nexus-theme") || "light";
  });

  const categoryMenuItems = useMemo(() => {
    const visibleTree = Array.isArray(categoryTree) ? categoryTree : [];
    const flattened = flattenCategoryTree(visibleTree);

    return flattened
      .filter((category) => category && category.status === "active" && category.deletedAt == null)
      .map((category) => ({
        ...category,
        productCount: getCategoryProductCount(category, catalogProducts),
      }));
  }, [catalogProducts, categoryTree]);

  useEffect(() => {
    setIsMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    setIsCategoriesOpen(false);
  }, [location.pathname]);

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
    if (typeof document === "undefined") {
      return undefined;
    }

    const handlePointerDown = (event) => {
      if (categoriesMenuRef.current && !categoriesMenuRef.current.contains(event.target)) {
        setIsCategoriesOpen(false);
      }
    };

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setIsCategoriesOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const closeMenu = () => setIsMenuOpen(false);
  const closeCategoriesMenu = () => setIsCategoriesOpen(false);
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

  return (
    <header className="site-header">
      <div className="site-shell site-header__inner">
        <button
          type="button"
          className="site-header__menu-button"
          aria-label="Open navigation"
          aria-expanded={isMenuOpen}
          aria-controls="site-mobile-menu"
          onClick={() => setIsMenuOpen((current) => !current)}
        >
          <MenuIcon />
        </button>

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
          <div
            className="site-nav__mega"
            ref={categoriesMenuRef}
            onMouseEnter={() => setIsCategoriesOpen(true)}
            onMouseLeave={() => setIsCategoriesOpen(false)}
          >
            <button
              type="button"
              className={`site-nav__trigger site-nav__trigger--button${isCategoriesOpen ? " is-active" : ""}`.trim()}
              aria-expanded={isCategoriesOpen}
              aria-haspopup="menu"
              onClick={() => setIsCategoriesOpen((current) => !current)}
            >
              Categories
              <ChevronDownIcon />
            </button>
            <div
              className={`site-nav__menu site-nav__menu--mega${isCategoriesOpen ? " is-open" : ""}`.trim()}
              aria-label="Categories menu"
            >
              {categoriesError ? (
                <div className="site-nav__menu-empty">Unable to load categories.</div>
              ) : categoriesLoading || productsLoading ? (
                <div className="site-nav__menu-empty">Loading categories...</div>
              ) : categoryMenuItems.length > 0 ? (
                <div className="site-nav__menu-grid">
                  {categoryMenuItems.map((item) => (
                    <Link
                      key={item.id}
                      to={getCategoryProductsPath(item.slug)}
                      className="site-nav__menu-card"
                      onClick={closeCategoriesMenu}
                    >
                      <span className="site-nav__menu-media" aria-hidden="true">
                        <img src={item.image} alt="" />
                      </span>
                      <span className="site-nav__menu-copy">
                        <strong>{item.name}</strong>
                        <small>
                          {item.parentName ? `${item.parentName} · ` : ""}
                          {item.productCount} products
                        </small>
                      </span>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="site-nav__menu-empty">No categories available.</div>
              )}
            </div>
          </div>
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
          {authUser ? (
            <>
              <Link
                to="/profile/dashboard"
                className="site-actions__icon-button"
                aria-label={`${authUser.name}'s profile`}
              >
                <ProfileIcon />
              </Link>
              <button
                type="button"
                className="site-actions__signin site-actions__signin--ghost"
                onClick={onLogout}
              >
                Logout
              </button>
            </>
          ) : (
            <Link className="site-actions__signin site-actions__signin--outline" to="/register/login">
              <ProfileIcon />
              <span>Sign In</span>
            </Link>
          )}
          <Link
            to="/wishlist"
            className="site-actions__icon-button"
            aria-label={`Wishlist, ${wishlistCount} items`}
          >
            <HeartIcon />
            {wishlistCount > 0 ? (
              <span className="site-actions__badge">{wishlistCount}</span>
            ) : null}
          </Link>
          <button
            type="button"
            className="site-actions__icon-button site-actions__icon-button--theme"
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
          </button>
          <Link to="/cart" className="site-actions__icon-button" aria-label={`Cart, ${cartCount} items`}>
            <CartIcon />
            {cartCount > 0 ? (
              <span className="site-actions__badge">{cartCount}</span>
            ) : null}
          </Link>
          {authUser ? (
            <Link
              to="/profile/notifications"
              className="site-actions__icon-button"
              aria-label={`Notifications, ${notificationCount} unread`}
            >
              <BellIcon />
              {notificationCount > 0 ? (
                <span className="site-actions__badge">{notificationCount}</span>
              ) : null}
            </Link>
          ) : null}
        </div>
      </div>

      <MobileDrawer
        open={isMenuOpen}
        onClose={closeMenu}
        title="Main navigation"
        className="site-mobile-drawer"
        maxWidth="min(82vw, 340px)"
      >
        <nav className="site-mobile-menu" id="site-mobile-menu" aria-label="Main navigation">
          <div className="site-mobile-menu__group">
            <Link to="/" onClick={closeMenu} className="site-mobile-menu__link">
              Home
            </Link>
            <Link to="/products" onClick={closeMenu} className="site-mobile-menu__link">
              Shop
            </Link>
          </div>

          <div className="site-mobile-menu__group">
            <p className="site-mobile-menu__label">Categories</p>
            {categoriesError ? (
              <p className="site-mobile-menu__empty">Unable to load categories.</p>
            ) : categoriesLoading && categoryTree.length === 0 ? (
              <p className="site-mobile-menu__empty">Loading categories...</p>
            ) : categoryTree.length > 0 ? (
              categoryTree.map((item) => (
                <div className="site-mobile-menu__category" key={item.slug}>
                  <Link to={getCategoryProductsPath(item.slug)} onClick={closeMenu} className="site-mobile-menu__category-link">
                    {item.name}
                  </Link>
                  {Array.isArray(item.children) && item.children.length > 0 ? (
                    <div className="site-mobile-menu__children">
                      {item.children.map((child) => (
                        <Link
                          key={child.slug}
                          to={getCategoryProductsPath(child.slug)}
                          onClick={closeMenu}
                          className="site-mobile-menu__child"
                        >
                          {child.name}
                        </Link>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))
            ) : (
              <p className="site-mobile-menu__empty">No categories available.</p>
            )}
          </div>

          <div className="site-mobile-menu__group">
            <p className="site-mobile-menu__label">Account</p>
            <Link to="/wishlist" onClick={closeMenu} className="site-mobile-menu__link">
              Wishlist
            </Link>
            <Link to="/cart" onClick={closeMenu} className="site-mobile-menu__link">
              Cart
            </Link>
            {authUser ? (
              <>
                <Link
                  to="/profile/dashboard"
                  onClick={closeMenu}
                  className="site-mobile-menu__link"
                >
                  Profile
                </Link>
                <Link
                  to="/profile/notifications"
                  onClick={closeMenu}
                  className="site-mobile-menu__link"
                >
                  Notifications
                </Link>
                <button
                  type="button"
                  className="site-mobile-menu__button"
                  onClick={() => {
                    closeMenu();
                    onLogout();
                  }}
                >
                  Logout
                </button>
              </>
            ) : (
              <>
                <Link
                  to="/register/login"
                  onClick={closeMenu}
                  className="site-mobile-menu__link"
                >
                  Login
                </Link>
                <Link
                  to="/register/signup"
                  onClick={closeMenu}
                  className="site-mobile-menu__link"
                >
                  Sign Up
                </Link>
              </>
            )}
          </div>
        </nav>
      </MobileDrawer>
    </header>
  );
}

export default Header;
