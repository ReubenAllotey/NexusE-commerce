const OPEN_RATE_URL = "https://open.er-api.com/v6/latest/CNY";
const REQUEST_TIMEOUT_MS = 10_000;

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function fetchJson(url: string, init: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const data = await response.json().catch(() => null);
    return { response, data };
  } finally {
    clearTimeout(timeout);
  }
}

function constantTimeEqual(left: string, right: string) {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ ok: false, message: "Method not allowed." }, 405);
  const configuredSecret = clean(Deno.env.get("EXCHANGE_RATE_REFRESH_SECRET"));
  const suppliedSecret = clean(request.headers.get("x-exchange-rate-refresh-secret"));
  if (!configuredSecret || !suppliedSecret || !constantTimeEqual(configuredSecret, suppliedSecret)) {
    return json({ ok: false, message: "Unauthorized refresh request." }, 401);
  }

  const supabaseUrl = clean(Deno.env.get("SUPABASE_URL"));
  const serviceRoleKey = clean(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  const administratorId = clean(Deno.env.get("EXCHANGE_RATE_SYSTEM_ADMIN_ID"));
  if (!supabaseUrl || !serviceRoleKey || !administratorId) return json({ ok: false, message: "Refresh is not configured." }, 503);
  const headers = { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, "Content-Type": "application/json" };

  let settingsResult;
  try {
    settingsResult = await fetchJson(`${supabaseUrl}/rest/v1/rpc/get_exchange_rate_settings`, { method: "POST", headers, body: "{}" });
  } catch {
    return json({ ok: false, message: "Unable to read exchange-rate settings." }, 503);
  }
  const { response: settingsResponse, data: settings } = settingsResult;
  if (!settingsResponse.ok || !settings) return json({ ok: false, message: "Unable to read exchange-rate settings." }, 503);
  const nextUpdate = Date.parse(settings.provider_next_update_at || "");
  if (Number.isFinite(nextUpdate) && nextUpdate > Date.now()) return json({ ok: true, skipped: true, nextUpdateAt: settings.provider_next_update_at }, 202);

  const apiKey = clean(Deno.env.get("EXCHANGE_RATE_API_KEY"));
  const providerUrl = apiKey ? `https://v6.exchangerate-api.com/v6/${encodeURIComponent(apiKey)}/latest/CNY` : OPEN_RATE_URL;
  let claimResult;
  try {
    claimResult = await fetchJson(`${supabaseUrl}/rest/v1/rpc/claim_exchange_rate_refresh`, {
      method: "POST",
      headers,
      body: JSON.stringify({ p_lease_seconds: 300 }),
    });
  } catch {
    return json({ ok: false, message: "Unable to claim the exchange-rate refresh lease." }, 503);
  }
  const { response: claimResponse, data: leaseToken } = claimResult;
  if (!claimResponse.ok) return json({ ok: false, message: "Unable to claim the exchange-rate refresh lease." }, 503);
  if (typeof leaseToken !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(leaseToken)) {
    return json({ ok: true, skipped: true, reason: "refresh_in_progress" }, 202);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const providerResponse = await fetch(providerUrl, { headers: { Accept: "application/json" }, signal: controller.signal });
    const provider = await providerResponse.json().catch(() => null);
    const rate = Number(provider?.conversion_rates?.GHS ?? provider?.rates?.GHS);
    const baseCurrency = clean(provider?.base_code ?? provider?.base ?? "CNY").toUpperCase();
    if (!providerResponse.ok || provider?.result === "error" || baseCurrency !== "CNY" || !Number.isFinite(rate) || rate <= 0 || rate > 1_000_000) return json({ ok: false, message: "The exchange-rate provider returned an invalid rate." }, 503);
    const providerTimestamp = provider?.time_last_update_unix ? new Date(Number(provider.time_last_update_unix) * 1000).toISOString() : provider?.time_last_update_utc || null;
    const providerNextUpdateAt = provider?.time_next_update_unix ? new Date(Number(provider.time_next_update_unix) * 1000).toISOString() : provider?.time_next_update_utc || null;
    const parsedProviderTimestamp = Date.parse(providerTimestamp || "");
    const parsedNextUpdateAt = Date.parse(providerNextUpdateAt || "");
    if (!Number.isFinite(parsedProviderTimestamp) || parsedProviderTimestamp > Date.now() + 5 * 60 * 1000 || (providerNextUpdateAt && (!Number.isFinite(parsedNextUpdateAt) || parsedNextUpdateAt <= parsedProviderTimestamp))) return json({ ok: false, message: "The exchange-rate provider returned invalid timestamps." }, 503);
    const updateResult = await fetchJson(`${supabaseUrl}/rest/v1/rpc/update_exchange_rate_settings`, { method: "POST", headers, body: JSON.stringify({ p_live_rate: rate, p_live_rate_provider: "ExchangeRate-API", p_provider_data_timestamp: providerTimestamp, p_provider_next_update_at: providerNextUpdateAt, p_last_successful_fetch_at: new Date().toISOString(), p_live_rate_version: crypto.randomUUID(), p_refresh_lease_token: leaseToken, p_administrator_id: administratorId, p_change_reason: "Scheduled live-rate refresh" }) });
    const { response: updateResponse, data: updated } = updateResult;
    if (!updateResponse.ok) return json({ ok: false, message: "Exchange-rate settings could not be updated." }, 503);
    return json({ ok: true, settings: updated, attributionRequired: !apiKey }, 200);
  } catch (error) {
    return json({ ok: false, message: error?.name === "AbortError" ? "Provider request timed out." : "Provider request failed." }, 503);
  } finally {
    clearTimeout(timeout);
    try {
      const releaseResult = await fetchJson(`${supabaseUrl}/rest/v1/rpc/release_exchange_rate_refresh`, {
        method: "POST",
        headers,
        body: JSON.stringify({ p_lease_token: leaseToken }),
      });
      if (!releaseResult.response.ok || releaseResult.data !== true) {
        // The refresh result is already determined; failed release is safely observable in the lease state.
      }
    } catch {
      // Do not replace the provider/update result with a release transport error.
    }
  }
});
