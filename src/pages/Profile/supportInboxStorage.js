import { supabase } from "../../lib/supabaseClient";

function normalizeStatus(status) {
  const value = String(status ?? "").trim().toLowerCase();

  if (value === "resolved") {
    return "resolved";
  }

  if (value === "open") {
    return "open";
  }

  return "new";
}

function toSupportMessage(row = {}, profile = null) {
  const subject = row.subject ?? row.title ?? "Support message";

  return {
    id: row.id ?? "",
    messageType: "support",
    customerId: row.user_id ?? "",
    customerName: profile?.full_name ?? profile?.name ?? "Guest user",
    customerEmail: profile?.email ?? "No email captured",
    orderId: row.order_id ?? null,
    subject,
    title: subject,
    message: row.message ?? "",
    category: row.category ?? "",
    priority: row.priority ?? "",
    status: normalizeStatus(row.status),
    adminReply: row.admin_reply ?? "",
    replyMessage: row.admin_reply ?? "",
    repliedAt: row.replied_at ?? null,
    repliedBy: row.replied_by ?? null,
    createdAt: row.created_at ?? row.createdAt ?? "",
    updatedAt: row.updated_at ?? row.updatedAt ?? "",
  };
}

async function loadProfilesByIds(userIds = []) {
  const uniqueIds = [...new Set(userIds.filter(Boolean))];

  if (uniqueIds.length === 0) {
    return new Map();
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .in("id", uniqueIds);

  if (error) {
    throw error;
  }

  return new Map((data ?? []).map((profile) => [profile.id, profile]));
}

export async function loadStoredSupportMessages({
  userId = null,
  includeAll = false,
  profileFallback = null,
} = {}) {
  let query = supabase
    .from("support_messages")
    .select(
      "id, user_id, order_id, subject, message, category, status, priority, admin_reply, replied_at, replied_by, created_at, updated_at",
    )
    .order("created_at", { ascending: false });

  if (!includeAll && userId) {
    query = query.eq("user_id", userId);
  } else if (!includeAll && !userId) {
    return [];
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  const supportRows = Array.isArray(data) ? data : [];
  const profileMap = includeAll
    ? await loadProfilesByIds(supportRows.map((row) => row.user_id))
    : new Map();

  const fallbackProfile = profileFallback
    ? {
        full_name: profileFallback.name ?? profileFallback.full_name ?? "",
        email: profileFallback.email ?? "",
      }
    : null;

  return supportRows.map((row) =>
    toSupportMessage(row, profileMap.get(row.user_id) ?? fallbackProfile),
  );
}

export async function recordSupportMessage(payload = {}) {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) {
    return { ok: false, message: sessionError.message || "Unable to read your session." };
  }

  const userId = sessionData?.session?.user?.id ?? "";
  if (!userId) {
    return { ok: false, message: "Please sign in to send a support message." };
  }

  const { data, error } = await supabase.rpc("create_support_message", {
    payload,
  });

  if (error) {
    return { ok: false, message: error.message || "Unable to send your support message." };
  }

  return { ok: true, message: toSupportMessage(data) };
}

export async function setSupportMessageStatus(messageId, status) {
  const { data, error } = await supabase.rpc("set_support_message_status", {
    p_message_id: messageId,
    p_status: status,
  });

  if (error) {
    return { ok: false, message: error.message || "Unable to change the message status." };
  }

  return { ok: true, message: toSupportMessage(data) };
}

export async function markSupportMessageViewed(messageId) {
  return setSupportMessageStatus(messageId, "open");
}

export async function replyToSupportMessage(messageId, replyMessage, status = "open") {
  const reply = replyMessage?.trim();

  if (!reply) {
    return { ok: false, message: "Please enter a reply before sending it." };
  }

  const { data, error } = await supabase.rpc("reply_to_support_message", {
    p_message_id: messageId,
    p_admin_reply: reply,
    p_status: status,
  });

  if (error) {
    return { ok: false, message: error.message || "Unable to send the reply." };
  }

  return { ok: true, message: toSupportMessage(data) };
}

export async function deleteSupportMessage(messageId) {
  const { error } = await supabase.rpc("delete_support_message", {
    p_message_id: messageId,
  });

  if (error) {
    return { ok: false, message: error.message || "Unable to delete the message." };
  }

  return { ok: true, messageId };
}

export function getSupportMetrics(messages = []) {
  const safeMessages = Array.isArray(messages) ? messages : [];

  return {
    totalMessages: safeMessages.length,
    newMessages: safeMessages.filter((message) => normalizeStatus(message.status) === "new").length,
    openMessages: safeMessages.filter((message) => normalizeStatus(message.status) === "open").length,
    resolvedMessages: safeMessages.filter((message) => normalizeStatus(message.status) === "resolved").length,
  };
}

export function getRecentSupportMessages(messages = [], limit = 20) {
  return [...(Array.isArray(messages) ? messages : [])]
    .sort((left, right) => new Date(right.createdAt ?? 0) - new Date(left.createdAt ?? 0))
    .slice(0, limit);
}

export function getSupportStatusLabel(status) {
  switch (normalizeStatus(status)) {
    case "open":
      return "Open";
    case "resolved":
      return "Resolved";
    default:
      return "New";
  }
}

export function getSupportStatusTone(status) {
  switch (normalizeStatus(status)) {
    case "open":
      return "blue";
    case "resolved":
      return "green";
    default:
      return "amber";
  }
}

export function normalizeSupportStatus(status) {
  return normalizeStatus(status);
}
