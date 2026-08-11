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

function toContactMessage(row = {}) {
  return {
    id: row.id ?? "",
    messageType: "contact",
    customerId: row.user_id ?? "",
    customerName: row.full_name ?? "Guest user",
    customerEmail: row.email ?? "No email captured",
    customerPhone: row.phone_number ?? "",
    subject: row.subject ?? "Contact message",
    title: row.subject ?? "Contact message",
    message: row.message ?? "",
    status: normalizeStatus(row.status),
    adminReply: row.admin_reply ?? "",
    replyMessage: row.admin_reply ?? "",
    repliedAt: row.replied_at ?? null,
    repliedBy: row.replied_by ?? null,
    createdAt: row.created_at ?? row.createdAt ?? "",
    updatedAt: row.updated_at ?? row.updatedAt ?? "",
  };
}

export async function loadContactMessages() {
  const { data, error } = await supabase
    .from("contact_messages")
    .select(
      "id, user_id, full_name, email, phone_number, subject, message, status, admin_reply, replied_at, replied_by, created_at, updated_at",
    )
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return (Array.isArray(data) ? data : []).map(toContactMessage);
}

export async function recordContactMessage(payload = {}) {
  const { data, error } = await supabase.rpc("create_contact_message", {
    payload,
  });

  if (error) {
    return { ok: false, message: error.message || "Unable to send your message." };
  }

  return { ok: true, message: toContactMessage(data) };
}

export async function replyToContactMessage(messageId, replyMessage, status = "open") {
  const reply = replyMessage?.trim();

  if (!reply) {
    return { ok: false, message: "Please enter a reply before sending it." };
  }

  const { data, error } = await supabase.rpc("reply_to_contact_message", {
    p_message_id: messageId,
    p_admin_reply: reply,
    p_status: status,
  });

  if (error) {
    return { ok: false, message: error.message || "Unable to send the reply." };
  }

  return { ok: true, message: toContactMessage(data) };
}

export async function setContactMessageStatus(messageId, status) {
  const { data, error } = await supabase.rpc("set_contact_message_status", {
    p_message_id: messageId,
    p_status: status,
  });

  if (error) {
    return { ok: false, message: error.message || "Unable to change the message status." };
  }

  return { ok: true, message: toContactMessage(data) };
}

export async function deleteContactMessage(messageId) {
  const { error } = await supabase.rpc("delete_contact_message", {
    p_message_id: messageId,
  });

  if (error) {
    return { ok: false, message: error.message || "Unable to delete the message." };
  }

  return { ok: true, messageId };
}

export function normalizeContactStatus(status) {
  return normalizeStatus(status);
}

export function getContactStatusLabel(status) {
  switch (normalizeStatus(status)) {
    case "open":
      return "Open";
    case "resolved":
      return "Resolved";
    default:
      return "New";
  }
}

export function getContactStatusTone(status) {
  switch (normalizeStatus(status)) {
    case "open":
      return "blue";
    case "resolved":
      return "green";
    default:
      return "amber";
  }
}

export function getContactMetrics(messages = []) {
  const safeMessages = Array.isArray(messages) ? messages : [];

  return {
    totalMessages: safeMessages.length,
    newMessages: safeMessages.filter((message) => normalizeStatus(message.status) === "new").length,
    openMessages: safeMessages.filter((message) => normalizeStatus(message.status) === "open").length,
    resolvedMessages: safeMessages.filter((message) => normalizeStatus(message.status) === "resolved").length,
  };
}

export function getRecentContactMessages(messages = [], limit = 20) {
  return [...(Array.isArray(messages) ? messages : [])]
    .sort((left, right) => new Date(right.createdAt ?? 0) - new Date(left.createdAt ?? 0))
    .slice(0, limit);
}
