import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { loadProducts } from "../pages/Products/productData";

export const FLASHY_SALES_PLACEMENTS = ["flashy", "best-selling"];

function cleanText(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function normalizePlacement(value) {
  const key = cleanText(value).toLowerCase();
  return key === "best-selling" ? "best-selling" : "flashy";
}

function normalizeNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function isVisibleAssignment(row = {}) {
  const now = new Date();
  const startsAt = row.starts_at ? new Date(row.starts_at) : null;
  const endsAt = row.ends_at ? new Date(row.ends_at) : null;

  if (startsAt && !Number.isNaN(startsAt.getTime()) && startsAt > now) {
    return false;
  }

  if (endsAt && !Number.isNaN(endsAt.getTime()) && endsAt < now) {
    return false;
  }

  return true;
}

function mapAssignmentToRecord(assignment = {}, product = null) {
  if (!product) {
    return null;
  }

  const placement = normalizePlacement(assignment.placement);
  return {
    id: assignment.id ?? "",
    productId: assignment.product_id ?? "",
    placement,
    group: placement,
    displayOrder: normalizeNumber(assignment.display_order, 0),
    order: normalizeNumber(assignment.display_order, 0),
    startsAt: assignment.starts_at ?? null,
    endsAt: assignment.ends_at ?? null,
    createdAt: assignment.created_at ?? "",
    updatedAt: assignment.updated_at ?? "",
    ...product,
  };
}

async function queryMerchandisingAssignments() {
  const { data, error } = await supabase
    .from("product_merchandising")
    .select("id,product_id,placement,display_order,starts_at,ends_at,created_at,updated_at")
    .order("placement", { ascending: true })
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  return Array.isArray(data) ? data : [];
}

export async function loadFlashySalesCatalog() {
  try {
    const [productsResult, assignments] = await Promise.all([
      loadProducts(),
      queryMerchandisingAssignments(),
    ]);

    if (!productsResult.ok) {
      return {
        ok: false,
        message: productsResult.message || "Unable to load merchandising products.",
        error: productsResult.error ?? null,
        records: [],
        flashyProducts: [],
        bestSellingProducts: [],
      };
    }

    const productById = new Map(
      (productsResult.products ?? []).map((product) => [product.id, product]),
    );

    const records = assignments
      .filter(isVisibleAssignment)
      .map((assignment) =>
        mapAssignmentToRecord(assignment, productById.get(assignment.product_id) ?? null),
      )
      .filter(Boolean)
      .sort(
        (left, right) =>
          (left.displayOrder ?? 0) - (right.displayOrder ?? 0) ||
          String(left.name ?? "").localeCompare(String(right.name ?? "")),
      );

    return {
      ok: true,
      records,
      flashyProducts: records.filter((record) => record.group === "flashy"),
      bestSellingProducts: records.filter((record) => record.group === "best-selling"),
      error: null,
      message: "",
    };
  } catch (error) {
    return {
      ok: false,
      message: error?.message || "Unable to load merchandising products.",
      error,
      records: [],
      flashyProducts: [],
      bestSellingProducts: [],
    };
  }
}

export async function saveFlashySalesRecord(record = {}) {
  const productId = cleanText(record.productId ?? record.product_id);
  const productSlug = cleanText(record.productSlug ?? record.product_slug);
  const placement = normalizePlacement(record.group ?? record.placement);
  const displayOrder = Math.max(Math.round(Number(record.displayOrder ?? record.order) || 0), 0);

  let resolvedProductId = productId;

  if (!resolvedProductId && productSlug) {
    const productsResult = await loadProducts();

    if (!productsResult.ok) {
      return {
        ok: false,
        message: productsResult.message || "Unable to resolve the selected product.",
        error: productsResult.error ?? null,
      };
    }

    resolvedProductId =
      productsResult.products?.find((product) => product.slug === productSlug)?.id ?? "";
  }

  if (!resolvedProductId) {
    return {
      ok: false,
      message: "Please choose a valid product before saving.",
    };
  }

  const { data, error } = await supabase.rpc("save_product_merchandising", {
    payload: {
      productId: resolvedProductId,
      placement,
      displayOrder,
      startsAt: record.startsAt ?? record.starts_at ?? null,
      endsAt: record.endsAt ?? record.ends_at ?? null,
    },
  });

  if (error) {
    return {
      ok: false,
      message: error.message || "Unable to save the merchandising record.",
      error,
    };
  }

  return {
    ok: true,
    record: data ?? null,
  };
}

export async function deleteFlashySalesRecord(record = {}) {
  const productId = cleanText(record.productId ?? record.product_id);
  const productSlug = cleanText(record.productSlug ?? record.product_slug);
  const placement = normalizePlacement(record.group ?? record.placement);

  let resolvedProductId = productId;

  if (!resolvedProductId && productSlug) {
    const productsResult = await loadProducts();

    if (!productsResult.ok) {
      return {
        ok: false,
        message: productsResult.message || "Unable to resolve the selected product.",
        error: productsResult.error ?? null,
      };
    }

    resolvedProductId =
      productsResult.products?.find((product) => product.slug === productSlug)?.id ?? "";
  }

  if (!resolvedProductId) {
    return {
      ok: false,
      message: "Please choose a valid product before deleting the merchandising record.",
    };
  }

  const { data, error } = await supabase.rpc("delete_product_merchandising", {
    p_product_id: resolvedProductId,
    p_placement: placement,
  });

  if (error) {
    return {
      ok: false,
      message: error.message || "Unable to delete the merchandising record.",
      error,
    };
  }

  return {
    ok: true,
    record: data ?? null,
  };
}

export function getFlashySalesMetrics(records = []) {
  const safeRecords = Array.isArray(records) ? records : [];
  const flashy = safeRecords.filter((record) => record.group === "flashy");
  const bestSelling = safeRecords.filter((record) => record.group === "best-selling");
  const averageRating =
    safeRecords.length > 0
      ? safeRecords.reduce((sum, record) => sum + (Number(record.rating) || 0), 0) / safeRecords.length
      : 0;

  return {
    totalItems: safeRecords.length,
    flashyItems: flashy.length,
    bestSellingItems: bestSelling.length,
    averageRating,
  };
}

export function useFlashySalesCatalog() {
  const [state, setState] = useState({
    records: [],
    flashyProducts: [],
    bestSellingProducts: [],
    loading: true,
    error: "",
  });
  const requestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setState((current) => ({ ...current, loading: true, error: "" }));

    const result = await loadFlashySalesCatalog();

    if (requestIdRef.current !== requestId) {
      return result;
    }

    setState({
      records: result.records ?? [],
      flashyProducts: result.flashyProducts ?? [],
      bestSellingProducts: result.bestSellingProducts ?? [],
      loading: false,
      error: result.ok ? "" : result.message || "Unable to load merchandising products.",
    });

    return result;
  }, []);

  useEffect(() => {
    let active = true;

    (async () => {
      const requestId = ++requestIdRef.current;
      setState((current) => ({ ...current, loading: true, error: "" }));

      const result = await loadFlashySalesCatalog();

      if (!active || requestIdRef.current !== requestId) {
        return;
      }

      setState({
        records: result.records ?? [],
        flashyProducts: result.flashyProducts ?? [],
        bestSellingProducts: result.bestSellingProducts ?? [],
        loading: false,
        error: result.ok ? "" : result.message || "Unable to load merchandising products.",
      });
    })();

    return () => {
      active = false;
      requestIdRef.current += 1;
    };
  }, []);

  return useMemo(
    () => ({
      ...state,
      refresh,
    }),
    [refresh, state],
  );
}
