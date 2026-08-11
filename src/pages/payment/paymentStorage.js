import { supabase } from "../../lib/supabaseClient";

// Temporary checkout state only. It is scoped to the signed-in user and cleared on logout.
const PAYMENT_SESSION_KEY = "nexus-payment-session";
// Temporary shipping draft for the current authenticated user only.
const CHECKOUT_DRAFT_KEY = "nexus-checkout-shipping-address";

function readJson(storage, key, fallback) {
  if (typeof window === "undefined") {
    return fallback;
  }

  try {
    const value = storage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(storage, key, value) {
  if (typeof window !== "undefined") {
    storage.setItem(key, JSON.stringify(value));
  }
}

function getSessionStorage() {
  return typeof window === "undefined" ? null : window.sessionStorage;
}

function clean(value) {
  return String(value ?? "").trim();
}

function buildOwnerScopedPayload(ownerUserId, payload) {
  const safeOwnerId = clean(ownerUserId);

  return {
    ownerUserId: safeOwnerId,
    payload: payload && typeof payload === "object" && !Array.isArray(payload) ? payload : null,
    savedAt: new Date().toISOString(),
  };
}

function isOwnerScopedPayload(value, ownerUserId) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  if (!clean(ownerUserId)) {
    return true;
  }

  return clean(value.ownerUserId) === clean(ownerUserId);
}

function normalizeNullableText(value) {
  const text = clean(value);
  return text || null;
}

async function getCurrentAuthUser() {
  const { data, error } = await supabase.auth.getUser();

  if (error) {
    return { ok: false, message: error.message || "Unable to resolve the signed-in user.", user: null };
  }

  if (!data?.user) {
    return { ok: false, message: "Please sign in to continue.", user: null };
  }

  return { ok: true, user: data.user };
}

async function getCurrentProfile(userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email, role, status")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    return { ok: false, message: error.message || "Unable to load the profile.", profile: null };
  }

  if (!data) {
    return { ok: false, message: "The active profile could not be found.", profile: null };
  }

  return {
    ok: true,
    profile: {
      id: data.id,
      name: clean(data.full_name) || "Customer",
      email: clean(data.email),
      role: clean(data.role) || "customer",
      status: clean(data.status) || "active",
    },
  };
}

function getPaymentMethodLabel(method) {
  switch (clean(method).toLowerCase()) {
    case "mobile-money":
      return "Mobile Money";
    case "mtn-mobile-money":
      return "MTN Mobile Money";
    case "telecel-cash":
      return "Telecel Cash";
    case "airteltigo-money":
      return "AirtelTigo Money";
    case "card":
      return "Debit or Credit Card";
    default:
      return "Mobile Money";
  }
}

function getMobileNetworkLabel(network) {
  switch (clean(network).toLowerCase()) {
    case "mtn":
      return "MTN Mobile Money";
    case "telecel":
      return "Telecel Cash";
    case "airteltigo":
      return "AirtelTigo Money";
    default:
      return "MTN Mobile Money";
  }
}

function normalizePaymentMethod(method) {
  const normalized = clean(method).toLowerCase();

  if (normalized === "card" || normalized === "debit-card" || normalized === "credit-card") {
    return "card";
  }

  return "mobile-money";
}

function getPaymentStatusLabel(status) {
  switch (clean(status).toLowerCase()) {
    case "successful":
    case "paid":
      return "Successful";
    case "failed":
    case "cancelled":
      return "Failed";
    case "processing":
      return "Processing";
    default:
      return "Pending";
  }
}

function getPaymentStatusTone(status) {
  switch (clean(status).toLowerCase()) {
    case "successful":
    case "paid":
      return "completed";
    case "failed":
    case "cancelled":
      return "failed";
    case "processing":
      return "processing";
    default:
      return "pending";
  }
}

export function formatGhanaCedis(value) {
  const safeValue = Number(value) || 0;

  return new Intl.NumberFormat("en-GH", {
    style: "currency",
    currency: "GHS",
    currencyDisplay: "symbol",
    minimumFractionDigits: Number.isInteger(safeValue) ? 0 : 2,
    maximumFractionDigits: Number.isInteger(safeValue) ? 0 : 2,
  }).format(safeValue);
}

export function loadCheckoutDraft(ownerUserId = "") {
  const storage = getSessionStorage();

  if (!storage) {
    return null;
  }

  const value = readJson(storage, CHECKOUT_DRAFT_KEY, null);

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  if (!isOwnerScopedPayload(value, ownerUserId)) {
    return null;
  }

  return value.payload && typeof value.payload === "object" ? value.payload : null;
}

export function saveCheckoutDraft(ownerUserId, payload) {
  const storage = getSessionStorage();

  if (!storage) {
    return;
  }

  const nextValue = buildOwnerScopedPayload(ownerUserId, payload);
  writeJson(storage, CHECKOUT_DRAFT_KEY, nextValue);
}

export function clearCheckoutDraft(ownerUserId = "") {
  const storage = getSessionStorage();

  if (!storage) {
    return;
  }

  if (!ownerUserId) {
    storage.removeItem(CHECKOUT_DRAFT_KEY);
    return;
  }

  const current = readJson(storage, CHECKOUT_DRAFT_KEY, null);

  if (isOwnerScopedPayload(current, ownerUserId)) {
    storage.removeItem(CHECKOUT_DRAFT_KEY);
  }
}

export function loadPaymentSession(ownerUserId = "") {
  const storage = getSessionStorage();

  if (!storage) {
    return null;
  }

  const session = readJson(storage, PAYMENT_SESSION_KEY, null);

  if (!session || typeof session !== "object" || Array.isArray(session)) {
    return null;
  }

  if (clean(ownerUserId) && clean(session.ownerUserId) && clean(session.ownerUserId) !== clean(ownerUserId)) {
    return null;
  }

  const { guestCredentials, ...safeSession } = session;
  return safeSession;
}

export function savePaymentSession(session, ownerUserId = "") {
  const storage = getSessionStorage();

  if (!storage) {
    return;
  }

  const nextSession =
    session && typeof session === "object" && !Array.isArray(session)
      ? (() => {
          const { guestCredentials, ...safeSession } = session;

          return {
            ...safeSession,
            ownerUserId: clean(ownerUserId) || clean(session.ownerUserId),
          };
        })()
      : null;

  if (!nextSession) {
    storage.removeItem(PAYMENT_SESSION_KEY);
    return;
  }

  writeJson(storage, PAYMENT_SESSION_KEY, nextSession);
}

export function clearPaymentSession() {
  const storage = getSessionStorage();

  if (storage) {
    storage.removeItem(PAYMENT_SESSION_KEY);
  }
}

function normalizeOrderItemCount(itemsByOrderId, orderId) {
  const items = itemsByOrderId.get(orderId) ?? [];
  return Array.isArray(items) ? items.reduce((sum, item) => sum + (Number(item.quantity) || 1), 0) : 0;
}

function mapPaymentRowToHistoryItem(paymentRow = {}, orderRow = null, itemCount = 0) {
  const status = clean(paymentRow.status).toLowerCase();
  const label = getPaymentStatusLabel(status);
  const tone = getPaymentStatusTone(status);
  const amountPaid = Number(paymentRow.amount) || Number(paymentRow.amount_minor) / 100 || 0;

  return {
    id: clean(paymentRow.id),
    orderId: clean(paymentRow.order_id),
    orderNumber: clean(orderRow?.order_number) || clean(paymentRow.order_number),
    paymentReference: clean(paymentRow.provider_reference),
    paymentMethod: clean(paymentRow.payment_method),
    paymentNetwork: clean(paymentRow.payment_network),
    paymentPhoneNumber: clean(paymentRow.payment_phone_number),
    paymentStatus: label,
    paymentTone: tone,
    amountPaid,
    currency: clean(paymentRow.currency) || "GHS",
    itemCount,
    orderStatus: clean(orderRow?.status),
    createdAt: paymentRow.created_at,
    updatedAt: paymentRow.updated_at,
    paidAt: paymentRow.paid_at,
  };
}

function mapPaymentReceipt(paymentRow = {}, orderRow = null, items = []) {
  if (!paymentRow || !orderRow) {
    return null;
  }

  const paymentStatus = clean(paymentRow.status).toLowerCase();
  const amountPaid = Number(paymentRow.amount) || Number(paymentRow.amount_minor) / 100 || 0;

  return {
    id: clean(paymentRow.id),
    paymentReference: clean(paymentRow.provider_reference),
    orderId: clean(orderRow.id),
    orderNumber: clean(orderRow.order_number),
    paymentMethod: clean(paymentRow.payment_method),
    paymentNetwork: clean(paymentRow.payment_network),
    paymentPhoneNumber: clean(paymentRow.payment_phone_number),
    paymentStatus: getPaymentStatusLabel(paymentStatus),
    paymentTone: getPaymentStatusTone(paymentStatus),
    amountPaid,
    currency: clean(paymentRow.currency) || "GHS",
    orderStatus: clean(orderRow.status),
    items: items.map((item) => ({
      key: clean(item.id),
      slug: clean(item.product_slug),
      name: clean(item.product_name) || "Unnamed product",
      brand: clean(item.brand),
      image: clean(item.image_url),
      price: Number(item.unit_price) || 0,
      quantity: Math.max(Math.round(Number(item.quantity) || 1), 1),
      variant: {
        color: clean(item.selected_color),
        size: clean(item.selected_size),
      },
      shippingFee: Number(item.shipping_fee) || 0,
      lineSubtotal: Number(item.line_subtotal) || 0,
      lineShipping: Number(item.line_shipping) || 0,
    })),
    createdAt: paymentRow.paid_at ?? paymentRow.created_at,
    updatedAt: paymentRow.updated_at,
  };
}

async function loadOrderItemCounts(orderIds = []) {
  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    return new Map();
  }

  const { data, error } = await supabase
    .from("order_items")
    .select("order_id, quantity")
    .in("order_id", orderIds)
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  const itemsByOrderId = new Map();

  for (const item of Array.isArray(data) ? data : []) {
    const orderId = clean(item.order_id);

    if (!orderId) {
      continue;
    }

    const existing = itemsByOrderId.get(orderId) ?? [];
    existing.push(item);
    itemsByOrderId.set(orderId, existing);
  }

  return itemsByOrderId;
}

export async function loadPaymentHistory({ authUser = null } = {}) {
  const userResult = authUser?.id
    ? {
        ok: true,
        user: {
          id: authUser.id,
          name: clean(authUser.name) || "Customer",
          email: clean(authUser.email),
          role: clean(authUser.role) || "customer",
          status: clean(authUser.status) || "active",
        },
      }
    : await getCurrentAuthUser();

  if (!userResult.ok) {
    return { ok: false, message: userResult.message, payments: [] };
  }

  const profileResult = await getCurrentProfile(userResult.user.id);

  if (!profileResult.ok) {
    return { ok: false, message: profileResult.message, payments: [] };
  }

  if (profileResult.profile.status !== "active") {
    return { ok: false, message: "Your account is not active.", payments: [] };
  }

  const { data: paymentRows, error } = await supabase
    .from("payments")
    .select(
      [
        "id",
        "order_id",
        "user_id",
        "provider",
        "payment_method",
        "payment_network",
        "payment_phone_number",
        "provider_reference",
        "status",
        "amount",
        "currency",
        "amount_minor",
        "authorization_url",
        "access_code",
        "paid_at",
        "created_at",
        "updated_at",
        "order:orders(id, order_number, status, payment_status, subtotal, shipping_total, total, created_at, updated_at)",
      ].join(","),
    )
    .eq("user_id", userResult.user.id)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });

  if (error) {
    return { ok: false, message: error.message || "Unable to load payment history.", payments: [] };
  }

  const rows = Array.isArray(paymentRows) ? paymentRows : [];
  const itemsByOrderId = await loadOrderItemCounts(rows.map((payment) => payment.order_id));

  return {
    ok: true,
    payments: rows.map((payment) =>
      mapPaymentRowToHistoryItem(payment, payment.order ?? null, normalizeOrderItemCount(itemsByOrderId, payment.order_id)),
    ),
  };
}

export async function loadPaymentReceipt(reference, { authUser = null } = {}) {
  const receiptReference = clean(reference);

  if (!receiptReference) {
    return { ok: true, receipt: null };
  }

  const userResult = authUser?.id
    ? {
        ok: true,
        user: {
          id: authUser.id,
          name: clean(authUser.name) || "Customer",
          email: clean(authUser.email),
          role: clean(authUser.role) || "customer",
          status: clean(authUser.status) || "active",
        },
      }
    : await getCurrentAuthUser();

  if (!userResult.ok) {
    return { ok: false, message: userResult.message, receipt: null };
  }

  const profileResult = await getCurrentProfile(userResult.user.id);

  if (!profileResult.ok) {
    return { ok: false, message: profileResult.message, receipt: null };
  }

  const { data: paymentRow, error } = await supabase
    .from("payments")
    .select(
      [
        "id",
        "order_id",
        "user_id",
        "provider",
        "payment_method",
        "payment_network",
        "payment_phone_number",
        "provider_reference",
        "status",
        "amount",
        "currency",
        "amount_minor",
        "authorization_url",
        "access_code",
        "paid_at",
        "created_at",
        "updated_at",
      ].join(","),
    )
    .eq("provider_reference", receiptReference)
    .maybeSingle();

  if (error) {
    return { ok: false, message: error.message || "Unable to load the receipt.", receipt: null };
  }

  if (!paymentRow) {
    return { ok: true, receipt: null };
  }

  const { data: orderRow, error: orderError } = await supabase
    .from("orders")
    .select(
      [
        "id",
        "order_number",
        "user_id",
        "customer_name",
        "customer_email",
        "status",
        "payment_status",
        "shipment_type",
        "batch_number",
        "shipping_address_id",
        "shipping_address_snapshot",
        "subtotal",
        "shipping_total",
        "total",
        "delivered_at",
        "created_at",
        "updated_at",
      ].join(","),
    )
    .eq("id", paymentRow.order_id)
    .maybeSingle();

  if (orderError) {
    return { ok: false, message: orderError.message || "Unable to load the related order.", receipt: null };
  }

  if (!orderRow) {
    return { ok: true, receipt: null };
  }

  const { data: itemRows, error: itemError } = await supabase
    .from("order_items")
    .select(
      [
        "id",
        "order_id",
        "product_id",
        "product_name",
        "product_slug",
        "brand",
        "image_url",
        "unit_price",
        "quantity",
        "selected_color",
        "selected_size",
        "shipping_fee",
        "line_subtotal",
        "line_shipping",
        "created_at",
      ].join(","),
    )
    .eq("order_id", orderRow.id)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (itemError) {
    return { ok: false, message: itemError.message || "Unable to load the receipt items.", receipt: null };
  }

  return {
    ok: true,
    receipt: mapPaymentReceipt(paymentRow, orderRow, Array.isArray(itemRows) ? itemRows : []),
  };
}

export { getPaymentMethodLabel, getMobileNetworkLabel, normalizePaymentMethod, getPaymentStatusLabel, getPaymentStatusTone };
