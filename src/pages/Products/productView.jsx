import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import {
  defaultSiteBanner,
  normalizeSiteBanner,
} from "../../shared/siteBannerStorage";
import { getShippingFee, slugify, useProductBySlug } from "./productData";

function StarIcon({ filled = false }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={filled ? "is-filled" : ""}
    >
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
  const { product, loading, message } = useProductBySlug(productSlug);
  const safeSiteBanner = useMemo(
    () => normalizeSiteBanner(siteBanner ?? defaultSiteBanner),
    [siteBanner],
  );
  const [activeImage, setActiveImage] = useState(null);
  const [selectedColor, setSelectedColor] = useState("");
  const [selectedSize, setSelectedSize] = useState("");

  const gallery = useMemo(() => {
    if (!product) {
      return [];
    }

    return Array.isArray(product.gallery) ? product.gallery : [];
  }, [product]);

  const mainImageSrc = product?.image ?? gallery[0]?.src ?? "";

  const colorOptions = useMemo(() => {
    if (product?.availableColors?.length) {
      return product.availableColors;
    }

    return gallery[0]
      ? [
          {
            label: "Default",
            value: "default",
            swatch: "#cfd9e6",
            previewTint: gallery[0].tint ?? "#dfe7f3",
          },
        ]
      : [];
  }, [gallery, product]);

  const sizeOptions = useMemo(() => {
    if (product?.availableSizes?.length) {
      return product.availableSizes;
    }

    return ["One size"];
  }, [product]);

  useEffect(() => {
    setActiveImage(null);
    setSelectedColor(colorOptions[0]?.value ?? "");
    setSelectedSize(sizeOptions[0] ?? "");
  }, [productSlug, colorOptions, sizeOptions]);

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

  const stars = renderStars(product.rating);
  const selectedImage = activeImage == null ? null : gallery[activeImage] ?? null;
  const selectedImageSrc = selectedImage?.src ?? mainImageSrc;
  const activeColor =
    colorOptions.find((color) => color.value === selectedColor) ?? colorOptions[0];
  const isWishlisted = wishlistItems.includes(product.name);
  const categoryHref = product.categorySlug
    ? `/products?category=${product.categorySlug}`
    : "/products";
  const shippingFee = getShippingFee(product);
  const shippingFeeLabel = shippingFee == null ? "Pending" : formatMoney(shippingFee);
  const shippingMethodLabel = formatShippingMethod(product.shippingMethod);
  const previewTint = activeColor?.previewTint ?? activeColor?.swatch ?? "#dfe7f3";
  const bannerBatchNumber = safeSiteBanner?.announcement?.batchNumber?.trim() || "Pending";
  const batchWindowStart = formatDate(safeSiteBanner?.announcement?.batchWindowStart);
  const batchWindowEnd = formatDate(safeSiteBanner?.announcement?.batchWindowEnd);
  const batchWindowLabel =
    batchWindowStart || batchWindowEnd
      ? [batchWindowStart, batchWindowEnd].filter(Boolean).join(" - ")
      : "Batch window pending";

  const handleAddToCart = () => {
    onAddToCart(product.slug, 1, {
      color: activeColor?.label ?? "",
      size: selectedSize,
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
            <Link to={categoryHref}>{product.categoryTrail[0]}</Link>
            <span aria-hidden="true">&rsaquo;</span>
          </span>
          {product.categoryTrail[1] ? (
            <span>
              <span>{product.categoryTrail[1]}</span>
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
                "--preview-accent": activeColor?.swatch ?? "#cfd9e6",
              }}
            >
              <span className="product-view__main-image-wash" aria-hidden="true" />
              <span className="product-view__color-badge">
                {activeColor?.label ?? "Default"}
              </span>
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
                    className={`product-view__thumb${
                      index === activeImage ? " is-active" : ""
                    }`}
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
            <p className="product-view__series">{product.series}</p>
            <h1>{product.name}</h1>

            <div
              className="product-view__rating"
              aria-label={`${product.rating} out of 5 stars`}
            >
              <div className="product-view__stars">
                {stars.map((filled, index) => (
                  <StarIcon key={`${index}-${filled}`} filled={filled} />
                ))}
              </div>
              <span>({product.reviews.toLocaleString()} reviews)</span>
            </div>

            <div className="product-view__pricing">
              <strong>{formatMoney(product.price)}</strong>
              <span>{product.compareAt ? formatMoney(product.compareAt) : "—"}</span>
            </div>

            <p className="product-view__stock">{product.stockStatus}</p>
            <p className="product-view__shipping">
              Shipping fee {shippingFeeLabel}
            </p>

            <div className="product-view__divider" />

            <div className="product-view__row">
              <span>Shipment</span>
              <strong>{shippingMethodLabel}</strong>
            </div>

            <div className="product-view__sizes" aria-label="Size options">
              <div className="product-view__swatch-label">
                <span>Size</span>
                <strong>{selectedSize}</strong>
              </div>
              <div className="product-view__size-options">
                {sizeOptions.map((size) => (
                  <button
                    type="button"
                    key={size}
                    className={`product-view__size${
                      size === selectedSize ? " is-active" : ""
                    }`}
                    onClick={() => setSelectedSize(size)}
                    aria-label={`Choose size ${size}`}
                    aria-pressed={size === selectedSize}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>

            {colorOptions.length > 0 ? (
              <div className="product-view__colors" aria-label="Color options">
                <div className="product-view__swatch-label">
                  <span>Color</span>
                  <strong>{activeColor?.label ?? "Default"}</strong>
                </div>
                <div className="product-view__swatches">
                  {colorOptions.map((color) => (
                    <button
                      type="button"
                      key={color.value}
                      className={`product-view__swatch${
                        color.value === selectedColor ? " is-active" : ""
                      }`}
                      onClick={() => setSelectedColor(color.value)}
                      aria-label={`Choose ${color.label}`}
                      aria-pressed={color.value === selectedColor}
                      style={{ "--swatch-color": color.swatch }}
                    >
                      <span aria-hidden="true" />
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="product-view__divider" />

            <div className="product-view__actions">
              <button
                type="button"
                className="product-view__add"
                onClick={handleAddToCart}
              >
                Add to Cart
              </button>
              <button
                type="button"
                className={`product-view__wishlist${
                  isWishlisted ? " is-active" : ""
                }`}
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
              Disclaimer: Shipping fees are estimated prices only. The final shipping cost will be confirmed when the product arrives in Ghana.
            </p>

            <div className="product-view__details">
              <p>{product.description}</p>
              <p>{product.overview}</p>
              <ul>
                {product.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

export default ProductView;
