function clean(value) {
  return String(value ?? "").trim();
}

function normalizePaymentStatus(value) {
  const status = clean(value).toLowerCase();
  return status === "success" || status === "successful" || status === "paid" ? "successful" : status;
}

export function amountToMinor(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

function paymentAmountToMinor(payment = {}) {
  const amountMinor = Number(payment.amount_minor);
  return Number.isInteger(amountMinor) && amountMinor >= 0
    ? amountMinor
    : amountToMinor(payment.amount);
}

export function getProductAmountDueMinor(order = {}) {
  if (order.amount_due_now != null && Number.isFinite(Number(order.amount_due_now))) {
    return Math.max(amountToMinor(order.amount_due_now), 0);
  }

  const totalMinor = Math.max(amountToMinor(order.total), 0);
  const shippingMinor = Math.max(amountToMinor(order.shipping_total), 0);
  const mode = clean(order.shipping_payment_mode).toLowerCase();
  const shippingStatus = clean(order.shipping_payment_status).toLowerCase();
  const shippingIsSeparate = mode === "pay_later" || shippingStatus === "outstanding" || shippingStatus === "partial";

  return Math.max(totalMinor - (shippingIsSeparate ? shippingMinor : 0), 0);
}

export function summarizePaymentAttempts(payments = [], paymentPurpose) {
  const grouped = new Map();
  for (const payment of Array.isArray(payments) ? payments : []) {
    if (clean(payment.payment_purpose).toLowerCase() !== paymentPurpose) continue;
    const key = clean(payment.provider_reference) || clean(payment.id);
    if (!key) continue;

    const existing = grouped.get(key);
    const currentSuccessful = normalizePaymentStatus(payment.status) === "successful";
    const existingSuccessful = existing && normalizePaymentStatus(existing.status) === "successful";
    if (!existing || currentSuccessful || !existingSuccessful) grouped.set(key, payment);
  }

  const uniquePayments = [...grouped.values()];
  const successful = uniquePayments.filter((payment) => normalizePaymentStatus(payment.status) === "successful");
  const pending = uniquePayments.filter((payment) => ["pending", "initialized"].includes(clean(payment.status).toLowerCase()));
  const processing = uniquePayments.filter((payment) => clean(payment.status).toLowerCase() === "processing");
  const failed = uniquePayments.filter((payment) => ["failed", "abandoned", "cancelled", "canceled"].includes(clean(payment.status).toLowerCase()));
  const latest = [...uniquePayments].sort(
    (left, right) => new Date(right.created_at ?? 0).getTime() - new Date(left.created_at ?? 0).getTime(),
  )[0] ?? null;

  return {
    successfulMinor: successful.reduce((sum, payment) => sum + paymentAmountToMinor(payment), 0),
    pendingCount: pending.length,
    processingCount: processing.length,
    failedCount: failed.length,
    lastAttempt: latest
      ? {
          status: normalizePaymentStatus(latest.status) || clean(latest.status).toLowerCase() || "unknown",
          createdAt: latest.created_at ?? null,
          paidAt: latest.paid_at ?? null,
        }
      : null,
  };
}

export function buildAdminPaymentSummary(order = {}, payments = [], items = []) {
  const orderAttempts = summarizePaymentAttempts(payments, "order");
  const shippingAttempts = summarizePaymentAttempts(payments, "shipping");
  const orderDueMinor = getProductAmountDueMinor(order);
  const outstandingOrderMinor = Math.max(orderDueMinor - orderAttempts.successfulMinor, 0);
  const productPaymentStatus = orderAttempts.successfulMinor >= orderDueMinor && orderDueMinor > 0
    ? "paid"
    : orderAttempts.successfulMinor > 0
      ? "partial"
      : orderAttempts.failedCount > 0 && orderAttempts.pendingCount === 0 && orderAttempts.processingCount === 0
        ? "failed"
        : "pending";
  const knownShippingMinor = (Array.isArray(items) ? items : []).reduce((sum, item) => sum + amountToMinor(item.line_shipping), 0);
  const allocatedShippingMinor = (Array.isArray(items) ? items : []).reduce((sum, item) => {
    const lineMinor = amountToMinor(item.line_shipping);
    return sum + Math.min(Math.max(amountToMinor(item.shipping_paid_amount), 0), lineMinor);
  }, 0);
  const hasPendingShipping = (Array.isArray(items) ? items : []).some(
    (item) => clean(item.shipping_fee_status).toLowerCase() === "pending",
  );
  const outstandingShippingMinor = Math.max(knownShippingMinor - allocatedShippingMinor, 0);
  const shippingPaymentStatus = hasPendingShipping
    ? "pending"
    : outstandingShippingMinor <= 0
      ? knownShippingMinor > 0 ? "paid" : "not_due"
      : allocatedShippingMinor > 0 ? "partial" : "unpaid";

  return {
    orderId: order.id,
    orderNumber: order.order_number,
    orderAmountDue: orderDueMinor / 100,
    verifiedOrderPayments: orderAttempts.successfulMinor / 100,
    outstandingOrderPayment: outstandingOrderMinor / 100,
    productPaymentStatus,
    pendingOrderPaymentAttempts: orderAttempts.pendingCount,
    processingOrderPaymentAttempts: orderAttempts.processingCount,
    failedOrderPaymentAttempts: orderAttempts.failedCount,
    lastOrderPaymentAttempt: orderAttempts.lastAttempt,
    shippingAmountDue: knownShippingMinor / 100,
    verifiedShippingPayments: shippingAttempts.successfulMinor / 100,
    allocatedShippingPayments: allocatedShippingMinor / 100,
    outstandingShippingPayment: outstandingShippingMinor / 100,
    shippingPaymentStatus,
    shippingPaymentMode: order.shipping_payment_mode ?? null,
    orderStatus: order.status,
  };
}
