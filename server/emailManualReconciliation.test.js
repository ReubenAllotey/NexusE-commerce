import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverSource = fs.readFileSync(path.join(projectRoot, "server.js"), "utf8");
const migration = fs.readFileSync(
  path.join(projectRoot, "supabase", "migrations", "20261029_0053_email_delivery_manual_reconciliation.sql"),
  "utf8",
);

function routeSource() {
  const start = serverSource.indexOf("async function handleAdminEmailDeliveryReconcile");
  const end = serverSource.indexOf("async function loadPaymentNoticeDelivery", start);
  assert.ok(start >= 0 && end > start);
  return serverSource.slice(start, end);
}

test("manual reconciliation route requires an authenticated active administrator", () => {
  const source = routeSource();
  assert.match(source, /getAuthenticatedUser\(req\)/);
  assert.match(source, /isActiveAdminProfile\(profileResult\.profile\)/);
  assert.match(source, /sendJson\(res, 401/);
  assert.match(source, /sendJson\(res, 403/);
});

test("manual reconciliation route validates delivery, decision, reason, and provider ID", () => {
  const source = routeSource();
  assert.match(source, /isUuid\(deliveryId\)/);
  assert.match(source, /\['mark_sent', 'requeue'\]\.includes\(decision\)/);
  assert.match(source, /reason\.length > 1000/);
  assert.match(source, /providerMessageId\.length > 255/);
});

test("route invokes only the protected reconciliation RPC with server-authenticated admin identity", () => {
  const source = routeSource();
  assert.match(source, /rpc\("reconcile_notification_email_delivery"/);
  assert.match(source, /p_admin_id: authResult\.user\.id/);
  assert.match(source, /p_delivery_id: deliveryId/);
  assert.match(source, /p_decision: decision/);
  assert.match(source, /p_reason: reason/);
  assert.match(source, /no email was sent/);
});

test("migration restricts reconciliation RPC execution to service_role", () => {
  assert.match(migration, /security definer/);
  assert.match(migration, /revoke all on function public\.reconcile_notification_email_delivery[\s\S]*from public, anon, authenticated, service_role/);
  assert.match(migration, /grant execute on function public\.reconcile_notification_email_delivery[\s\S]*to service_role/);
});

test("migration locks and accepts only manual-review deliveries", () => {
  assert.match(migration, /from public\.notification_email_deliveries[\s\S]*where id = p_delivery_id[\s\S]*for update/);
  assert.match(migration, /v_delivery\.status <> 'manual_review'/);
  assert.match(migration, /v_delivery\.attempts >= v_delivery\.max_attempts/);
});

test("mark-sent is non-delivering and records provider evidence plus audit identity", () => {
  assert.match(migration, /decision, provider_message_id, reason, admin_id/);
  assert.match(migration, /status = 'sent'/);
  assert.match(migration, /provider = 'brevo'/);
  assert.match(migration, /provider_message_id = coalesce/);
  assert.match(migration, /notification_email_reconciliation_events/);
});

test("requeue preserves attempts and returns the delivery to normal queue processing", () => {
  assert.match(migration, /if v_decision = 'requeue' and v_delivery\.attempts >= v_delivery\.max_attempts/);
  assert.match(migration, /status = 'pending'/);
  assert.match(migration, /next_attempt_at = now\(\)/);
  assert.doesNotMatch(migration, /attempts\s*=\s*attempts\s*\+\s*1/);
});

test("reconciliation history is protected from direct mutation", () => {
  assert.match(migration, /on delete restrict/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table public\.notification_email_reconciliation_events from public, anon, authenticated, service_role/);
});

test("normal worker claims cannot reclaim manual-review or terminal failed deliveries", () => {
  const queueMigration = fs.readFileSync(
    path.join(projectRoot, "supabase", "migrations", "20261029_0052_email_delivery_manual_review.sql"),
    "utf8",
  );
  assert.match(queueMigration, /status in \('pending', 'failed'\)/);
  assert.doesNotMatch(queueMigration, /status in \('pending', 'failed', 'manual_review'\)/);
  assert.match(queueMigration, /attempts < q\.max_attempts/);
});

test("stale processing jobs are moved to manual review rather than automatically resent", () => {
  const queueMigration = fs.readFileSync(
    path.join(projectRoot, "supabase", "migrations", "20261029_0052_email_delivery_manual_review.sql"),
    "utf8",
  );
  assert.match(queueMigration, /set status = 'manual_review'/);
  assert.match(queueMigration, /Processing lease expired; provider outcome requires manual review/);
});

test("worker exposes the database persistence failure instead of claiming certainty", () => {
  assert.match(serverSource, /Email delivery outcome is uncertain because the sent state could not be persisted/);
  assert.match(serverSource, /code: "delivery_update_failed"/);
});

test("the route is registered as a POST-only admin endpoint", () => {
  assert.match(serverSource, /pathname === "\/api\/admin\/notification-email\/reconcile" && req\.method === "POST"/);
  assert.match(serverSource, /await handleAdminEmailDeliveryReconcile\(req, res\)/);
});
