function readItemValue(item, camelName, snakeName) {
  return item?.[camelName] ?? item?.[snakeName];
}

export function getShippingAccounting(order = {}) {
  const items = Array.isArray(order?.items) ? order.items : [];
  let knownShipping = 0;
  let paidShipping = 0;
  let outstandingShipping = 0;
  let hasPendingShipping = false;

  for (const item of items) {
    const lineShipping = Math.max(Number(readItemValue(item, "lineShipping", "line_shipping")) || 0, 0);
    const paidAmount = Math.min(
      Math.max(Number(readItemValue(item, "shippingPaidAmount", "shipping_paid_amount")) || 0, 0),
      lineShipping,
    );
    const feeStatus = String(readItemValue(item, "shippingFeeStatus", "shipping_fee_status") ?? "")
      .trim()
      .toLowerCase();

    knownShipping += lineShipping;
    paidShipping += paidAmount;
    outstandingShipping += Math.max(lineShipping - paidAmount, 0);
    hasPendingShipping ||= feeStatus === "pending";
  }

  const status = hasPendingShipping && outstandingShipping <= 0
    ? "pending"
    : outstandingShipping > 0
      ? paidShipping > 0 ? "partial" : "unpaid"
      : knownShipping > 0
        ? "paid"
        : "free";

  return {
    knownShipping,
    paidShipping,
    outstandingShipping,
    hasPendingShipping,
    status,
  };
}

export function getShippingPaymentLabel(status) {
  switch (status) {
    case "unpaid":
      return "Unpaid";
    case "partial":
      return "Unpaid";
    case "pending":
      return "Pending";
    case "paid":
      return "Paid";
    default:
      return "Free";
  }
}
