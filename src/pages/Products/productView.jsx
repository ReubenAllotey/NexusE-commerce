import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { defaultSiteBanner, normalizeSiteBanner } from "../../shared/siteBannerStorage";
import NexusProductCard from "./ProductCard";
import {
  buildDefaultSelectedOptions,
  buildVariantKeyFromSelectedOptions,
  getAvailabilityMeta,
  getShippingFee,
  useProductBySlug,
  useProducts,
} from "./productData";

const FALLBACK_IMAGE =
  "data:image/svg+xml;charset=UTF-8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800"><rect width="800" height="800" fill="#f7fbff"/><rect x="160" y="180" width="480" height="440" rx="40" fill="#e2eaf5"/><rect x="220" y="240" width="360" height="300" rx="28" fill="#cdd8ea"/><path d="M280 420h240" stroke="#9eb0ca" stroke-width="24" stroke-linecap="round"/><path d="M400 300v240" stroke="#9eb0ca" stroke-width="24" stroke-linecap="round"/><circle cx="400" cy="420" r="54" fill="#b6c7df"/></svg>',
  );

function StarIcon({ filled = false }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={filled ? "is-filled" : ""}>
      <path d="m12 3 2.9 5.9 6.5.9-4.7 4.5 1.1 6.4L12 17.6 6.2 20.7l1.1-6.4L2.6 9.8l6.5-.9L12 3Z" />
    </svg>
  );
}

function TruckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 7h11v8H3z" />
      <path d="M14 10h3l2 2v3h-5z" />
      <circle cx="7" cy="17" r="1.5" />
      <circle cx="17" cy="17" r="1.5" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2 5 5v6c0 5 3.6 9.7 7 11 3.4-1.3 7-6 7-11V5l-7-3Z" />
      <path d="M9.5 12.5 11.2 14l3.3-3.7" />
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

function formatMoney(value) {
  const safeValue = Number(value) || 0;

  return new Intl.NumberFormat("en-GH", {
    style: "currency",
    currency: "GHS",
    currencyDisplay: "symbol",
    minimumFractionDigits: Number.isInteger(safeValue) ? 0 : 2,
    maximumFractionDigits: Number.isInteger(safeValue) ? 0 : 2,
  }).format(safeValue);
}

function formatDate(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatShippingMethod(value) {
  if (value === "sea-freight") {
    return "Sea freight";
  }

  if (value === "air-freight") {
    return "Air freight";
  }

  return "Air freight";
}

function renderStars(score) {
  return Array.from({ length: 5 }, (_, index) => index < Math.round(score));
}

function ProductView({
  onAddToCart = () => {},
  onToggleWishlist = () => {},
  wishlistItems = [],
  siteBanner = defaultSiteBanner,
}) {
  const { productSlug } = useParams();
  const { product, loading } = useProductBySlug(productSlug);
  const { products: catalogProducts = [] } = useProducts();
  const safeSiteBanner = useMemo(
    () => normalizeSiteBanner(siteBanner ?? defaultSiteBanner),
    [siteBanner],
  );
  const [activeImage, setActiveImage] = useState(null);
  const [selectedOptions, setSelectedOptions] = useState([]);
  const [quantity, setQuantity] = useState(1);

  const gallery = useMemo(
    () => (product && Array.isArray(product.gallery) ? product.gallery.filter(Boolean) : []),
    [product],
  );
  const variationGroups = useMemo(
    () => (Array.isArray(product?.variationGroups) ? product.variationGroups.filter(Boolean) : []),
    [product?.variationGroups],
  );
  const categoryTrail = Array.isArray(product?.categoryTrail) ? product.categoryTrail : [];
  const features = Array.isArray(product?.features) ? product.features : [];

  const defaultSelectedOptions = useMemo(
    () => buildDefaultSelectedOptions(variationGroups),
    [variationGroups],
  );

  useEffect(() => {
    setActiveImage(null);
    setSelectedOptions(defaultSelectedOptions);
    setQuantity(1);
  }, [defaultSelectedOptions, productSlug]);

  const stars = renderStars(product?.rating ?? 0);
  const reviewCount = Number(product?.reviews) || 0;
  const selectionLookup = new Map(selectedOptions.map((option) => [option.groupId, option]));
  const activeSelection = variationGroups
    .map((group) => {
      const selectedOption =
        selectionLookup.get(group.id) ??
        group.options?.find((option) => option.isDefault) ??
        group.options?.[0] ??
        null;

      if (!selectedOption) {
        return null;
      }

      return {
        groupId: group.id ?? "",
        groupName: group.groupName ?? "Variation",
        kind: group.kind ?? "text",
        optionId: selectedOption.id ?? "",
        label: selectedOption.label ?? "",
        value: selectedOption.value ?? selectedOption.label ?? "",
        priceDelta: Number(selectedOption.priceDelta) || 0,
        compareAtDelta: selectedOption.compareAtDelta ?? null,
        swatchColor: selectedOption.swatchColor ?? "",
        imageUrl: selectedOption.imageUrl ?? "",
        isDefault: Boolean(selectedOption.isDefault),
      };
    })
    .filter(Boolean);

  const selectedImageOption = activeSelection.find((option) => option.imageUrl);
  const selectedImage = activeImage == null ? null : gallery[activeImage] ?? null;
  const selectedImageSrc =
    selectedImage?.src || selectedImageOption?.imageUrl || product?.image || gallery[0]?.src || FALLBACK_IMAGE;
  const isWishlisted = wishlistItems.includes(product?.name);
  const categoryHref = product?.categorySlug ? `/products?category=${product.categorySlug}` : "/products";
  const shippingFee = getShippingFee(product);
  const shippingFeeLabel = shippingFee == null ? "Pending" : formatMoney(shippingFee);
  const shippingMethodLabel = formatShippingMethod(product?.shippingMethod);
  const activePrice =
    (Number(product?.price) || 0) +
    activeSelection.reduce((sum, option) => sum + (Number(option.priceDelta) || 0), 0);
  const activeCompareAt =
    product?.compareAt != null
      ? (Number(product.compareAt) || 0) +
        activeSelection.reduce((sum, option) => sum + (Number(option.compareAtDelta) || 0), 0)
      : null;
  const previewTint =
    activeSelection.find((option) => option.swatchColor)?.swatchColor || selectedImage?.tint || "#dfe7f3";
  const availabilityMeta = getAvailabilityMeta(product?.availabilityType ?? product?.availability_type);
  const isPreorderProduct = availabilityMeta.availabilityType === "preorder";
  const isComingSoonProduct = availabilityMeta.availabilityType === "coming_soon";
  const bannerBatchNumber = safeSiteBanner?.announcement?.batchNumber?.trim() || "Pending";
  const batchWindowStart = formatDate(safeSiteBanner?.announcement?.batchWindowStart);
  const batchWindowEnd = formatDate(safeSiteBanner?.announcement?.batchWindowEnd);
  const batchWindowLabel =
    batchWindowStart || batchWindowEnd
      ? [batchWindowStart, batchWindowEnd].filter(Boolean).join(" - ")
      : "Batch window pending";
  const activeSelectionLabel =
    activeSelection.map((option) => option.label).filter(Boolean).join(" / ") || "Default";
  const safeQuantity = Math.max(Number(quantity) || 0, 1);
  const relatedProducts = useMemo(() => {
    if (!Array.isArray(catalogProducts) || catalogProducts.length === 0) {
      return [];
    }

    return catalogProducts
      .filter(
        (entry) =>
          entry?.id !== product?.id &&
          (entry?.categoryId === product?.categoryId || entry?.categorySlug === product?.categorySlug),
      )
      .slice(0, 4);
  }, [catalogProducts, product?.categoryId, product?.categorySlug, product?.id]);

  if (loading) {
    return (
      <main className="product-view">
        <div className="product-view__shell">
          <section className="product-view__layout">
            <div className="shop-empty">
              <h2>Loading product...</h2>
              <p>We are fetching the latest product data from Supabase.</p>
            </div>
          </section>
        </div>
      </main>
    );
  }

  if (!product) {
    return <Navigate to="/products" replace />;
  }

  const handleAddToCart = () => {
    onAddToCart(product, safeQuantity, {
      selectedOptions: activeSelection,
      variantKey: buildVariantKeyFromSelectedOptions(activeSelection),
      availabilityType: product?.availabilityType ?? product?.availability_type,
    });
  };

  return (
    <main className="product-view">
      <div className="product-view__shell">
        <nav className="product-view__breadcrumb" aria-label="Breadcrumb">
          <span>
            <Link to="/">Home</Link>
            <span aria-hidden="true">&rsaquo;</span>
          </span>
          <span>
            <Link to={categoryHref}>{categoryTrail[0] ?? product.category ?? "Shop"}</Link>
            <span aria-hidden="true">&rsaquo;</span>
          </span>
          {categoryTrail[1] ? (
            <span>
              <span>{categoryTrail[1]}</span>
              <span aria-hidden="true">&rsaquo;</span>
            </span>
          ) : null}
          <span aria-current="page">{product.name}</span>
        </nav>

        <section className="product-view__layout">
          <div className="product-view__media">
            <div
              className="product-view__main-image"
              style={{
                "--preview-tint": previewTint,
                "--preview-accent":
                  activeSelection.find((option) => option.swatchColor)?.swatchColor || "#cfd9e6",
              }}
            >
              <span className="product-view__main-image-wash" aria-hidden="true" />
              <span className="product-view__color-badge">{activeSelectionLabel}</span>
              <img
                src={selectedImageSrc}
                alt={product.name}
                className={product.imageClassName ?? ""}
              />
            </div>

            {gallery.length > 0 ? (
              <div className="product-view__thumbs" aria-label="Product images">
                {gallery.map((image, index) => (
                  <button
                    type="button"
                    key={`${image.label}-${index}`}
                    className={`product-view__thumb${index === activeImage ? " is-active" : ""}`}
                    onClick={() => setActiveImage(index)}
                    aria-label={`Show ${image.label}`}
                    aria-pressed={index === activeImage}
                    style={{ "--thumb-tint": image.tint }}
                  >
                    <img src={image.src} alt="" aria-hidden="true" />
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="product-view__content">
            <div className="product-view__topline">
              {product.badge ? <p className="product-view__series">{product.badge}</p> : null}
              <span
                className={`product-view__availability product-view__availability--${availabilityMeta.tone ?? "green"}`}
              >
                {availabilityMeta.badge}
              </span>
            </div>
            <h1>{product.name}</h1>

            <div className="product-view__rating" aria-label={`${product.rating} out of 5 stars`}>
              <div className="product-view__stars">
                {stars.map((filled, index) => (
                  <StarIcon key={`${index}-${filled}`} filled={filled} />
                ))}
              </div>
              <span>({reviewCount.toLocaleString()} reviews)</span>
            </div>

            <div className="product-view__pricing">
              <strong>{formatMoney(activePrice)}</strong>
              <span>{activeCompareAt ? formatMoney(activeCompareAt) : "-"}</span>
            </div>

            {isPreorderProduct ? (
              <div className="product-view__preorder-banner">
                <strong>PRE-ORDER</strong>
                <p>
                  Estimated arrival: {product.estimatedArrival || "To be announced"}. Product payment
                  confirms your order. Final shipping fee will be calculated separately when the item
                  arrives in Ghana.
                </p>
              </div>
            ) : null}

            {isComingSoonProduct ? (
              <div className="product-view__preorder-banner product-view__preorder-banner--coming-soon">
                <strong>COMING SOON</strong>
                <p>This product is coming soon and cannot be added to cart yet.</p>
              </div>
            ) : null}

            <p className="product-view__stock">{product.stockStatus}</p>
            <p className="product-view__shipping">Shipping fee {shippingFeeLabel}</p>

            <div className="product-view__divider" />

            <div className="product-view__row">
              <span>Shipment</span>
              <strong>{shippingMethodLabel}</strong>
            </div>

            {variationGroups.length > 0 ? (
              <div className="product-view__variations">
                {variationGroups.map((group) => {
                  const groupOptions = Array.isArray(group.options) ? group.options : [];
                  const activeGroupOption =
                    activeSelection.find((option) => option.groupId === group.id) ??
                    groupOptions.find((option) => option.isDefault) ??
                    groupOptions[0] ??
                    null;

                  return (
                    <div key={group.id ?? group.groupName} className="product-view__sizes">
                      <div className="product-view__swatch-label">
                        <span>{group.groupName}</span>
                        <strong>{activeGroupOption?.label ?? "Default"}</strong>
                      </div>
                      <div
                        className={
                          group.kind === "color"
                            ? "product-view__swatches"
                            : "product-view__size-options"
                        }
                        aria-label={`${group.groupName} options`}
                      >
                        {groupOptions.map((option) => {
                          const isActive = activeGroupOption?.id === option.id;
                          const buttonClass =
                            group.kind === "color"
                              ? `product-view__swatch${isActive ? " is-active" : ""}`
                              : `product-view__size${isActive ? " is-active" : ""}`;

                          return (
                            <button
                              type="button"
                              key={option.id ?? option.value ?? option.label}
                              className={buttonClass}
                              onClick={() => {
                                setSelectedOptions((current) => {
                                  const next = current.filter((entry) => entry.groupId !== group.id);
                                  return [
                                    ...next,
                                    {
                                      groupId: group.id ?? "",
                                      groupName: group.groupName ?? "Variation",
                                      kind: group.kind ?? "text",
                                      optionId: option.id ?? "",
                                      label: option.label ?? "",
                                      value: option.value ?? option.label ?? "",
                                      priceDelta: Number(option.priceDelta) || 0,
                                      compareAtDelta: option.compareAtDelta ?? null,
                                      swatchColor: option.swatchColor ?? "",
                                      imageUrl: option.imageUrl ?? "",
                                      isDefault: Boolean(option.isDefault),
                                    },
                                  ].sort((left, right) =>
                                    String(left.groupId).localeCompare(String(right.groupId)),
                                  );
                                });
                              }}
                              aria-label={`Choose ${option.label} for ${group.groupName}`}
                              aria-pressed={isActive}
                              style={
                                group.kind === "color" && option.swatchColor
                                  ? { "--swatch-color": option.swatchColor }
                                  : undefined
                              }
                            >
                              {group.kind === "color" && option.swatchColor ? (
                                <span aria-hidden="true" />
                              ) : null}
                              {option.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}

            <div className="product-view__buybar">
              <div className="product-view__quantity" aria-label="Quantity selector">
                <button
                  type="button"
                  onClick={() => setQuantity((current) => Math.max(1, current - 1))}
                  aria-label="Decrease quantity"
                >
                  −
                </button>
                <span>{safeQuantity}</span>
                <button
                  type="button"
                  onClick={() => setQuantity((current) => current + 1)}
                  aria-label="Increase quantity"
                >
                  +
                </button>
              </div>

              <button
                type="button"
                className={`product-view__add${availabilityMeta.disabled ? " is-disabled" : ""}`}
                onClick={handleAddToCart}
                disabled={availabilityMeta.disabled}
              >
                <CartIcon />
                {availabilityMeta.buttonLabel} • {formatMoney(activePrice * safeQuantity)}
              </button>

              <button
                type="button"
                className={`product-view__wishlist${isWishlisted ? " is-active" : ""}`}
                aria-pressed={isWishlisted}
                aria-label={`${isWishlisted ? "Remove" : "Save"} ${product.name}`}
                onClick={() => onToggleWishlist(product.name)}
              >
                ♥
              </button>
            </div>

            <div className="product-view__perks">
              <article className="product-view__perk product-view__perk--shipping">
                <TruckIcon />
                <div>
                  <strong>Shipping fee</strong>
                  <span>
                    {shippingFee == null
                      ? `${shippingMethodLabel} pending until the fee is added`
                      : `${shippingMethodLabel} from ${formatMoney(shippingFee)} on this item`}
                  </span>
                </div>
              </article>

              <article className="product-view__perk product-view__perk--batch">
                <ShieldIcon />
                <div>
                  <strong>Batch Number</strong>
                  <span>{bannerBatchNumber}</span>
                  <span className="product-view__perk-note">{batchWindowLabel}</span>
                </div>
              </article>
            </div>

            <p className="product-view__disclaimer">
              Disclaimer: Shipping fees are estimated prices only. The final shipping cost will be
              confirmed when the product arrives in Ghana.
            </p>
          </div>
        </section>

        <section className="product-view__details-panel">
          <div className="product-view__details">
            <div className="product-view__details-card">
              <h2>Description</h2>
              <p>{product.description}</p>
            </div>

            <div className="product-view__details-card">
              <h2>Overview</h2>
              <p>{product.overview}</p>
            </div>

            {features.length > 0 ? (
              <div className="product-view__details-card">
                <h2>Features</h2>
                <ul>
                  {features.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </section>

        {relatedProducts.length > 0 ? (
          <section className="product-view__recommendations">
            <div className="section-heading">
              <div className="section-heading__copy">
                <span className="section-label__icon section-label__icon--blue" aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path d="M4 5h6v6H4z" />
                    <path d="M14 5h6v6h-6z" />
                    <path d="M4 15h6v4H4z" />
                    <path d="M14 15h6v4h-6z" />
                  </svg>
                </span>
                <div>
                  <p className="section-heading__eyebrow">Recommended</p>
                  <h2>More products you may like</h2>
                </div>
              </div>
            </div>

            <div className="shop-grid shop-grid--recommendations">
              {relatedProducts.map((item) => (
                <NexusProductCard
                  key={item.id}
                  item={item}
                  classNamePrefix="shop-card"
                  onAddToCart={onAddToCart}
                  onToggleWishlist={onToggleWishlist}
                  isWishlisted={wishlistItems.includes(item.name)}
                />
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}

export default ProductView;
