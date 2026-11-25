const MIN_RATE = 0.000001;
const MAX_RATE = 1_000_000;
const DEFAULT_MAX_LIVE_AGE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 8_000;

export function normalizeExchangeRate(value) {
  if (value === "" || value == null) return null;
  const rate = Number(value);
  return Number.isFinite(rate) && rate >= MIN_RATE && rate <= MAX_RATE ? rate : null;
}

export function roundGhs(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

export function convertCnyToGhs(cnyAmount, exchangeRate) {
  const amount = Number(cnyAmount);
  const rate = normalizeExchangeRate(exchangeRate);
  if (!Number.isFinite(amount) || amount < 0 || rate == null) return null;
  return roundGhs(amount * rate);
}

export function convertGhsToCny(ghsAmount, exchangeRate) {
  const amount = Number(ghsAmount);
  const rate = normalizeExchangeRate(exchangeRate);
  if (!Number.isFinite(amount) || amount < 0 || rate == null) return null;
  return amount / rate;
}

function timeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return { controller, timeout };
}

export async function fetchCnyGhsRate({ apiKey = "", fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const key = String(apiKey ?? "").trim();
  const endpoint = key
    ? `https://v6.exchangerate-api.com/v6/${encodeURIComponent(key)}/latest/CNY`
    : "https://open.er-api.com/v6/latest/CNY";
  const { controller, timeout } = timeoutSignal(timeoutMs);

  try {
    const response = await fetchImpl(endpoint, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    const rate = normalizeExchangeRate(body?.conversion_rates?.GHS ?? body?.rates?.GHS);
    if (!response.ok || (body?.result && body.result !== "success") || rate == null) {
      throw new Error("The exchange-rate provider returned an invalid CNY/GHS rate.");
    }

    const providerTimestamp = body?.time_last_update_unix
      ? new Date(Number(body.time_last_update_unix) * 1000).toISOString()
      : body?.time_last_update_utc || null;

    return {
      rate,
      provider: "ExchangeRate-API",
      providerTimestamp,
      providerNextUpdateAt: body?.time_next_update_unix
        ? new Date(Number(body.time_next_update_unix) * 1000).toISOString()
        : body?.time_next_update_utc || null,
      fetchedAt: new Date().toISOString(),
      attributionRequired: !key,
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("The exchange-rate provider timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function isLiveRateFresh(settings, now = Date.now(), maxAgeMs = DEFAULT_MAX_LIVE_AGE_MS) {
  const rate = normalizeExchangeRate(settings?.live_rate ?? settings?.liveRate);
  const providerDataAt = Date.parse(settings?.provider_data_timestamp ?? settings?.providerDataTimestamp ?? "");
  return rate != null && Number.isFinite(providerDataAt) && now - providerDataAt <= maxAgeMs;
}

export function getActiveRate(settings, now = Date.now(), maxAgeMs = DEFAULT_MAX_LIVE_AGE_MS) {
  const mode = String(settings?.active_pricing_mode ?? settings?.activePricingMode ?? "").toLowerCase();
  if (mode === "manual") {
    const rate = normalizeExchangeRate(settings?.manual_rate ?? settings?.manualRate);
    return rate == null ? { ok: false, message: "A manual exchange rate has not been configured." } : { ok: true, rate, source: "manual" };
  }

  if (mode === "live" && isLiveRateFresh(settings, now, maxAgeMs)) {
    return { ok: true, rate: normalizeExchangeRate(settings.live_rate ?? settings.liveRate), source: "live" };
  }

  return { ok: false, message: "The live exchange rate is unavailable or stale. Refresh it or switch to manual pricing." };
}

export const EXCHANGE_RATE_DEFAULTS = {
  maxLiveAgeMs: DEFAULT_MAX_LIVE_AGE_MS,
  timeoutMs: DEFAULT_TIMEOUT_MS,
};
