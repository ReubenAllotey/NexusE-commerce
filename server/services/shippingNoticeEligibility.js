const CANCELLED_STATUSES = new Set(["cancelled", "canceled"]);
const NOTICE_STATUSES = new Set(["unpaid", "partial"]);

function toMinorUnits(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.max(Math.round(amount * 100), 0) : 0;
}

export function evaluateShippingNoticeEligibility(order, accounting, { recipientValid = true } = {}) {
  if (!order) {
    return { eligible: false, reason: "order_not_found", message: "Order not found." };
  }

  if (CANCELLED_STATUSES.has(String(order.status ?? "").trim().toLowerCase())) {
    return { eligible: false, reason: "cancelled", message: "Cancelled orders cannot receive shipping payment notices." };
  }

  if (!recipientValid) {
    return {
      eligible: false,
      reason: "missing_recipient",
      message: "This order does not have an eligible customer email address.",
    };
  }

  const pendingShipping = accounting?.hasPendingShipping === true || accounting?.status === "pending";
  if (pendingShipping || !NOTICE_STATUSES.has(accounting?.status)) {
    const reason = pendingShipping
      ? "pending_shipping"
      : accounting?.status === "paid"
        ? "already_paid"
        : accounting?.status === "free"
          ? "no_balance"
          : "ineligible_shipping";
    const message = pendingShipping
      ? "Shipping is still being calculated for this order."
      : accounting?.status === "paid"
        ? "This shipping balance is already paid."
        : "This order has no shipping balance.";
    return { eligible: false, reason, message };
  }

  const paymentMode = String(order.shipping_payment_mode ?? "").trim().toLowerCase();
  if (paymentMode && !["pay_now", "pay_later"].includes(paymentMode)) {
    return {
      eligible: false,
      reason: "unsupported_payment_mode",
      message: "This order has an unsupported shipping payment mode.",
    };
  }

  return { eligible: true, reason: "eligible", message: "Shipping notice is eligible." };
}

export function summarizeShippingNoticeResults(results = []) {
  const rows = Array.isArray(results) ? results : [];
  const eligible = rows.filter((row) => row.eligible);
  const uniqueCustomers = new Set(eligible.map((row) => row.customerKey).filter(Boolean));
  const count = (reason) => rows.filter((row) => row.reason === reason).length;
  const totalOutstandingShipping = rows.reduce(
    (total, row) => total + toMinorUnits(row.accounting?.outstandingShipping),
    0,
  ) / 100;
  const eligibleOutstandingShipping = eligible.reduce(
    (total, row) => total + toMinorUnits(row.accounting?.outstandingShipping),
    0,
  ) / 100;

  return {
    eligibleOrders: eligible.length,
    uniqueCustomers: uniqueCustomers.size,
    totalOutstandingShipping,
    eligibleOutstandingShipping,
    skippedOrders: rows.length - eligible.length,
    eligibleResends: rows.filter((row) => row.reason === "resend_eligible").length,
    blockedByCooldown: count("cooldown"),
    blockedByDuplicateProtection: count("already_pending") + count("already_processing") + count("already_sent") + count("retryable_failed") + count("permanent_failed") + count("missing_delivery"),
    alreadyQueued: count("already_pending") + count("already_processing"),
    alreadySent: count("already_sent"),
    retryableFailed: count("retryable_failed"),
    permanentlyFailed: count("permanent_failed"),
    missingDelivery: count("missing_delivery"),
    missingRecipient: count("missing_recipient"),
    cancelled: count("cancelled"),
    alreadyPaid: count("already_paid"),
    pendingShipping: count("pending_shipping"),
    noPreviousNotice: count("no_previous_notice"),
  };
}
