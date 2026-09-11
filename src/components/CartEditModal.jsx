import { useEffect, useMemo, useState } from "react";
import {
  getMissingRequiredVariationGroups,
  resolveProductPrice,
} from "../pages/Products/productData";

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

function optionKey(option = {}) {
  return String(option.id ?? option.value ?? option.label ?? "");
}

function selectedOptionKey(option = {}) {
  return String(option.optionId ?? option.id ?? option.value ?? option.label ?? "");
}

function normalizeSelectedOptionsForProduct(value, groups = []) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((selected) => {
      if (!selected || typeof selected !== "object") {
        return null;
      }

      const selectedGroupId = selected.groupId ?? selected.group_id;
      const selectedGroupName = String(selected.groupName ?? selected.group_name ?? "").trim().toLowerCase();
      const group = groups.find(
        (entry) =>
          (selectedGroupId != null && String(entry?.id ?? "") === String(selectedGroupId)) ||
          (selectedGroupName && String(entry?.groupName ?? entry?.group_name ?? "").trim().toLowerCase() === selectedGroupName),
      );

      if (!group) {
        return selected;
      }

      const selectedId = selected.optionId ?? selected.option_id;
      const selectedLabel = String(selected.label ?? selected.optionLabel ?? selected.option_label ?? "").trim().toLowerCase();
      const selectedValue = String(selected.value ?? selected.optionValue ?? selected.option_value ?? "").trim().toLowerCase();
      const option = (Array.isArray(group.options) ? group.options : []).find(
        (entry) =>
          (selectedId != null && String(entry?.id ?? "") === String(selectedId)) ||
          (selectedLabel && String(entry?.label ?? "").trim().toLowerCase() === selectedLabel) ||
          (selectedValue && String(entry?.value ?? "").trim().toLowerCase() === selectedValue),
      );

      if (!option) {
        return { ...selected, groupId: group.id ?? selectedGroupId };
      }

      return {
        groupId: group.id ?? selectedGroupId ?? "",
        groupName: group.groupName ?? group.group_name ?? selected.groupName ?? selected.group_name ?? "Variation",
        kind: group.kind ?? selected.kind ?? "text",
        optionId: option.id ?? selectedId ?? "",
        label: option.label ?? selected.label ?? "",
        value: option.value ?? selected.value ?? option.label ?? "",
        priceDelta: Number(option.priceDelta ?? option.price_delta ?? selected.priceDelta ?? selected.price_delta) || 0,
        compareAtDelta: option.compareAtDelta ?? option.compare_at_delta ?? selected.compareAtDelta ?? selected.compare_at_delta ?? null,
        swatchColor: option.swatchColor ?? option.swatch_color ?? selected.swatchColor ?? selected.swatch_color ?? "",
        imageUrl: option.imageUrl ?? option.image_url ?? selected.imageUrl ?? selected.image_url ?? "",
        isDefault: Boolean(option.isDefault ?? option.is_default ?? selected.isDefault ?? selected.is_default),
      };
    })
    .filter(Boolean);
}

function CartEditModal({ item, product, onClose, onUpdate }) {
  const variationGroups = useMemo(
    () => {
      const groups = Array.isArray(product?.variationGroups)
        ? product.variationGroups
        : Array.isArray(product?.variation_groups)
          ? product.variation_groups
          : [];

      return groups.filter(Boolean).map((group) => ({
        ...group,
        id: group.id ?? group.group_id ?? "",
        groupName: group.groupName ?? group.group_name ?? group.name ?? "Variation",
        kind: group.kind ?? "text",
        options: (group.options ?? group.variationOptions ?? group.variation_options ?? [])
          .filter(Boolean)
          .map((option) => ({
            ...option,
            id: option.id ?? option.option_id ?? "",
            label: option.label ?? option.optionLabel ?? option.option_label ?? option.name ?? option.value ?? "",
            value: option.value ?? option.optionValue ?? option.option_value ?? option.label ?? option.name ?? "",
            priceDelta: option.priceDelta ?? option.price_delta ?? 0,
            compareAtDelta: option.compareAtDelta ?? option.compare_at_delta ?? null,
            swatchColor: option.swatchColor ?? option.swatch_color ?? "",
            imageUrl: option.imageUrl ?? option.image_url ?? "",
          })),
      }));
    },
    [product],
  );
  const [selectedOptions, setSelectedOptions] = useState([]);
  const [quantity, setQuantity] = useState(1);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSelectedOptions(
      normalizeSelectedOptionsForProduct(item?.selectedOptions ?? item?.selected_options, variationGroups),
    );
    setQuantity(Math.max(Number(item?.quantity) || 1, 1));
    setError("");
  }, [item, variationGroups]);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape" && !saving) onClose();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, saving]);

  if (!item || !product) return null;

  const activePrice = resolveProductPrice(product, selectedOptions);

  function handleSelect(group, option) {
    const nextOption = {
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
    const current = selectedOptions.find((entry) => String(entry.groupId) === String(nextOption.groupId));
    const isDeselecting = current && selectedOptionKey(current) === optionKey(option);

    setSelectedOptions((entries) => {
      if (isDeselecting) {
        return entries.filter((entry) => String(entry.groupId) !== String(nextOption.groupId));
      }
      return [
        ...entries.filter((entry) => String(entry.groupId) !== String(nextOption.groupId)),
        nextOption,
      ].sort((left, right) => String(left.groupId).localeCompare(String(right.groupId)));
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const missing = getMissingRequiredVariationGroups(variationGroups, selectedOptions);
    if (missing.length > 0) {
      setError(`Please select ${missing[0].groupName}.`);
      return;
    }

    setSaving(true);
    setError("");
    const result = await onUpdate({ item, product, quantity, selectedOptions });
    setSaving(false);
    if (result?.ok) {
      onClose();
    } else {
      setError(result?.message || "Unable to update this cart item.");
    }
  }

  return (
    <div className="cart-edit-modal" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !saving && onClose()}>
      <section className="cart-edit-modal__panel" role="dialog" aria-modal="true" aria-labelledby="cart-edit-title">
        <header className="cart-edit-modal__header">
          <div>
            <p>Edit Item</p>
            <h2 id="cart-edit-title">{product.name}</h2>
          </div>
          <button type="button" className="cart-edit-modal__close" onClick={onClose} disabled={saving} aria-label="Close edit item dialog">
            ×
          </button>
        </header>

        <form onSubmit={handleSubmit}>
          <div className="cart-edit-modal__product">
            <img src={product.image} alt="" />
            <div>
              <strong>{formatMoney(activePrice)}</strong>
              <span>Choose your options and quantity.</span>
            </div>
          </div>

          {variationGroups.length > 0 ? (
            <div className="cart-edit-modal__variations">
              {variationGroups.map((group) => {
                const active = selectedOptions.find((option) => String(option.groupId) === String(group.id));
                return (
                  <fieldset key={group.id ?? group.groupName}>
                    <legend>
                      <span>{group.groupName}</span>
                      <strong>{active?.label || "Select an option"}</strong>
                    </legend>
                    <div className="cart-edit-modal__options">
                      {(Array.isArray(group.options) ? group.options : []).map((option) => {
                        const isActive = selectedOptionKey(active) === optionKey(option);
                        return (
                          <button
                            type="button"
                            key={optionKey(option)}
                            className={`cart-edit-modal__option${isActive ? " is-active" : ""}`}
                            aria-pressed={isActive}
                            onClick={() => handleSelect(group, option)}
                          >
                            {group.kind === "color" && option.swatchColor ? <i style={{ "--swatch-color": option.swatchColor }} aria-hidden="true" /> : null}
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>
                );
              })}
            </div>
          ) : null}

          <div className="cart-edit-modal__quantity">
            <span>Quantity</span>
            <div>
              <button type="button" onClick={() => setQuantity((value) => Math.max(1, value - 1))} aria-label="Decrease quantity">−</button>
              <strong>{quantity}</strong>
              <button type="button" onClick={() => setQuantity((value) => value + 1)} aria-label="Increase quantity">+</button>
            </div>
          </div>

          {error ? <p className="cart-edit-modal__error" role="alert">{error}</p> : null}

          <footer className="cart-edit-modal__actions">
            <button type="button" className="cart-edit-modal__cancel" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="cart-edit-modal__submit" disabled={saving}>{saving ? "Updating..." : "Update Cart"}</button>
          </footer>
        </form>
      </section>
    </div>
  );
}

export default CartEditModal;
