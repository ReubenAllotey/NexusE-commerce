import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
// import logo from "../../images/nexuslogo.png";
import { getCategoryProductsPath } from "../../../pages/Home/catalogData";
import { useCategoryTree } from "../../../shared/categoryStorage";
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
      <path d="M12 20.35 10.55 19C5.4 14.36 2 11.28 2 7.5A5.4 5.4 0 0 1 7.5 2c1.74 0 3.41.81 4.5 2.08A6.06 6.06 0 0 1 16.5 2 5.4 5.4 0 0 1 22 7.5c0 3.78-3.4 6.86-8.55 11.5L12 20.35Z" />
    </svg>
  );
}

function CartIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 7h10l1 11H6L7 7Z" />
      <path d="M9 7a3 3 0 0 1 6 0" />
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

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </svg>
  );
}

function Header({
  cartCount = 0,
  wishlistCount = 0,
  notificationCount = 0,
  authUser = null,
  onLogout = () => {},
}) {
  const location = useLocation();
  const { tree: categoryTree, loading: categoriesLoading, error: categoriesError } = useCategoryTree();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const categoryLinks = categoryTree.map((category) => ({
    label: category.name,
    to: getCategoryProductsPath(category.slug),
    children: Array.isArray(category.children) ? category.children : [],
  }));

  useEffect(() => {
    setIsMenuOpen(false);
  }, [location.pathname]);

  const closeMenu = () => setIsMenuOpen(false);

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

        {/* <img src={logo} alt="Nexus logo" className="site-brand__logo" /> */}
        <Link to="/" className="site-brand" aria-label="Exclusive home">
          Nexus Imports
        </Link>

        <nav className="site-nav" aria-label="Primary">
          <Link to="/">Home</Link>
          <Link to="/products" className="site-nav__link">
            Products
          </Link>
          <details className="site-nav__group">
            <summary className="site-nav__trigger">
              Categories
              <ChevronDownIcon />
            </summary>
            <div className="site-nav__menu" aria-label="Categories menu">
              {categoriesError ? (
                <div className="site-nav__menu-empty">Unable to load categories.</div>
              ) : categoriesLoading && categoryLinks.length === 0 ? (
                <div className="site-nav__menu-empty">Loading categories...</div>
              ) : categoryLinks.length > 0 ? (
                categoryLinks.map((item) => (
                  <div className="site-nav__menu-group" key={item.label}>
                    <Link className="site-nav__menu-parent" to={item.to}>
                      {item.label}
                    </Link>
                    {item.children.length > 0 ? (
                      <div className="site-nav__menu-children">
                        {item.children.map((child) => (
                          <Link
                            key={child.slug}
                            to={getCategoryProductsPath(child.slug)}
                            className="site-nav__menu-child"
                          >
                            {child.name}
                          </Link>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))
              ) : (
                <div className="site-nav__menu-empty">No categories available.</div>
              )}
            </div>
          </details>
          <Link to="/about">About</Link>
          <Link to="/contact">Contact</Link>
        </nav>

        <div className="site-actions">
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
          <Link
            to="/cart"
            className="site-actions__icon-button"
            aria-label={`Cart, ${cartCount} items`}
          >
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
            <Link className="site-actions__signin" to="/register/signup">
              Sign Up
            </Link>
          )}
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
              Products
            </Link>
            <Link to="/about" onClick={closeMenu} className="site-mobile-menu__link">
              About
            </Link>
            <Link to="/contact" onClick={closeMenu} className="site-mobile-menu__link">
              Contact
            </Link>
          </div>

          <div className="site-mobile-menu__group">
            <p className="site-mobile-menu__label">Categories</p>
            {categoriesError ? (
              <p className="site-mobile-menu__empty">Unable to load categories.</p>
            ) : categoriesLoading && categoryLinks.length === 0 ? (
              <p className="site-mobile-menu__empty">Loading categories...</p>
            ) : categoryLinks.length > 0 ? (
              categoryLinks.map((item) => (
                <div className="site-mobile-menu__category" key={item.label}>
                  <Link to={item.to} onClick={closeMenu} className="site-mobile-menu__category-link">
                    {item.label}
                  </Link>
                  {item.children.length > 0 ? (
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
