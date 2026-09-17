import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  getProductPurchaseMeta,
  getProductPath,
  resolveProductCompareAt,
  resolveProductPrice,
  slugify,
} from "./productData";
import UnavailableStockButton from "./UnavailableStockButton";

const FALLBACK_IMAGE =
  "data:image/svg+xml;charset=UTF-8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800"><rect width="800" height="800" fill="#f7fbff"/><rect x="150" y="170" width="500" height="460" rx="36" fill="#e3ebf7"/><path d="M250 360h300" stroke="#c0cfdf" stroke-width="22" stroke-linecap="round"/><path d="M250 420h220" stroke="#c0cfdf" stroke-width="22" stroke-linecap="round"/><circle cx="400" cy="300" r="66" fill="#b8c7db"/><path d="M400 238v124M338 300h124" stroke="#9fb1c9" stroke-width="24" stroke-linecap="round"/></svg>',
  );

function HeartIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 20.35 10.55 19C5.4 14.36 2 11.28 2 7.5A5.4 5.4 0 0 1 7.5 2c1.74 0 3.41.81 4.5 2.08A6.06 6.06 0 0 1 16.5 2 5.4 5.4 0 0 1 22 7.5c0 3.78-3.4 6.86-8.55 11.5L12 20.35Z" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5c5.5 0 9.8 4 11 7-1.2 3-5.5 7-11 7S2.2 15 1 12c1.2-3 5.5-7 11-7Zm0 2C8 7 4.7 9.6 3.5 12 4.7 14.4 8 17 12 17s7.3-2.6 8.5-5C19.3 9.6 16 7 12 7Zm0 1.8A3.2 3.2 0 1 1 8.8 12 3.2 3.2 0 0 1 12 8.8Z" />
    </svg>
  );
}

function CartIcon({ className = "" } = {}) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path d="M3 4h2.5l2 11h11.2l1.6-7H8" />
      <path d="M8.4 15h9.9" />
      <circle cx="10.4" cy="20" r="1.4" />
      <circle cx="18.1" cy="20" r="1.4" />
    </svg>
  );
}

function formatMoney(value) {
  return new Intl.NumberFormat("en-GH", {
    style: "currency",
    currency: "GHS",
    currencyDisplay: "symbol",
    minimumFractionDigits: Number.isInteger(Number(value) || 0) ? 0 : 2,
    maximumFractionDigits: Number.isInteger(Number(value) || 0) ? 0 : 2,
  }).format(Number(value) || 0);
}

function ProductCard({
  item = {},
  onAddToCart = () => {},
  onToggleWishlist = () => {},
  isWishlisted = false,
  classNamePrefix = "product-card",
}) {
  const prefix = classNamePrefix === "shop-card" ? "shop-card" : "product-card";
  const navigate = useNavigate();
  const safeVariationGroups = useMemo(
    () => (Array.isArray(item.variationGroups) ? item.variationGroups.filter(Boolean) : []),
    [item.variationGroups],
  );
  const activePrice = resolveProductPrice(item, []);
  const activeCompareAt = resolveProductCompareAt(item, []);
  const activeImage = item.image || item.primaryImageUrl || FALLBACK_IMAGE;
  const detailHref = getProductPath(item.slug ?? slugify(item.name));
  const availabilityMeta = getProductPurchaseMeta(item);

  const handlePurchaseClick = () => {
    if (safeVariationGroups.length > 0) {
      navigate(detailHref);
      return;
    }
    onAddToCart(item, 1, {
      selectedOptions: [],
      variantKey: "",
      availabilityType: item.availabilityType ?? item.availability_type,
    });
  };

  return (
    <article className={prefix}>
      <div className={`${prefix}__media`}>
        <div className={`${prefix}__actions`}>
          <button
            type="button"
            className={`${prefix}__wishlist${isWishlisted ? " is-active" : ""}`}
            aria-label={`${isWishlisted ? "Remove" : "Save"} ${item.name}`}
            aria-pressed={isWishlisted}
            onClick={() => onToggleWishlist(item.name)}
          >
            <HeartIcon />
          </button>
          <Link
            to={detailHref}
            className={`${prefix}__preview`}
            aria-label={`View ${item.name}`}
          >
            <EyeIcon />
          </Link>
        </div>

        <Link
          to={detailHref}
          className={`${prefix}__media-link`}
          aria-label={`Open ${item.name}`}
        >
          <img
            src={activeImage}
            alt={item.name}
            className={item.imageClassName ?? ""}
            loading="lazy"
          />
        </Link>
        {availabilityMeta.outOfStock ? (
          <span className="product-card__out-of-stock-badge">OUT OF STOCK</span>
        ) : null}
      </div>

      <div className={`${prefix}__body`}>
        <div className={`${prefix}__topline`}>
          <span className={`${prefix}__availability ${prefix}__availability--${availabilityMeta.tone ?? "green"}`}>
            {availabilityMeta.badge}
          </span>
        </div>

        <Link to={detailHref} className={`${prefix}__title-link`}>
          <h3>{item.name}</h3>
        </Link>

        <div className={`${prefix}__price`}>
          <strong>{formatMoney(activePrice)}</strong>
          {activeCompareAt != null && Number(activeCompareAt) > activePrice ? (
            <span>{formatMoney(activeCompareAt)}</span>
          ) : null}
        </div>

        {availabilityMeta.outOfStock ? (
          <UnavailableStockButton
            className={`${prefix}__button nexus-product-card__cart-button is-disabled`}
            aria-label={`${item.name} is out of stock`}
          >
            <CartIcon className="nexus-product-card__cart-icon" />
            {availabilityMeta.buttonLabel}
          </UnavailableStockButton>
        ) : (
          <button
            type="button"
            className={`${prefix}__button nexus-product-card__cart-button${
              availabilityMeta.disabled ? " is-disabled" : ""
            }`}
            disabled={availabilityMeta.disabled}
            onClick={handlePurchaseClick}
          >
            <CartIcon className="nexus-product-card__cart-icon" />
            {availabilityMeta.buttonLabel}
          </button>
        )}
      </div>
    </article>
  );
}

export default ProductCard;
