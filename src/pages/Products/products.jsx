import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useCategoryRecords } from "../../shared/categoryStorage";
import {
  buildDefaultSelectedOptions,
  buildVariantKeyFromSelectedOptions,
  getProductPurchaseMeta,
  getProductPath,
  slugify,
  useProducts,
} from "./productData";
import NexusProductCard from "./ProductCard";
import UnavailableStockButton from "./UnavailableStockButton";
import logo from "../../assets/images/nexuslogo.png";
import { getDiscoverCategoryCards } from "../../shared/categoryStorage";
import SiteFooter from "../../shared/SiteFooter";

const ITEMS_PER_PAGE = 24;

function parseCategorySelection(value) {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((slug) => slug.trim())
    .filter(Boolean);
}

function matchesCategorySelection(item, categorySelection) {
  const selectedSlug = slugify(categorySelection);
  if (!selectedSlug) {
    return false;
  }

  const productCategorySlug = slugify(item?.categorySlug ?? item?.category);
  const productCategoryName = slugify(item?.category ?? "");
  const trail = Array.isArray(item?.categoryTrail) ? item.categoryTrail : [];

  if (productCategorySlug === selectedSlug || productCategoryName === selectedSlug) {
    return true;
  }

  return trail.some((entry) => slugify(entry) === selectedSlug);
}

const sortOptions = [
  { value: "featured", label: "Featured" },
  { value: "price-asc", label: "Price: Low to High" },
  { value: "price-desc", label: "Price: High to Low" },
  { value: "rating-desc", label: "Top Rated" },
  { value: "name-asc", label: "Name: A to Z" },
];

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m21 21-4.3-4.3" />
      <circle cx="11" cy="11" r="6.5" />
    </svg>
  );
}

function ShopBadgeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 6h16l-1.3 11a2 2 0 0 1-2 1.8H7.3a2 2 0 0 1-2-1.8L4 6Z" />
      <path d="M8 6V4.8A2.8 2.8 0 0 1 10.8 2h2.4A2.8 2.8 0 0 1 16 4.8V6" />
      <path d="M9 10h6" />
    </svg>
  );
}

function FiltersIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 6h8" />
      <path d="M16 6h4" />
      <path d="M10 6v4" />
      <path d="M4 12h16" />
      <path d="M4 18h4" />
      <path d="M12 18h8" />
      <path d="M14 18v-4" />
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

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5c5.5 0 9.8 4 11 7-1.2 3-5.5 7-11 7S2.2 15 1 12c1.2-3 5.5-7 11-7Zm0 2C8 7 4.7 9.6 3.5 12 4.7 14.4 8 17 12 17s7.3-2.6 8.5-5C19.3 9.6 16 7 12 7Zm0 1.8A3.2 3.2 0 1 1 8.8 12 3.2 3.2 0 0 1 12 8.8Z" />
    </svg>
  );
}

function ChevronIcon({ direction = "right" }) {
  const d = direction === "left" ? "m14 6-6 6 6 6" : "m10 6 6 6-6 6";

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} />
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

function formatMoney(value) {
  return new Intl.NumberFormat("en-GH", {
    style: "currency",
    currency: "GHS",
    currencyDisplay: "symbol",
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);
}

function toggleItem(list, item) {
  return list.includes(item)
    ? list.filter((entry) => entry !== item)
    : [...list, item];
}

function getProductColorEntries(item = {}) {
  if (Array.isArray(item.availableColors) && item.availableColors.length > 0) {
    return item.availableColors.filter(Boolean);
  }

  if (Array.isArray(item.colors) && item.colors.length > 0) {
    return item.colors.filter(Boolean);
  }

  return [];
}

function getColorSelectionKey(entry = {}) {
  return slugify(entry?.value ?? entry?.key ?? entry?.label ?? entry?.name ?? "");
}

function renderStars(score) {
  const stars = Array.from(
    { length: 5 },
    (_, index) => index < Math.round(score),
  );

  return stars.map((filled, index) => (
    <StarIcon key={`${index}-${filled}`} filled={filled} />
  ));
}

function ProductCard({ item, isWishlisted, onAddToCart, onToggleWishlist }) {
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
  }, [item.slug, defaultOption?.id, defaultOption?.value]);

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
  const availabilityMeta = getProductPurchaseMeta(item);

  return (
    <article className="shop-card">
      <div className="shop-card__image">
        <div className="shop-card__actions">
          <button
            type="button"
            className={`shop-card__wishlist${isWishlisted ? " is-active" : ""}`}
            onClick={() => onToggleWishlist(item.name)}
            aria-label={`${isWishlisted ? "Remove" : "Add"} ${item.name} to wishlist`}
          >
            <HeartIcon />
          </button>

          <Link
            to={getProductPath(item.slug)}
            className="shop-card__preview"
            aria-label={`View ${item.name}`}
          >
            <EyeIcon />
          </Link>
        </div>
        <img
          src={activeImage}
          alt={item.name}
          className={
            item.imageClassName
              ? `shop-card__photo ${item.imageClassName}`
              : "shop-card__photo"
          }
          loading="lazy"
        />
        {availabilityMeta.outOfStock ? (
          <span className="shop-card__out-of-stock-badge">OUT OF STOCK</span>
        ) : null}
      </div>

      <div className="shop-card__body">
        <div className="shop-card__topline">
          <span className={`shop-card__availability shop-card__availability--${availabilityMeta.tone ?? "green"}`}>
            {availabilityMeta.badge}
          </span>
        </div>

        <h3>{item.name}</h3>

        {primaryGroup ? (
          <div className="shop-card__variant-group">
            <div className="shop-card__variant-label">
              <span>{primaryGroup.groupName}</span>
              <strong>{activeOption?.label ?? "Default"}</strong>
            </div>
            <div className="shop-card__variants" role="list" aria-label={`${item.name} ${primaryGroup.groupName} options`}>
              {primaryGroupOptions.map((option) => (
                <button
                  key={option.id ?? option.value ?? option.label}
                  type="button"
                  className={`shop-card__variant${
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
                    <span className="shop-card__variant-swatch" aria-hidden="true" />
                  ) : null}
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="shop-card__price">
          <strong>{formatMoney(activePrice)}</strong>
          {activeCompareAt != null && Number(activeCompareAt) > activePrice ? (
            <span>{formatMoney(activeCompareAt)}</span>
          ) : null}
        </div>

        {availabilityMeta.outOfStock ? (
          <UnavailableStockButton
            className="shop-card__add nexus-product-card__cart-button is-disabled"
            aria-label={`${item.name} is out of stock`}
          >
            <CartIcon className="nexus-product-card__cart-icon" />
            {availabilityMeta.buttonLabel}
          </UnavailableStockButton>
        ) : (
          <button
            type="button"
            className={`shop-card__add nexus-product-card__cart-button${
              availabilityMeta.disabled ? " is-disabled" : ""
            }`}
            disabled={availabilityMeta.disabled}
            onClick={() =>
              onAddToCart({
                ...item,
                price: activePrice,
                compareAt: activeCompareAt,
                selectedOptions: activeSelection,
                variantKey: activeVariantKey,
                availabilityType: item.availabilityType ?? item.availability_type,
              })
            }
          >
            <CartIcon className="nexus-product-card__cart-icon" />
            {availabilityMeta.buttonLabel}
          </button>
        )}
      </div>
    </article>
  );
}

function Products({
  onAddToCart = () => {},
  onToggleWishlist = () => {},
  wishlistItems = [],
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    products,
    loading: productsLoading,
    error: productsError,
  } = useProducts();
  const {
    records: categoryRecords,
    loading: categoriesLoading,
    error: categoriesError,
  } = useCategoryRecords();
  const categoryParam = searchParams.get("category") ?? "";
  const searchParam = searchParams.get("search") ?? "";
  const [searchTerm, setSearchTerm] = useState(searchParam);
  const [sortBy, setSortBy] = useState("featured");
  const [selectedColors, setSelectedColors] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const visibleCategoryRecords = useMemo(
    () =>
      categoryRecords
        .filter((category) => category.status === "active" && !category.deletedAt && !category.parentId)
        .sort((left, right) => (left.order ?? 0) - (right.order ?? 0) || left.name.localeCompare(right.name)),
    [categoryRecords],
  );
  const categoryOptions = useMemo(
    () =>
      getDiscoverCategoryCards(visibleCategoryRecords, products)
        .map((record) => {
          return {
            slug: record.slug,
            label: record.name,
            name: record.name,
          };
        }),
    [products, visibleCategoryRecords],
  );
  const colorOptions = useMemo(() => {
    const colors = new Map();

    (Array.isArray(products) ? products : []).forEach((product) => {
      getProductColorEntries(product).forEach((entry) => {
        const key = getColorSelectionKey(entry);

        if (!key || colors.has(key)) {
          return;
        }

        colors.set(key, {
          key,
          label: entry?.label ?? entry?.name ?? entry?.value ?? entry?.key ?? "Color",
          swatch: entry?.swatch ?? entry?.previewTint ?? entry?.swatchColor ?? "",
        });
      });
    });

    return Array.from(colors.values()).sort((left, right) => left.label.localeCompare(right.label));
  }, [products]);
  const selectedCategories = parseCategorySelection(categoryParam);

  useEffect(() => {
    setSearchTerm(searchParam);
    setCurrentPage(1);
  }, [searchParam]);

  const filteredProducts = useMemo(
    () =>
      (Array.isArray(products) ? products : [])
        .filter((item) => {
          const haystack =
            `${item.name} ${item.description} ${item.brand} ${item.category}`.toLowerCase();
          const matchesSearch = haystack.includes(searchTerm.toLowerCase());
          const matchesCategory =
            selectedCategories.length === 0 ||
            selectedCategories.some((selection) => matchesCategorySelection(item, selection));
          const productColors = getProductColorEntries(item);
          const matchesColor =
            selectedColors.length === 0 ||
            selectedColors.some((selection) =>
              productColors.some((entry) => getColorSelectionKey(entry) === selection),
            );

          return matchesSearch && matchesCategory && matchesColor;
        })
        .sort((a, b) => {
          switch (sortBy) {
            case "price-asc":
              return a.price - b.price;
            case "price-desc":
              return b.price - a.price;
            case "rating-desc":
              return b.rating - a.rating;
            case "name-asc":
              return a.name.localeCompare(b.name);
            default:
              return new Date(a.createdAt ?? 0) - new Date(b.createdAt ?? 0);
          }
        }),
    [products, searchTerm, selectedCategories, selectedColors, sortBy],
  );

  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / ITEMS_PER_PAGE));
  const safePage = Math.min(currentPage, totalPages);
  const startIndex = (safePage - 1) * ITEMS_PER_PAGE;
  const visibleProducts = filteredProducts.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  const visibleStart = filteredProducts.length > 0 ? startIndex + 1 : 0;
  const visibleEnd = startIndex + visibleProducts.length;

  const handleSearchChange = (value) => {
    setSearchTerm(value);
    const nextParams = new URLSearchParams(searchParams);
    const nextValue = value.trim();

    if (nextValue.length > 0) {
      nextParams.set("search", nextValue);
    } else {
      nextParams.delete("search");
    }

    setSearchParams(nextParams, { replace: true });
    setCurrentPage(1);
  };

  const handleCategoryToggle = (category) => {
    const nextCategories = toggleItem(selectedCategories, category);
    const nextParams = new URLSearchParams(searchParams);

    if (nextCategories.length === 0) {
      nextParams.delete("category");
    } else {
      nextParams.set(
        "category",
        nextCategories
          .join(","),
      );
    }

    setSearchParams(nextParams, { replace: true });
    setCurrentPage(1);
  };

  const handleColorToggle = (colorKey) => {
    setSelectedColors((current) => toggleItem(current, colorKey));
    setCurrentPage(1);
  };

  const handleSortChange = (value) => {
    setSortBy(value);
    setCurrentPage(1);
  };

  return (
    <main className="shop-page" id="top">
      <section className="shop-page__hero">
        <div className="shop-shell shop-page__hero-inner">
          <div className="shop-page__badge">
            <ShopBadgeIcon />
            <span>Shop</span>
          </div>
          <h1>Our Products</h1>
          <p>Discover premium electronics and gadgets at unbeatable prices.</p>
        </div>
      </section>

      <div className="shop-page__content">
        <div className="shop-shell">
          <section className="shop-main" id="catalog">
            <div className="shop-toolbar">
              <label className="shop-toolbar__search" htmlFor="shop-toolbar-search">
                <SearchIcon />
                <input
                  id="shop-toolbar-search"
                  type="search"
                  value={searchTerm}
                  onChange={(event) => handleSearchChange(event.target.value)}
                  placeholder="Search products, brands, categories..."
                />
              </label>

              <div className="shop-toolbar__filters">
                <div className="shop-toolbar__filters-label">
                  <FiltersIcon />
                  <span>Filters</span>
                </div>

                <details className="shop-filter-pill">
                  <summary>
                    <span>Category</span>
                    <ChevronIcon direction="right" />
                  </summary>
                  <div className="shop-filter-pill__panel">
                    <div className="shop-filter__list">
                      {categoriesError ? <p className="shop-filter__note">Unable to load categories.</p> : null}
                      {categoriesLoading && categoryOptions.length === 0 ? (
                        <p className="shop-filter__note">Loading categories...</p>
                      ) : categoryOptions.length > 0 ? (
                        categoryOptions.map((category) => (
                          <label key={category.slug} className="shop-check">
                            <input
                              type="checkbox"
                              checked={selectedCategories.includes(category.slug)}
                              onChange={() => handleCategoryToggle(category.slug)}
                            />
                            <span>{category.label}</span>
                          </label>
                        ))
                      ) : (
                        <p className="shop-filter__note">No categories available.</p>
                      )}
                    </div>
                  </div>
                </details>

                <details className="shop-filter-pill">
                  <summary>
                    <span>Color</span>
                    <ChevronIcon direction="right" />
                  </summary>
                  <div className="shop-filter-pill__panel">
                    <div className="shop-filter__list">
                      {colorOptions.length > 0 ? (
                        colorOptions.map((color) => (
                          <label key={color.key} className="shop-check">
                            <input
                              type="checkbox"
                              checked={selectedColors.includes(color.key)}
                              onChange={() => handleColorToggle(color.key)}
                            />
                            <span>
                              {color.swatch ? (
                                <span
                                  className="shop-check__swatch"
                                  style={{ "--variant-swatch": color.swatch }}
                                  aria-hidden="true"
                                />
                              ) : null}
                              {color.label}
                            </span>
                          </label>
                        ))
                      ) : (
                        <p className="shop-filter__note">No colors available.</p>
                      )}
                    </div>
                  </div>
                </details>

                <label className="shop-toolbar__sort" htmlFor="shop-sort">
                  <span>Sort:</span>
                  <select
                    id="shop-sort"
                    value={sortBy}
                    onChange={(event) => handleSortChange(event.target.value)}
                  >
                    {sortOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            {productsError ? (
              <div className="shop-empty">
                <h3>Unable to load products right now.</h3>
                <p>{productsError.message || "Please try again in a moment."}</p>
              </div>
            ) : null}

            {productsLoading && filteredProducts.length === 0 ? (
              <div className="shop-empty">
                <h3>Loading products...</h3>
                <p>We are pulling the current catalog from Supabase.</p>
              </div>
            ) : null}

            <p className="shop-summary">
              <strong>{filteredProducts.length}</strong> products found
            </p>

            <p className="shop-summary shop-summary--sub">
              Showing {visibleStart}-{visibleEnd} of {filteredProducts.length} products
            </p>

            <div className="shop-grid">
              {visibleProducts.length > 0 ? (
                visibleProducts.map((item) => (
                  <NexusProductCard
                    key={item.name}
                    item={item}
                    isWishlisted={wishlistItems.includes(item.name)}
                    onAddToCart={onAddToCart}
                    onToggleWishlist={onToggleWishlist}
                    classNamePrefix="shop-card"
                  />
                ))
              ) : (
                <div className="shop-empty">
                  <h3>No products match your filters.</h3>
                  <p>Try clearing a category, color, or search term to see more items.</p>
                </div>
              )}
            </div>

            {filteredProducts.length > 0 ? (
              <div className="shop-pagination" aria-label="Pagination">
                <button
                  type="button"
                  onClick={() => setCurrentPage((page) => Math.max(page - 1, 1))}
                  disabled={safePage === 1}
                  aria-label="Previous page"
                >
                  <ChevronIcon direction="left" />
                </button>

                {Array.from({ length: totalPages }, (_, index) => index + 1).map((page) => (
                  <button
                    type="button"
                    key={page}
                    onClick={() => setCurrentPage(page)}
                    className={page === safePage ? "is-active" : ""}
                    aria-label={`Page ${page}`}
                    aria-current={page === safePage ? "page" : undefined}
                  >
                    {page}
                  </button>
                ))}

                <button
                  type="button"
                  onClick={() => setCurrentPage((page) => Math.min(page + 1, totalPages))}
                  disabled={safePage === totalPages}
                  aria-label="Next page"
                >
                  <ChevronIcon direction="right" />
                </button>
              </div>
            ) : null}
          </section>
        </div>
      </div>

      <SiteFooter logoSrc={logo} logoAlt="Nexus logo" />
    </main>
  );
}

export default Products;

