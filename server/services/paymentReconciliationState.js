function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function validateReconciliationState(balanceNotice, initialOrder = {}) {
  if (!balanceNotice?.ok || !balanceNotice.order || !balanceNotice.accounting) {
    return {
      ok: false,
      code: "missing_state",
      message: "The reconciled payment state could not be reloaded.",
    };
  }

  const expectedPaymentStatus = Number(balanceNotice.accounting.outstanding) <= 0 ? "paid" : "pending";
  const persistedPaymentStatus = normalize(balanceNotice.order.payment_status);
  if (persistedPaymentStatus !== expectedPaymentStatus) {
    return {
      ok: false,
      code: "payment_status_mismatch",
      message: "The persisted order payment status did not match its verified balance.",
      expectedPaymentStatus,
      persistedPaymentStatus,
    };
  }

  const initialShippingMode = normalize(initialOrder.shippingPaymentMode ?? initialOrder.shipping_payment_mode);
  const initialShippingStatus = normalize(initialOrder.shippingPaymentStatus ?? initialOrder.shipping_payment_status);
  const persistedShippingStatus = normalize(balanceNotice.order.shipping_payment_status);
  if (initialShippingMode === "pay_later"
    && initialShippingStatus === "outstanding"
    && persistedShippingStatus !== "outstanding") {
    return {
      ok: false,
      code: "shipping_status_mismatch",
      message: "The deferred shipping payment status changed unexpectedly.",
      expectedShippingStatus: "outstanding",
      persistedShippingStatus,
    };
  }

  return {
    ok: true,
    expectedPaymentStatus,
    persistedPaymentStatus,
    persistedShippingStatus,
  };
}
