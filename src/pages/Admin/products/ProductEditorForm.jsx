import { useEffect, useMemo, useState } from "react";
import { useCategoryRecords } from "../../../shared/categoryStorage";
import { supabase } from "../../../lib/supabaseClient";
import {
  DEFAULT_AVAILABILITY_TYPE,
  PRODUCT_SHIPPING_METHOD_OPTIONS,
  getAvailabilityMeta,
  normalizeVariationGroups,
  slugify,
} from "../../Products/productData";

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Unable to read the selected file."));
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to decode the selected image."));
    image.src = src;
  });
}

async function compressImageFile(file) {
  const originalDataUrl = await readFileAsDataUrl(file);

  try {
    const image = await loadImage(originalDataUrl);
    const maxDimension = 1400;
    const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) {
      return originalDataUrl;
    }

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    return canvas.toDataURL("image/jpeg", 0.84);
  } catch {
    return originalDataUrl;
  }
}

function resolveCategoryLabel(categoryId, categoryRecords = []) {
  const lookup = new Map(categoryRecords.map((record) => [record.id, record]));
  const visited = new Set();
  const labels = [];
  let current = lookup.get(categoryId) ?? null;

  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    labels.unshift(current.name ?? "");
    current = current.parentId ? lookup.get(current.parentId) ?? null : null;
  }

  return labels.filter(Boolean).join(" / ");
}

function splitLines(value) {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function createEditorId(prefix = "variation") {
  const randomId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  return `${prefix}-${randomId}`;
}

function normalizeEditorVariationOption(option = {}, index = 0) {
  const label = String(option?.label ?? option?.option_label ?? option?.name ?? option?.value ?? "").trim();
  const value = String(option?.value ?? option?.option_value ?? "").trim() || slugify(label);
  const rawCompareAtDelta = option?.compareAtDelta ?? option?.compare_at_delta ?? null;

  return {
    id: String(option?.id ?? "").trim() || createEditorId("variation-option"),
    label,
    value,
    priceDelta: Number.isFinite(Number(option?.priceDelta ?? option?.price_delta))
      ? Number(option?.priceDelta ?? option?.price_delta)
      : 0,
    compareAtDelta:
      rawCompareAtDelta === "" || rawCompareAtDelta == null ? null : Number(rawCompareAtDelta),
    swatchColor: String(option?.swatchColor ?? option?.swatch_color ?? "").trim(),
    imageUrl: String(option?.imageUrl ?? option?.image_url ?? "").trim(),
    displayOrder: Math.max(Math.round(Number(option?.displayOrder ?? option?.display_order ?? index + 1) || 0), 0),
    isDefault: Boolean(option?.isDefault ?? option?.is_default),
  };
}

function normalizeEditorVariationGroup(group = {}, index = 0) {
  const options = Array.isArray(group?.options)
    ? group.options.map((option, optionIndex) => normalizeEditorVariationOption(option, optionIndex))
    : [];

  return {
    id: String(group?.id ?? "").trim() || createEditorId("variation-group"),
    groupName: String(group?.groupName ?? group?.group_name ?? "").trim(),
    displayOrder: Math.max(Math.round(Number(group?.displayOrder ?? group?.display_order ?? index + 1) || 0), 0),
    isRequired: Boolean(group?.isRequired ?? group?.is_required),
    options,
  };
}

function buildInitialVariationGroups(value = {}) {
  if (Array.isArray(value?.variationGroups) && value.variationGroups.length > 0) {
    const basePrice = Number(value?.price ?? 0) || 0;
    const baseCompareAt = Number.isFinite(Number(value?.compareAt ?? value?.compare_at))
      ? Number(value?.compareAt ?? value?.compare_at)
      : null;

    return normalizeVariationGroups(
      value.variationGroups,
      basePrice,
      baseCompareAt,
    )
      .map((group, index) => normalizeEditorVariationGroup(group, index))
      .map((group, index) => ({
        ...group,
        displayOrder: index + 1,
      }));
  }

  const groups = [];
  const seriesOptions = Array.isArray(value?.seriesOptions) ? value.seriesOptions : [];
  if (seriesOptions.length > 0) {
    groups.push({
      id: createEditorId("variation-group"),
      groupName: "Series",
      displayOrder: groups.length + 1,
      isRequired: false,
      options: seriesOptions
        .map((option, optionIndex) => {
          const optionPrice = Number(option?.price ?? value?.price ?? 0);
          const basePrice = Number(value?.price ?? 0);
          const optionCompareAt = option?.compareAt == null ? null : Number(option.compareAt);
          const baseCompareAt = value?.compareAt == null ? null : Number(value?.compareAt);

          return {
            id: String(option?.id ?? "").trim() || createEditorId("variation-option"),
            label: String(option?.label ?? "").trim(),
            value: String(option?.key ?? option?.value ?? "").trim() || slugify(option?.label ?? ""),
            priceDelta: Number.isFinite(optionPrice) && Number.isFinite(basePrice) ? optionPrice - basePrice : 0,
            compareAtDelta:
              optionCompareAt == null || baseCompareAt == null || Number.isNaN(optionCompareAt) || Number.isNaN(baseCompareAt)
                ? null
                : optionCompareAt - baseCompareAt,
            swatchColor: "",
            imageUrl: "",
            displayOrder: optionIndex + 1,
            isDefault: optionIndex === 0,
          };
        })
        .filter((option) => option.label),
    });
  }

  const colorOptions = Array.isArray(value?.availableColors) ? value.availableColors : [];
  if (colorOptions.length > 0) {
    groups.push({
      id: createEditorId("variation-group"),
      groupName: "Color",
      displayOrder: groups.length + 1,
      isRequired: false,
      options: colorOptions.map((option, optionIndex) => {
        const label = String(option?.label ?? option?.value ?? option?.key ?? "").trim();
        return {
          id: String(option?.id ?? "").trim() || createEditorId("variation-option"),
          label,
          value: String(option?.value ?? option?.key ?? "").trim() || slugify(label),
          priceDelta: 0,
          compareAtDelta: null,
          swatchColor: String(option?.swatch ?? option?.swatchColor ?? "").trim(),
          imageUrl: String(option?.imageUrl ?? option?.image_url ?? "").trim(),
          displayOrder: optionIndex + 1,
          isDefault: optionIndex === 0,
        };
      }),
    });
  }

  const sizeOptions = Array.isArray(value?.availableSizes) ? value.availableSizes : [];
  if (sizeOptions.length > 0) {
    groups.push({
      id: createEditorId("variation-group"),
      groupName: "Size",
      displayOrder: groups.length + 1,
      isRequired: false,
      options: sizeOptions.map((size, index) => {
        const label = String(size ?? "").trim();
        return {
          id: createEditorId("variation-option"),
          label,
          value: slugify(label),
          priceDelta: 0,
          compareAtDelta: null,
          swatchColor: "",
          imageUrl: "",
          displayOrder: index + 1,
          isDefault: index === 0,
        };
      }),
    });
  }

  return groups;
}

function reindexVariationGroups(groups = []) {
  return groups.map((group, groupIndex) => {
    const options = Array.isArray(group.options) ? group.options : [];
    const normalizedOptions = options.map((option, optionIndex) => ({
      ...option,
      displayOrder: optionIndex + 1,
    }));

    const hasDefault = normalizedOptions.some((option) => option.isDefault);
    if (!hasDefault && normalizedOptions.length > 0) {
      normalizedOptions[0] = { ...normalizedOptions[0], isDefault: true };
    }

    return {
      ...group,
      displayOrder: groupIndex + 1,
      options: normalizedOptions,
    };
  });
}

function createBlankVariationOption(index = 0, isDefault = false) {
  return {
    id: createEditorId("variation-option"),
    label: "",
    value: "",
    priceDelta: 0,
    compareAtDelta: null,
    swatchColor: "",
    imageUrl: "",
    displayOrder: index + 1,
    isDefault,
  };
}

function createBlankVariationGroup(index = 0) {
  return {
    id: createEditorId("variation-group"),
    groupName: "",
    displayOrder: index + 1,
    isRequired: false,
    options: [createBlankVariationOption(0, true)],
  };
}

function summarizeVariationGroups(groups = []) {
  return (Array.isArray(groups) ? groups : [])
    .map((group) => {
      const groupName = String(group?.groupName ?? "").trim();
      const optionSummary = (Array.isArray(group?.options) ? group.options : [])
        .map((option) => {
          const label = String(option?.label ?? "").trim();
          if (!label) {
            return "";
          }

          const parts = [label];
          const priceDelta = Number(option?.priceDelta ?? 0);
          if (Number.isFinite(priceDelta) && priceDelta !== 0) {
            parts.push(`${priceDelta > 0 ? "+" : ""}GH₵${Math.abs(priceDelta).toFixed(2)}`);
          }

          const compareAtDelta = option?.compareAtDelta;
          if (compareAtDelta != null && compareAtDelta !== "") {
            const numeric = Number(compareAtDelta);
            if (Number.isFinite(numeric) && numeric !== 0) {
              parts.push(`compare-at ${numeric > 0 ? "+" : ""}GH₵${Math.abs(numeric).toFixed(2)}`);
            }
          }

          if (String(option?.swatchColor ?? "").trim()) {
            parts.push(`swatch ${String(option.swatchColor).trim()}`);
          }

          if (String(option?.imageUrl ?? "").trim()) {
            parts.push("image");
          }

          return parts.join(" ");
        })
        .filter(Boolean)
        .join(", ");

      return groupName ? `${groupName}: ${optionSummary}` : optionSummary;
    })
    .filter(Boolean)
    .join(" | ");
}

function buildImageEntries(value) {
  const gallery = Array.isArray(value?.gallery) ? value.gallery : [];
  const mainImage = value?.image ?? gallery[0]?.src ?? "";

  return {
    name: value?.name ?? "",
    category: value?.category ?? "",
    categoryId: value?.categoryId ?? value?.category_id ?? value?.category ?? "",
    subcategoryLabel: value?.subcategoryLabel ?? value?.subcategory_label ?? "",
    price: value?.price ?? "",
    compareAt: value?.compareAt ?? "",
    shippingFee: value?.shippingFee ?? "",
    shippingMethod: value?.shippingMethod ?? "air-freight",
    availabilityType: value?.availabilityType ?? value?.availability_type ?? DEFAULT_AVAILABILITY_TYPE,
    estimatedArrival: value?.estimatedArrival ?? value?.estimated_arrival ?? "",
    preorderTerms: value?.preorderTerms ?? value?.preorder_terms ?? "",
    mainImage,
    galleryImages: gallery
      .map((entry, index) => ({
        id: `${entry?.src ?? "gallery"}-${index}`,
        src: entry?.src ?? "",
        label: entry?.label ?? `Sub image ${index + 1}`,
        tint: entry?.tint ?? "#e8eef6",
      }))
      .filter((entry) => entry.src && entry.src !== mainImage),
    badge: value?.badge ?? "New",
    stockStatus: value?.stockStatus ?? "In Stock & Ready to Ship",
    description: value?.description ?? "",
    overview: value?.overview ?? "",
    variationGroups: buildInitialVariationGroups(value),
    featuresText: Array.isArray(value?.features)
      ? value.features
          .map((item) => {
            if (typeof item === "string") {
              return item;
            }

            if (item && typeof item === "object") {
              return item.title ?? item.label ?? item.feature_text ?? "";
            }

            return "";
          })
          .filter(Boolean)
          .join("\n")
      : value?.featuresText ?? "",
    perksText: Array.isArray(value?.perks)
      ? value.perks
          .map((item) => {
            if (typeof item === "string") {
              return item;
            }

            if (item && typeof item === "object") {
              const title = item.title ?? item.label ?? item.perk_text ?? "";
              const copy = item.copy ?? "";
              return copy ? `${title}: ${copy}` : title;
            }

            return "";
          })
          .filter(Boolean)
          .join("\n")
      : value?.perksText ?? "",
  };
}

function Field({ children, fullWidth = false }) {
  return (
    <label
      className={`admin-product-form__field${
        fullWidth ? " admin-product-form__field--full" : ""
      }`}
    >
      {children}
    </label>
  );
}

function MediaPreview({ src, label, onRemove, compact = false }) {
  if (!src) {
    return null;
  }

  return (
    <article className={`admin-product-form__preview${compact ? " admin-product-form__preview--compact" : ""}`}>
      <img src={src} alt={label} />
      <div className="admin-product-form__preview-copy">
        <strong>{label}</strong>
        {onRemove ? (
          <button type="button" onClick={onRemove}>
            Remove
          </button>
        ) : null}
      </div>
    </article>
  );
}

function ProductEditorForm({
  title,
  description,
  submitLabel,
  initialProduct,
  onSubmit,
  onCancel,
}) {
  const [formData, setFormData] = useState(() => buildImageEntries(initialProduct));
  const [submitError, setSubmitError] = useState("");
  const [generateError, setGenerateError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const {
    records: categoryRecords,
    loading: categoriesLoading,
    error: categoriesError,
  } = useCategoryRecords();

  useEffect(() => {
    setFormData(buildImageEntries(initialProduct));
  }, [initialProduct]);

  const variationSummary = useMemo(
    () => summarizeVariationGroups(formData.variationGroups),
    [formData.variationGroups],
  );
  const categoryOptions = useMemo(
    () =>
      categoryRecords
        .filter((record) => record.status === "active" && !record.deletedAt && !record.parentId)
        .sort((left, right) =>
          (left.order ?? 0) - (right.order ?? 0) || left.name.localeCompare(right.name),
        )
        .map((record) => ({
          value: record.id,
          label: record.parentId
            ? `${categoryRecords.find((item) => item.id === record.parentId)?.name ?? "Parent"} / ${record.name}`
            : record.name,
        })),
    [categoryRecords],
  );
  const selectedCategoryKnown = categoryOptions.some((option) => option.value === formData.categoryId);
  const categorySelectOptions = selectedCategoryKnown
    ? categoryOptions
    : formData.categoryId
      ? [{ value: formData.categoryId, label: `${initialProduct?.category ?? "Current category"} (current)` }, ...categoryOptions]
      : categoryOptions;
  const generateButtonLabel = isGenerating
    ? "Generating..."
    : formData.description || formData.overview
      ? "Regenerate with AI"
      : "Generate with AI";

  const handleChange = (event) => {
    const { name, value } = event.target;

    if (generateError) {
      setGenerateError("");
    }

    setFormData((current) => ({
      ...current,
      [name]: value,
      }));
  };

  const updateVariationGroups = (updater) => {
    if (generateError) {
      setGenerateError("");
    }

    setFormData((current) => {
      const nextGroups = typeof updater === "function" ? updater(current.variationGroups ?? []) : current.variationGroups ?? [];
      return {
        ...current,
        variationGroups: reindexVariationGroups(nextGroups),
      };
    });
  };

  const handleAddVariationGroup = () => {
    updateVariationGroups((groups) => [...groups, createBlankVariationGroup(groups.length)]);
  };

  const handleRemoveVariationGroup = (groupId) => {
    updateVariationGroups((groups) => groups.filter((group) => group.id !== groupId));
  };

  const handleVariationGroupChange = (groupId, field, value) => {
    updateVariationGroups((groups) =>
      groups.map((group) =>
        group.id === groupId
          ? {
              ...group,
              [field]: field === "isRequired" ? Boolean(value) : value,
            }
          : group,
      ),
    );
  };

  const handleAddVariationOption = (groupId) => {
    updateVariationGroups((groups) =>
      groups.map((group) => {
        if (group.id !== groupId) {
          return group;
        }

        return {
          ...group,
          options: [
            ...(group.options ?? []),
            createBlankVariationOption((group.options ?? []).length, (group.options ?? []).length === 0),
          ],
        };
      }),
    );
  };

  const handleRemoveVariationOption = (groupId, optionId) => {
    updateVariationGroups((groups) =>
      groups.map((group) => {
        if (group.id !== groupId) {
          return group;
        }

        return {
          ...group,
          options: (group.options ?? []).filter((option) => option.id !== optionId),
        };
      }),
    );
  };

  const handleVariationOptionChange = (groupId, optionId, field, value) => {
    updateVariationGroups((groups) =>
      groups.map((group) => {
        if (group.id !== groupId) {
          return group;
        }

        const nextOptions = (group.options ?? []).map((option) => {
          if (option.id !== optionId) {
            return option;
          }

          const nextOption = {
            ...option,
            [field]:
              field === "isDefault"
                ? Boolean(value)
                : field === "priceDelta" || field === "compareAtDelta"
                  ? value === "" || value == null
                    ? ""
                    : Number(value)
                  : value,
          };

          if (field === "label") {
            const existingValue = String(option.value ?? "").trim();
            const generatedValue = slugify(value);
            if (!existingValue || existingValue === slugify(option.label)) {
              nextOption.value = generatedValue;
            }
          }

          return nextOption;
        });

        if (field === "isDefault" && value) {
          return {
            ...group,
            options: nextOptions.map((option) => ({
              ...option,
              isDefault: option.id === optionId,
            })),
          };
        }

        return {
          ...group,
          options: nextOptions,
        };
      }),
    );
  };

  const handleVariationOptionImageChange = async (groupId, optionId, event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const src = await compressImageFile(file);
      handleVariationOptionChange(groupId, optionId, "imageUrl", src);
    } catch {
      // Keep the current option image intact if the upload cannot be processed.
    }

    event.target.value = "";
  };

  const handleClearVariationOptionImage = (groupId, optionId) => {
    handleVariationOptionChange(groupId, optionId, "imageUrl", "");
  };

  const handleMainImageChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const src = await compressImageFile(file);
      setFormData((current) => ({
        ...current,
        mainImage: src,
      }));
    } catch {
      // Ignore unsupported files and keep the existing image intact.
    }
    event.target.value = "";
  };

  const handleGalleryChange = async (event) => {
    const files = Array.from(event.target.files ?? []);

    if (files.length === 0) {
      return;
    }

    try {
      const images = await Promise.all(
        files.map(async (file, index) => ({
          id: `${file.name}-${file.lastModified}-${index}`,
          src: await compressImageFile(file),
          label: file.name.replace(/\.[^/.]+$/, "") || `Sub image ${index + 1}`,
          tint: "#e8eef6",
        })),
      );

      setFormData((current) => ({
        ...current,
        galleryImages: [...current.galleryImages, ...images],
      }));
    } catch {
      // Ignore unreadable files and keep the existing gallery intact.
    }

    event.target.value = "";
  };

  const mainPreviewSrc = formData.mainImage || formData.galleryImages[0]?.src || "";

  const removeGalleryImage = (id) => {
    setFormData((current) => ({
      ...current,
      galleryImages: current.galleryImages.filter((image) => image.id !== id),
    }));
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    setSubmitError("");

    const invalidVariationGroup = (formData.variationGroups ?? []).find((group) => {
      const groupName = String(group?.groupName ?? "").trim();
      const filledOptions = (Array.isArray(group?.options) ? group.options : []).filter((option) =>
        String(option?.label ?? "").trim(),
      );
      const hasAnyOptionText = (Array.isArray(group?.options) ? group.options : []).some((option) => {
        const label = String(option?.label ?? "").trim();
        const value = String(option?.value ?? "").trim();
        const imageUrl = String(option?.imageUrl ?? "").trim();
        const swatchColor = String(option?.swatchColor ?? "").trim();
        return Boolean(label || value || imageUrl || swatchColor || Number(option?.priceDelta ?? 0) || option?.isDefault);
      });

      if (!groupName && hasAnyOptionText) {
        return true;
      }

      if (groupName && filledOptions.length === 0) {
        return true;
      }

      return Boolean(
        groupName &&
          filledOptions.some((option) => {
            const optionLabel = String(option?.label ?? "").trim();
            const optionValue = String(option?.value ?? "").trim();
            return !optionLabel || !optionValue;
          }),
      );
    });

    if (invalidVariationGroup) {
      setSubmitError("Each variation group needs a name and at least one filled option before saving.");
      return;
    }

    setIsSaving(true);

    Promise.resolve(onSubmit(formData))
      .then((result) => {
        if (result && result.ok === false) {
          setSubmitError(result.message || "Unable to save the product.");
        }
      })
      .catch((error) => {
        setSubmitError(error?.message || "Unable to save the product.");
      })
      .finally(() => {
        setIsSaving(false);
      });
  };

  const handleGenerateContent = async () => {
    if (isGenerating) {
      return;
    }

    const productName = String(formData.name ?? "").trim();
    const categoryLabel =
      resolveCategoryLabel(formData.categoryId, categoryRecords) || String(formData.category ?? "").trim();
    const featureLines = splitLines(formData.featuresText);
    const overviewLines = splitLines(formData.overview);
    const descriptionLines = splitLines(formData.description);
    const variationText = variationSummary;
    const supportFields = [
      categoryLabel,
      String(formData.subcategoryLabel ?? "").trim(),
      String(formData.price ?? "").trim(),
      variationText,
      featureLines.join(", "),
      String(formData.shippingMethod ?? "").trim(),
    ].filter(Boolean);

    if (!productName) {
      setGenerateError("Add a product name before generating content.");
      return;
    }

    if (supportFields.length === 0) {
      setGenerateError("Add category, features, variations, or price details before generating content.");
      return;
    }

    setGenerateError("");
    setIsGenerating(true);

    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token ?? "";

      if (sessionError) {
        throw new Error(sessionError.message || "Unable to restore your session.");
      }

      if (!accessToken) {
        throw new Error("Please sign in again to generate product content.");
      }

      const response = await fetch("/api/admin/products/generate-content", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          productName,
          category: categoryLabel,
          subcategoryLabel: String(formData.subcategoryLabel ?? "").trim(),
          price: String(formData.price ?? "").trim(),
          shippingMethod: String(formData.shippingMethod ?? "").trim(),
          variations: variationText,
          features: featureLines,
          description: descriptionLines.join("\n"),
          overview: overviewLines.join("\n"),
        }),
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(payload?.message || "Unable to generate product content. Please try again.");
      }

      if (typeof payload?.description !== "string" || typeof payload?.overview !== "string") {
        throw new Error("Unable to generate product content. Please try again.");
      }

      setFormData((current) => ({
        ...current,
        description: payload.description,
        overview: payload.overview,
      }));
    } catch (error) {
      setGenerateError(error?.message || "Unable to generate product content. Please try again.");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <form className="admin-product-form" onSubmit={handleSubmit}>
      <div className="admin-product-form__header">
        <div>
          <p>Product editor</p>
          <h2>{title}</h2>
          <span>{description}</span>
        </div>
      </div>

      <div className="admin-product-form__grid">
        <Field>
          <span>Product Name</span>
          <input
            type="text"
            name="name"
            value={formData.name}
            onChange={handleChange}
            placeholder="Enter product name"
            required
          />
        </Field>

        <Field>
          <span>Category</span>
          <select
            name="categoryId"
            value={formData.categoryId}
            onChange={handleChange}
            disabled={categoriesLoading}
            required
          >
            <option value="">{categoriesLoading ? "Loading categories..." : "Select a category"}</option>
            {categorySelectOptions.map((category) => (
              <option key={`${category.value}-${category.label}`} value={category.value}>
                {category.label}
              </option>
            ))}
          </select>
          {categoriesError ? (
            <small className="admin-product-form__hint">Unable to load categories right now.</small>
          ) : null}
        </Field>

        <Field>
          <span>Subcategory Label</span>
          <input
            type="text"
            name="subcategoryLabel"
            value={formData.subcategoryLabel}
            onChange={handleChange}
            placeholder="Optional display label such as Audio"
          />
          <small className="admin-product-form__hint">
            Display only. This does not create a real category relation.
          </small>
        </Field>

        <Field>
          <span>Price</span>
          <input
            type="number"
            name="price"
            value={formData.price}
            onChange={handleChange}
            min="0"
            step="0.01"
            placeholder="0.00"
            required
          />
        </Field>

        <Field>
          <span>Compare At</span>
          <input
            type="number"
            name="compareAt"
            value={formData.compareAt}
            onChange={handleChange}
            min="0"
            step="0.01"
            placeholder="Optional"
          />
        </Field>

        <Field>
          <span>Shipping Fee</span>
          <input
            type="number"
            name="shippingFee"
            value={formData.shippingFee}
            onChange={handleChange}
            min="0"
            step="0.01"
            placeholder="Leave blank for pending"
          />
        </Field>

        <Field>
          <span>Shipment Type</span>
          <select name="shippingMethod" value={formData.shippingMethod} onChange={handleChange}>
            {PRODUCT_SHIPPING_METHOD_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>

        <Field>
          <span>Badge</span>
          <input
            type="text"
            name="badge"
            value={formData.badge}
            onChange={handleChange}
            placeholder="New"
          />
        </Field>

        <Field>
          <span>Stock Status</span>
          <input
            type="text"
            name="stockStatus"
            value={formData.stockStatus}
            onChange={handleChange}
            placeholder="In Stock & Ready to Ship"
          />
        </Field>

        <Field>
          <span>Availability</span>
          <select
            name="availabilityType"
            value={formData.availabilityType ?? DEFAULT_AVAILABILITY_TYPE}
            onChange={handleChange}
          >
            <option value="ready_stock">Ready Stock</option>
            <option value="preorder">Pre-order</option>
            <option value="coming_soon">Coming Soon</option>
          </select>
          <small className="admin-product-form__hint">
            {getAvailabilityMeta(formData.availabilityType ?? DEFAULT_AVAILABILITY_TYPE).label} products
            use the storefront label and action button automatically.
          </small>
        </Field>

        {String(formData.availabilityType ?? DEFAULT_AVAILABILITY_TYPE) === "preorder" ? (
          <>
            <Field>
              <span>Estimated Arrival</span>
              <input
                type="text"
                name="estimatedArrival"
                value={formData.estimatedArrival}
                onChange={handleChange}
                placeholder="6–10 weeks"
              />
            </Field>

            <Field fullWidth>
              <span>Pre-order Terms</span>
              <textarea
                name="preorderTerms"
                value={formData.preorderTerms}
                onChange={handleChange}
                rows="3"
                placeholder="Product payment confirms your order. Final shipping fee will be calculated separately when the item arrives in Ghana."
              />
            </Field>
          </>
        ) : null}

        <Field fullWidth>
          <span>Main Image</span>
          <input type="file" accept="image/*" onChange={handleMainImageChange} />
          <small className="admin-product-form__hint">
            Upload an image from your phone or computer.
          </small>
        </Field>

        <Field fullWidth>
          <span>Main Image URL</span>
          <input
            type="text"
            name="mainImage"
            value={formData.mainImage}
            onChange={handleChange}
            placeholder="Optional fallback URL or pasted image path"
          />
        </Field>

        <Field fullWidth>
          <span>Sub Images</span>
          <input type="file" accept="image/*" multiple onChange={handleGalleryChange} />
          <small className="admin-product-form__hint">
            Add multiple gallery images so the product page can show extra angles and details.
          </small>
        </Field>

        <Field fullWidth>
          <span>Selected Media</span>
          <div className="admin-product-form__media-grid">
            {mainPreviewSrc ? (
              <MediaPreview src={mainPreviewSrc} label="Main image" compact />
            ) : (
              <div className="admin-product-form__preview admin-product-form__preview--empty">
                No main image selected yet.
              </div>
            )}

            {formData.galleryImages.length > 0 ? (
              formData.galleryImages.map((image) => (
                <MediaPreview
                  key={image.id}
                  src={image.src}
                  label={image.label}
                  onRemove={() => removeGalleryImage(image.id)}
                  compact
                />
              ))
            ) : (
              <div className="admin-product-form__preview admin-product-form__preview--empty">
                No sub images uploaded yet.
              </div>
            )}
          </div>
        </Field>

        <div className="admin-product-form__field admin-product-form__field--full">
          <div className="admin-product-form__variation-heading">
            <div>
              <span>Product Variations</span>
              <small className="admin-product-form__hint">
                Add options such as Color, Size, Storage, RAM or any other product option.
              </small>
            </div>
            <button
              type="button"
              className="admin-product-form__button admin-product-form__button--ghost admin-product-form__variation-add"
              onClick={handleAddVariationGroup}
            >
              + Add variation
            </button>
          </div>

          {formData.variationGroups.length > 0 ? (
            <div className="admin-product-form__variation-stack">
              {formData.variationGroups.map((group, groupIndex) => (
                <article key={group.id ?? `${group.groupName}-${groupIndex}`} className="admin-product-form__variation-card">
                  <div className="admin-product-form__variation-card-header">
                    <div className="admin-product-form__variation-card-headline">
                      <strong>Variation {groupIndex + 1}</strong>
                      <label className="admin-product-form__variation-inline-field">
                        <span>Variation name</span>
                        <input
                          type="text"
                          value={group.groupName}
                          onChange={(event) =>
                            handleVariationGroupChange(group.id, "groupName", event.target.value)
                          }
                          placeholder="Color, Size, Storage, RAM..."
                        />
                      </label>
                    </div>

                    <div className="admin-product-form__variation-card-actions">
                      <label className="admin-product-form__variation-toggle">
                        <input
                          type="checkbox"
                          checked={Boolean(group.isRequired)}
                          onChange={(event) =>
                            handleVariationGroupChange(group.id, "isRequired", event.target.checked)
                          }
                        />
                        Required
                      </label>

                      <button
                        type="button"
                        className="admin-product-form__button admin-product-form__button--ghost"
                        onClick={() => handleRemoveVariationGroup(group.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  <div className="admin-product-form__variation-options">
                    {(group.options ?? []).map((option, optionIndex) => (
                      <article
                        key={option.id ?? `${group.id}-${optionIndex}`}
                        className="admin-product-form__variation-option"
                      >
                        <div className="admin-product-form__variation-option-grid">
                          <label className="admin-product-form__variation-inline-field">
                            <span>Option label</span>
                            <input
                              type="text"
                              value={option.label}
                              onChange={(event) =>
                                handleVariationOptionChange(group.id, option.id, "label", event.target.value)
                              }
                              placeholder="Black"
                            />
                          </label>

                          <label className="admin-product-form__variation-inline-field">
                            <span>Option value</span>
                            <input
                              type="text"
                              value={option.value}
                              onChange={(event) =>
                                handleVariationOptionChange(group.id, option.id, "value", event.target.value)
                              }
                              placeholder="black"
                            />
                          </label>

                          <label className="admin-product-form__variation-inline-field">
                            <span>Price adjustment (GH₵)</span>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={option.priceDelta}
                              onChange={(event) =>
                                handleVariationOptionChange(
                                  group.id,
                                  option.id,
                                  "priceDelta",
                                  event.target.value,
                                )
                              }
                              placeholder="0.00"
                            />
                          </label>

                          <label className="admin-product-form__variation-inline-field">
                            <span>Compare-at adjustment (GH₵)</span>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={option.compareAtDelta ?? ""}
                              onChange={(event) =>
                                handleVariationOptionChange(
                                  group.id,
                                  option.id,
                                  "compareAtDelta",
                                  event.target.value,
                                )
                              }
                              placeholder="Optional"
                            />
                          </label>

                          <label className="admin-product-form__variation-inline-field">
                            <span>Swatch color</span>
                            <input
                              type="text"
                              value={option.swatchColor}
                              onChange={(event) =>
                                handleVariationOptionChange(
                                  group.id,
                                  option.id,
                                  "swatchColor",
                                  event.target.value,
                                )
                              }
                              placeholder="#000000"
                            />
                          </label>

                          <label className="admin-product-form__variation-inline-field">
                            <span>Image</span>
                            <input
                              type="file"
                              accept="image/*"
                              onChange={(event) => handleVariationOptionImageChange(group.id, option.id, event)}
                            />
                          </label>
                        </div>

                        <div className="admin-product-form__variation-option-footer">
                          <label className="admin-product-form__variation-toggle">
                            <input
                              type="radio"
                              name={`variation-default-${group.id}`}
                              checked={Boolean(option.isDefault)}
                              onChange={() =>
                                handleVariationOptionChange(group.id, option.id, "isDefault", true)
                              }
                            />
                            Default
                          </label>

                          <div className="admin-product-form__variation-option-preview">
                            {option.imageUrl ? (
                              <>
                                <img src={option.imageUrl} alt={option.label || "Variation option"} />
                                <button
                                  type="button"
                                  className="admin-product-form__button admin-product-form__button--ghost"
                                  onClick={() => handleClearVariationOptionImage(group.id, option.id)}
                                >
                                  Clear image
                                </button>
                              </>
                            ) : (
                              <div className="admin-product-form__variation-option-preview admin-product-form__variation-option-preview--empty">
                                No image selected.
                              </div>
                            )}
                          </div>

                          <button
                            type="button"
                            className="admin-product-form__button admin-product-form__button--ghost"
                            onClick={() => handleRemoveVariationOption(group.id, option.id)}
                          >
                            Delete option
                          </button>
                        </div>
                      </article>
                    ))}

                    <button
                      type="button"
                      className="admin-product-form__button admin-product-form__button--ghost admin-product-form__variation-add-option"
                      onClick={() => handleAddVariationOption(group.id)}
                    >
                      + Add option
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="admin-product-form__variation-empty">
              No variations added yet. Click Add variation to start.
            </div>
          )}
        </div>

        <Field fullWidth>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem" }}>
            <span>Description</span>
            <button
              type="button"
              className="admin-product-form__button admin-product-form__button--ghost"
              onClick={handleGenerateContent}
              disabled={isGenerating}
              style={{ padding: "0.55rem 0.95rem", minWidth: "auto" }}
            >
              {generateButtonLabel}
            </button>
          </div>
          <textarea
            name="description"
            value={formData.description}
            onChange={handleChange}
            rows="4"
            placeholder="Short product description"
          />
          <small className="admin-product-form__hint">
            Generate a description and overview from the product details above, then review or edit them before saving.
          </small>
        </Field>

        <Field fullWidth>
          <span>Overview</span>
          <textarea
            name="overview"
            value={formData.overview}
            onChange={handleChange}
            rows="4"
            placeholder="Longer product overview"
          />
        </Field>

        <Field fullWidth>
          <span>Features</span>
          <textarea
            name="featuresText"
            value={formData.featuresText}
            onChange={handleChange}
            rows="4"
            placeholder="One feature per line"
          />
        </Field>

        <Field fullWidth>
          <span>Perks</span>
          <textarea
            name="perksText"
            value={formData.perksText}
            onChange={handleChange}
            rows="4"
            placeholder="One perk per line"
          />
        </Field>
      </div>

      <p className="admin-product-form__note">
        Leave shipping fee blank to mark it as pending. Uploaded images are stored with the product
        record so the storefront can render them right away.
      </p>

      {generateError ? <p className="admin-product-form__error">{generateError}</p> : null}
      {submitError ? <p className="admin-product-form__error">{submitError}</p> : null}

      <div className="admin-product-form__actions">
        <button
          type="button"
          className="admin-product-form__button admin-product-form__button--ghost"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button type="submit" className="admin-product-form__button admin-product-form__button--primary">
          {isSaving ? "Saving..." : submitLabel}
        </button>
      </div>
    </form>
  );
}

export default ProductEditorForm;
