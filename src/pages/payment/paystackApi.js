async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
    ...options,
  });

  const body = await readJson(response);

  if (!response.ok || body?.ok === false || body?.status === false) {
    throw new Error(body?.error || body?.message || "Paystack request failed.");
  }

  return body;
}

export function initializePaystackCheckout(payload, { accessToken = "" } = {}) {
  return requestJson("/api/paystack/initialize", {
    method: "POST",
    headers: accessToken
      ? {
          Authorization: `Bearer ${accessToken}`,
        }
      : undefined,
    body: JSON.stringify(payload ?? {}),
  });
}

export function loadOrderBalancePaymentContext(orderId, paymentToken) {
  const normalizedOrderId = String(orderId ?? "").trim();
  const normalizedToken = String(paymentToken ?? "").trim();

  return requestJson(`/api/payments/order-balance?orderId=${encodeURIComponent(normalizedOrderId)}`, {
    headers: normalizedToken
      ? { "X-Payment-Reminder-Token": normalizedToken }
      : undefined,
  });
}

export function loadShippingBalancePaymentContext(orderId, paymentToken, accessToken = "") {
  const normalizedOrderId = String(orderId ?? "").trim();
  const normalizedToken = String(paymentToken ?? "").trim();

  return requestJson(`/api/payments/shipping-balance?orderId=${encodeURIComponent(normalizedOrderId)}`, {
    headers: {
      ...(normalizedToken ? { "X-Shipping-Payment-Token": normalizedToken } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
  });
}

export function verifyPaystackTransaction(reference, { accessToken = "", guestAccessToken = "", paymentReminderToken = "", shippingPaymentToken = "" } = {}) {
  return requestJson(`/api/paystack/verify/${encodeURIComponent(String(reference ?? "").trim())}`, {
    headers: {
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(guestAccessToken ? { "X-Guest-Checkout-Token": guestAccessToken } : {}),
      ...(paymentReminderToken ? { "X-Payment-Reminder-Token": paymentReminderToken } : {}),
      ...(shippingPaymentToken ? { "X-Shipping-Payment-Token": shippingPaymentToken } : {}),
    },
  });
}
