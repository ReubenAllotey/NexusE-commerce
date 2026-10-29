import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migration = fs.readFileSync(
  path.join(projectRoot, "supabase", "migrations", "20261029_0050_notification_event_deduplication.sql"),
  "utf8",
);
const audit = fs.readFileSync(
  path.join(projectRoot, "supabase", "queries", "audit_notification_event_duplicates.sql"),
  "utf8",
);
const serverSource = fs.readFileSync(path.join(projectRoot, "server.js"), "utf8");
const accountSetupSource = fs.readFileSync(
  path.join(projectRoot, "server", "services", "accountSetupEmail.js"),
  "utf8",
);

test("event deduplication migration is fail-closed and preserves broadcast scoping", () => {
  assert.match(migration, /having count\(\*\) > 1/);
  assert.match(migration, /raise exception 'Notification event duplicates must be remediated/);
  assert.match(migration, /create unique index if not exists notifications_event_source_unique_idx/);
  assert.match(migration, /where source_type in \('payment_status', 'account_setup'\)/);
  assert.match(migration, /on conflict do nothing/);
  assert.match(migration, /if v_source_type in \('payment_status', 'account_setup'\)/);
  assert.match(migration, /create or replace function private\.handle_payment_notification_change/);
  assert.match(migration, /if not found or v_order\.user_id is null then/);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.notifications/i);
});

test("duplicate audit reports notification and delivery history without mutations", () => {
  assert.match(audit, /from public\.notifications as n/);
  assert.match(audit, /left join public\.notification_email_deliveries/);
  assert.match(audit, /having count\(\*\) > 1/);
  assert.doesNotMatch(audit.replace(/--.*$/gm, ""), /\b(delete|update|insert|truncate)\b/i);
});

test("guest linking accepts an existing verified system guest account but not a registered account", () => {
  assert.match(serverSource, /function getVerifiedGuestAccountId\(orderEmail, guestAccount = null\)/);
  assert.match(serverSource, /metadata\.account_type === "guest"/);
  assert.match(serverSource, /authEmail !== expectedEmail/);
  assert.match(serverSource, /const linkedUserId = getVerifiedGuestAccountId\(guestEmail, guestAccount\)/);
  assert.match(serverSource, /The payment was verified, but the guest account link is pending/);
});

test("account setup waits for profile readiness and remains idempotent by order", () => {
  assert.match(serverSource, /if \(!profile\) \{[\s\S]*?The guest account profile is not ready/);
  assert.match(serverSource, /buildGuestAccountSetupNotification\(order\)/);
  assert.match(accountSetupSource, /source_key: `account-setup:\$\{orderId\}`/);
});
