import { supabase } from "../../lib/supabaseClient";

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toNullableText(value) {
  const text = clean(value);
  return text || null;
}

function readField(source = {}, camelKey, snakeKey, fallback = null) {
  if (source && Object.prototype.hasOwnProperty.call(source, camelKey)) {
    return source[camelKey];
  }

  if (source && Object.prototype.hasOwnProperty.call(source, snakeKey)) {
    return source[snakeKey];
  }

  return fallback;
}

function normalizeShippingAddressSnapshot(snapshot = {}) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return null;
  }

  return {
    id: clean(readField(snapshot, "id", "id")),
    addressLabel: clean(readField(snapshot, "addressLabel", "address_label")),
    fullName: clean(readField(snapshot, "fullName", "full_name")),
    phoneNumber: clean(readField(snapshot, "phoneNumber", "phone_number")),
    emailAddress: clean(readField(snapshot, "emailAddress", "email_address")),
    country: clean(readField(snapshot, "country", "country")),
    region: clean(readField(snapshot, "region", "region")),
    city: clean(readField(snapshot, "city", "city")),
    streetAddress: clean(readField(snapshot, "streetAddress", "street_address")),
    houseNumber: clean(readField(snapshot, "houseNumber", "house_number")),
    landmark: clean(readField(snapshot, "landmark", "landmark")),
    postalCode: clean(readField(snapshot, "postalCode", "postal_code")),
    isDefault: Boolean(readField(snapshot, "isDefault", "is_default", false)),
  };
}

function normalizeSelectedOptions(value = []) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((option) => {
      if (!option || typeof option !== "object") {
        return null;
      }

      const groupName = clean(readField(option, "groupName", "group_name"));
      const label = clean(readField(option, "label", "label") || readField(option, "value", "value"));

      if (!groupName || !label) {
        return null;
      }

      return {
        groupId: clean(readField(option, "groupId", "group_id")) || null,
        groupName,
        kind: clean(readField(option, "kind", "kind")) || "text",
        optionId: clean(readField(option, "optionId", "option_id")) || null,
        label,
        value: clean(readField(option, "value", "value")) || label,
        priceDelta: normalizeNumber(readField(option, "priceDelta", "price_delta"), 0),
        compareAtDelta:
          readField(option, "compareAtDelta", "compare_at_delta", null) == null
            ? null
            : normalizeNumber(readField(option, "compareAtDelta", "compare_at_delta"), 0),
        swatchColor: clean(readField(option, "swatchColor", "swatch_color")),
        imageUrl: clean(readField(option, "imageUrl", "image_url")),
        isDefault: Boolean(readField(option, "isDefault", "is_default", false)),
      };
    })
    .filter(Boolean);
}

function normalizeAvailabilityType(value) {
  const normalized = clean(value).toLowerCase().replace(/[\s-]+/g, "_");

  if (normalized === "preorder" || normalized === "coming_soon" || normalized === "ready_stock") {
    return normalized;
  }

  return "ready_stock";
}

function buildVariantLabel(selectedOptions = [], selectedColor = "", selectedSize = "") {
  if (Array.isArray(selectedOptions) && selectedOptions.length > 0) {
    return selectedOptions.map((option) => clean(option.label)).filter(Boolean).join(" / ");
  }

  return [clean(selectedColor), clean(selectedSize)].filter(Boolean).join(" / ");
}

function normalizeOrderItemRecord(item = {}) {
  const quantity = Math.max(Math.round(normalizeNumber(readField(item, "quantity", "quantity"), 1)), 1);
  const shippingFee = normalizeNumber(readField(item, "shippingFee", "shipping_fee"), 0);
  const selectedColor = clean(readField(item, "selectedColor", "selected_color"));
  const selectedSize = clean(readField(item, "selectedSize", "selected_size"));
  const selectedOptions = normalizeSelectedOptions(readField(item, "selectedOptions", "selected_options", []));
  const availabilityType = normalizeAvailabilityType(readField(item, "availabilityType", "availability_type"));

  return {
    key: clean(readField(item, "key", "id")) || `${clean(readField(item, "productSlug", "product_slug"))}-${clean(readField(item, "productId", "product_id"))}`,
    slug: clean(readField(item, "productSlug", "product_slug")),
    name: clean(readField(item, "productName", "product_name")) || "Unnamed product",
    brand: clean(readField(item, "brand", "brand")),
    image: clean(readField(item, "imageUrl", "image_url")),
    imageClassName: clean(readField(item, "imageClassName", "image_class_name")),
    price: normalizeNumber(readField(item, "unitPrice", "unit_price"), 0),
    quantity,
    variant: {
      color: selectedColor,
      size: selectedSize,
      label: buildVariantLabel(selectedOptions, selectedColor, selectedSize),
      options: selectedOptions,
    },
    variantKey: clean(readField(item, "variantKey", "variant_key")),
    selectedOptions,
    shippingFee,
    availabilityType,
    estimatedArrival: toNullableText(readField(item, "estimatedArrival", "estimated_arrival")),
    preorderTerms: toNullableText(readField(item, "preorderTerms", "preorder_terms")),
    lineSubtotal: normalizeNumber(readField(item, "lineSubtotal", "line_subtotal"), 0),
    lineShipping: normalizeNumber(readField(item, "lineShipping", "line_shipping"), 0),
  };
}

function mapOrderBundleToLegacyViewModel(bundle = {}, fallbackItems = []) {
  const order = bundle && typeof bundle === "object" && bundle.order ? bundle.order : bundle;
  const itemsSource =
    (bundle && typeof bundle === "object" && Array.isArray(bundle.items) && bundle.items.length > 0
      ? bundle.items
      : Array.isArray(order?.items)
        ? order.items
        : fallbackItems) ?? [];
  const shippingAddressSnapshot =
    bundle?.shippingAddress ??
    order?.shippingAddress ??
    order?.shipping_address_snapshot ??
    null;

  return {
    id: clean(readField(order, "id", "id")),
    orderNumber: clean(readField(order, "orderNumber", "order_number")),
    customerId: clean(readField(order, "customerId", "user_id")),
    customerName:
      clean(readField(order, "customerName", "customer_name")) ||
      clean(readField(order, "customer_name", "customer_name")) ||
      "Customer",
    customerEmail:
      clean(readField(order, "customerEmail", "customer_email")) ||
      clean(readField(order, "customer_email", "customer_email")),
    orderType: normalizeAvailabilityType(readField(order, "orderType", "order_type")) === "preorder"
      ? "preorder"
      : "ready_stock",
    status: clean(readField(order, "status", "status")) || "pending_payment",
    paymentStatus: clean(readField(order, "paymentStatus", "payment_status")) || "pending",
    shipmentType: clean(readField(order, "shipmentType", "shipment_type")),
    batchNumber: clean(readField(order, "batchNumber", "batch_number")),
    shippingAddressId: clean(readField(order, "shippingAddressId", "shipping_address_id")),
    shippingAddress: normalizeShippingAddressSnapshot(shippingAddressSnapshot),
    subtotal: normalizeNumber(readField(order, "subtotal", "subtotal"), 0),
    shippingTotal: normalizeNumber(readField(order, "shippingTotal", "shipping_total"), 0),
    total: normalizeNumber(readField(order, "total", "total"), 0),
    estimatedArrival: toNullableText(readField(order, "estimatedArrival", "estimated_arrival")),
    preorderTerms: toNullableText(readField(order, "preorderTerms", "preorder_terms")),
    deliveredAt: readField(order, "deliveredAt", "delivered_at", null),
    createdAt: clean(readField(order, "createdAt", "created_at")),
    updatedAt: clean(readField(order, "updatedAt", "updated_at")),
    items: itemsSource.map(normalizeOrderItemRecord),
  };
}

function mapOrderRowsToLegacyViewModels(rows = [], itemsByOrderId = new Map()) {
  return [...rows]
    .sort((left, right) => new Date(right.created_at ?? right.createdAt ?? 0) - new Date(left.created_at ?? left.createdAt ?? 0))
    .map((row) =>
      mapOrderBundleToLegacyViewModel(
        {
          order: row,
          items: itemsByOrderId.get(row.id) ?? [],
        },
      ),
    );
}

async function getCurrentAuthUser() {
  const { data, error } = await supabase.auth.getUser();

  if (error) {
    return { ok: false, message: error.message || "Unable to resolve the signed-in user." };
  }

  if (!data?.user) {
    return { ok: false, message: "Please sign in to continue." };
  }

  return { ok: true, user: data.user };
}

async function loadCurrentProfile(userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email, role, status")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    return { ok: false, message: error.message || "Unable to load the profile." };
  }

  if (!data) {
    return { ok: false, message: "The active profile could not be found." };
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

function getOrderSelect() {
  return "*";
}

function getOrderItemSelect() {
  return "*";
}

async function fetchOrderItems(orderIds = []) {
  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    return { ok: true, itemsByOrderId: new Map() };
  }

  const { data, error } = await supabase
    .from("order_items")
    .select(getOrderItemSelect())
    .in("order_id", orderIds)
    .order("created_at", { ascending: true });

  if (error) {
    return { ok: false, message: error.message || "Unable to load order items.", itemsByOrderId: new Map() };
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

  return { ok: true, itemsByOrderId };
}

export async function loadOrders({ authUser = null } = {}) {
  const resolvedUser = authUser?.id
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

  if (!resolvedUser.ok) {
    return { ok: false, message: resolvedUser.message, orders: [] };
  }

  let profile = resolvedUser.user;

  if (!authUser?.id) {
    const profileResult = await loadCurrentProfile(resolvedUser.user.id);

    if (!profileResult.ok) {
      return { ok: false, message: profileResult.message, orders: [] };
    }

    profile = profileResult.profile;
  }

  const isAdmin = profile.role === "admin" && profile.status === "active";
  let query = supabase
    .from("orders")
    .select(getOrderSelect())
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });

  if (!isAdmin) {
    query = query.eq("user_id", resolvedUser.user.id);
  }

  const { data: orderRows, error } = await query;

  if (error) {
    return { ok: false, message: error.message || "Unable to load orders.", orders: [] };
  }

  const orders = Array.isArray(orderRows) ? orderRows : [];
  const itemsResult = await fetchOrderItems(orders.map((order) => order.id));

  if (!itemsResult.ok) {
    return { ok: false, message: itemsResult.message, orders: [] };
  }

  return {
    ok: true,
    orders: mapOrderRowsToLegacyViewModels(orders, itemsResult.itemsByOrderId),
  };
}

export async function createOrderFromCart({
  shippingAddressId = "",
  batchNumber = "",
} = {}) {
  const userResult = await getCurrentAuthUser();

  if (!userResult.ok) {
    return { ok: false, message: userResult.message, order: null };
  }

  const profileResult = await loadCurrentProfile(userResult.user.id);

  if (!profileResult.ok) {
    return { ok: false, message: profileResult.message, order: null };
  }

  if (profileResult.profile.role !== "customer" || profileResult.profile.status !== "active") {
    return { ok: false, message: "Only active customer accounts can create orders.", order: null };
  }

  const payload = {
    shipping_address_id: clean(shippingAddressId),
    batch_number: clean(batchNumber),
  };

  const { data, error } = await supabase.rpc("create_order_from_cart", { payload });

  if (error) {
    return { ok: false, message: error.message || "Unable to create the order.", order: null };
  }

  const nextOrder = mapOrderBundleToLegacyViewModel(data ?? {}, []);

  return {
    ok: true,
    order: nextOrder,
    raw: data ?? null,
  };
}

export async function updateOrderStatus(orderId, status) {
  const userResult = await getCurrentAuthUser();

  if (!userResult.ok) {
    return { ok: false, message: userResult.message, order: null };
  }

  const profileResult = await loadCurrentProfile(userResult.user.id);

  if (!profileResult.ok) {
    return { ok: false, message: profileResult.message, order: null };
  }

  if (profileResult.profile.role !== "admin" || profileResult.profile.status !== "active") {
    return { ok: false, message: "Only active administrators can update order status.", order: null };
  }

  const { data, error } = await supabase.rpc("update_order_status", {
    p_order_id: clean(orderId),
    p_status: clean(status),
  });

  if (error) {
    return { ok: false, message: error.message || "Unable to update the order.", order: null };
  }

  return {
    ok: true,
    order: mapOrderBundleToLegacyViewModel(data ?? {}, []),
    raw: data ?? null,
  };
}

export function mapOrderRowToLegacyViewModel(row = {}, extras = {}) {
  return mapOrderBundleToLegacyViewModel(
    {
      order: row,
      items: extras.items ?? [],
      shippingAddress: extras.shippingAddress ?? null,
      customer: extras.customer ?? null,
    },
    extras.items ?? [],
  );
}

export function mapOrderRowsToLegacyViewModelArray(rows = [], itemsByOrderId = new Map()) {
  return mapOrderRowsToLegacyViewModels(rows, itemsByOrderId);
}

export function isDeliveredOrder(order) {
  const status = clean(order?.status).toLowerCase();
  return status === "delivered" || status === "completed";
}

export function isInTransitOrder(order) {
  const status = clean(order?.status).toLowerCase();
  return status === "processing" || status === "in_transit" || status === "shipped";
}

export function isPreorderOrder(order) {
  return clean(order?.orderType ?? order?.order_type).toLowerCase() === "preorder";
}

export function getOrderTypeLabel(order) {
  return isPreorderOrder(order) ? "Pre-Order" : "Ready Stock";
}

export function isOwnedOrder(order, authUser = null) {
  const sessionUserId = clean(authUser?.id);
  const sessionEmail = clean(authUser?.email).toLowerCase();
  const orderUserId = clean(order?.customerId ?? order?.user_id ?? order?.userId);

  if (!sessionUserId) {
    return false;
  }

  if (orderUserId) {
    return orderUserId === sessionUserId;
  }

  const orderEmail = clean(order?.customerEmail ?? order?.customer_email).toLowerCase();

  return Boolean(sessionEmail && orderEmail && orderEmail === sessionEmail);
}

export function getOrderStatusLabel(status) {
  const normalized = clean(status).toLowerCase();

  if (normalized === "preorder_received") {
    return "Pre-order Received";
  }

  if (normalized === "shipping_fee_pending") {
    return "Shipping Fee Pending";
  }

  if (normalized === "ready_for_delivery") {
    return "Ready for Delivery";
  }

  if (normalized === "arrived_in_ghana") {
    return "Arrived in Ghana";
  }

  if (normalized === "shipped") {
    return "Shipped";
  }

  if (normalized === "delivered") {
    return "Delivered";
  }

  if (normalized === "completed") {
    return "Completed";
  }

  if (normalized === "cancelled" || normalized === "canceled") {
    return "Cancelled";
  }

  if (normalized === "pending_payment") {
    return "Pending Payment";
  }

  if (normalized === "pending") {
    return "Pending";
  }

  if (normalized === "processing" || normalized === "in_transit") {
    return "Processing";
  }

  return "Processing";
}

export function markOrderDelivered(orders, orderId) {
  const deliveredAt = new Date().toISOString();

  return Array.isArray(orders)
    ? orders.map((order) =>
        order.id === orderId
          ? {
              ...order,
              status: "delivered",
              deliveredAt: order.deliveredAt ?? deliveredAt,
              updatedAt: deliveredAt,
            }
          : order,
      )
    : [];
}

export function updateOrderById(orders = [], orderId, updates = {}) {
  const updatedAt = updates.updatedAt ?? new Date().toISOString();

  return Array.isArray(orders)
    ? orders.map((order) =>
        order.id === orderId
          ? {
              ...order,
              ...updates,
              updatedAt,
              deliveredAt:
                updates.status === "delivered"
                  ? order.deliveredAt ?? updatedAt
                  : updates.status === "cancelled"
                    ? null
                    : order.deliveredAt,
            }
          : order,
      )
    : [];
}
