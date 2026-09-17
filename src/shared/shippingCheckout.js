import { resolveProductPrice } from "../pages/Products/productData";

export const SHIPPING_PAYMENT_MODES = Object.freeze({
  PAY_NOW: "pay_now",
  PAY_LATER: "pay_later",
});

export function normalizeShippingPaymentMode(value) {
  return value === SHIPPING_PAYMENT_MODES.PAY_NOW || value === SHIPPING_PAYMENT_MODES.PAY_LATER
    ? value
    : SHIPPING_PAYMENT_MODES.PAY_LATER;
}

function normalizeShippingStatus(product = {}, item = {}) {
  const status = String(
    product.shippingFeeStatus ?? product.shipping_fee_status ?? item.shippingFeeStatus ?? item.shipping_fee_status ?? "pending",
  ).trim().toLowerCase();

  return status === "ready" && (item.shippingFee ?? item.shipping_fee ?? product.shippingFee ?? product.shipping_fee) != null
    ? "ready"
    : "pending";
}

export function resolveShippingLine(product = {}, item = {}) {
  const quantity = Math.max(Number(item.quantity) || 1, 1);
  const shippingFeeStatus = normalizeShippingStatus(product, item);
  const rawFee = product.shippingFee ?? product.shipping_fee ?? item.shippingFee ?? item.shipping_fee;
  const shippingFee = shippingFeeStatus === "ready" && rawFee != null ? Math.max(Number(rawFee) || 0, 0) : null;
  const unitPrice = resolveProductPrice(
    product,
    item.selectedOptions ?? item.selected_options ?? item.variant?.options ?? [],
  );
  const lineSubtotal = unitPrice * quantity;
  const lineShipping = shippingFeeStatus === "ready" ? (shippingFee ?? 0) * quantity : 0;

  return {
    quantity,
    unitPrice,
    lineSubtotal,
    shippingFee,
    shippingFeeStatus,
    lineShipping,
    hasPendingShipping: shippingFeeStatus === "pending",
  };
}

export function calculateShippingCheckoutSummary(rows = [], preference = SHIPPING_PAYMENT_MODES.PAY_LATER) {
  const normalizedPreference = normalizeShippingPaymentMode(preference);
  const productSubtotal = rows.reduce((sum, row) => sum + (Number(row.lineSubtotal) || 0), 0);
  const knownShippingTotal = rows.reduce((sum, row) => sum + (Number(row.lineShipping) || 0), 0);
  const hasPendingShipping = rows.some((row) => row.shippingFeeStatus === "pending" || row.hasPendingShipping);
  const hasKnownPositiveShipping = knownShippingTotal > 0;
  const hasOnlyFreeShipping = !hasPendingShipping && !hasKnownPositiveShipping;
  const amountPayableNow = productSubtotal + (normalizedPreference === SHIPPING_PAYMENT_MODES.PAY_NOW ? knownShippingTotal : 0);

  return {
    productSubtotal,
    subtotal: productSubtotal,
    knownShippingTotal,
    shippingTotal: knownShippingTotal,
    hasPendingShipping,
    hasKnownPositiveShipping,
    hasOnlyFreeShipping,
    knownCommercialTotal: productSubtotal + knownShippingTotal,
    amountPayableNow,
    shippingDueLater: normalizedPreference === SHIPPING_PAYMENT_MODES.PAY_LATER ? knownShippingTotal : 0,
    shippingPaymentPreference: normalizedPreference,
    totalPrice: amountPayableNow,
  };
}

export function getDefaultShippingPaymentMode(summary = {}) {
  if (Number(summary.knownShippingTotal) > 0) {
    return SHIPPING_PAYMENT_MODES.PAY_NOW;
  }

  return SHIPPING_PAYMENT_MODES.PAY_LATER;
}

export function canPayShippingNow(summary = {}) {
  return Number(summary.knownShippingTotal) > 0;
}

export function getShippingPaymentPreferenceStorageKey(ownerKey = "guest") {
  return `nexus-shipping-payment-preference:${String(ownerKey || "guest").trim() || "guest"}`;
}

export function saveShippingPaymentPreference(preference, ownerKey = "guest") {
  if (typeof window !== "undefined") {
    window.sessionStorage.setItem(
      getShippingPaymentPreferenceStorageKey(ownerKey),
      normalizeShippingPaymentMode(preference),
    );
  }
}

export function loadShippingPaymentPreference(ownerKey = "guest") {
  if (typeof window === "undefined") {
    return null;
  }

  const value = window.sessionStorage.getItem(getShippingPaymentPreferenceStorageKey(ownerKey));
  return value === SHIPPING_PAYMENT_MODES.PAY_NOW || value === SHIPPING_PAYMENT_MODES.PAY_LATER ? value : null;
}
