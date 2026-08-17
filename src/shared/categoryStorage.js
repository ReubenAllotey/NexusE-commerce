import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import electronicsImage from "../assets/images/electronic-set.png";
import beautyImage from "../assets/images/Woman.jpg";
import booksImage from "../assets/images/desktop.jfif";
import cameraImage from "../assets/images/camera.jpg";
import fanImage from "../assets/images/standing-fan.jpeg";
import fridgeImage from "../assets/images/fridge.jpeg";
import kitchenImage from "../assets/images/kitchen-oven.jpeg";
import laptopImage from "../assets/images/laptop.jpeg";
import officeChairImage from "../assets/images/office chair.jpg";
import playStationImage from "../assets/images/placestation.png";
import shirtImage from "../assets/images/laurel wrath shirt.png";
import musicImage from "../assets/images/music-set.jpeg";
import watchImage from "../assets/images/watcb.jpeg";
import tvImage from "../assets/images/flatscreen-tv.jpeg";
import washingImage from "../assets/images/washingmachine.jpeg";

const CATEGORY_SELECT =
  "id,name,slug,description,icon,status,parent_id,display_order,show_on_homepage,deleted_at,created_at,updated_at";

const categoryListeners = new Set();

let categoryCache = null;
let categoryCacheError = null;
let categoryCacheLoaded = false;

function emitCategoryChange() {
  for (const listener of categoryListeners) {
    listener();
  }
}

function subscribeCategoryChange(listener) {
  categoryListeners.add(listener);

  return () => {
    categoryListeners.delete(listener);
  };
}

function invalidateCategoryCache() {
  categoryCache = null;
  categoryCacheError = null;
  categoryCacheLoaded = false;
  emitCategoryChange();
}

function createResult(ok, payload = {}) {
  return {
    ok,
    ...payload,
  };
}

function normalizeText(value, fallback = "") {
  return String(value ?? fallback).trim();
}

export function slugify(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeStatus(status) {
  return String(status ?? "").toLowerCase() === "hidden" ? "hidden" : "active";
}

export function getCategoryImageSource(row = {}) {
  const rawText = [row.name, row.slug, row.icon, row.description]
    .map((value) => normalizeText(value).toLowerCase())
    .join(" ");

  const imageRules = [
    {
      keywords: ["beauty", "skin", "care", "health", "serum", "lotion", "makeup"],
      src: beautyImage,
    },
    {
      keywords: ["book", "books", "education", "study", "learning"],
      src: booksImage,
    },
    {
      keywords: ["camera", "photo", "photography", "canon"],
      src: cameraImage,
    },
    {
      keywords: ["smartwatch", "watch", "wearable", "wearables", "fitness band", "smart band"],
      src: watchImage,
    },
    {
      keywords: ["fan", "air", "cooling", "ventilation"],
      src: fanImage,
    },
    {
      keywords: ["fridge", "refrigerator", "freezer"],
      src: fridgeImage,
    },
    {
      keywords: ["kitchen", "oven", "toaster", "blender", "mixer", "cook"],
      src: kitchenImage,
    },
    {
      keywords: ["office", "stationery", "stationary", "paper", "pen", "notebook", "printer"],
      src: officeChairImage,
    },
    {
      keywords: ["laptop", "computer", "pc", "desktop", "macbook"],
      src: laptopImage,
    },
    {
      keywords: [
        "shirt",
        "fashion",
        "tee",
        "wear",
        "dress",
        "cloth",
        "apparel",
        "shoe",
        "shoes",
        "footwear",
        "sneaker",
        "sneakers",
        "bag",
        "bags",
        "luggage",
        "backpack",
        "suitcase",
      ],
      src: shirtImage,
    },
    {
      keywords: ["speaker", "audio", "sound", "headphone", "music"],
      src: musicImage,
    },
    {
      keywords: ["tv", "television", "screen", "display"],
      src: tvImage,
    },
    {
      keywords: ["gaming", "game", "console", "playstation", "xbox", "nintendo"],
      src: playStationImage,
    },
    {
      keywords: ["wash", "laundry", "machine", "washer"],
      src: washingImage,
    },
    {
      keywords: ["electronics", "electronic", "gadget", "phone", "mobile", "tablet"],
      src: electronicsImage,
    },
  ];

  const match = imageRules.find((rule) =>
    rule.keywords.some((keyword) => rawText.includes(keyword)),
  );

  return match?.src ?? electronicsImage;
}

const FEATURED_CATEGORY_PRESETS = [
  { name: "Smartwatches & Wearables", slug: slugify("Smartwatches & Wearables"), order: 9001 },
  { name: "Cameras & Photography", slug: slugify("Cameras & Photography"), order: 9002 },
  { name: "Kitchen Appliances", slug: slugify("Kitchen Appliances"), order: 9003 },
  { name: "Shoes & Footwear", slug: slugify("Shoes & Footwear"), order: 9004 },
  { name: "Bags & Luggage", slug: slugify("Bags & Luggage"), order: 9005 },
  { name: "Office & Stationery", slug: slugify("Office & Stationery"), order: 9006 },
  { name: "Automotive Accessories", slug: slugify("Automotive Accessories"), order: 9007 },
  { name: "Kids & Toys", slug: slugify("Kids & Toys"), order: 9008 },
  { name: "Gaming", slug: slugify("Gaming"), order: 9009 },
];

function normalizeCategoryKey(record = {}) {
  return slugify(record.slug ?? record.name ?? "");
}

function sortCategoryRecords(records = []) {
  return [...records].sort((left, right) => {
    const leftOrder = Number(left.order ?? left.displayOrder ?? 0);
    const rightOrder = Number(right.order ?? right.displayOrder ?? 0);

    return leftOrder - rightOrder || String(left.name ?? "").localeCompare(String(right.name ?? ""));
  });
}

function rowToRecord(row, slugIndex = new Map()) {
  if (!row) {
    return null;
  }

  const parentId = row.parent_id ?? null;

  return {
    id: row.id,
    name: row.name ?? "",
    slug: row.slug ?? "",
    description: row.description ?? "",
    icon: row.icon ?? "",
    image: getCategoryImageSource(row),
    status: row.status ?? "active",
    parentId,
    parentSlug: parentId ? slugIndex.get(parentId) ?? "" : "",
    order: Number(row.display_order ?? 0),
    displayOrder: Number(row.display_order ?? 0),
    showOnHomepage: Boolean(row.show_on_homepage),
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
    deletedAt: row.deleted_at ?? null,
    deleted: row.deleted_at != null,
  };
}

function recordsToSlugIndex(rows = []) {
  return new Map(rows.map((row) => [row.id, row.slug]));
}

function normalizeRecords(rows = []) {
  const slugIndex = recordsToSlugIndex(rows);

  return rows
    .map((row) => rowToRecord(row, slugIndex))
    .filter(Boolean);
}

function ensureNotEmptySlug(value) {
  const slug = slugify(value);

  if (!slug) {
    throw new Error("Category slug cannot be empty after normalization.");
  }

  return slug;
}

function isVisibleCategory(record) {
  return record?.status === "active" && record?.deletedAt == null;
}

function getSiblingOrder(records = [], parentId = null) {
  const siblings = records.filter(
    (record) => String(record.parentId ?? "") === String(parentId ?? "") && record.deletedAt == null,
  );

  return siblings.reduce((highest, record) => Math.max(highest, Number(record.order) || 0), 0) + 1;
}

function pickCategoryReference(ref, records = []) {
  if (!ref) {
    return null;
  }

  if (typeof ref === "object") {
    return ref;
  }

  const normalized = String(ref).trim();

  return (
    records.find((record) => record.id === normalized) ??
    records.find((record) => record.slug === normalized) ??
    null
  );
}

function buildWritePayload(fields = {}, existing = null, parentId = null) {
  const hasExplicitSlug = Object.prototype.hasOwnProperty.call(fields, "slug");
  const sourceSlug = hasExplicitSlug
    ? normalizeText(fields.slug)
    : existing?.slug ?? "";
  const nextSlug = sourceSlug ? ensureNotEmptySlug(sourceSlug) : ensureNotEmptySlug(fields.name);
  const nextName = normalizeText(fields.name, existing?.name ?? "");

  if (!nextName) {
    throw new Error("Category name is required.");
  }

  const nextStatus = normalizeStatus(fields.status ?? existing?.status ?? "active");
  const nextDeletedAt =
    Object.prototype.hasOwnProperty.call(fields, "deletedAt")
      ? fields.deletedAt ?? null
      : existing?.deletedAt ?? null;

  return {
    name: nextName,
    slug: nextSlug,
    description: Object.prototype.hasOwnProperty.call(fields, "description")
      ? normalizeText(fields.description)
      : existing?.description ?? "",
    icon: Object.prototype.hasOwnProperty.call(fields, "icon")
      ? normalizeText(fields.icon)
      : existing?.icon ?? "",
    status: nextStatus,
    parent_id: parentId ?? existing?.parentId ?? null,
    display_order: Number.isFinite(Number(fields.order ?? fields.displayOrder))
      ? Number(fields.order ?? fields.displayOrder)
      : Number(existing?.order ?? existing?.displayOrder ?? 0),
    show_on_homepage:
      typeof fields.showOnHomepage === "boolean"
        ? fields.showOnHomepage
        : typeof existing?.showOnHomepage === "boolean"
          ? existing.showOnHomepage
          : false,
    deleted_at: nextDeletedAt,
  };
}

async function queryCategories() {
  const { data, error } = await supabase
    .from("categories")
    .select(CATEGORY_SELECT)
    .order("display_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    throw error;
  }

  return Array.isArray(data) ? data : [];
}

export async function loadCategoryRecords({ forceRefresh = false } = {}) {
  if (!forceRefresh && categoryCacheLoaded && Array.isArray(categoryCache)) {
    return createResult(true, { records: categoryCache });
  }

  try {
    const rows = await queryCategories();
    const records = sortCategoryRecords(normalizeRecords(rows));

    categoryCache = records;
    categoryCacheError = null;
    categoryCacheLoaded = true;

    return createResult(true, { records });
  } catch (error) {
    categoryCache = [];
    categoryCacheError = error;
    categoryCacheLoaded = true;

    return createResult(false, {
      records: [],
      error,
      message: error?.message ?? "Unable to load categories.",
    });
  }
}

async function resolveCurrentRecords() {
  const result = await loadCategoryRecords({ forceRefresh: true });
  return result.records ?? [];
}

function mapDatabaseError(error, fallbackMessage) {
  return createResult(false, {
    error,
    message: error?.message ?? fallbackMessage,
  });
}

async function persistCategoryMutation(writePromise) {
  try {
    const result = await writePromise;
    if (result?.ok) {
      invalidateCategoryCache();
    }
    return result;
  } catch (error) {
    return mapDatabaseError(error, "Unable to save the category.");
  }
}

async function resolveCategoryTarget(categoryRef) {
  const records = await resolveCurrentRecords();
  const record = pickCategoryReference(categoryRef, records);

  if (!record) {
    return null;
  }

  return { record, records };
}

async function runCategoryInsert(payload) {
  const { data, error } = await supabase
    .from("categories")
    .insert(payload)
    .select(CATEGORY_SELECT)
    .single();

  if (error) {
    return mapDatabaseError(error, "Unable to save the category.");
  }

  return createResult(true, {
    category: rowToRecord(data, new Map([[data.id, data.slug]])),
  });
}

async function runCategoryUpdate(categoryRef, payload) {
  const target = await resolveCategoryTarget(categoryRef);

  if (!target) {
    return createResult(false, {
      message: "Category not found.",
    });
  }

  const { data, error } = await supabase
    .from("categories")
    .update(payload)
    .eq("id", target.record.id)
    .select(CATEGORY_SELECT)
    .single();

  if (error) {
    return mapDatabaseError(error, "Unable to save the category.");
  }

  return createResult(true, {
    category: rowToRecord(data, new Map([[data.id, data.slug]])),
  });
}

export async function createCategoryRecord(fields = {}) {
  const records = await resolveCurrentRecords();
  const displayOrder = Number.isFinite(Number(fields.order ?? fields.displayOrder))
    ? Number(fields.order ?? fields.displayOrder)
    : getSiblingOrder(records, null);
  const payload = buildWritePayload({ ...fields, order: displayOrder }, null, null);

  return persistCategoryMutation(runCategoryInsert(payload));
}

export async function createSubcategoryRecord(parentRef, fields = {}) {
  const resolved = await resolveCategoryTarget(parentRef);

  if (!resolved) {
    return createResult(false, { message: "Parent category must exist." });
  }

  const { record: parent, records } = resolved;

  if (parent.deletedAt != null) {
    return createResult(false, { message: "Deleted categories cannot be used as parents." });
  }

  if (parent.status !== "active") {
    return createResult(false, { message: "Active categories cannot use hidden parents." });
  }

  const displayOrder = Number.isFinite(Number(fields.order ?? fields.displayOrder))
    ? Number(fields.order ?? fields.displayOrder)
    : getSiblingOrder(records, parent.id);
  const payload = buildWritePayload(
    { ...fields, order: displayOrder },
    null,
    parent.id,
  );

  payload.parent_id = parent.id;

  return persistCategoryMutation(runCategoryInsert(payload));
}

export async function updateCategoryRecord(categoryRef, fields = {}) {
  const target = await resolveCategoryTarget(categoryRef);

  if (!target) {
    return createResult(false, { message: "Category not found." });
  }

  const nextParentId = Object.prototype.hasOwnProperty.call(fields, "parentId")
    ? fields.parentId || null
    : target.record.parentId;
  const payload = buildWritePayload(fields, target.record, nextParentId);

  if (Object.prototype.hasOwnProperty.call(fields, "parentId")) {
    payload.parent_id = fields.parentId || null;
  }

  return persistCategoryMutation(runCategoryUpdate(target.record.id, payload));
}

export async function setCategoryStatus(categoryRef, status) {
  const target = await resolveCategoryTarget(categoryRef);

  if (!target) {
    return createResult(false, { message: "Category not found." });
  }

  const nextStatus = normalizeStatus(status);
  const payload = {
    status: nextStatus,
    deleted_at: target.record.deletedAt ?? null,
  };

  if (nextStatus === "active") {
    payload.deleted_at = null;
  }

  return persistCategoryMutation(runCategoryUpdate(target.record.id, payload));
}

export async function softDeleteCategoryRecord(categoryRef) {
  const target = await resolveCategoryTarget(categoryRef);

  if (!target) {
    return createResult(false, { message: "Category not found." });
  }

  const payload = {
    status: "hidden",
    deleted_at: new Date().toISOString(),
  };

  return persistCategoryMutation(runCategoryUpdate(target.record.id, payload));
}

export async function restoreCategoryRecord(categoryRef) {
  const target = await resolveCategoryTarget(categoryRef);

  if (!target) {
    return createResult(false, { message: "Category not found." });
  }

  const payload = {
    status: "active",
    deleted_at: null,
  };

  return persistCategoryMutation(runCategoryUpdate(target.record.id, payload));
}

export async function deleteCategoryRecord(categoryRef) {
  return softDeleteCategoryRecord(categoryRef);
}

export function getCategoryCards(records = []) {
  return sortCategoryRecords(
    (Array.isArray(records) ? records : []).filter(
      (record) => isVisibleCategory(record) && !record.parentId,
    ),
  );
}

export function getHomepageCategoryCards(records = []) {
  return sortCategoryRecords(
    (Array.isArray(records) ? records : []).filter(
      (record) =>
        Boolean(record.showOnHomepage) &&
        isVisibleCategory(record) &&
        !record.parentId,
    ),
  );
}

export function getDiscoverCategoryCards(records = [], products = []) {
  const rootCategories = sortCategoryRecords(
    (Array.isArray(records) ? records : []).filter(
      (record) => isVisibleCategory(record) && !record.parentId,
    ),
  );
  const existingKeys = new Set(rootCategories.map((record) => normalizeCategoryKey(record)));
  const featuredCategories = FEATURED_CATEGORY_PRESETS.filter(
    (preset) => !existingKeys.has(preset.slug),
  ).map((preset) => ({
    id: `featured-${preset.slug}`,
    name: preset.name,
    slug: preset.slug,
    description: "",
    icon: "",
    image: getCategoryImageSource(preset),
    status: "active",
    parentId: null,
    parentSlug: "",
    order: preset.order,
    displayOrder: preset.order,
    showOnHomepage: true,
    createdAt: null,
    updatedAt: null,
    deletedAt: null,
    deleted: false,
    featured: true,
  }));

  return sortCategoryRecords([...rootCategories, ...featuredCategories]).map((category) => ({
    ...category,
    productCount: getCategoryProductCount(category, products),
  }));
}

export function getCategoryTree(records = []) {
  const activeRecords = (Array.isArray(records) ? records : []).filter(isVisibleCategory);
  const recordIndex = new Map(activeRecords.map((record) => [record.id, record]));
  const childRecords = activeRecords.filter((record) => record.parentId);
  const existingKeys = new Set(activeRecords.map((record) => normalizeCategoryKey(record)));
  const featuredRoots = FEATURED_CATEGORY_PRESETS.filter(
    (preset) => !existingKeys.has(preset.slug),
  ).map((preset) => ({
    id: `featured-${preset.slug}`,
    name: preset.name,
    slug: preset.slug,
    description: "",
    icon: "",
    image: getCategoryImageSource(preset),
    status: "active",
    parentId: null,
    parentSlug: "",
    order: preset.order,
    displayOrder: preset.order,
    showOnHomepage: true,
    createdAt: null,
    updatedAt: null,
    deletedAt: null,
    deleted: false,
    children: [],
    featured: true,
  }));

  return sortCategoryRecords([...activeRecords, ...featuredRoots])
    .filter((record) => !record.parentId)
    .map((record) => ({
      ...record,
      children: sortCategoryRecords(
        childRecords.filter((child) => child.parentId === record.id),
      ).map((child) => ({
        ...child,
        parentName: recordIndex.get(child.parentId)?.name ?? record.name,
      })),
    }));
}

export function getCategoryMetrics(records = []) {
  const safeRecords = Array.isArray(records) ? records : [];

  return {
    totalCategories: safeRecords.filter((record) => !record.parentId).length,
    activeCategories: safeRecords.filter(
      (record) => record.status === "active" && record.deletedAt == null && !record.parentId,
    ).length,
    hiddenCategories: safeRecords.filter(
      (record) =>
        (record.status === "hidden" || record.deletedAt != null) && !record.parentId,
    ).length,
    subcategories: safeRecords.filter((record) => record.parentId != null).length,
  };
}

export function getCategoryProductCount(category, products = []) {
  if (!category) {
    return 0;
  }

  const categoryName = normalizeText(category.name);
  const categoryKey = normalizeCategoryKey(category);

  return (Array.isArray(products) ? products : []).filter((product) => {
    const trail = Array.isArray(product?.categoryTrail) ? product.categoryTrail : [];
    const productCategoryName = normalizeText(product?.category);
    const productCategoryKey = normalizeCategoryKey({
      slug: product?.categorySlug ?? product?.category,
      name: product?.category,
    });
    const trailMatches = trail.some(
      (entry) => normalizeCategoryKey({ slug: entry, name: entry }) === categoryKey,
    );

    return (
      productCategoryName === categoryName ||
      productCategoryKey === categoryKey ||
      trailMatches ||
      trail.includes(categoryName)
    );
  }).length;
}

export function getCategoryOrderCount(category, orders = [], products = []) {
  if (!category) {
    return 0;
  }

  const categoryName = normalizeText(category.name);
  const categoryKey = normalizeCategoryKey(category);
  const productIndex = new Map(
    (Array.isArray(products) ? products : []).map((product) => [product.slug ?? product.name, product]),
  );

  let total = 0;

  for (const order of Array.isArray(orders) ? orders : []) {
    const items = Array.isArray(order?.items) ? order.items : [];

    for (const item of items) {
      const product = productIndex.get(item.slug ?? item.name);
      const trail = Array.isArray(product?.categoryTrail) ? product.categoryTrail : [];
      const productCategoryName = normalizeText(product?.category);
      const productCategoryKey = normalizeCategoryKey({
        slug: product?.categorySlug ?? product?.category,
        name: product?.category,
      });
      const trailMatches = trail.some(
        (entry) => normalizeCategoryKey({ slug: entry, name: entry }) === categoryKey,
      );

      if (
        productCategoryName === categoryName ||
        productCategoryKey === categoryKey ||
        trailMatches ||
        trail.includes(categoryName)
      ) {
        total += Number(item.quantity) || 1;
      }
    }
  }

  return total;
}

export function useCategoryRecords() {
  const [state, setState] = useState({
    records: [],
    loading: true,
    error: "",
  });
  const requestVersion = useRef(0);

  const refresh = useCallback(async ({ forceRefresh = false } = {}) => {
    const nextRequest = requestVersion.current + 1;
    requestVersion.current = nextRequest;
    setState((current) => ({ ...current, loading: true, error: "" }));

    const result = await loadCategoryRecords({ forceRefresh });

    if (requestVersion.current !== nextRequest) {
      return result;
    }

    setState({
      records: result.records ?? [],
      loading: false,
      error: result.ok ? "" : result.message ?? "Unable to load categories.",
    });

    return result;
  }, []);

  useEffect(() => {
    let isMounted = true;

    const run = async () => {
      const nextRequest = requestVersion.current + 1;
      requestVersion.current = nextRequest;
      setState((current) => ({ ...current, loading: true, error: "" }));

      const result = await loadCategoryRecords();

      if (!isMounted || requestVersion.current !== nextRequest) {
        return;
      }

      setState({
        records: result.records ?? [],
        loading: false,
        error: result.ok ? "" : result.message ?? "Unable to load categories.",
      });
    };

    run();
    const unsubscribe = subscribeCategoryChange(run);

    return () => {
      isMounted = false;
      requestVersion.current += 1;
      unsubscribe();
    };
  }, []);

  return {
    ...state,
    refresh,
  };
}

export function useCategoryCatalog() {
  return useCategoryRecords();
}

export function useCategoryTree() {
  const { records, loading, error, refresh } = useCategoryRecords();
  const tree = useMemo(() => getCategoryTree(records), [records]);

  return {
    tree,
    records,
    loading,
    error,
    refresh,
  };
}
