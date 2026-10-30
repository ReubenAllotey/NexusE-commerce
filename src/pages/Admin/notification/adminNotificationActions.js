function clean(value) {
  return String(value ?? "").trim();
}

function lower(value) {
  return clean(value).toLowerCase();
}

function hasAny(text, values) {
  return values.some((value) => text.includes(value));
}

function adminOrderUrl(notification, includePayment = false) {
  const orderId = clean(notification.orderId);
  if (!orderId) return "";

  const params = new URLSearchParams({ orderId });
  if (includePayment && clean(notification.paymentId)) {
    params.set("paymentId", clean(notification.paymentId));
  }
  return `/admin/orders?${params.toString()}`;
}

function adminShipmentUrl(notification) {
  const shipmentId = clean(notification.shipmentId);
  return shipmentId ? `/admin/shipment?shipmentId=${encodeURIComponent(shipmentId)}` : "";
}

function adminCustomerUrl(notification) {
  const customerId = clean(notification.userId ?? notification.customerId);
  return customerId ? `/admin/customers?customerId=${encodeURIComponent(customerId)}` : "";
}

function action(label, description, actionUrl = "") {
  return { actionLabel: label, actionDescription: description, actionUrl };
}

export function resolveAdminNotificationAction(notification = {}) {
  const sourceType = lower(notification.sourceType ?? notification.source_type);
  const sourceKey = lower(notification.sourceKey ?? notification.source_key);
  const title = lower(notification.title);
  const message = lower(notification.message);
  const text = `${title} ${message}`;
  const paymentStatus = lower(notification.paymentStatus ?? notification.payment_status);
  const hasPayment = Boolean(clean(notification.paymentId));
  const isShippingRequest = sourceKey.startsWith("shipping-payment-request:")
    || hasAny(text, ["shipping fee payment required", "shipping payment required"]);
  const isShipment = sourceType === "shipment_event"
    || sourceType === "shipment"
    || hasAny(text, ["shipment updated", "shipment status", "shipment dispatched", "shipment delivered"]);
  const isAccount = sourceKey.startsWith("account-setup:")
    || hasAny(text, ["account", "password", "profile"]);
  const isPayment = sourceType === "payment_status"
    || hasPayment
    || hasAny(text, ["payment", "paid", "paystack"]);
  const isOrder = sourceType === "order_status"
    || hasAny(text, ["order placed", "order status", "order updated"]);

  if (isShippingRequest) {
    return action("View Order", "Open the related order in the admin workspace.", adminOrderUrl(notification));
  }

  if (isPayment) {
    const isProcessing = ["pending", "processing", "initiated"].includes(paymentStatus)
      || hasAny(text, ["payment processing", "payment pending"]);
    const label = isProcessing ? "Check Payment Status" : "View Payment";
    const description = isProcessing
      ? "Review the payment status in the admin order workspace."
      : "Review the payment and related order in the admin workspace.";
    return action(label, description, hasPayment ? adminOrderUrl(notification, true) : "");
  }

  if (isShipment) {
    return action("View Shipment", "Open the related shipment in the admin workspace.", adminShipmentUrl(notification));
  }

  if (isOrder) {
    return action("View Order", "Open the related order in the admin workspace.", adminOrderUrl(notification));
  }

  if (isAccount) {
    return action("View Customer", "Open the related customer in the admin workspace.", adminCustomerUrl(notification));
  }

  return action("No action", "No authorized admin destination is available for this notification.");
}
