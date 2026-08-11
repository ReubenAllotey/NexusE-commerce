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

export function verifyPaystackTransaction(reference, { accessToken = "" } = {}) {
  return requestJson(`/api/paystack/verify/${encodeURIComponent(String(reference ?? "").trim())}`, {
    headers: accessToken
      ? {
          Authorization: `Bearer ${accessToken}`,
        }
      : undefined,
  });
}
