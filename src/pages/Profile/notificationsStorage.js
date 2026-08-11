import { supabase } from "../../lib/supabaseClient";

const NOTIFICATION_CATEGORY_ALIASES = {
  admin: "announcement",
  announcement: "announcement",
  announcements: "announcement",
  billing: "orders",
  delivery: "shipping",
  more: "more",
  notice: "announcement",
  order: "orders",
  orders: "orders",
  payment: "orders",
  payments: "orders",
  shipment: "shipping",
  shipping: "shipping",
  system: "more",
};

const NOTIFICATION_SOURCE_TYPES = new Set([
  "announcement",
  "order_status",
  "payment_status",
  "shipment_event",
]);

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeBoolean(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

export function normalizeNotificationCategory(category) {
  const key = clean(category).toLowerCase();
  return NOTIFICATION_CATEGORY_ALIASES[key] ?? "more";
}

export function getNotificationCategory(notification) {
  return normalizeNotificationCategory(
    notification?.category ?? notification?.sourceType ?? notification?.source_type,
  );
}

export function getNotificationCategoryLabel(category) {
  switch (normalizeNotificationCategory(category)) {
    case "orders":
      return "Orders";
    case "shipping":
      return "Shipping";
    case "announcement":
      return "Announcement";
    default:
      return "More";
  }
}

export function getNotificationsForUser(notifications = [], authUser = null) {
  if (!Array.isArray(notifications)) {
    return [];
  }

  if (!authUser) {
    return notifications;
  }

  const isAdmin = clean(authUser.role).toLowerCase() === "admin" && clean(authUser.status).toLowerCase() === "active";

  if (isAdmin) {
    return notifications;
  }

  return notifications.filter((notification) => {
    const ownerId = clean(notification.userId ?? notification.customerId ?? notification.user_id);
    return ownerId && ownerId === clean(authUser.id);
  });
}

function getCurrentAuthUser() {
  return supabase.auth.getUser().then(({ data, error }) => {
    if (error) {
      return { ok: false, message: error.message || "Unable to resolve the signed-in user.", user: null };
    }

    if (!data?.user) {
      return { ok: false, message: "Please sign in to continue.", user: null };
    }

    return {
      ok: true,
      user: {
        id: data.user.id,
        email: clean(data.user.email),
        name:
          clean(data.user.user_metadata?.full_name) ||
          clean(data.user.user_metadata?.name) ||
          clean(data.user.email).split("@")[0] ||
          "Customer",
        role: clean(data.user.app_metadata?.role) || "customer",
        status: "active",
      },
    };
  });
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
      id: clean(data.id),
      name: clean(data.full_name) || "Customer",
      email: clean(data.email),
      role: clean(data.role) || "customer",
      status: clean(data.status) || "active",
    },
  };
}

async function resolveActiveSessionUser(authUser = null) {
  const currentUser = authUser?.id
    ? {
        id: clean(authUser.id),
        email: clean(authUser.email),
        name: clean(authUser.name) || clean(authUser.full_name) || "Customer",
        role: clean(authUser.role) || "customer",
        status: clean(authUser.status) || "active",
      }
    : (await getCurrentAuthUser()).user;

  if (!currentUser) {
    return { ok: false, message: "Please sign in to continue.", user: null };
  }

  if (!currentUser.role || !currentUser.status || !authUser?.id) {
    const profileResult = await getCurrentProfile(currentUser.id);

    if (profileResult.ok) {
      return { ok: true, user: { ...currentUser, ...profileResult.profile } };
    }
  }

  return { ok: true, user: currentUser };
}

async function loadProfileMap(userIds = []) {
  const uniqueUserIds = [...new Set(userIds.map((id) => clean(id)).filter(Boolean))];

  if (uniqueUserIds.length === 0) {
    return new Map();
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .in("id", uniqueUserIds);

  if (error) {
    throw error;
  }

  const profileMap = new Map();

  for (const profile of Array.isArray(data) ? data : []) {
    profileMap.set(clean(profile.id), {
      name: clean(profile.full_name) || "Customer",
      email: clean(profile.email),
    });
  }

  return profileMap;
}

async function loadOrderMap(orderIds = []) {
  const uniqueOrderIds = [...new Set(orderIds.map((id) => clean(id)).filter(Boolean))];

  if (uniqueOrderIds.length === 0) {
    return new Map();
  }

  const { data, error } = await supabase
    .from("orders")
    .select("id, order_number, user_id")
    .in("id", uniqueOrderIds);

  if (error) {
    throw error;
  }

  const orderMap = new Map();

  for (const order of Array.isArray(data) ? data : []) {
    orderMap.set(clean(order.id), {
      id: clean(order.id),
      orderNumber: clean(order.order_number),
      userId: clean(order.user_id),
    });
  }

  return orderMap;
}

async function loadShipmentMap(shipmentIds = []) {
  const uniqueShipmentIds = [...new Set(shipmentIds.map((id) => clean(id)).filter(Boolean))];

  if (uniqueShipmentIds.length === 0) {
    return new Map();
  }

  const { data, error } = await supabase
    .from("shipments")
    .select("id, order_id, batch_number, current_status, current_step")
    .in("id", uniqueShipmentIds);

  if (error) {
    throw error;
  }

  const shipmentMap = new Map();

  for (const shipment of Array.isArray(data) ? data : []) {
    shipmentMap.set(clean(shipment.id), {
      id: clean(shipment.id),
      orderId: clean(shipment.order_id),
      batchNumber: clean(shipment.batch_number),
      currentStatus: clean(shipment.current_status),
      currentStep: Number(shipment.current_step) || 0,
    });
  }

  return shipmentMap;
}

async function loadPaymentMap(paymentIds = []) {
  const uniquePaymentIds = [...new Set(paymentIds.map((id) => clean(id)).filter(Boolean))];

  if (uniquePaymentIds.length === 0) {
    return new Map();
  }

  const { data, error } = await supabase
    .from("payments")
    .select("id, order_id, provider_reference, status, amount, currency, created_at")
    .in("id", uniquePaymentIds);

  if (error) {
    throw error;
  }

  const paymentMap = new Map();

  for (const payment of Array.isArray(data) ? data : []) {
    paymentMap.set(clean(payment.id), {
      id: clean(payment.id),
      orderId: clean(payment.order_id),
      providerReference: clean(payment.provider_reference),
      status: clean(payment.status),
      amount: Number(payment.amount) || 0,
      currency: clean(payment.currency) || "GHS",
      createdAt: payment.created_at,
    });
  }

  return paymentMap;
}

function buildNotificationAction(row, context = {}) {
  const actionUrl = clean(row.action_url);
  if (actionUrl) {
    return {
      actionUrl,
      actionLabel: clean(row.action_label) || "Open",
      actionDescription: clean(row.action_description),
    };
  }

  if (row.payment_id) {
    return {
      actionUrl: `/receipt/${clean(context.payment?.providerReference) || clean(row.source_key).replace(/^.*?:/, "")}`,
      actionLabel: "View receipt",
      actionDescription: "Open the payment receipt and order summary.",
    };
  }

  if (row.shipment_id) {
    return {
      actionUrl: "/profile/shipments",
      actionLabel: "View shipment",
      actionDescription: "Open shipment tracking for this order.",
    };
  }

  if (row.order_id) {
    return {
      actionUrl: "/profile/orders",
      actionLabel: "View order",
      actionDescription: "Open the order details page.",
    };
  }

  return {
    actionUrl: "",
    actionLabel: "",
    actionDescription: "",
  };
}

function mapNotificationRow(row = {}, context = {}) {
  const category = getNotificationCategory(row);
  const profile = context.profileMap?.get(clean(row.user_id)) ?? null;
  const order = context.orderMap?.get(clean(row.order_id)) ?? null;
  const shipment = context.shipmentMap?.get(clean(row.shipment_id)) ?? null;
  const payment = context.paymentMap?.get(clean(row.payment_id)) ?? null;
  const action = buildNotificationAction(row, { payment });
  const ownerId = clean(row.user_id);
  const orderId = clean(row.order_id) || clean(shipment?.orderId) || clean(payment?.orderId);

  return {
    id: clean(row.id),
    userId: ownerId,
    customerId: ownerId,
    customerName: profile?.name || context.currentUser?.name || "",
    customerEmail: profile?.email || context.currentUser?.email || "",
    category,
    title: clean(row.title),
    message: clean(row.message),
    orderId,
    orderNumber: clean(order?.orderNumber),
    shipmentId: clean(row.shipment_id),
    batchNumber: clean(shipment?.batchNumber),
    paymentId: clean(row.payment_id),
    paymentReference: clean(payment?.providerReference),
    actionUrl: action.actionUrl,
    actionLabel: action.actionLabel,
    actionDescription: action.actionDescription,
    sourceType: clean(row.source_type),
    sourceKey: clean(row.source_key),
    read: normalizeBoolean(row.is_read),
    isRead: normalizeBoolean(row.is_read),
    readAt: row.read_at ?? null,
    createdAt: row.created_at,
  };
}

async function hydrateNotificationRows(rows = [], currentUser = null) {
  const notificationRows = Array.isArray(rows) ? rows : [];

  if (notificationRows.length === 0) {
    return [];
  }

  const orderIds = new Set();
  const shipmentIds = new Set();
  const paymentIds = new Set();
  const userIds = new Set();

  for (const row of notificationRows) {
    const userId = clean(row.user_id);
    const orderId = clean(row.order_id);
    const shipmentId = clean(row.shipment_id);
    const paymentId = clean(row.payment_id);

    if (userId) {
      userIds.add(userId);
    }
    if (orderId) {
      orderIds.add(orderId);
    }
    if (shipmentId) {
      shipmentIds.add(shipmentId);
    }
    if (paymentId) {
      paymentIds.add(paymentId);
    }
  }

  const [shipmentMap, paymentMap] = await Promise.all([
    loadShipmentMap([...shipmentIds]),
    loadPaymentMap([...paymentIds]),
  ]);

  for (const shipment of shipmentMap.values()) {
    if (shipment.orderId) {
      orderIds.add(shipment.orderId);
    }
  }

  for (const payment of paymentMap.values()) {
    if (payment.orderId) {
      orderIds.add(payment.orderId);
    }
  }

  const [orderMap, profileMap] = await Promise.all([
    loadOrderMap([...orderIds]),
    loadProfileMap([...userIds]),
  ]);

  return notificationRows.map((row) =>
    mapNotificationRow(row, {
      currentUser,
      orderMap,
      profileMap,
      shipmentMap,
      paymentMap,
    }),
  );
}

function normalizeNotificationPayload(payload = {}) {
  const sourceCustomer = payload?.customer && typeof payload.customer === "object" ? payload.customer : {};
  const userId = clean(payload.userId ?? payload.user_id ?? sourceCustomer.id ?? payload.customerId ?? payload.customer_id);
  const title = clean(payload.title);
  const message = clean(payload.message);
  const category = normalizeNotificationCategory(payload.category ?? payload.notificationCategory ?? payload.type);
  const sourceTypeCandidate = clean(payload.sourceType ?? payload.source_type ?? category);
  const sourceType = NOTIFICATION_SOURCE_TYPES.has(sourceTypeCandidate) ? sourceTypeCandidate : "announcement";
  const sourceKey =
    clean(payload.sourceKey ?? payload.source_key) ||
    clean(
      [
        sourceType,
        userId || "broadcast",
        clean(payload.orderId ?? payload.order_id),
        clean(payload.shipmentId ?? payload.shipment_id),
        clean(payload.paymentId ?? payload.payment_id),
        title.toLowerCase(),
        message.toLowerCase(),
      ]
        .filter(Boolean)
        .join(":"),
    );

  return {
    userId,
    category,
    title,
    message,
    orderId: clean(payload.orderId ?? payload.order_id) || null,
    shipmentId: clean(payload.shipmentId ?? payload.shipment_id) || null,
    paymentId: clean(payload.paymentId ?? payload.payment_id) || null,
    actionUrl: clean(payload.actionUrl ?? payload.action_url) || null,
    actionLabel: clean(payload.actionLabel ?? payload.action_label) || null,
    actionDescription: clean(payload.actionDescription ?? payload.action_description) || null,
    sourceType,
    sourceKey,
    isRead: normalizeBoolean(payload.isRead ?? payload.is_read),
    readAt: payload.readAt ?? payload.read_at ?? null,
  };
}

export async function loadNotifications({ authUser = null } = {}) {
  const sessionResult = await resolveActiveSessionUser(authUser);

  if (!sessionResult.ok) {
    return { ok: false, message: sessionResult.message, notifications: [] };
  }

  const currentUser = sessionResult.user;
  const isAdmin = clean(currentUser.role).toLowerCase() === "admin" && clean(currentUser.status).toLowerCase() === "active";

  let query = supabase
    .from("notifications")
    .select(
      "id, user_id, category, title, message, order_id, shipment_id, payment_id, action_url, action_label, action_description, source_type, source_key, is_read, read_at, created_at",
    )
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });

  if (!isAdmin) {
    query = query.eq("user_id", currentUser.id);
  }

  const { data, error } = await query;

  if (error) {
    return { ok: false, message: error.message || "Unable to load notifications.", notifications: [] };
  }

  return {
    ok: true,
    notifications: await hydrateNotificationRows(Array.isArray(data) ? data : [], currentUser),
  };
}

export async function createNotification(payload = {}, { authUser = null } = {}) {
  const sessionResult = await resolveActiveSessionUser(authUser);

  if (!sessionResult.ok) {
    return { ok: false, message: sessionResult.message, notification: null };
  }

  const currentUser = sessionResult.user;
  const isAdmin = clean(currentUser.role).toLowerCase() === "admin" && clean(currentUser.status).toLowerCase() === "active";

  if (!isAdmin) {
    return {
      ok: false,
      message: "Only active administrators can create notifications.",
      notification: null,
    };
  }

  const normalized = normalizeNotificationPayload(payload);

  if (!normalized.userId) {
    return {
      ok: false,
      message: "Please choose a customer for this notification.",
      notification: null,
    };
  }

  if (!normalized.title || !normalized.message) {
    return {
      ok: false,
      message: "Please add a title and message.",
      notification: null,
    };
  }

  const { data, error } = await supabase.rpc("create_user_notification", {
    payload: {
      userId: normalized.userId,
      category: normalized.category,
      title: normalized.title,
      message: normalized.message,
      orderId: normalized.orderId,
      shipmentId: normalized.shipmentId,
      paymentId: normalized.paymentId,
      actionUrl: normalized.actionUrl,
      actionLabel: normalized.actionLabel,
      actionDescription: normalized.actionDescription,
      sourceType: normalized.sourceType,
      sourceKey: normalized.sourceKey,
      isRead: normalized.isRead,
      readAt: normalized.readAt,
    },
  });

  if (error) {
    return { ok: false, message: error.message || "Unable to create the notification.", notification: null };
  }

  const notificationRow =
    data && typeof data === "object" && !Array.isArray(data)
      ? data.notification ?? data
      : Array.isArray(data) && data.length > 0
        ? data[0]
        : null;

  if (!notificationRow) {
    return {
      ok: false,
      message: "The notification could not be created.",
      notification: null,
    };
  }

  return {
    ok: true,
    notification: mapNotificationRow(
      {
        ...notificationRow,
        user_id: normalized.userId,
        category: normalized.category,
        title: normalized.title,
        message: normalized.message,
        order_id: normalized.orderId,
        shipment_id: normalized.shipmentId,
        payment_id: normalized.paymentId,
        action_url: normalized.actionUrl,
        action_label: normalized.actionLabel,
        action_description: normalized.actionDescription,
        source_type: normalized.sourceType,
        source_key: normalized.sourceKey,
        is_read: normalizeBoolean(notificationRow.is_read ?? normalized.isRead),
        read_at: notificationRow.read_at ?? normalized.readAt,
      },
      {
        currentUser,
        profileMap: new Map([
          [
            normalized.userId,
            {
              name: clean(payload?.customer?.name ?? payload?.customer?.fullName ?? payload?.customerName) || "",
              email: clean(payload?.customer?.email ?? payload?.customerEmail) || "",
            },
          ],
        ]),
      },
    ),
  };
}

export async function markNotificationAsRead(notificationId, isRead = true, { authUser = null } = {}) {
  const sessionResult = await resolveActiveSessionUser(authUser);

  if (!sessionResult.ok) {
    return { ok: false, message: sessionResult.message, notification: null };
  }

  const normalizedNotificationId = clean(notificationId);

  if (!normalizedNotificationId) {
    return { ok: false, message: "Please choose a notification to update.", notification: null };
  }

  const { data, error } = await supabase
    .from("notifications")
    .update({
      is_read: normalizeBoolean(isRead),
    })
    .eq("id", normalizedNotificationId)
    .eq("user_id", sessionResult.user.id)
    .select(
      "id, user_id, category, title, message, order_id, shipment_id, payment_id, action_url, action_label, action_description, source_type, source_key, is_read, read_at, created_at",
    )
    .maybeSingle();

  if (error) {
    return { ok: false, message: error.message || "Unable to update the notification.", notification: null };
  }

  if (!data) {
    return { ok: false, message: "The notification could not be updated.", notification: null };
  }

  const hydrated = await hydrateNotificationRows([data], sessionResult.user);

  return {
    ok: true,
    notification: hydrated[0] ?? mapNotificationRow(data, { currentUser: sessionResult.user }),
  };
}

export async function markAllNotificationsRead({ authUser = null } = {}) {
  const sessionResult = await resolveActiveSessionUser(authUser);

  if (!sessionResult.ok) {
    return { ok: false, message: sessionResult.message, notifications: [] };
  }

  const { data, error } = await supabase
    .from("notifications")
    .update({
      is_read: true,
    })
    .eq("user_id", sessionResult.user.id)
    .eq("is_read", false)
    .select(
      "id, user_id, category, title, message, order_id, shipment_id, payment_id, action_url, action_label, action_description, source_type, source_key, is_read, read_at, created_at",
    );

  if (error) {
    return { ok: false, message: error.message || "Unable to update the notifications.", notifications: [] };
  }

  const updatedRows = Array.isArray(data) ? data : [];

  return {
    ok: true,
    notifications: await hydrateNotificationRows(updatedRows, sessionResult.user),
  };
}
