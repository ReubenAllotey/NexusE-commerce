import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../lib/supabaseClient";

import booksPlaceholder from "../../assets/images/electronic-set.png";
import beautyPlaceholder from "../../assets/images/Woman.jpg";
import camera from "../../assets/images/camera.jpg";
import fan from "../../assets/images/standing-fan.jpeg";
import fridge from "../../assets/images/fridge.jpeg";
import headphonesPlaceholder from "../../assets/images/music-set.jpeg";
import heroLaptop from "../../assets/images/HP-laptop.jpeg";
import heroPhone from "../../assets/images/IPhone 17 Pro Max.jpg";
import heroTv from "../../assets/images/flatscreen-tv.jpeg";
import kettle from "../../assets/images/kettle.jpg";
import shirt from "../../assets/images/laurel wrath shirt.png";
import macbook from "../../assets/images/laptop.jpeg";
import officeChair from "../../assets/images/ergonomic-chair.jpeg";
import speaker from "../../assets/images/music-set.jpeg";
import washerBasket from "../../assets/images/washingBasket.jpg";
import washingMachine from "../../assets/images/washingmachine.jpeg";

export const PRODUCT_COLOR_OPTIONS = [
  { key: "black", label: "Black", swatch: "#1f2937", previewTint: "#d9dee7" },
  { key: "white", label: "White", swatch: "#f2f5f8", previewTint: "#fafbfd" },
  { key: "oat", label: "Oat", swatch: "#d8c6ad", previewTint: "#f1e7d7" },
  { key: "olive", label: "Olive", swatch: "#5d7055", previewTint: "#e1e8da" },
  { key: "navy", label: "Navy", swatch: "#1e3a8a", previewTint: "#dfe8f8" },
  { key: "red", label: "Red", swatch: "#dc2626", previewTint: "#fae3e3" },
  { key: "blue", label: "Blue", swatch: "#2563eb", previewTint: "#e3edff" },
  { key: "gray", label: "Gray", swatch: "#9ca3af", previewTint: "#edf1f6" },
  { key: "pink", label: "Pink", swatch: "#ec4899", previewTint: "#fde3ef" },
  { key: "green", label: "Green", swatch: "#16a34a", previewTint: "#e4f5ea" },
  { key: "heather-gray", label: "Heather Gray", swatch: "#9ca3af", previewTint: "#e6eaef" },
  { key: "sand", label: "Sand", swatch: "#d7c1a2", previewTint: "#f2e6d6" },
];

export const PRODUCT_SIZE_OPTIONS = ["XS", "S", "M", "L", "XL", "2XL", "3XL"];

export const PRODUCT_SHIPPING_METHOD_OPTIONS = [
  {
    value: "air-freight",
    label: "Air freight",
    note: "Faster delivery for lighter or urgent items.",
  },
  {
    value: "sea-freight",
    label: "Sea freight",
    note: "Better for bulky items and lower shipping cost.",
  },
];

const PRODUCT_SELECT =
  "id,category_id,subcategory_label,slug,name,series,brand,sold_by,price,compare_at,rating,review_count,badge,stock_status,description,overview,primary_image_url,shipping_fee,shipping_fee_status,shipping_method,status,source,deleted_at,created_at,updated_at";
const CATEGORY_SELECT = "id,name,slug,parent_id,status,deleted_at";
const CHILD_SELECT = "id,product_id,image_url,display_order,created_at";
const COLOR_SELECT = "id,product_id,color_name,display_order";
const SIZE_SELECT = "id,product_id,size_name,display_order";
const FEATURE_SELECT = "id,product_id,feature_text,display_order";
const PERK_SELECT = "id,product_id,perk_text,display_order";

const PRODUCT_IMAGE_ASSET_MAP = {
  "books-placeholder.svg": booksPlaceholder,
  "electronic-set.png": booksPlaceholder,
  "beauty-placeholder.svg": beautyPlaceholder,
  "Woman.jpg": beautyPlaceholder,
  "camera.jpg": camera,
  "fan.jpg": fan,
  "standing-fan.jpeg": fan,
  "frige2.jpeg": fridge,
  "fridge.jpeg": fridge,
  "headphones-placeholder.svg": headphonesPlaceholder,
  "music-set.jpeg": headphonesPlaceholder,
  "hero-laptop.png": heroLaptop,
  "HP-laptop.jpeg": heroLaptop,
  "hero-phone.png": heroPhone,
  "IPhone 17 Pro Max.jpg": heroPhone,
  "hero-tv.png": heroTv,
  "flatscreen-tv.jpeg": heroTv,
  "kettle.jpg": kettle,
  "laurel wrath shirt.png": shirt,
  "macbook.jpg": macbook,
  "laptop.jpeg": macbook,
  "office chair.jpg": officeChair,
  "ergonomic-chair.jpeg": officeChair,
  "Speaker.png": speaker,
  "music-set.jpeg": speaker,
  "washingBasket.jpg": washerBasket,
  "washingmachine1.png": washingMachine,
  "washingmachine.jpeg": washingMachine,
};

const DEFAULT_STOCK_STATUS = "In Stock & Ready to Ship";

function cleanText(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function normalizeOptionalText(value) {
  const text = cleanText(value);
  return text || null;
}

function normalizeNumber(value) {
  if (value === "" || value == null) {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeNonNegativeInteger(value) {
  if (value === "" || value == null) {
    return null;
  }

  const numeric = Math.max(Math.round(Number(value) || 0), 0);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeTextList(value) {
  const source = Array.isArray(value)
    ? value.map((entry) => {
        if (typeof entry === "string" || typeof entry === "number") {
          return String(entry);
        }

        if (entry && typeof entry === "object") {
          return cleanText(
            entry.title ??
              entry.label ??
              entry.value ??
              entry.feature_text ??
              entry.perk_text ??
              entry.size_name ??
              entry.color_name ??
              entry.name ??
              "",
          );
        }

        return "";
      })
    : String(value ?? "")
        .split(/\r?\n/)
        .map((entry) => entry.trim());
  const seen = new Set();
  const normalized = [];

  for (const entry of source) {
    const text = cleanText(entry);

    if (!text) {
      continue;
    }

    const key = text.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push(text);
  }

  return normalized;
}

function normalizeProductText(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function slugify(value) {
  return normalizeProductText(value);
}

function normalizeImageSrc(src) {
  const value = cleanText(src);

  if (!value) {
    return "";
  }

  if (/^(data:|https?:\/\/|\/)/i.test(value)) {
    return value;
  }

  const fileName = value.split(/[\\/]/).pop() ?? value;
  return PRODUCT_IMAGE_ASSET_MAP[fileName] ?? PRODUCT_IMAGE_ASSET_MAP[value] ?? value;
}

function normalizeColorSelectionList(value = []) {
  const source = Array.isArray(value)
    ? value.map((entry) => {
        if (typeof entry === "string" || typeof entry === "number") {
          return String(entry);
        }

        if (entry && typeof entry === "object") {
          return cleanText(entry.value ?? entry.key ?? entry.label ?? entry.color_name ?? "");
        }

        return "";
      })
    : [];

  return source.map(normalizeColorSelection).filter(Boolean);
}

function resolveColorMeta(colorName) {
  const normalized = slugify(colorName);
  const option = PRODUCT_COLOR_OPTIONS.find((entry) => entry.key === normalized);

  if (option) {
    return option;
  }

  const fallback = PRODUCT_COLOR_OPTIONS.find((entry) => entry.key === "gray");
  return {
    key: normalized || "gray",
    label: cleanText(colorName) || "Gray",
    swatch: fallback?.swatch ?? "#9ca3af",
    previewTint: fallback?.previewTint ?? "#edf1f6",
  };
}

function parsePerkText(perkText) {
  const text = cleanText(perkText);

  if (!text) {
    return { title: "", copy: "" };
  }

  const [title, ...rest] = text.split(/[:|—-]/);
  const copy = rest.join(":").trim();

  return {
    title: cleanText(title, text),
    copy,
  };
}

function parseSeriesPriceValue(value) {
  const normalized = cleanText(value)
    .replace(/[₵$]/g, "")
    .replace(/,/g, "")
    .trim();

  if (!normalized) {
    return null;
  }

  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
}

function splitSeriesEntries(seriesText) {
  const text = cleanText(seriesText);

  if (!text) {
    return [];
  }

  if (/[|\n;]/.test(text)) {
    return text
      .split(/\s*(?:\||;|\n)\s*/u)
      .map((entry) => cleanText(entry))
      .filter(Boolean);
  }

  if (text.includes(",")) {
    return text
      .split(/\s*,\s*/u)
      .map((entry) => cleanText(entry))
      .filter(Boolean);
  }

  return [text];
}

function parseSeriesOption(entry, basePrice, compareAt, index) {
  const text = cleanText(entry);
  const fallbackPrice = normalizeNumber(basePrice) ?? 0;
  const fallbackCompareAt = normalizeNumber(compareAt);
  const pricePattern =
    /^(.*?)(?:\s*(?:[:@\-–—=])\s*)(?:GHS|GH₵|₵|\$)?\s*([0-9,]+(?:\.[0-9]+)?)\s*\)?$/iu;
  const match = text.match(pricePattern);
  const label = cleanText(match?.[1] ?? text) || `Series ${index + 1}`;
  const price = parseSeriesPriceValue(match?.[2]);

  return {
    key: `${slugify(label) || `series-${index + 1}`}-${index + 1}`,
    label,
    price: price ?? fallbackPrice,
    compareAt: index === 0 ? fallbackCompareAt : null,
  };
}

function buildSeriesOptions(seriesText, basePrice, compareAt) {
  const entries = splitSeriesEntries(seriesText);
  const options = entries.map((entry, index) =>
    parseSeriesOption(entry, basePrice, compareAt, index),
  );

  if (options.length === 0) {
    return [];
  }

  const seen = new Set();
  const deduped = [];

  for (const option of options) {
    const key = option.label.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(option);
  }

  return deduped;
}

function imageRowsToGallery(primaryImageUrl, imageRows = []) {
  const gallery = [];
  const seen = new Set();
  const primaryKey = normalizeImageSrc(primaryImageUrl).toLowerCase();

  const addImage = (src, label, tint = "#e8eef6") => {
    const resolved = normalizeImageSrc(src);

    if (!resolved) {
      return;
    }

    const key = resolved.toLowerCase();
    if (seen.has(key) || (primaryKey && key === primaryKey)) {
      return;
    }

    seen.add(key);
    gallery.push({
      src: resolved,
      label,
      tint,
    });
  };

  imageRows
    .slice()
    .sort((left, right) => {
      const leftOrder = Number(left?.display_order ?? 0);
      const rightOrder = Number(right?.display_order ?? 0);
      return leftOrder - rightOrder || String(left?.created_at ?? "").localeCompare(String(right?.created_at ?? ""));
    })
    .forEach((row, index) => {
      addImage(row?.image_url, row?.label ?? `Sub image ${index + 1}`, "#e8eef6");
    });

  return gallery;
}

function buildBundleLookup(rows = [], keyName) {
  return new Map(
    rows.map((row) => [String(row?.[keyName] ?? "").trim(), row]).filter(([key]) => key.length > 0),
  );
}

function buildBundleLists(rows = [], keyName, valueName) {
  return [...rows]
    .sort((left, right) => {
      const leftOrder = Number(left?.display_order ?? 0);
      const rightOrder = Number(right?.display_order ?? 0);
      return leftOrder - rightOrder || String(left?.created_at ?? "").localeCompare(String(right?.created_at ?? ""));
    })
    .map((row) => cleanText(row?.[valueName] ?? row?.[keyName] ?? ""))
    .filter(Boolean);
}

function ensureProductBundleRows(bundle = {}) {
  const product = bundle.product ?? {};

  return {
    category: bundle.category ?? null,
    images: Array.isArray(bundle.images) ? bundle.images : [],
    colors: Array.isArray(bundle.colors) ? bundle.colors : [],
    sizes: Array.isArray(bundle.sizes) ? bundle.sizes : [],
    features: Array.isArray(bundle.features) ? bundle.features : [],
    perks: Array.isArray(bundle.perks) ? bundle.perks : [],
    product,
  };
}

function mapChildColorRows(colorRows = []) {
  return colorRows
    .slice()
    .sort((left, right) => {
      const leftOrder = Number(left?.display_order ?? 0);
      const rightOrder = Number(right?.display_order ?? 0);
      return leftOrder - rightOrder || String(left?.id ?? "").localeCompare(String(right?.id ?? ""));
    })
    .map((row) => {
      const meta = resolveColorMeta(row?.color_name);
      return {
        label: cleanText(row?.color_name, meta.label),
        value: slugify(row?.color_name) || meta.key,
        swatch: meta.swatch,
        previewTint: meta.previewTint,
      };
    })
    .filter((row) => row.label);
}

function normalizeCategoryLabel(categoryRow, subcategoryLabel) {
  const categoryName = cleanText(categoryRow?.name);
  const subcategory = cleanText(subcategoryLabel);

  return [categoryName, subcategory].filter(Boolean);
}

export function mapProductRowToLegacyViewModel(row = {}, bundle = {}) {
  const normalizedBundle = ensureProductBundleRows(bundle);
  const primaryImageUrl = normalizeImageSrc(row?.primary_image_url);
  const categoryRow = normalizedBundle.category ?? null;
  const categoryName = cleanText(categoryRow?.name);
  const categorySlug = cleanText(categoryRow?.slug);
  const gallery = imageRowsToGallery(primaryImageUrl, normalizedBundle.images);
  const colors = mapChildColorRows(normalizedBundle.colors);
  const sizes = buildBundleLists(normalizedBundle.sizes, "size_name", "size_name");
  const features = buildBundleLists(normalizedBundle.features, "feature_text", "feature_text");
  const perks = buildBundleLists(normalizedBundle.perks, "perk_text", "perk_text").map(parsePerkText);

  return {
    id: row?.id ?? "",
    categoryId: row?.category_id ?? "",
    category: categoryName,
    categorySlug,
    categoryTrail: normalizeCategoryLabel(categoryRow, row?.subcategory_label),
    subcategoryLabel: cleanText(row?.subcategory_label),
    slug: cleanText(row?.slug),
    name: cleanText(row?.name),
    series: cleanText(row?.series),
    seriesOptions: buildSeriesOptions(row?.series, row?.price, row?.compare_at),
    brand: cleanText(row?.brand),
    soldBy: cleanText(row?.sold_by),
    price: Number(row?.price) || 0,
    compareAt: normalizeNumber(row?.compare_at),
    rating: normalizeNumber(row?.rating) ?? 0,
    reviews: Math.max(0, Math.round(Number(row?.review_count) || 0)),
    badge: cleanText(row?.badge) || "New",
    stockStatus: cleanText(row?.stock_status) || DEFAULT_STOCK_STATUS,
    description: cleanText(row?.description),
    overview: cleanText(row?.overview),
    image: primaryImageUrl,
    imageClassName: "is-contain",
    gallery,
    features,
    perks,
    availableColors: colors,
    availableSizes: sizes,
    shippingFee: normalizeNumber(row?.shipping_fee),
    shippingFeeStatus:
      cleanText(row?.shipping_fee_status).toLowerCase() === "pending" || row?.shipping_fee == null
        ? "pending"
        : "ready",
    shippingMethod: cleanText(row?.shipping_method) || "air-freight",
    status: cleanText(row?.status) || "active",
    source: cleanText(row?.source) || "custom",
    createdAt: row?.created_at ?? "",
    updatedAt: row?.updated_at ?? "",
    deletedAt: row?.deleted_at ?? null,
    deleted: row?.deleted_at != null,
  };
}

function createResult(ok, payload = {}) {
  return { ok, ...payload };
}

function mapDbError(error, fallbackMessage) {
  return createResult(false, {
    error,
    message: error?.message ?? fallbackMessage,
  });
}

function normalizeNumericList(values = []) {
  return values
    .map((value, index) => ({
      value: normalizeNumber(value?.value ?? value?.price ?? value?.amount ?? value),
      index,
    }))
    .filter((entry) => entry.value != null)
    .map((entry) => entry.value);
}

async function queryCategoriesByIds(categoryIds = []) {
  const ids = [...new Set(categoryIds.filter(Boolean))];

  if (ids.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from("categories")
    .select(CATEGORY_SELECT)
    .in("id", ids)
    .order("display_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    throw error;
  }

  return Array.isArray(data) ? data : [];
}

async function queryProductBundleRows({ slug = "", includeDeleted = false } = {}) {
  let query = supabase
    .from("products")
    .select(PRODUCT_SELECT)
    .order("created_at", { ascending: true })
    .order("name", { ascending: true });

  if (slug) {
    query = query.eq("slug", slug);
  }

  if (!includeDeleted) {
    query = query.eq("status", "active").is("deleted_at", null);
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  const productRows = Array.isArray(data) ? data : [];
  const productIds = productRows.map((row) => row.id).filter(Boolean);
  const categoryIds = productRows.map((row) => row.category_id).filter(Boolean);

  const [categories, images, colors, sizes, features, perks] = await Promise.all([
    queryCategoriesByIds(categoryIds),
    productIds.length === 0
      ? Promise.resolve([])
      : supabase
          .from("product_images")
          .select(CHILD_SELECT)
          .in("product_id", productIds)
          .order("display_order", { ascending: true })
          .order("created_at", { ascending: true })
          .then(({ data: childData, error: childError }) => {
            if (childError) {
              throw childError;
            }

            return Array.isArray(childData) ? childData : [];
          }),
    productIds.length === 0
      ? Promise.resolve([])
      : supabase
          .from("product_colors")
          .select(COLOR_SELECT)
          .in("product_id", productIds)
          .order("display_order", { ascending: true })
          .then(({ data: childData, error: childError }) => {
            if (childError) {
              throw childError;
            }

            return Array.isArray(childData) ? childData : [];
          }),
    productIds.length === 0
      ? Promise.resolve([])
      : supabase
          .from("product_sizes")
          .select(SIZE_SELECT)
          .in("product_id", productIds)
          .order("display_order", { ascending: true })
          .then(({ data: childData, error: childError }) => {
            if (childError) {
              throw childError;
            }

            return Array.isArray(childData) ? childData : [];
          }),
    productIds.length === 0
      ? Promise.resolve([])
      : supabase
          .from("product_features")
          .select(FEATURE_SELECT)
          .in("product_id", productIds)
          .order("display_order", { ascending: true })
          .then(({ data: childData, error: childError }) => {
            if (childError) {
              throw childError;
            }

            return Array.isArray(childData) ? childData : [];
          }),
    productIds.length === 0
      ? Promise.resolve([])
      : supabase
          .from("product_perks")
          .select(PERK_SELECT)
          .in("product_id", productIds)
          .order("display_order", { ascending: true })
          .then(({ data: childData, error: childError }) => {
            if (childError) {
              throw childError;
            }

            return Array.isArray(childData) ? childData : [];
          }),
  ]);

  const categoryById = buildBundleLookup(categories, "id");
  const imagesByProductId = new Map();
  const colorsByProductId = new Map();
  const sizesByProductId = new Map();
  const featuresByProductId = new Map();
  const perksByProductId = new Map();

  for (const row of images) {
    const list = imagesByProductId.get(row.product_id) ?? [];
    list.push(row);
    imagesByProductId.set(row.product_id, list);
  }

  for (const row of colors) {
    const list = colorsByProductId.get(row.product_id) ?? [];
    list.push(row);
    colorsByProductId.set(row.product_id, list);
  }

  for (const row of sizes) {
    const list = sizesByProductId.get(row.product_id) ?? [];
    list.push(row);
    sizesByProductId.set(row.product_id, list);
  }

  for (const row of features) {
    const list = featuresByProductId.get(row.product_id) ?? [];
    list.push(row);
    featuresByProductId.set(row.product_id, list);
  }

  for (const row of perks) {
    const list = perksByProductId.get(row.product_id) ?? [];
    list.push(row);
    perksByProductId.set(row.product_id, list);
  }

  const products = productRows.map((row) =>
    mapProductRowToLegacyViewModel(row, {
      category: categoryById.get(row.category_id) ?? null,
      images: imagesByProductId.get(row.id) ?? [],
      colors: colorsByProductId.get(row.id) ?? [],
      sizes: sizesByProductId.get(row.id) ?? [],
      features: featuresByProductId.get(row.id) ?? [],
      perks: perksByProductId.get(row.id) ?? [],
    }),
  );

  return createResult(true, { products });
}

export async function loadProducts(options = {}) {
  try {
    return await queryProductBundleRows(options);
  } catch (error) {
    return mapDbError(error, "Unable to load products.");
  }
}

export async function loadProductBySlug(slug, options = {}) {
  const safeSlug = cleanText(slug);

  if (!safeSlug) {
    return createResult(false, { message: "Product slug is required.", product: null });
  }

  try {
    const result = await queryProductBundleRows({ ...options, slug: safeSlug });
    const product = result.products?.[0] ?? null;

    if (!product) {
      return createResult(false, { message: "Product not found.", product: null });
    }

    return createResult(true, { product });
  } catch (error) {
    return mapDbError(error, "Unable to load the product.");
  }
}

function toProductWriteNumber(value) {
  const numeric = normalizeNumber(value);
  return numeric == null ? null : numeric;
}

function parseProductWriteText(value) {
  return cleanText(value);
}

function normalizePerkTextList(value) {
  return normalizeTextList(value);
}

function normalizeColorSelection(value) {
  const key = slugify(value);
  const meta = PRODUCT_COLOR_OPTIONS.find((option) => option.key === key);
  return meta ? meta.key : key;
}

function normalizeGalleryInput(value = []) {
  const gallery = Array.isArray(value) ? value : [];
  const seen = new Set();

  return gallery
    .map((entry) => ({
      src: normalizeImageSrc(entry?.src ?? entry?.image_url ?? entry),
      label: cleanText(entry?.label ?? ""),
      tint: cleanText(entry?.tint ?? "#e8eef6"),
    }))
    .filter((entry) => entry.src)
    .filter((entry) => {
      const key = entry.src.toLowerCase();

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
}

function normalizeExistingProductFields(existingProduct = {}) {
  return {
    id: cleanText(existingProduct.id),
    category_id: cleanText(existingProduct.categoryId ?? existingProduct.category_id),
    slug: cleanText(existingProduct.slug),
    name: cleanText(existingProduct.name),
    series: cleanText(existingProduct.series),
    brand: cleanText(existingProduct.brand),
    sold_by: cleanText(existingProduct.soldBy ?? existingProduct.sold_by),
    price: toProductWriteNumber(existingProduct.price),
    compare_at: toProductWriteNumber(existingProduct.compareAt ?? existingProduct.compare_at),
    rating: normalizeNumber(existingProduct.rating),
    review_count: normalizeNonNegativeInteger(existingProduct.reviews ?? existingProduct.review_count) ?? 0,
    badge: cleanText(existingProduct.badge),
    stock_status: cleanText(existingProduct.stockStatus ?? existingProduct.stock_status),
    description: cleanText(existingProduct.description),
    overview: cleanText(existingProduct.overview),
    primary_image_url: normalizeImageSrc(existingProduct.image ?? existingProduct.primary_image_url),
    shipping_fee: normalizeNumber(existingProduct.shippingFee ?? existingProduct.shipping_fee),
    shipping_fee_status:
      cleanText(existingProduct.shippingFeeStatus ?? existingProduct.shipping_fee_status).toLowerCase() === "pending"
        ? "pending"
        : "ready",
    shipping_method: cleanText(existingProduct.shippingMethod ?? existingProduct.shipping_method) || "air-freight",
    status: cleanText(existingProduct.status) || "active",
    source: cleanText(existingProduct.source) || "custom",
    subcategory_label: normalizeOptionalText(existingProduct.subcategoryLabel ?? existingProduct.subcategory_label),
    gallery: normalizeGalleryInput(existingProduct.gallery),
    availableColors: Array.isArray(existingProduct.availableColors) ? existingProduct.availableColors : [],
    availableSizes: Array.isArray(existingProduct.availableSizes) ? existingProduct.availableSizes : [],
    features: Array.isArray(existingProduct.features) ? existingProduct.features : [],
    perks: Array.isArray(existingProduct.perks) ? existingProduct.perks : [],
  };
}

export function buildProductBundlePayloadFromLegacyProduct(product = {}, overrides = {}) {
  const existing = normalizeExistingProductFields(product);
  const next = {
    ...existing,
    ...overrides,
  };

  const gallery = normalizeGalleryInput(next.gallery);
  const primaryImage = normalizeImageSrc(next.primary_image_url || next.image || gallery[0]?.src || "");
  const imageRows = gallery
    .map((entry, index) => ({
      image_url: entry.src,
      display_order: index + 1,
    }))
    .filter((entry) => entry.image_url && entry.image_url !== primaryImage);

  return {
    product: {
      id: next.id || undefined,
      category_id: next.category_id,
      slug: next.slug || undefined,
      name: next.name,
      series: next.series || null,
      brand: next.brand || null,
      sold_by: next.sold_by || null,
      price: next.price,
      compare_at: next.compare_at,
      rating: next.rating,
      review_count: next.review_count,
      badge: next.badge || null,
      stock_status: next.stock_status || DEFAULT_STOCK_STATUS,
      description: next.description || null,
      overview: next.overview || null,
      primary_image_url: primaryImage || null,
      shipping_fee: next.shipping_fee,
      shipping_fee_status: next.shipping_fee_status || (next.shipping_fee == null ? "pending" : "ready"),
      shipping_method: next.shipping_method || "air-freight",
      status: next.status || "active",
      source: next.source || "custom",
      subcategory_label: next.subcategory_label,
    },
    images: imageRows,
    colors: normalizeColorSelectionList(next.availableColors).map((colorName, index) => ({
      color_name: PRODUCT_COLOR_OPTIONS.find((option) => option.key === colorName)?.label ?? colorName,
      display_order: index + 1,
    })),
    sizes: normalizeTextList(next.availableSizes).map((sizeName, index) => ({
      size_name: sizeName,
      display_order: index + 1,
    })),
    features: normalizeTextList(next.features).map((featureText, index) => ({
      feature_text: featureText,
      display_order: index + 1,
    })),
    perks: normalizePerkTextList(next.perks).map((perkText, index) => ({
      perk_text: perkText,
      display_order: index + 1,
    })),
  };
}

export function buildProductBundlePayloadFromEditorValues(values = {}, existingProduct = null) {
  const nextName = cleanText(values.name);
  const existing = existingProduct ? normalizeExistingProductFields(existingProduct) : null;
  const selectedColorKeys = Array.isArray(values.selectedColorKeys) ? values.selectedColorKeys : [];
  const selectedSizes = Array.isArray(values.selectedSizes) ? values.selectedSizes : [];
  const galleryImages = normalizeGalleryInput(values.galleryImages);
  const mainImage = normalizeImageSrc(values.mainImage || galleryImages[0]?.src || existing?.primary_image_url || "");
  const imageRows = galleryImages
    .map((entry, index) => ({
      image_url: entry.src,
      display_order: index + 1,
    }))
    .filter((entry) => entry.image_url && entry.image_url !== mainImage);

  const slugInput = cleanText(values.slug ?? "");
  const slugValue = slugInput
    ? slugify(slugInput)
    : existing?.slug
      ? existing.slug
      : slugify(nextName);

  if (!slugValue) {
    throw new Error("Product slug cannot be empty after normalization.");
  }

  const categoryId = cleanText(values.categoryId ?? values.category ?? existing?.category_id ?? existing?.categoryId);

  return {
    product: {
      id: existing?.id || undefined,
      category_id: categoryId || undefined,
      slug: slugValue,
      name: nextName,
      series: cleanText(values.series) || null,
      brand: cleanText(values.brand) || null,
      sold_by: cleanText(values.soldBy) || cleanText(values.brand) || existing?.sold_by || null,
      price: normalizeNumber(values.price) ?? 0,
      compare_at: normalizeNumber(values.compareAt),
      rating: normalizeNumber(values.rating),
      review_count: normalizeNonNegativeInteger(values.reviews) ?? 0,
      badge: cleanText(values.badge) || null,
      stock_status: cleanText(values.stockStatus) || DEFAULT_STOCK_STATUS,
      description: cleanText(values.description) || null,
      overview: cleanText(values.overview) || cleanText(values.description) || null,
      primary_image_url: mainImage || null,
      shipping_fee:
        values.shippingFee === "" || values.shippingFee == null
          ? null
          : normalizeNumber(values.shippingFee),
      shipping_fee_status:
        values.shippingFee === "" || values.shippingFee == null ? "pending" : "ready",
      shipping_method: cleanText(values.shippingMethod) || existing?.shipping_method || "air-freight",
      status: cleanText(values.status) || existing?.status || "active",
      source: cleanText(values.source) || existing?.source || "custom",
      subcategory_label:
        values.subcategoryLabel === "" || values.subcategoryLabel == null
          ? null
          : cleanText(values.subcategoryLabel),
    },
    images: imageRows,
    colors: selectedColorKeys
      .map(normalizeColorSelection)
      .filter(Boolean)
      .map((colorName, index) => ({
        color_name: PRODUCT_COLOR_OPTIONS.find((option) => option.key === colorName)?.label ?? colorName,
        display_order: index + 1,
      })),
    sizes: selectedSizes
      .map((sizeName) => cleanText(sizeName))
      .filter(Boolean)
      .map((sizeName, index) => ({
        size_name: sizeName,
        display_order: index + 1,
      })),
    features: normalizeTextList(values.featuresText).map((featureText, index) => ({
      feature_text: featureText,
      display_order: index + 1,
    })),
    perks: normalizeTextList(values.perksText).map((perkText, index) => ({
      perk_text: perkText,
      display_order: index + 1,
    })),
  };
}

export function getProductPath(slug) {
  return `/products/${slug}`;
}

export function getShippingFee(product) {
  if (!product) {
    return null;
  }

  if (product.shippingFeeStatus === "pending") {
    return null;
  }

  const fee = normalizeNumber(product.shippingFee);

  return fee == null ? null : fee;
}

async function queryRpc(functionName, args = {}) {
  const { data, error } = await supabase.rpc(functionName, args);

  if (error) {
    return mapDbError(error, "Unable to save the product.");
  }

  return createResult(true, { data });
}

export async function saveProductBundle(payload = {}) {
  const normalizedPayload = ensureProductBundleRows(payload);
  return queryRpc("save_product_bundle", { payload: normalizedPayload });
}

export async function setProductDeletedAt(productId, deletedAt = new Date().toISOString()) {
  const product_id = cleanText(productId);

  if (!product_id) {
    return createResult(false, { message: "Product id is required." });
  }

  return queryRpc("set_product_deleted_at", { product_id, deleted_at: deletedAt });
}

export async function restoreProductRecord(productId) {
  const product_id = cleanText(productId);

  if (!product_id) {
    return createResult(false, { message: "Product id is required." });
  }

  return queryRpc("restore_product", { product_id });
}

export function useProducts(options = {}) {
  const includeDeleted = Boolean(options.includeDeleted);
  const optionsKey = useMemo(() => JSON.stringify({ includeDeleted }), [includeDeleted]);
  const [state, setState] = useState({
    products: [],
    loading: true,
    error: null,
    message: "",
  });
  const requestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setState((current) => ({
      ...current,
      loading: true,
      error: null,
      message: "",
    }));

    const result = await loadProducts({ includeDeleted });

    if (requestIdRef.current !== requestId) {
      return result;
    }

    setState({
      products: result.ok ? result.products ?? [] : [],
      loading: false,
      error: result.ok ? null : result.error ?? null,
      message: result.ok ? "" : result.message ?? "",
    });

    return result;
  }, [includeDeleted]);

  useEffect(() => {
    let active = true;

    (async () => {
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      setState((current) => ({
        ...current,
        loading: true,
        error: null,
        message: "",
      }));

      const result = await loadProducts({ includeDeleted });

      if (!active || requestIdRef.current !== requestId) {
        return;
      }

      setState({
        products: result.ok ? result.products ?? [] : [],
        loading: false,
        error: result.ok ? null : result.error ?? null,
        message: result.ok ? "" : result.message ?? "",
      });
    })();

    return () => {
      active = false;
      requestIdRef.current += 1;
    };
  }, [optionsKey, includeDeleted]);

  return {
    ...state,
    refresh,
  };
}

export function useProductBySlug(slug, options = {}) {
  const safeSlug = cleanText(slug);
  const includeDeleted = Boolean(options.includeDeleted);
  const [state, setState] = useState({
    product: null,
    loading: Boolean(safeSlug),
    error: null,
    message: "",
  });
  const requestIdRef = useRef(0);
  const optionsKey = useMemo(() => JSON.stringify({ includeDeleted, slug: safeSlug }), [includeDeleted, safeSlug]);

  const refresh = useCallback(async () => {
    if (!safeSlug) {
      setState({
        product: null,
        loading: false,
        error: null,
        message: "Product slug is required.",
      });
      return createResult(false, { message: "Product slug is required.", product: null });
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setState((current) => ({
      ...current,
      loading: true,
      error: null,
      message: "",
    }));

    const result = await loadProductBySlug(safeSlug, { includeDeleted });

    if (requestIdRef.current !== requestId) {
      return result;
    }

    setState({
      product: result.ok ? result.product ?? null : null,
      loading: false,
      error: result.ok ? null : result.error ?? null,
      message: result.ok ? "" : result.message ?? "",
    });

    return result;
  }, [includeDeleted, safeSlug]);

  useEffect(() => {
    let active = true;

    if (!safeSlug) {
      setState({
        product: null,
        loading: false,
        error: null,
        message: "Product slug is required.",
      });
      return () => {
        active = false;
      };
    }

    (async () => {
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      setState((current) => ({
        ...current,
        loading: true,
        error: null,
        message: "",
      }));

      const result = await loadProductBySlug(safeSlug, { includeDeleted });

      if (!active || requestIdRef.current !== requestId) {
        return;
      }

      setState({
        product: result.ok ? result.product ?? null : null,
        loading: false,
        error: result.ok ? null : result.error ?? null,
        message: result.ok ? "" : result.message ?? "",
      });
    })();

    return () => {
      active = false;
      requestIdRef.current += 1;
    };
  }, [optionsKey, includeDeleted]);

  return {
    ...state,
    refresh,
  };
}
