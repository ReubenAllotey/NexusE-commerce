import test from "node:test";
import assert from "node:assert/strict";
import {
  convertCnyToGhs,
  fetchCnyGhsRate,
  getActiveRate,
  isLiveRateFresh,
  normalizeExchangeRate,
} from "./services/exchangeRateService.js";

test("exchange-rate service converts CNY to rounded GHS", () => {
  assert.equal(convertCnyToGhs(100, 0.16), 16);
  assert.equal(convertCnyToGhs(0.1, 0.16), 0.02);
  assert.equal(convertCnyToGhs(19.99, 1.6789), 33.56);
  assert.equal(normalizeExchangeRate(0), null);
});

test("manual pricing remains available without a live provider response", () => {
  assert.deepEqual(getActiveRate({ activePricingMode: "manual", manualRate: 0.16 }), {
    ok: true,
    rate: 0.16,
    source: "manual",
  });
});

test("initial settings with null manual and live rates fail closed without throwing", () => {
  assert.deepEqual(getActiveRate({ activePricingMode: "manual", manualRate: null, liveRate: null }), {
    ok: false,
    message: "A manual exchange rate has not been configured.",
  });
  assert.equal(isLiveRateFresh({ activePricingMode: "live", manualRate: null, liveRate: null }), false);
});

test("live pricing fails closed when the rate is stale", () => {
  const old = new Date("2026-11-23T00:00:00.000Z").getTime();
  const now = new Date("2026-11-25T00:00:01.000Z").getTime();
  assert.equal(isLiveRateFresh({ liveRate: 0.16, providerDataTimestamp: new Date(old).toISOString(), lastSuccessfulFetchAt: new Date(now).toISOString() }, now), false);
  assert.equal(getActiveRate({ activePricingMode: "live", liveRate: 0.16, providerDataTimestamp: new Date(old).toISOString(), lastSuccessfulFetchAt: new Date(now).toISOString() }, now).ok, false);
  assert.equal(isLiveRateFresh({ liveRate: 0.16, providerDataTimestamp: new Date(now - 60_000).toISOString(), lastSuccessfulFetchAt: new Date(old).toISOString() }, now), true);
});

test("provider response is validated without exposing credentials", async () => {
  const result = await fetchCnyGhsRate({
    apiKey: "synthetic-key",
    fetchImpl: async (url) => {
      assert.match(url, /exchangerate-api\.com\/v6\/synthetic-key\/latest\/CNY$/);
      return { ok: true, json: async () => ({ result: "success", conversion_rates: { GHS: 0.16 } }) };
    },
  });
  assert.equal(result.rate, 0.16);
  assert.equal(result.provider, "ExchangeRate-API");
  assert.equal(result.providerNextUpdateAt, null);
});
