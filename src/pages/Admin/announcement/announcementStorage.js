import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";

export const ANNOUNCEMENT_CATEGORY_OPTIONS = [
  { value: "shipping-update", label: "Shipping Update" },
  { value: "new-arrival", label: "New Arrival" },
  { value: "promotion", label: "Promotion" },
  { value: "maintenance", label: "Maintenance" },
  { value: "payment-reminder", label: "Payment Reminder" },
  { value: "general-announcement", label: "General Announcement" },
];

const CATEGORY_LABELS = Object.fromEntries(
  ANNOUNCEMENT_CATEGORY_OPTIONS.map((item) => [item.value, item.label]),
);

const CATEGORY_ALIASES = {
  shipping: "shipping-update",
  "shipping update": "shipping-update",
  "shipping-update": "shipping-update",
  new: "new-arrival",
  "new arrival": "new-arrival",
  "new-arrival": "new-arrival",
  promotion: "promotion",
  maintenance: "maintenance",
  payment: "payment-reminder",
  "payment reminder": "payment-reminder",
  "payment-reminder": "payment-reminder",
  general: "general-announcement",
  announcement: "general-announcement",
  "general announcement": "general-announcement",
  "general-announcement": "general-announcement",
};

const AUDIENCE_LABELS = {
  all_users: "All users",
  active_orders: "Users with active orders",
  pending_payment: "Users with pending payment",
};

function cleanText(value) {
  return String(value ?? "").trim();
}

function cleanDate(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function parseDate(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function normalizeAnnouncementCategory(category) {
  const key = cleanText(category).toLowerCase();
  return CATEGORY_ALIASES[key] ?? key ?? "general-announcement";
}

export function getAnnouncementCategoryLabel(category) {
  return CATEGORY_LABELS[normalizeAnnouncementCategory(category)] ?? "General Announcement";
}

export function getAnnouncementCategoryOptions() {
  return ANNOUNCEMENT_CATEGORY_OPTIONS;
}

export function getAnnouncementAudienceKey(category) {
  switch (normalizeAnnouncementCategory(category)) {
    case "shipping-update":
      return "active_orders";
    case "payment-reminder":
      return "pending_payment";
    default:
      return "all_users";
  }
}

export function getAnnouncementAudienceLabel(categoryOrKey) {
  const normalized = cleanText(categoryOrKey).toLowerCase();

  if (normalized in AUDIENCE_LABELS) {
    return AUDIENCE_LABELS[normalized];
  }

  return AUDIENCE_LABELS[getAnnouncementAudienceKey(normalized)] ?? "All users";
}

export function normalizeAnnouncementStatus(status) {
  const key = cleanText(status).toLowerCase();

  if (key === "scheduled" || key === "expired" || key === "active") {
    return key;
  }

  return "active";
}

export function getAnnouncementStatus(record) {
  if (record?.deletedAt) {
    return "expired";
  }

  const now = Date.now();
  const publishDate = parseDate(record?.publishDate ?? record?.startsAt);
  const expireDate = parseDate(record?.expireDate ?? record?.endsAt);

  if (expireDate && now > expireDate.getTime()) {
    return "expired";
  }

  if (publishDate && now < publishDate.getTime()) {
    return "scheduled";
  }

  return normalizeAnnouncementStatus(record?.status);
}

export function getAnnouncementStatusLabel(status) {
  switch (normalizeAnnouncementStatus(status)) {
    case "scheduled":
      return "Scheduled";
    case "expired":
      return "Expired";
    default:
      return "Active";
  }
}

export function getAnnouncementStatusTone(status) {
  switch (normalizeAnnouncementStatus(status)) {
    case "scheduled":
      return "amber";
    case "expired":
      return "rose";
    default:
      return "green";
  }
}

function mapRowToAnnouncement(row = {}) {
  const publishedAt = row.starts_at ?? row.publish_date ?? "";
  const expireAt = row.ends_at ?? row.expire_date ?? "";

  return {
    id: row.id ?? "",
    title: row.title ?? "",
    category: normalizeAnnouncementCategory(row.category),
    audienceKey: getAnnouncementAudienceKey(row.category),
    audienceLabel: getAnnouncementAudienceLabel(row.category),
    body: row.message ?? "",
    message: row.message ?? "",
    publishDate: cleanDate(publishedAt),
    expireDate: cleanDate(expireAt),
    startsAt: publishedAt ?? "",
    endsAt: expireAt ?? "",
    status: normalizeAnnouncementStatus(row.status),
    deletedAt: row.deleted_at ?? null,
    createdBy: row.created_by ?? null,
    createdAt: row.created_at ?? "",
    updatedAt: row.updated_at ?? "",
  };
}

function mapAnnouncementPayload(payload = {}) {
  const category = normalizeAnnouncementCategory(payload.category);
  const title = cleanText(payload.title);
  const message = cleanText(payload.message ?? payload.body);
  const publishDate = cleanDate(payload.publishDate ?? payload.startsAt);
  const expireDate = cleanDate(payload.expireDate ?? payload.endsAt);
  const status = publishDate && new Date(`${publishDate}T00:00:00Z`) > new Date()
    ? "scheduled"
    : expireDate && new Date(`${expireDate}T23:59:59Z`) < new Date()
      ? "expired"
      : "active";

  return {
    id: cleanText(payload.id),
    title,
    message,
    category,
    status,
    starts_at: publishDate || null,
    ends_at: expireDate || null,
  };
}

export async function loadAnnouncements({ includeArchived = false } = {}) {
  const { data, error } = await supabase
    .from("announcements")
    .select(
      "id,title,message,category,status,starts_at,ends_at,deleted_at,created_by,created_at,updated_at",
    )
    .order("created_at", { ascending: false });

  if (error) {
    return {
      ok: false,
      message: error.message || "Unable to load announcements.",
      error,
      announcements: [],
    };
  }

  const rows = Array.isArray(data) ? data.map(mapRowToAnnouncement) : [];
  const now = Date.now();
  const announcements = includeArchived
    ? rows
    : rows.filter((item) => {
        const publishDate = parseDate(item.publishDate);
        const expireDate = parseDate(item.expireDate);

        if (item.deletedAt) {
          return false;
        }

        if (item.status !== "active") {
          return false;
        }

        if (publishDate && now < publishDate.getTime()) {
          return false;
        }

        if (expireDate && now > expireDate.getTime()) {
          return false;
        }

        return true;
      });

  return {
    ok: true,
    announcements,
  };
}

export async function saveAnnouncement(payload = {}) {
  const normalizedPayload = mapAnnouncementPayload(payload);
  const { data, error } = await supabase.rpc("save_announcement", {
    payload: normalizedPayload,
  });

  if (error) {
    return {
      ok: false,
      message: error.message || "Unable to save the announcement.",
      error,
      announcement: null,
    };
  }

  return {
    ok: true,
    announcement: mapRowToAnnouncement(data ?? normalizedPayload),
  };
}

export async function deleteAnnouncement(announcementId) {
  const id = cleanText(announcementId);

  if (!id) {
    return {
      ok: false,
      message: "Announcement id is required.",
    };
  }

  const { data, error } = await supabase.rpc("soft_delete_announcement", {
    p_announcement_id: id,
  });

  if (error) {
    return {
      ok: false,
      message: error.message || "Unable to delete the announcement.",
      error,
    };
  }

  return {
    ok: true,
    announcement: mapRowToAnnouncement(data ?? {}),
  };
}

export function getAnnouncementMetrics(announcements = []) {
  const visible = Array.isArray(announcements) ? announcements : [];

  return {
    totalAnnouncements: visible.length,
    activeAnnouncements: visible.filter((item) => getAnnouncementStatus(item) === "active").length,
    scheduledAnnouncements: visible.filter((item) => getAnnouncementStatus(item) === "scheduled").length,
    expiredAnnouncements: visible.filter((item) => getAnnouncementStatus(item) === "expired").length,
  };
}

export function useAnnouncements({ includeArchived = false } = {}) {
  const [state, setState] = useState({
    announcements: [],
    loading: true,
    error: "",
  });
  const requestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setState((current) => ({ ...current, loading: true, error: "" }));

    const result = await loadAnnouncements({ includeArchived });

    if (requestIdRef.current !== requestId) {
      return result;
    }

    setState({
      announcements: result.announcements ?? [],
      loading: false,
      error: result.ok ? "" : result.message || "Unable to load announcements.",
    });

    return result;
  }, [includeArchived]);

  useEffect(() => {
    let active = true;

    (async () => {
      const requestId = ++requestIdRef.current;
      setState((current) => ({ ...current, loading: true, error: "" }));

      const result = await loadAnnouncements({ includeArchived });

      if (!active || requestIdRef.current !== requestId) {
        return;
      }

      setState({
        announcements: result.announcements ?? [],
        loading: false,
        error: result.ok ? "" : result.message || "Unable to load announcements.",
      });
    })();

    return () => {
      active = false;
      requestIdRef.current += 1;
    };
  }, [includeArchived]);

  return useMemo(
    () => ({
      ...state,
      refresh,
    }),
    [refresh, state],
  );
}
