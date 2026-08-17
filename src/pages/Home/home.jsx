import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import nexusPerson from "../../assets/images/nexusPerson.png";
import logo from "../../assets/images/nexuslogo.png";
import { getCategoryProductsPath } from "./catalogData";
import {
  buildDefaultSelectedOptions,
  buildVariantKeyFromSelectedOptions,
  getProductPath,
  slugify,
} from "../Products/productData";
import NexusProductCard from "../Products/ProductCard";
import {
  getDiscoverCategoryCards,
  useCategoryRecords,
} from "../../shared/categoryStorage";
import {
  getAnnouncementCategoryLabel,
  getAnnouncementStatus,
  getAnnouncementStatusLabel,
  useAnnouncements,
} from "../Admin/announcement/announcementStorage";
import { useFlashySalesCatalog } from "../../shared/flashySalesStorage";
import { useProducts } from "../Products/productData";

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

function QuoteIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M10 11H6.6A3.6 3.6 0 0 1 10.2 7.4V6A5.8 5.8 0 0 0 4 11.8V18h6v-7ZM20 11h-3.4A3.6 3.6 0 0 1 20.2 7.4V6A5.8 5.8 0 0 0 14 11.8V18h6v-7Z" />
    </svg>
  );
}

function HeroTrustIcon({ kind }) {
  const icons = {
    plane: <path d="M3 11.5 21 4l-3.5 16-5.1-6.1L8 18.5l.7-5.1L3 11.5Z" />,
    ship: (
      <>
        <path d="M4 14h16l-2 4H6l-2-4Z" />
        <path d="M8 14V8h8v6" />
        <path d="M6 18c1.2 1 2.4 1.5 3.6 1.5S12 19 13.2 18.5c1.2-.5 2.4-.5 3.6 0" />
      </>
    ),
    box: (
      <>
        <path d="M4 8 12 4l8 4-8 4-8-4Z" />
        <path d="M4 8v8l8 4 8-4V8" />
        <path d="M12 12v8" />
      </>
    ),
  };

  return (
    <span className="hero-banner__trust-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24">{icons[kind]}</svg>
    </span>
  );
}

function ImportBannerIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 8h11v6H3z" />
      <path d="M14 10h3l3 3v1h-6z" />
      <path d="M6 8V6h6l2 2" />
      <circle cx="8" cy="17.5" r="1.5" />
      <circle cx="17" cy="17.5" r="1.5" />
    </svg>
  );
}

function SectionLabelIcon({ kind }) {
  const icons = {
    flash: <path d="M13 2 5 13h6l-1 9 8-11h-6l1-9Z" />,
    category: (
      <>
        <path d="M4 5h6v6H4z" />
        <path d="M14 5h6v6h-6z" />
        <path d="M4 15h6v4H4z" />
        <path d="M14 15h6v4h-6z" />
      </>
    ),
    calendar: (
      <>
        <path d="M7 3v3M17 3v3" />
        <path d="M4 7h16" />
        <path d="M5 5h14a1 1 0 0 1 1 1v12H4V6a1 1 0 0 1 1-1Z" />
        <path d="M8 11h3M13 11h3M8 15h3M13 15h3" />
      </>
    ),
    box: (
      <>
        <path d="M4 8 12 4l8 4-8 4-8-4Z" />
        <path d="M4 8v8l8 4 8-4V8" />
        <path d="M12 12v8" />
      </>
    ),
    feedback: (
      <>
        <path d="M5 6h14v8H9l-4 4V6Z" />
        <path d="M8 9h8M8 12h5" />
      </>
    ),
    default: <path d="M12 3v18M3 12h18" />,
  };

  return (
    <span className="section-label__icon" aria-hidden="true">
      <svg viewBox="0 0 24 24">{icons[kind] ?? icons.default}</svg>
    </span>
  );
}

function CategoryIcon({ kind }) {
  const icons = {
    beauty: (
      <>
        <path d="M12 4.5 13.6 8l3.8.6-2.8 2.8.7 3.9-3.3-1.8-3.3 1.8.7-3.9L6.6 8 10.4 7.4 12 4.5Z" />
      </>
    ),
    books: (
      <>
        <path d="M7 5h9a2 2 0 0 1 2 2v11a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2V7a2 2 0 0 1 2-2Z" />
        <path d="M9 6h6" />
        <path d="M9 9h6" />
      </>
    ),
    electronics: (
      <>
        <path d="M5 6h14v9H5z" />
        <path d="M9 18h6" />
        <path d="M12 15v3" />
      </>
    ),
    fashion: (
      <>
        <path d="M8 5 12 3l4 2 3 3-2 2-1-1v10H6V9L5 10 3 8l5-3Z" />
      </>
    ),
    health: (
      <>
        <path d="M12 3 9 6H6v3l-3 3 3 3v3h3l3 3 3-3h3v-3l3-3-3-3V6h-3l-3-3Z" />
        <path d="M12 8v8" />
        <path d="M8 12h8" />
      </>
    ),
    home: (
      <>
        <path d="M4 11.5 12 5l8 6.5V19H4z" />
        <path d="M9 19v-5h6v5" />
      </>
    ),
    kitchen: (
      <>
        <path d="M7 4v16" />
        <path d="M7 6c0 2 1.2 3 2.8 3.5v10.5" />
        <path d="M14 4v7" />
        <path d="M16 4v7" />
        <path d="M15 11v9" />
      </>
    ),
    sports: (
      <>
        <circle cx="12" cy="12" r="7" />
        <path d="M5.7 8.6c2.1.9 3.9 2.5 5 4.4 1 1.7 1.5 3.4 1.5 5" />
        <path d="M18.3 8.6c-2.1.9-3.9 2.5-5 4.4-1 1.7-1.5 3.4-1.5 5" />
      </>
    ),
    toys: (
      <>
        <path d="M5 9h14v8H5z" />
        <path d="M8 9V7a2 2 0 0 1 4 0" />
        <path d="M16 9V7a2 2 0 0 0-4 0" />
        <path d="M9 13h.01" />
        <path d="M15 13h.01" />
        <path d="M11 15h2" />
      </>
    ),
    phones: (
      <>
        <path d="M9 4h6v16H9z" />
        <path d="M11 17h2" />
      </>
    ),
    computers: (
      <>
        <path d="M4 6h16v10H4z" />
        <path d="M9 18h6" />
        <path d="M12 16v2" />
      </>
    ),
    watch: (
      <>
        <path d="M9 6h6l1 3v6l-1 3H9l-1-3V9z" />
        <path d="M10 3h4" />
        <path d="M10 21h4" />
      </>
    ),
    camera: (
      <>
        <path d="M4 8h4l2-2h4l2 2h4v10H4z" />
        <circle cx="12" cy="13" r="3" />
      </>
    ),
    headphones: (
      <>
        <path d="M5 13a7 7 0 0 1 14 0" />
        <path d="M5 13v5h3v-5H5Z" />
        <path d="M16 13v5h3v-5h-3Z" />
      </>
    ),
    gaming: (
      <>
        <path d="M5 9h14a3 3 0 0 1 3 3v2a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3v-2a3 3 0 0 1 3-3Z" />
        <path d="M8 12h3" />
        <path d="M9.5 10.5v3" />
        <path d="M16 12h.01" />
        <path d="M18 13.5h.01" />
      </>
    ),
    truck: (
      <>
        <path d="M3 7h11v8H3z" />
        <path d="M14 10h3l2 2v3h-5z" />
        <circle cx="7" cy="17" r="1.5" />
        <circle cx="17" cy="17" r="1.5" />
      </>
    ),
    shield: (
      <>
        <path d="M12 2 5 5v6c0 5 3.6 9.7 7 11 3.4-1.3 7-6 7-11V5l-7-3Z" />
        <path d="M9.5 12.5 11.2 14l3.3-3.7" />
      </>
    ),
  };

  return (
    <span className="category-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24">{icons[kind]}</svg>
    </span>
  );
}

function formatCountdownValue(value) {
  return String(value).padStart(2, "0");
}

function getCountdownParts(targetTime) {
  const remaining = Math.max(targetTime - Date.now(), 0);
  const totalSeconds = Math.floor(remaining / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [
    [formatCountdownValue(days), "Days"],
    [formatCountdownValue(hours), "Hours"],
    [formatCountdownValue(minutes), "Minutes"],
    [formatCountdownValue(seconds), "Seconds"],
  ];
}

function Countdown({ targetTime }) {
  const [parts, setParts] = useState(() => getCountdownParts(targetTime));

  useEffect(() => {
    const updateCountdown = () => setParts(getCountdownParts(targetTime));

    updateCountdown();
    const timer = window.setInterval(updateCountdown, 1000);

    return () => window.clearInterval(timer);
  }, [targetTime]);

  return parts.map(([value, label]) => (
    <div className="countdown__item" key={label}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  ));
}

function Rating({ score, reviews }) {
  const stars = Array.from(
    { length: 5 },
    (_, index) => index < Math.round(score),
  );

  return (
    <div className="rating">
      <div className="rating__stars" aria-label={`${score} out of 5 stars`}>
        {stars.map((filled, index) => (
          <span
            key={`${index}-${filled}`}
            className={filled ? "is-filled" : ""}
          >
            &#9733;
          </span>
        ))}
      </div>
      <span className="rating__count">({reviews})</span>
    </div>
  );
}

function StarRating({ score }) {
  const stars = Array.from(
    { length: 5 },
    (_, index) => index < Math.round(score),
  );

  return (
    <div
      className="testimonial-card__stars"
      aria-label={`${score} out of 5 stars`}
    >
      {stars.map((filled, index) => (
        <span key={`${index}-${filled}`} className={filled ? "is-filled" : ""}>
          &#9733;
        </span>
      ))}
    </div>
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
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);
}

function ProductCard({ item, onAddToCart, onToggleWishlist, isWishlisted }) {
  const detailHref = getProductPath(item.slug ?? slugify(item.name));
  const variationGroups = useMemo(
    () => (Array.isArray(item.variationGroups) ? item.variationGroups.filter(Boolean) : []),
    [item.variationGroups],
  );
  const defaultSelectedOptions = useMemo(
    () => buildDefaultSelectedOptions(variationGroups),
    [variationGroups],
  );
  const primaryGroup = variationGroups.find(Boolean) ?? null;
  const primaryGroupOptions = Array.isArray(primaryGroup?.options) ? primaryGroup.options : [];
  const defaultOption = primaryGroup?.options?.find((option) => option.isDefault) ?? primaryGroup?.options?.[0] ?? null;
  const [selectedOptionKey, setSelectedOptionKey] = useState("");

  useEffect(() => {
    setSelectedOptionKey(defaultOption?.id ?? defaultOption?.value ?? "");
  }, [detailHref, defaultOption?.id, defaultOption?.value]);

  const activeOption =
    primaryGroup?.options?.find((option) => (option.id ?? option.value) === selectedOptionKey) ??
    defaultOption;
  const activeSelection = useMemo(
    () =>
      variationGroups
        .map((group) => {
          const groupOption =
            group.id === primaryGroup?.id
              ? activeOption
              : defaultSelectedOptions.find((entry) => entry.groupId === group.id) ??
                group.options?.find((option) => option.isDefault) ??
                group.options?.[0] ??
                null;

          if (!groupOption) {
            return null;
          }

          return {
            groupId: group.id ?? "",
            groupName: group.groupName ?? "Variation",
            kind: group.kind ?? "text",
            optionId: groupOption.id ?? "",
            label: groupOption.label ?? "",
            value: groupOption.value ?? groupOption.label ?? "",
            priceDelta: Number(groupOption.priceDelta) || 0,
            compareAtDelta: groupOption.compareAtDelta ?? null,
            swatchColor: groupOption.swatchColor ?? "",
            imageUrl: groupOption.imageUrl ?? "",
            isDefault: Boolean(groupOption.isDefault),
          };
        })
        .filter(Boolean),
    [activeOption, defaultSelectedOptions, primaryGroup?.id, variationGroups],
  );
  const activePrice =
    (Number(item.price) || 0) +
    activeSelection.reduce((sum, option) => sum + (Number(option.priceDelta) || 0), 0);
  const activeCompareAt =
    item.compareAt != null
      ? Number(item.compareAt) +
        activeSelection.reduce((sum, option) => sum + (Number(option.compareAtDelta) || 0), 0)
      : null;
  const activeImage =
    activeSelection.find((option) => option.imageUrl)?.imageUrl || activeOption?.imageUrl || item.image;
  const activeVariantKey = buildVariantKeyFromSelectedOptions(activeSelection);

  return (
    <article className="product-card">
      <div className="product-card__media">
        <div className="product-card__actions">
          <button
            type="button"
            className={`product-card__wishlist${
              isWishlisted ? " is-active" : ""
            }`}
            aria-label={`${isWishlisted ? "Remove" : "Save"} ${item.name}`}
            aria-pressed={isWishlisted}
            onClick={() => onToggleWishlist(item.name)}
          >
            <HeartIcon />
          </button>
          <Link
            to={detailHref}
            className="product-card__preview"
            aria-label={`View ${item.name}`}
          >
            <EyeIcon />
          </Link>
        </div>
        <Link
          to={detailHref}
          className="product-card__media-link"
          aria-label={`Open ${item.name}`}
        >
          <img
            src={activeImage}
            alt={item.name}
            className={item.imageClassName ?? ""}
          />
        </Link>
      </div>

      <div className="product-card__body">
        <Link to={detailHref} className="product-card__title-link">
          <h3>{item.name}</h3>
        </Link>
        {primaryGroup ? (
          <div className="product-card__variant-group">
            <div className="product-card__variant-label">
              <span>{primaryGroup.groupName}</span>
              <strong>{activeOption?.label ?? "Default"}</strong>
            </div>
            <div className="product-card__variants" role="list" aria-label={`${item.name} ${primaryGroup.groupName} options`}>
              {primaryGroupOptions.map((option) => (
                <button
                  key={option.id ?? option.value ?? option.label}
                  type="button"
                  className={`product-card__variant${
                    (option.id ?? option.value) === selectedOptionKey ? " is-active" : ""
                  }`}
                  onClick={() => setSelectedOptionKey(option.id ?? option.value ?? "")}
                  aria-pressed={(option.id ?? option.value) === selectedOptionKey}
                  aria-label={`${item.name} ${option.label}`}
                  style={
                    option.swatchColor
                      ? { "--variant-swatch": option.swatchColor }
                      : undefined
                  }
                >
                  {primaryGroup.kind === "color" && option.swatchColor ? (
                    <span className="product-card__variant-swatch" aria-hidden="true" />
                  ) : null}
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <div className="product-card__price">
          <strong>{formatMoney(activePrice)}</strong>
          {activeCompareAt != null && Number(activeCompareAt) > activePrice ? (
            <span>{formatMoney(activeCompareAt)}</span>
          ) : null}
        </div>
        <button
          type="button"
          className="product-card__button nexus-product-card__cart-button"
          onClick={() =>
            onAddToCart({
              ...item,
              price: activePrice,
              compareAt: activeCompareAt,
              selectedOptions: activeSelection,
              variantKey: activeVariantKey,
            })
          }
        >
          <CartIcon className="nexus-product-card__cart-icon" />
          Add To Cart
        </button>
      </div>
    </article>
  );
}

function SectionLabel({ children, icon = "default" }) {
  return (
    <p className="section-label">
      <SectionLabelIcon kind={icon} />
      {children}
    </p>
  );
}

function AnnouncementCard({ announcement }) {
  const status = getAnnouncementStatus(announcement);

  return (
    <article className="testimonial-card">
      <div className="testimonial-card__header">
        <QuoteIcon />
        <div>
          <strong>{announcement.title}</strong>
          <span>{getAnnouncementCategoryLabel(announcement.category)}</span>
        </div>
      </div>

      <p className="testimonial-card__quote">{announcement.body}</p>

      <div className="testimonial-card__footer">
        <span>{getAnnouncementStatusLabel(status)}</span>
        <span>{announcement.publishDate || "Posted recently"}</span>
      </div>
    </article>
  );
}

function ServiceCard({ icon, title, copy }) {
  return (
    <article className="service-card">
      <span className="service-card__icon">
        <CategoryIcon kind={icon} />
      </span>
      <div>
        <h3>{title}</h3>
        <p>{copy}</p>
      </div>
    </article>
  );
}

const serviceItems = [
  {
    icon: "truck",
    title: "FAST DELIVERY",
    copy: "Delivery is done to your door step",
  },
  {
    icon: "headphones",
    title: "24/7 CUSTOMER SERVICE",
    copy: "Friendly 24/7 customer support",
  },
  {
    icon: "shield",
    title: "SECURED PAYMENT",
    copy: "Different payment method accepted",
  },
  {
    icon: "watch",
    title: "EASY TRACKING",
    copy: "Follow your order from checkout to delivery",
  },
];

const importBannerHighlights = [
  "Order with Ease.",
  "Import with Confidence.",
];

const testimonialItems = [
  {
    name: "Amina K.",
    title: "Verified Buyer",
    quote:
      "The checkout was smooth and the delivery came faster than expected. The product quality was even better in person.",
    score: 5,
    accent: "#f97316, #fb7185",
  },
  {
    name: "Daniel O.",
    title: "Returning Customer",
    quote:
      "I like how easy it is to browse. The product photos feel clean, and the pricing is straightforward.",
    score: 4,
    accent: "#2563eb, #22c55e",
  },
  {
    name: "Sarah M.",
    title: "Home Shopper",
    quote:
      "The site feels polished now. I found what I wanted quickly and the customer support response was excellent.",
    score: 5,
    accent: "#db4444, #14b8a6",
  },
];

const footerLinks = {
  support: ["Accra-Ghana", "nexusimport@gmail.com", "+233 53-404-8292"],
  account: [
    { label: "My Account", to: "/profile/dashboard" },
    { label: "Login", to: "/register/login" },
    { label: "Register", to: "/register/signup" },
    { label: "Cart", to: "/cart" },
    { label: "Wishlist", to: "/wishlist" },
    { label: "Shop", to: "/products" },
  ],
  quickLink: [
    { label: "About", to: "/about" },
    { label: "Contact", to: "/contact" },
  ],
};

const heroContent = {
  eyebrow: "WELCOME",
  badge: "YOUR TRUSTED IMPORT PARTNER",
  title: {
    lineOne: "Shop Beyond Borders.",
    lineTwo: "We Handle the Rest.",
  },
  copy:
    "Shop quality products and import with confidence. Nexus Import Hub makes it easy to order, ship, and receive your items from China to Ghana.",
  primaryCta: "Shop Now",
  secondaryCta: "Track Your Order",
  primaryHref: "/products",
  secondaryHref: "/profile/orders",
  image: nexusPerson,
  alt: "Nexus import hero product",
  trustLine: [
    { kind: "plane", label: "Air Shipping" },
    { kind: "ship", label: "Sea Shipping" },
    { kind: "box", label: "Secure Delivery" },
  ],
};

function Home({ onAddToCart, onToggleWishlist, wishlistItems = [] }) {
  const navigate = useNavigate();
  const {
    records: categoryRecords,
    loading: categoriesLoading,
    error: categoriesError,
  } = useCategoryRecords();
  const {
    announcements: liveAnnouncements,
    loading: announcementsLoading,
    error: announcementsError,
  } = useAnnouncements();
  const {
    flashyProducts: liveFlashyProducts,
    bestSellingProducts: liveBestSellingProducts,
    loading: flashyLoading,
    error: flashyError,
  } = useFlashySalesCatalog();
  const {
    products: liveCatalogProducts,
    loading: productsLoading,
    error: productsError,
  } = useProducts();
  const [activeCategory, setActiveCategory] = useState("");
  const [isCategoryPaused, setIsCategoryPaused] = useState(false);
  const categoryCarouselRef = useRef(null);
  const categoryLoopWidthRef = useRef(0);
  const [flashSaleDeadline] = useState(
    () => Date.now() + 7 * 24 * 60 * 60 * 1000,
  );
  const categoryCards = useMemo(
    () => getDiscoverCategoryCards(categoryRecords, liveCatalogProducts),
    [categoryRecords, liveCatalogProducts],
  );
  const loopingCategoryCards = useMemo(
    () => [...categoryCards, ...categoryCards],
    [categoryCards],
  );

  useEffect(() => {
    const measureLoopWidth = () => {
      const container = categoryCarouselRef.current;

      if (!container) {
        categoryLoopWidthRef.current = 0;
        return;
      }

      const cards = container.querySelectorAll(".category-card");
      const firstCardOfSecondLoop = cards[categoryCards.length];

      categoryLoopWidthRef.current = firstCardOfSecondLoop?.offsetLeft ?? 0;
    };

    const frame = window.requestAnimationFrame(measureLoopWidth);
    window.addEventListener("resize", measureLoopWidth);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", measureLoopWidth);
    };
  }, [categoryCards.length]);

  const scrollCategories = useCallback((direction) => {
    const container = categoryCarouselRef.current;

    if (!container) {
      return;
    }

    const loopWidth = categoryLoopWidthRef.current;

    if (loopWidth > 0) {
      if (container.scrollLeft >= loopWidth) {
        container.scrollLeft -= loopWidth;
      } else if (container.scrollLeft < 0) {
        container.scrollLeft += loopWidth;
      }
    }

    const firstCard = container.querySelector(".category-card");
    const cardWidth = firstCard?.getBoundingClientRect().width ?? 220;
    const gap = 20;
    const step = cardWidth + gap;
    const maxScrollLeft = Math.max(container.scrollWidth - container.clientWidth, 0);
    const nextScrollLeft = container.scrollLeft + direction * step;

    if (maxScrollLeft <= 0) {
      return;
    }

    if (direction > 0 && nextScrollLeft >= maxScrollLeft - 4) {
      container.scrollTo({ left: 0, behavior: "smooth" });
      return;
    }

    if (direction < 0 && nextScrollLeft <= 0) {
      container.scrollTo({ left: maxScrollLeft, behavior: "smooth" });
      return;
    }

    container.scrollBy({
      left: direction * step,
      behavior: "smooth",
    });
  }, []);

  useEffect(() => {
    if (categoryCards.length === 0) {
      setActiveCategory("");
      return;
    }

    const activeStillExists = categoryCards.some(
      (category) => category.slug === activeCategory,
    );

    if (!activeCategory || !activeStillExists) {
      setActiveCategory(categoryCards[0].slug);
    }
  }, [activeCategory, categoryCards]);

  useEffect(() => {
    if (isCategoryPaused || categoryCards.length < 2) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      scrollCategories(1);
    }, 1000);

    return () => window.clearInterval(timer);
  }, [categoryCards.length, isCategoryPaused, scrollCategories]);

  const goToProducts = (categorySlug = "") => {
    navigate(getCategoryProductsPath(categorySlug));
  };

  return (
    <main className="home-page">
      <section className="hero-section" id="hero">
        <div className="hero-banner">
          <div className="hero-banner__copy">
            <p className="hero-banner__eyebrow">{heroContent.eyebrow}</p>
            <span className="hero-banner__brand">{heroContent.badge}</span>
            <h1>
              <span className="hero-banner__title-line">
                {heroContent.title.lineOne}
              </span>
              <span className="hero-banner__title-line">
                {heroContent.title.lineTwo}
              </span>
            </h1>
            <p className="hero-banner__copy-text">{heroContent.copy}</p>
            <div className="hero-banner__actions">
              <Link className="hero-banner__link" to={heroContent.primaryHref}>
                {heroContent.primaryCta} <span aria-hidden="true">&rarr;</span>
              </Link>
              <Link
                className="hero-banner__link hero-banner__link--ghost"
                to={heroContent.secondaryHref}
              >
                {heroContent.secondaryCta}
              </Link>
            </div>
            <p className="hero-banner__trustline" aria-label="Shipping highlights">
              {heroContent.trustLine.map((item) => (
                <span key={item.label}>
                  <HeroTrustIcon kind={item.kind} />
                  {item.label}
                </span>
              ))}
            </p>
          </div>

          <div className="hero-banner__stage">
            <div className="hero-banner__visual">
              <img src={heroContent.image} alt={heroContent.alt} />
            </div>
          </div>
        </div>
      </section>

      <section className="service-strip" aria-label="Store benefits">
        <div className="site-shell service-strip__inner">
          {serviceItems.map((service) => (
            <ServiceCard key={service.title} {...service} />
          ))}
        </div>
      </section>

      <section className="site-shell section-block" id="flash-sales">
        <div className="section-header">
          <div>
            <SectionLabel icon="flash">Today's</SectionLabel>
            <h2>Flash Sales</h2>
          </div>

          <div className="section-header__tools">
            <div className="countdown" aria-label="Flash sale countdown">
              <Countdown targetTime={flashSaleDeadline} />
            </div>

            <div className="section-controls">
              <button type="button" aria-label="Previous products">
                &larr;
              </button>
              <button
                type="button"
                aria-label="Go to products page"
                onClick={goToProducts}
              >
                &rarr;
              </button>
            </div>
          </div>
        </div>

        <div className="product-row product-row--wide">
          {flashyError ? (
            <div className="shop-empty">
              <h3>Unable to load flashy sale products right now.</h3>
              <p>{flashyError}</p>
            </div>
          ) : flashyLoading && liveFlashyProducts.length === 0 ? (
            <div className="shop-empty">
              <h3>Loading flashy sale products...</h3>
              <p>We are syncing merchandising assignments from Supabase.</p>
            </div>
          ) : (
            liveFlashyProducts.map((item) => (
              <NexusProductCard
                key={item.id ?? item.slug}
                item={item}
                onAddToCart={onAddToCart}
                onToggleWishlist={onToggleWishlist}
                isWishlisted={wishlistItems.includes(item.name)}
                classNamePrefix="product-card"
              />
            ))
          )}
        </div>

        <div className="section-center">
          <a href="#best-selling" className="primary-button">
            View All Products
          </a>
        </div>
      </section>

      <hr className="section-divider" />

      <section className="site-shell section-block" id="categories">
        <div className="section-header">
          <div>
            <SectionLabel icon="category">Categories</SectionLabel>
            <h2>Browse By Category</h2>
          </div>

          <div className="section-controls">
            <button type="button" aria-label="Previous categories" onClick={() => scrollCategories(-1)}>
              &larr;
            </button>
            <button
              type="button"
              aria-label="Next categories"
              onClick={() => scrollCategories(1)}
            >
              &rarr;
            </button>
          </div>
        </div>

        {categoriesError ? (
          <p className="section-note">Unable to load categories right now.</p>
        ) : null}

        {categoriesLoading && categoryCards.length === 0 ? (
          <div className="category-grid category-grid--carousel">
            <div className="category-card">
              <span className="section-note">Loading categories...</span>
            </div>
          </div>
        ) : categoryCards.length > 0 ? (
        <div
            className="category-grid category-grid--carousel"
            ref={categoryCarouselRef}
            onMouseEnter={() => setIsCategoryPaused(true)}
            onMouseLeave={() => setIsCategoryPaused(false)}
          >
            {loopingCategoryCards.map((category, index) => (
              <article
                key={`${category.slug}-${index}`}
                className={`category-card${activeCategory === category.slug ? " is-active" : ""}${
                  category.children?.length ? " has-children" : ""
                }`}
              >
                <Link
                  to={getCategoryProductsPath(category.slug)}
                  className="category-card__link"
                  onClick={() => setActiveCategory(category.slug)}
                >
                  <span className="category-card__media">
                    <img src={category.image} alt={category.name} loading="lazy" />
                  </span>
                  <strong>{category.name}</strong>
                  <span className="category-card__count">{category.productCount} Products</span>
                </Link>

                {Array.isArray(category.children) &&
                category.children.length > 0 ? (
                  <div
                    className="category-card__children"
                    aria-label={`${category.name} subcategories`}
                  >
                    {category.children.map((child) => (
                      <Link
                        key={child.slug}
                        to={getCategoryProductsPath(child.slug)}
                        className="category-card__child"
                        onClick={() => setActiveCategory(category.slug)}
                      >
                        {child.name}
                      </Link>
                    ))}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <div className="category-grid">
            <div className="category-card">
              <span className="section-note">
                No categories are available yet.
              </span>
            </div>
          </div>
        )}
      </section>

      <section className="site-shell section-block" id="best-selling">
        <div className="section-header">
          <div>
            <SectionLabel icon="calendar">This Month</SectionLabel>
            <h2>Best Selling Products</h2>
          </div>

          <a href="#featured" className="view-all-link">
            View All
          </a>
        </div>

        <div className="product-row">
          {flashyError ? (
            <div className="shop-empty">
              <h3>Unable to load best-selling products right now.</h3>
              <p>{flashyError}</p>
            </div>
          ) : flashyLoading && liveBestSellingProducts.length === 0 ? (
            <div className="shop-empty">
              <h3>Loading best-selling products...</h3>
              <p>We are syncing merchandising assignments from Supabase.</p>
            </div>
          ) : (
            liveBestSellingProducts.slice(0, 8).map((item) => (
              <NexusProductCard
                key={item.id ?? item.slug}
                item={item}
                onAddToCart={onAddToCart}
                onToggleWishlist={onToggleWishlist}
                isWishlisted={wishlistItems.includes(item.name)}
                classNamePrefix="product-card"
              />
            ))
          )}
        </div>
      </section>

      <section className="site-shell section-block" id="explore">
        <div className="section-header">
          <div>
            <SectionLabel icon="box">Our Products</SectionLabel>
            <h2>Explore Our Products</h2>
          </div>

          <div className="section-controls">
            <button type="button" aria-label="Previous products">
              &larr;
            </button>
            <button
              type="button"
              aria-label="Go to products page"
              onClick={goToProducts}
            >
              &rarr;
            </button>
          </div>
        </div>

        <div className="product-row">
          {productsError ? (
            <div className="shop-empty">
              <h3>Unable to load products right now.</h3>
              <p>{productsError.message || "Please try again in a moment."}</p>
            </div>
          ) : productsLoading && liveCatalogProducts.length === 0 ? (
            <div className="shop-empty">
              <h3>Loading products...</h3>
              <p>We are pulling the current catalog from Supabase.</p>
            </div>
          ) : (
            liveCatalogProducts
              .slice(0, 4)
              .map((item) => (
                <NexusProductCard
                  key={item.slug}
                  item={item}
                  onAddToCart={onAddToCart}
                  onToggleWishlist={onToggleWishlist}
                  isWishlisted={wishlistItems.includes(item.name)}
                  classNamePrefix="product-card"
                />
            ))
          )}
        </div>

        <div className="section-center">
          <a href="/products" className="primary-button">
            View All Products
          </a>
        </div>
      </section>

      <section className="home-import-banner" aria-label="Nexus import message">
        <div className="site-shell home-import-banner__inner">
          <span className="home-import-banner__icon" aria-hidden="true">
            <ImportBannerIcon />
          </span>
          <div className="home-import-banner__copy">
            <p className="home-import-banner__eyebrow">Nexus Import Hub</p>
            <h2>
              {importBannerHighlights.map((line) => (
                <span key={line}>{line}</span>
              ))}
            </h2>
          </div>
        </div>
      </section>

      <section className="site-shell section-block" id="testimonials">
        <div className="section-header">
          <div>
            <SectionLabel icon="feedback">Feedback</SectionLabel>
            <h2>Customer Testimonials</h2>
          </div>
        </div>

        <div className="testimonial-grid">
          {testimonialItems.map((item) => (
            <article className="testimonial-card" key={item.name}>
              <div className="testimonial-card__avatar" aria-hidden="true">
                {item.name
                  .split(" ")
                  .map((part) => part[0])
                  .join("")}
              </div>

              <div className="testimonial-card__header">
                <QuoteIcon />
                <div>
                  <strong>{item.name}</strong>
                  <span>{item.title}</span>
                </div>
              </div>

              <p className="testimonial-card__quote">{item.quote}</p>

              <div className="testimonial-card__footer">
                <StarRating score={item.score} />
                <span>Customer approved</span>
              </div>
            </article>
          ))}
        </div>
      </section>

      <footer className="site-footer" id="footer">
        <div className="site-shell site-footer__inner">
          <div className="site-footer__brand">
            <div className="site-footer__brand-row">
              <img src={logo} alt="Nexus logo " className="site-footer__logo" />
              <div>
                <h3>Nexus Imports </h3>
                <p>Subscribe</p>
              </div>
            </div>
            <span>Get 10% off your first order</span>

            <form
              className="site-footer__form"
              onSubmit={(event) => event.preventDefault()}
            >
              <input
                type="email"
                placeholder="Enter your email"
                aria-label="Email address"
              />
              <button type="submit" aria-label="Subscribe">
                &rarr;
              </button>
            </form>
          </div>

          <div className="site-footer__column">
            <h3>Support</h3>
            {footerLinks.support.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>

          <div className="site-footer__column">
            <h3>Account</h3>
            {footerLinks.account.map((item) => (
              <Link to={item.to} key={item.label}>
                {item.label}
              </Link>
            ))}
          </div>

          <div className="site-footer__column">
            <h3>Quick Link</h3>
            {footerLinks.quickLink.map((item) => (
              <Link to={item.to} key={item.label}>
                {item.label}
              </Link>
            ))}
          </div>

          <div className="site-footer__column">
            <h3>Connect</h3>
            <div className="site-footer__socials" aria-label="Social links">
              <span>f</span>
              <span>t</span>
              <span>i</span>
              <span>in</span>
            </div>
          </div>
        </div>

        <div className="site-shell site-footer__bottom">
          <p>Copyright @ Nexus 2026</p>
        </div>
      </footer>
    </main>
  );
}

export default Home;
