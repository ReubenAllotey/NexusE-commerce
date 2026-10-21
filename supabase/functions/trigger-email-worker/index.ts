const DEFAULT_WORKER_URL = "https://nexuse-commerce.onrender.com/internal/email-queue/worker";
const REQUEST_TIMEOUT_MS = 10_000;

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function isPendingInsert(payload: Record<string, unknown>) {
  const record = payload.record;
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return false;
  }

  const row = record as Record<string, unknown>;
  const notificationType = clean(row.notification_type);
  return (
    clean(payload.type).toUpperCase() === "INSERT" &&
    clean(payload.schema) === "public" &&
    clean(payload.table) === "notification_email_deliveries" &&
    clean(row.status) === "pending" &&
    clean(row.notification_id) !== "" &&
    clean(row.recipient_user_id) !== "" &&
    clean(row.recipient_email) !== "" &&
    ["order_status", "payment_status", "shipment_event"].includes(notificationType) &&
    Number(row.max_attempts ?? 0) > 0 &&
    Number(row.attempts ?? 0) === 0
  );
}

function constantTimeEqual(left: string, right: string) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);

  if (leftBytes.length !== rightBytes.length) {
    return false;
  }

  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return json({ ok: false, message: "Method not allowed." }, 405);
  }

  const webhookSecret = clean(Deno.env.get("EMAIL_QUEUE_WEBHOOK_SECRET"));
  const suppliedSecret = clean(request.headers.get("x-email-queue-webhook-secret"));
  if (!webhookSecret || !suppliedSecret || !constantTimeEqual(suppliedSecret, webhookSecret)) {
    return json({ ok: false, message: "Unauthorized webhook request." }, 401);
  }

  let payload: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return json({ ok: false, message: "Invalid webhook payload." }, 400);
    }
    payload = parsed as Record<string, unknown>;
  } catch {
    return json({ ok: false, message: "Invalid webhook payload." }, 400);
  }

  // The payload only wakes the worker. The Render endpoint re-reads and claims
  // due jobs from Supabase, so webhook data is never treated as send authority.
  if (!isPendingInsert(payload)) {
    return json({ ok: true, skipped: true, message: "Event was not a new pending email job." }, 202);
  }

  const workerSecret = clean(Deno.env.get("EMAIL_QUEUE_WORKER_SECRET"));
  if (!workerSecret) {
    return json({ ok: false, message: "Email worker is not configured." }, 503);
  }

  const workerUrl = clean(Deno.env.get("RENDER_EMAIL_WORKER_URL")) || DEFAULT_WORKER_URL;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(workerUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${workerSecret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ source: "supabase_database_webhook" }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return json({ ok: false, message: `Email worker returned HTTP ${response.status}.` }, 502);
    }

    return json({ ok: true, triggered: true }, 202);
  } catch (error) {
    const message = error?.name === "AbortError" ? "Email worker request timed out." : "Email worker request failed.";
    return json({ ok: false, message }, 502);
  } finally {
    clearTimeout(timeout);
  }
});
