import { useEffect, useMemo, useState } from "react";
import { useCategoryRecords } from "../../../shared/categoryStorage";
import { supabase } from "../../../lib/supabaseClient";
import {
  PRODUCT_COLOR_OPTIONS,
  PRODUCT_SHIPPING_METHOD_OPTIONS,
  PRODUCT_SIZE_OPTIONS,
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

function normalizeColorSelection(value) {
  const key = String(value ?? "").trim().toLowerCase();
  const option = PRODUCT_COLOR_OPTIONS.find((item) => item.key === key);
  return option ? option.key : key;
}

function getColorMeta(key) {
  return PRODUCT_COLOR_OPTIONS.find((item) => item.key === key) ?? null;
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

function buildImageEntries(value) {
  const gallery = Array.isArray(value?.gallery) ? value.gallery : [];
  const mainImage = value?.image ?? gallery[0]?.src ?? "";
  const selectedColorKeys = Array.isArray(value?.availableColors)
    ? value.availableColors
        .map((item) => item?.value ?? item?.key ?? item?.label)
        .map(normalizeColorSelection)
        .filter(Boolean)
    : [];

  return {
    name: value?.name ?? "",
    category: value?.category ?? "",
    brand: value?.brand ?? "",
    soldBy: value?.soldBy ?? "",
    series: value?.series ?? "",
    categoryId: value?.categoryId ?? value?.category_id ?? value?.category ?? "",
    subcategoryLabel: value?.subcategoryLabel ?? value?.subcategory_label ?? "",
    price: value?.price ?? "",
    compareAt: value?.compareAt ?? "",
    shippingFee: value?.shippingFee ?? "",
    shippingMethod: value?.shippingMethod ?? "air-freight",
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
    rating: value?.rating ?? "",
    reviews: value?.reviews ?? "",
    selectedColorKeys,
    selectedSizes: Array.isArray(value?.availableSizes) ? value.availableSizes : [],
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

  const selectedColorOptions = useMemo(
    () =>
      formData.selectedColorKeys
        .map((key) => getColorMeta(key))
        .filter(Boolean),
    [formData.selectedColorKeys],
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

  const handleColorToggle = (key) => {
    if (generateError) {
      setGenerateError("");
    }

    setFormData((current) => ({
      ...current,
      selectedColorKeys: current.selectedColorKeys.includes(key)
        ? current.selectedColorKeys.filter((item) => item !== key)
        : [...current.selectedColorKeys, key],
    }));
  };

  const handleSizeToggle = (size) => {
    if (generateError) {
      setGenerateError("");
    }

    setFormData((current) => ({
      ...current,
      selectedSizes: current.selectedSizes.includes(size)
        ? current.selectedSizes.filter((item) => item !== size)
        : [...current.selectedSizes, size],
    }));
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
    const colorLabels = selectedColorOptions.map((option) => option.label);
    const sizeLabels = Array.isArray(formData.selectedSizes) ? formData.selectedSizes : [];
    const featureLines = splitLines(formData.featuresText);
    const overviewLines = splitLines(formData.overview);
    const descriptionLines = splitLines(formData.description);
    const supportFields = [
      categoryLabel,
      String(formData.subcategoryLabel ?? "").trim(),
      String(formData.brand ?? "").trim(),
      String(formData.series ?? "").trim(),
      String(formData.price ?? "").trim(),
      colorLabels.join(", "),
      sizeLabels.join(", "),
      featureLines.join(", "),
      String(formData.shippingMethod ?? "").trim(),
    ].filter(Boolean);

    if (!productName) {
      setGenerateError("Add a product name before generating content.");
      return;
    }

    if (supportFields.length === 0) {
      setGenerateError("Add category, brand, features, colors, sizes, or price details before generating content.");
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
          brand: String(formData.brand ?? "").trim(),
          series: String(formData.series ?? "").trim(),
          price: String(formData.price ?? "").trim(),
          shippingMethod: String(formData.shippingMethod ?? "").trim(),
          colors: colorLabels,
          sizes: sizeLabels,
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
          <span>Brand</span>
          <input
            type="text"
            name="brand"
            value={formData.brand}
            onChange={handleChange}
            placeholder="Nexus"
          />
        </Field>

        <Field>
          <span>Sold By</span>
          <input
            type="text"
            name="soldBy"
            value={formData.soldBy}
            onChange={handleChange}
            placeholder="Nexus Store"
          />
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
          <span>Series</span>
          <input
            type="text"
            name="series"
            value={formData.series}
            onChange={handleChange}
            placeholder="Product series"
          />
        </Field>

        <Field>
          <span>Rating</span>
          <input
            type="number"
            name="rating"
            value={formData.rating}
            onChange={handleChange}
            min="0"
            max="5"
            step="0.1"
            placeholder="0.0"
          />
        </Field>

        <Field>
          <span>Reviews</span>
          <input
            type="number"
            name="reviews"
            value={formData.reviews}
            onChange={handleChange}
            min="0"
            step="1"
            placeholder="0"
          />
        </Field>

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

        <Field fullWidth>
          <span>Colors</span>
          <div className="admin-product-form__option-grid">
            {PRODUCT_COLOR_OPTIONS.map((color) => (
              <label key={color.key} className="admin-product-form__chip">
                <input
                  type="checkbox"
                  checked={formData.selectedColorKeys.includes(color.key)}
                  onChange={() => handleColorToggle(color.key)}
                />
                <span
                  className="admin-product-form__chip-swatch"
                  style={{ "--chip-color": color.swatch }}
                />
                <strong>{color.label}</strong>
              </label>
            ))}
          </div>
          {selectedColorOptions.length > 0 ? (
            <div className="admin-product-form__chip-summary">
              Selected: {selectedColorOptions.map((color) => color.label).join(", ")}
            </div>
          ) : null}
        </Field>

        <Field fullWidth>
          <span>Sizes</span>
          <div className="admin-product-form__option-grid admin-product-form__option-grid--sizes">
            {PRODUCT_SIZE_OPTIONS.map((size) => (
              <label key={size} className="admin-product-form__chip admin-product-form__chip--size">
                <input
                  type="checkbox"
                  checked={formData.selectedSizes.includes(size)}
                  onChange={() => handleSizeToggle(size)}
                />
                <strong>{size}</strong>
              </label>
            ))}
          </div>
          {formData.selectedSizes.length > 0 ? (
            <div className="admin-product-form__chip-summary">
              Selected: {formData.selectedSizes.join(", ")}
            </div>
          ) : null}
        </Field>

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
