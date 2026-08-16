import { supabase } from "../lib/supabaseClient";

export const defaultSiteBanner = {
  id: "",
  bannerKey: "homepage",
  announcement: {
    label: "Announcement",
    batchNumber: "SEA-08",
    headline: "Batch SEA-08 is open for orders",
    body: "Orders placed within the active batch window will move together on the next shipping cycle.",
    batchWindowStart: "2026-08-10",
    batchWindowEnd: "2026-08-20",
    shippingMode: "sea",
    airTransitDays: 16,
    seaTransitDays: 30,
    ctaLabel: "View Details",
    ctaHref: "/products",
  },
  reflection: {
    label: "Daily Reflection",
    headline: "In the beginning God created the heavens and the earth.",
    verse: "Genesis 1:1",
    body: "",
  },
  status: "active",
  displayOrder: 0,
  createdAt: "",
  updatedAt: "",
};

function cleanText(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function cleanDate(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toISOString().slice(0, 10);
}

function normalizeShippingMode(value) {
  const key = cleanText(value).toLowerCase();

  if (key === "air" || key === "sea" || key === "both") {
    return key;
  }

  return defaultSiteBanner.announcement.shippingMode;
}

function normalizeNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function normalizeSiteBanner(value = {}) {
  const safe = value && typeof value === "object" ? value : {};
  const announcement = safe.announcement ?? {};
  const reflection = safe.reflection ?? {};

  return {
    id: cleanText(safe.id),
    bannerKey: cleanText(safe.bannerKey ?? safe.banner_key, "homepage") || "homepage",
    announcement: {
      label: cleanText(announcement.label ?? announcement.announcement_label, defaultSiteBanner.announcement.label),
      batchNumber: cleanText(
        announcement.batchNumber ?? announcement.batch_number ?? announcement.announcement_batch_number,
        defaultSiteBanner.announcement.batchNumber,
      ),
      headline: cleanText(
        announcement.headline ?? announcement.announcement_headline,
        defaultSiteBanner.announcement.headline,
      ),
      body: cleanText(announcement.body ?? announcement.announcement_body, defaultSiteBanner.announcement.body),
      batchWindowStart:
        cleanDate(
          announcement.batchWindowStart ??
            announcement.batch_window_start ??
            announcement.announcement_batch_window_start,
        ) || "",
      batchWindowEnd:
        cleanDate(
          announcement.batchWindowEnd ??
            announcement.batch_window_end ??
            announcement.announcement_batch_window_end,
        ) || "",
      shippingMode: normalizeShippingMode(
        announcement.shippingMode ??
          announcement.shipping_mode ??
          announcement.announcement_shipping_mode,
      ),
      airTransitDays: normalizeNumber(
        announcement.airTransitDays ??
          announcement.air_transit_days ??
          announcement.announcement_air_transit_days,
        defaultSiteBanner.announcement.airTransitDays,
      ),
      seaTransitDays: normalizeNumber(
        announcement.seaTransitDays ??
          announcement.sea_transit_days ??
          announcement.announcement_sea_transit_days,
        defaultSiteBanner.announcement.seaTransitDays,
      ),
      ctaLabel: cleanText(
        announcement.ctaLabel ?? announcement.cta_label ?? announcement.announcement_cta_label,
        defaultSiteBanner.announcement.ctaLabel,
      ),
      ctaHref: cleanText(
        announcement.ctaHref ?? announcement.cta_href ?? announcement.announcement_cta_href,
        defaultSiteBanner.announcement.ctaHref,
      ),
    },
    reflection: {
      label: cleanText(reflection.label ?? reflection.reflection_label, defaultSiteBanner.reflection.label),
      headline: cleanText(
        reflection.headline ?? reflection.reflection_headline,
        defaultSiteBanner.reflection.headline,
      ),
      verse: cleanText(reflection.verse ?? reflection.reflection_verse, defaultSiteBanner.reflection.verse),
      body: cleanText(reflection.body ?? reflection.reflection_body, defaultSiteBanner.reflection.body),
    },
    status: cleanText(safe.status, defaultSiteBanner.status) || defaultSiteBanner.status,
    displayOrder: normalizeNumber(safe.displayOrder ?? safe.display_order, defaultSiteBanner.displayOrder),
    createdAt: cleanText(safe.createdAt ?? safe.created_at),
    updatedAt: cleanText(safe.updatedAt ?? safe.updated_at),
  };
}

function mapRowToSiteBanner(row = {}) {
  return normalizeSiteBanner({
    id: row.id ?? "",
    bannerKey: row.banner_key ?? "homepage",
    announcement: {
      label: row.announcement_label,
      batchNumber: row.announcement_batch_number,
      headline: row.announcement_headline,
      body: row.announcement_body,
      batchWindowStart: row.announcement_batch_window_start,
      batchWindowEnd: row.announcement_batch_window_end,
      shippingMode: row.announcement_shipping_mode,
      airTransitDays: row.announcement_air_transit_days,
      seaTransitDays: row.announcement_sea_transit_days,
      ctaLabel: row.announcement_cta_label,
      ctaHref: row.announcement_cta_href,
    },
    reflection: {
      label: row.reflection_label,
      headline: row.reflection_headline,
      verse: row.reflection_verse,
      body: row.reflection_body,
    },
    status: row.status,
    displayOrder: row.display_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function mapSiteBannerPayload(banner = {}) {
  const safeBanner = normalizeSiteBanner(banner ?? defaultSiteBanner);

  return {
    banner_key: safeBanner.bannerKey,
    announcement_label: safeBanner.announcement.label,
    announcement_batch_number: safeBanner.announcement.batchNumber,
    announcement_headline: safeBanner.announcement.headline,
    announcement_body: safeBanner.announcement.body,
    announcement_batch_window_start: safeBanner.announcement.batchWindowStart || null,
    announcement_batch_window_end: safeBanner.announcement.batchWindowEnd || null,
    announcement_shipping_mode: safeBanner.announcement.shippingMode,
    announcement_air_transit_days: safeBanner.announcement.airTransitDays,
    announcement_sea_transit_days: safeBanner.announcement.seaTransitDays,
    announcement_cta_label: safeBanner.announcement.ctaLabel,
    announcement_cta_href: safeBanner.announcement.ctaHref,
    reflection_label: safeBanner.reflection.label,
    reflection_headline: safeBanner.reflection.headline,
    reflection_verse: safeBanner.reflection.verse,
    reflection_body: safeBanner.reflection.body || null,
    status: safeBanner.status,
    display_order: safeBanner.displayOrder,
  };
}

export async function loadStoredSiteBanner() {
  const { data, error } = await supabase
    .from("site_banners")
    .select(
      "id,banner_key,announcement_label,announcement_batch_number,announcement_headline,announcement_body,announcement_batch_window_start,announcement_batch_window_end,announcement_shipping_mode,announcement_air_transit_days,announcement_sea_transit_days,announcement_cta_label,announcement_cta_href,reflection_label,reflection_headline,reflection_verse,reflection_body,status,display_order,created_at,updated_at",
    )
    .eq("banner_key", "homepage")
    .eq("status", "active")
    .is("deleted_at", null)
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return normalizeSiteBanner(defaultSiteBanner);
  }

  return mapRowToSiteBanner(data);
}

export async function saveStoredSiteBanner(banner = {}) {
  const payload = mapSiteBannerPayload(banner);
  const { data, error } = await supabase.rpc("save_site_banner", {
    payload,
  });

  if (error) {
    return {
      ok: false,
      message: error.message || "Unable to save the site banner.",
      error,
      banner: normalizeSiteBanner(banner ?? defaultSiteBanner),
    };
  }

  return {
    ok: true,
    banner: mapRowToSiteBanner(data ?? payload),
  };
}
