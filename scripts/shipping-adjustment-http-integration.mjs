import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const baseUrl = process.env.BACKEND_URL || "http://127.0.0.1:8787";
const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.SUPABASE_ANON_KEY;
const workerSecret = process.env.EMAIL_QUEUE_WORKER_SECRET;
const adjustmentId = "71000000-0000-4000-8000-000000000070";

assert.ok(supabaseUrl && serviceRoleKey && anonKey && workerSecret, "Synthetic Supabase configuration is incomplete.");

const adminClient = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
const authClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
const password = process.env.CI_TEST_PASSWORD;

async function signIn(email) {
  const { data, error } = await authClient.auth.signInWithPassword({ email, password });
  if (error || !data.session?.access_token) throw error || new Error("Synthetic admin sign-in failed.");
  return data.session.access_token;
}

async function request(path, { method = "GET", token, body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

const adminToken = await signIn(process.env.CI_ADMIN_EMAIL);

const unauthenticated = await request(`/api/admin/shipping-fee-adjustment/notifications/preview?adjustmentId=${adjustmentId}`);
assert.equal(unauthenticated.response.status, 401);
const nonAdmin = await request(`/api/admin/shipping-fee-adjustment/notifications/preview?adjustmentId=${adjustmentId}`, { token: await signIn(process.env.CI_REGISTERED_EMAIL) });
assert.equal(nonAdmin.response.status, 403);

const { data: intents, error: intentError } = await adminClient
  .from("shipping_fee_adjustment_notification_intents")
  .select("id,order_id,additional_due,status,notification_id")
  .eq("adjustment_id", adjustmentId)
  .order("created_at");
if (intentError) throw intentError;
assert.equal(intents.length, 12);
assert.equal(intents.reduce((sum, intent) => sum + Number(intent.additional_due || 0), 0).toFixed(2), "0.57");
const { data: syntheticOrders, error: orderError } = await adminClient
  .from("orders")
  .select("id,user_id")
  .in("id", intents.map((intent) => intent.order_id));
if (orderError) throw orderError;
assert.equal(syntheticOrders.filter((order) => order.user_id).length, 9);
assert.equal(syntheticOrders.filter((order) => !order.user_id).length, 3);

const preview = await request(`/api/admin/shipping-fee-adjustment/notifications/preview?adjustmentId=${adjustmentId}`, { token: adminToken });
assert.equal(preview.response.status, 200);
assert.equal(preview.payload.intents?.length, 12);

const worker = await request("/internal/email-queue/worker", {
  method: "POST",
  token: workerSecret,
});
assert.equal(worker.response.status, 200);
assert.equal(Number(worker.payload.adjustmentRecovery), 12);

const recovered = await request("/api/admin/shipping-fee-adjustment/notifications/recover", {
  method: "POST",
  token: adminToken,
  body: { adjustmentId },
});
assert.equal(recovered.response.status, 200);
assert.equal(recovered.payload.results?.length, 12);

const repeated = await request("/api/admin/shipping-fee-adjustment/notifications/recover", {
  method: "POST",
  token: adminToken,
  body: { adjustmentId },
});
assert.equal(repeated.response.status, 200);

const { data: adjustmentNotifications, error: notificationError } = await adminClient
  .from("notifications")
  .select("id,source_key")
  .eq("source_type", "payment_status")
  .like("source_key", `shipping-fee-adjustment:${adjustmentId}:%`);
if (notificationError) throw notificationError;
assert.equal(adjustmentNotifications.length, 12);
const notificationIds = adjustmentNotifications.map((notification) => notification.id);
const { count: deliveryCount, error: deliveryCountError } = await adminClient
  .from("notification_email_deliveries")
  .select("id", { count: "exact", head: true })
  .in("notification_id", notificationIds);
if (deliveryCountError) throw deliveryCountError;
assert.equal(deliveryCount, 12);
assert.equal(new Set(adjustmentNotifications.map((notification) => notification.source_key)).size, 12);

const { data: deliveries, error: deliveryError } = await adminClient
  .from("notification_email_deliveries")
  .select("id,status,provider,provider_message_id,notification_id")
  .in("notification_id", notificationIds);
if (deliveryError) throw deliveryError;
assert.equal(deliveries.length, 12);
assert.ok(deliveries.every((delivery) => delivery.status === "sent"));
assert.ok(deliveries.every((delivery) => delivery.provider === "brevo" && delivery.provider_message_id));

const bulkPreview = await request("/api/admin/shipping-payment-notices/bulk", {
  method: "POST",
  token: adminToken,
  body: { action: "preview", mode: "initial" },
});
assert.equal(bulkPreview.response.status, 200);
const syntheticOrderIds = new Set(intents.map((intent) => intent.order_id));
assert.equal((bulkPreview.payload.orders || []).filter((order) => syntheticOrderIds.has(order.id)).length, 0);

const ordinaryConflict = await request("/api/admin/shipping-payment-notice", {
  method: "POST",
  token: adminToken,
  body: { orderId: intents[0].order_id, mode: "initial" },
});
assert.ok([409, 422].includes(ordinaryConflict.response.status));

console.log(JSON.stringify({
  syntheticOrders: 12,
  registeredOrders: 9,
  guestOrders: 3,
  expectedOutstanding: "0.57",
  recoveryResults: recovered.payload.results?.length || 0,
  notificationCount: adjustmentNotifications.length,
  deliveryCount,
  workerStatus: worker.response.status,
  automaticRecovery: worker.payload.adjustmentRecovery || 0,
  workerProcessed: worker.payload.processed || 0,
  bulkPreviewStatus: bulkPreview.response.status,
  ordinaryConflictStatus: ordinaryConflict.response.status,
}, null, 2));
