import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverSource = fs.readFileSync(path.join(root, "server.js"), "utf8");
const migrationSource = fs.readFileSync(
  path.join(root, "supabase/migrations/20261124_0062_repeated_shipping_payment_notices.sql"),
  "utf8",
);

test("shipping reminder resends use a dedicated audited RPC and preserve the original key", () => {
  assert.match(serverSource, /create_admin_shipping_payment_reminder/);
  assert.match(serverSource, /mode: noticeMode/);
  assert.match(serverSource, /bulkJobId: job\.id/);
  assert.match(serverSource, /bulkJobLockToken: job\.lock_token/);
  assert.match(serverSource, /bulkJobItemLockToken: item\.lock_token/);
  assert.match(migrationSource, /shipping-payment-request:' \|\| v_order\.id::text/);
  assert.match(migrationSource, /:reminder:' \|\| v_notification_id::text/);
  assert.match(migrationSource, /shipping_payment_reminder_audit/);
});

test("shipping reminder cooldown is based on sent_at and supports audited overrides", () => {
  assert.match(migrationSource, /v_latest_sent_at/);
  assert.match(migrationSource, /d\.last_attempt_at, d\.updated_at, d\.last_error/);
  assert.match(migrationSource, /max\(d\.sent_at\) filter \(where d\.status = 'sent'\)/);
  assert.match(migrationSource, /interval '48 hours'/);
  assert.match(migrationSource, /clock_timestamp\(\) < v_cooldown_until/);
  assert.match(migrationSource, /An override reason is required/);
  assert.match(migrationSource, /override_reason/);
});

test("bulk reminder creation is fenced and idempotent per leased item", () => {
  assert.match(migrationSource, /shipping_payment_reminder_audit_item_unique_idx/);
  assert.match(migrationSource, /where bulk_job_item_id is not null/);
  assert.match(migrationSource, /p_bulk_job_lock_token uuid/);
  assert.match(migrationSource, /p_bulk_job_item_lock_token uuid/);
  assert.match(migrationSource, /to_regprocedure\('public\.create_admin_shipping_payment_reminder/);
  assert.match(migrationSource, /revoke all on function public\.create_admin_shipping_payment_reminder\(uuid, uuid, text, boolean, text, text, text, uuid, uuid, uuid, uuid\)/);
  assert.match(migrationSource, /v_item\.order_id <> p_order_id/);
  assert.match(migrationSource, /v_item\.status <> 'processing'/);
  assert.match(migrationSource, /v_job\.lock_token <> p_bulk_job_lock_token/);
  assert.match(migrationSource, /v_item\.lock_token <> p_bulk_job_item_lock_token/);
  assert.match(migrationSource, /v_existing_audit\.notification_id/);
  assert.match(migrationSource, /'already_created'/);
  assert.match(migrationSource, /d\.status in \('pending', 'processing'\)/);
});

test("bulk reminder locks follow the shipping payment order and fence stale leases", () => {
  assert.match(migrationSource, /pg_advisory_xact_lock\(pg_catalog\.hashtextextended\(p_order_id::text \|\| ':shipping-payment'/);
  assert.match(migrationSource, /v_job\.locked_at <= clock_timestamp\(\) - interval '300 seconds'/);
  assert.match(migrationSource, /v_item\.locked_at <= clock_timestamp\(\) - interval '300 seconds'/);
  assert.match(migrationSource, /v_job\.notice_mode <> v_mode/);
  assert.match(migrationSource, /v_job\.override_reason/);
});

test("initial and resend modes fail closed on delivery state and use safe recipient fallback", () => {
  assert.match(migrationSource, /'already_notified'/);
  assert.match(migrationSource, /'manual_review'/);
  assert.match(migrationSource, /'missing_delivery'/);
  assert.match(migrationSource, /'unknown_delivery'/);
  assert.match(migrationSource, /'invalid_sent_timestamp'/);
  assert.match(migrationSource, /'retry_timestamp_missing'/);
  assert.match(migrationSource, /'retry_cooldown'/);
  assert.match(migrationSource, /coalesce\(v_order\.customer_email, ''\)/);
  assert.match(migrationSource, /coalesce\(v_order\.guest_email, ''\)/);
  assert.match(migrationSource, /v_mode = 'initial'/);
  assert.match(migrationSource, /v_existing\.sent_at/);
});

test("pending shipping items remain ineligible even with zero or null amounts", () => {
  assert.equal(
    (migrationSource.match(/lower\(coalesce\(i\.shipping_fee_status, ''\)\) = 'pending'\)/g) || []).length,
    2,
  );
  assert.doesNotMatch(
    migrationSource,
    /lower\(coalesce\(i\.shipping_fee_status, ''\)\) = 'pending'\s+and\s+greatest\(coalesce\(i\.line_shipping, 0\), 0\) > 0/,
  );

  const accountingSource = serverSource.slice(
    serverSource.indexOf("function getServerShippingAccounting"),
    serverSource.indexOf("async function loadShippingPaymentDetails"),
  );
  assert.match(accountingSource, /hasPendingShipping \|\|= feeStatus === "pending"/);
  assert.match(accountingSource, /const status = hasPendingShipping\s+\? "pending"/);
  assert.match(
    fs.readFileSync(path.join(root, "server/services/shippingNoticeEligibility.js"), "utf8"),
    /accounting\?\.hasPendingShipping === true/,
  );
});

test("shipping retries use a transactionally fenced advisory-lock RPC", () => {
  assert.match(serverSource, /retry_shipping_payment_notice_delivery/);
  assert.match(serverSource, /shippingOrderId: order\.id/);
  assert.match(migrationSource, /create or replace function public\.retry_shipping_payment_notice_delivery/);
  assert.match(migrationSource, /v_order_id::text \|\| ':shipping-payment'/);
  assert.match(migrationSource, /from public\.notification_email_deliveries d\n  where d\.notification_id = p_notification_id\n  for update/);
  assert.match(migrationSource, /grant execute on function public\.retry_shipping_payment_notice_delivery\(uuid\)\n  to service_role/);
});

test("shipping reminder action URLs are order-bound payment links", () => {
  assert.match(migrationSource, /The shipping reminder action URL is invalid/);
  assert.match(migrationSource, /purpose=shipping-balance&orderId=/);
  assert.match(migrationSource, /p_app_origin text/);
  assert.match(migrationSource, /split_part\(p_action_url, '\/payment\?', 1\) <> p_app_origin/);
  assert.match(serverSource, /buildShippingPaymentReminderUrl\(order\.id\)/);
  assert.match(serverSource, /isTrustedShippingPaymentUrl\(actionUrl, order\.id\)/);
  assert.match(serverSource, /getConfiguredApplicationOrigins/);
  assert.match(serverSource, /parsed\.protocol === "https:"/);
});

test("shipping retries reject active and superseding deliveries", () => {
  assert.match(migrationSource, /d\.status in \('pending', 'processing'\)/);
  assert.match(migrationSource, /d\.sent_at is not null/);
  assert.match(migrationSource, /n\.created_at > v_notification_created_at/);
  assert.match(migrationSource, /n\.created_at = v_notification_created_at and n\.id > p_notification_id/);
  assert.match(migrationSource, /'active_delivery'/);
  assert.match(migrationSource, /'superseded'/);
});

test("shipping reminder RPC preserves authorization and atomic queue creation", () => {
  assert.match(migrationSource, /security definer/);
  assert.match(migrationSource, /set search_path = ''/);
  assert.match(migrationSource, /grant execute on function public\.create_admin_shipping_payment_reminder/);
  assert.match(migrationSource, /Only active administrators/);
  assert.match(migrationSource, /for update/);
  assert.match(migrationSource, /notification_email_deliveries/);
  assert.match(migrationSource, /insert into public\.shipping_payment_reminder_audit/);
});

test("email template states that shipping links expire after 48 hours", () => {
  const template = fs.readFileSync(path.join(root, "server/services/shipmentNotificationEmail.js"), "utf8");
  assert.match(template, /valid for 48 hours/);
  assert.match(template, /request a new payment link/);
});
