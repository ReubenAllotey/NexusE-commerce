import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  buildDefaultSelectedOptions,
  buildVariantKeyFromSelectedOptions,
  getProductPath,
  slugify,
} from "./productData";

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
  return new Intl.NumberFormat("en-GH", {
    style: "currency",
    currency: "GHS",
    currencyDisplay: "symbol",
    minimumFractionDigits: Number.isInteger(Number(value) || 0) ? 0 : 2,
    maximumFractionDigits: Number.isInteger(Number(value) || 0) ? 0 : 2,
  }).format(Number(value) || 0);
}

function buildSelectionEntry(group, option) {
  return {
    groupId: group.id ?? group.groupName ?? "",
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
  };
}

function ProductCard({
  item = {},
  onAddToCart = () => {},
  onToggleWishlist = () => {},
  isWishlisted = false,
  classNamePrefix = "product-card",
}) {
  const prefix = classNamePrefix === "shop-card" ? "shop-card" : "product-card";
  const safeVariationGroups = useMemo(
    () => (Array.isArray(item.variationGroups) ? item.variationGroups.filter(Boolean) : []),
    [item.variationGroups],
  );
  const defaultSelectedOptions = useMemo(
    () => buildDefaultSelectedOptions(safeVariationGroups),
    [safeVariationGroups],
  );
  const [selectedOptions, setSelectedOptions] = useState([]);

  useEffect(() => {
    setSelectedOptions(defaultSelectedOptions);
  }, [defaultSelectedOptions, item.id, item.slug]);

  const selectionLookup = useMemo(
    () => new Map(selectedOptions.map((option) => [option.groupId, option])),
    [selectedOptions],
  );

  const activeSelection = useMemo(
    () =>
      safeVariationGroups
        .map((group) => {
          const selectedOption =
            selectionLookup.get(group.id) ??
            group.options?.find((option) => option.isDefault) ??
            group.options?.[0] ??
            null;

          if (!selectedOption) {
            return null;
          }

          return buildSelectionEntry(group, selectedOption);
        })
        .filter(Boolean),
    [safeVariationGroups, selectionLookup],
  );

  const primaryGroup = safeVariationGroups.find(Boolean) ?? null;
  const visibleGroups = useMemo(() => {
    if (!safeVariationGroups.length) {
      return [];
    }

    const groupsWithOptions = safeVariationGroups.filter(
      (group) => Array.isArray(group.options) && group.options.length > 0,
    );

    if (groupsWithOptions.length === 0) {
      return [];
    }

    const primary = groupsWithOptions[0] ?? null;
    const colorGroup =
      groupsWithOptions.find((group, index) => index > 0 && group.kind === "color") ?? null;
    const fallbackGroup = groupsWithOptions[1] ?? null;

    return [primary, colorGroup ?? fallbackGroup].filter(Boolean).filter((group, index, list) => {
      return list.findIndex((entry) => entry?.id === group?.id) === index;
    });
  }, [safeVariationGroups]);

  const activePrice =
    (Number(item.price) || 0) +
    activeSelection.reduce((sum, option) => sum + (Number(option.priceDelta) || 0), 0);
  const activeCompareAt =
    item.compareAt != null
      ? (Number(item.compareAt) || 0) +
        activeSelection.reduce((sum, option) => sum + (Number(option.compareAtDelta) || 0), 0)
      : null;
  const activeImage =
    activeSelection.find((option) => option.imageUrl)?.imageUrl ||
    item.image ||
    item.primaryImageUrl ||
    FALLBACK_IMAGE;
  const activeVariantKey = buildVariantKeyFromSelectedOptions(activeSelection);
  const detailHref = getProductPath(item.slug ?? slugify(item.name));

  const handleSelectOption = (group, option) => {
    setSelectedOptions((current) => {
      const next = current.filter((entry) => entry.groupId !== (group.id ?? group.groupName ?? ""));
      return [...next, buildSelectionEntry(group, option)].sort((left, right) =>
        String(left.groupId).localeCompare(String(right.groupId)),
      );
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
      </div>

      <div className={`${prefix}__body`}>
        <Link to={detailHref} className={`${prefix}__title-link`}>
          <h3>{item.name}</h3>
        </Link>

        {visibleGroups.length > 0 ? (
          <div className={`${prefix}__variation-stack`}>
            {visibleGroups.map((group) => {
              const groupOptions = Array.isArray(group.options) ? group.options : [];
              const activeGroupOption =
                activeSelection.find((option) => option.groupId === group.id) ??
                groupOptions.find((option) => option.isDefault) ??
                groupOptions[0] ??
                null;
              const visibleOptions = groupOptions.slice(0, 4);
              const hiddenCount = Math.max(groupOptions.length - visibleOptions.length, 0);

              return (
                <div key={group.id ?? group.groupName} className={`${prefix}__variant-group`}>
                  <div className={`${prefix}__variant-label`}>
                    <span>{group.groupName}</span>
                    <strong>{activeGroupOption?.label ?? "Default"}</strong>
                  </div>

                  <div
                    className={`${prefix}__variants`}
                    role="list"
                    aria-label={`${item.name} ${group.groupName} options`}
                  >
                    {visibleOptions.map((option) => {
                      const optionKey = option.id ?? option.value ?? option.label;
                      const isActive =
                        (activeGroupOption?.id ?? activeGroupOption?.value ?? activeGroupOption?.label) ===
                        optionKey;
                      const isColor = group.kind === "color" && Boolean(option.swatchColor);

                      return (
                        <button
                          key={optionKey}
                          type="button"
                          className={`${prefix}__variant${isActive ? " is-active" : ""}${
                            isColor ? ` ${prefix}__variant--swatch` : ""
                          }`}
                          onClick={() => handleSelectOption(group, option)}
                          aria-pressed={isActive}
                          aria-label={`${item.name} ${option.label}`}
                          style={
                            isColor
                              ? { "--variant-swatch": option.swatchColor }
                              : undefined
                          }
                        >
                          {isColor ? <span className={`${prefix}__variant-swatch`} aria-hidden="true" /> : null}
                          <span>{option.label}</span>
                        </button>
                      );
                    })}

                    {hiddenCount > 0 ? (
                      <span className={`${prefix}__variant-more`}>+{hiddenCount}</span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}

        <div className={`${prefix}__price`}>
          <strong>{formatMoney(activePrice)}</strong>
          {activeCompareAt != null && Number(activeCompareAt) > activePrice ? (
            <span>{formatMoney(activeCompareAt)}</span>
          ) : null}
        </div>

        <button
          type="button"
          className={`${prefix}__button`}
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
          <CartIcon />
          Add to Cart
        </button>
      </div>
    </article>
  );
}

export default ProductCard;
