import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverSource = fs.readFileSync(path.join(root, "server.js"), "utf8");
const adminSource = fs.readFileSync(path.join(root, "src/pages/Admin/AdminOrdersPage.jsx"), "utf8");
const migrationSource = fs.readFileSync(
  path.join(root, "supabase/migrations/20261026_0043_repeated_payment_reminders.sql"),
  "utf8",
);

test("repeated reminders use a dedicated atomic service-role RPC", () => {
  assert.match(migrationSource, /create or replace function public\.create_admin_payment_reminder/);
  assert.match(migrationSource, /security definer\s+set search_path = ''/);
  assert.match(migrationSource, /for update/);
  assert.match(migrationSource, /interval '24 hours'/);
  assert.match(migrationSource, /v_latest_delivery_status in \('pending', 'processing'\)/);
  assert.match(migrationSource, /select 'queued'::text/);
  assert.match(migrationSource, /gen_random_uuid\(\)/);
  assert.match(migrationSource, /grant execute on function public\.create_admin_payment_reminder\([^)]*\)\s+to service_role/);
  assert.match(migrationSource, /revoke all on function public\.create_admin_payment_reminder/);
});

test("reminder creation validates active admins, payment status, and guest recipients", () => {
  assert.match(migrationSource, /Only active administrators can create payment reminders/);
  assert.match(migrationSource, /lower\(coalesce\(p\.role, ''\)\) = 'admin'/);
  assert.match(migrationSource, /lower\(coalesce\(p\.status, ''\)\) = 'active'/);
  assert.match(migrationSource, /'cancelled', 'canceled'/);
  assert.match(migrationSource, /payment_purpose, ''\)\) = 'order'/);
  assert.match(migrationSource, /status, ''\)\) = 'successful'/);
  assert.match(migrationSource, /This order does not have an eligible customer recipient/);
});

test("reminder scope and recipient handling isolate legacy guest records", () => {
  assert.match(migrationSource, /d\.status in \('pending', 'processing'\)/);
  assert.match(migrationSource, /coalesce\(o\.customer_email, o\.guest_email\)/);
  assert.match(migrationSource, /coalesce\(v_order\.customer_email, v_order\.guest_email\)/);
  assert.match(serverSource, /customer_email \|\| order\.guest_email/);
  assert.match(serverSource, /linkedOrder\.customer_email \|\| linkedOrder\.guest_email/);
});

test("legacy reminder keys remain readable while new reminders get unique keys", () => {
  assert.match(migrationSource, /order-payment-request:' \|\| v_scope \|\| ':reminder:' \|\| v_notification_id/);
  assert.match(serverSource, /source_key\.eq\.\$\{legacySourceKey\},source_key\.like\.\$\{reminderSourcePrefix\}%/);
  assert.match(serverSource, /limit\(25\)/);
});

test("override requires a reason and records administrator audit data", () => {
  assert.match(migrationSource, /An override reason is required/);
  assert.match(migrationSource, /create table if not exists public\.payment_reminder_audit/);
  assert.match(migrationSource, /admin_id uuid not null references auth\.users\(id\)/);
  assert.match(migrationSource, /override_reason/);
  assert.match(migrationSource, /is_override/);
  assert.match(migrationSource, /created_at timestamptz/);
});

test("server passes the authenticated admin and signed action URL to the RPC", () => {
  assert.match(serverSource, /supabaseAdmin\.rpc\("create_admin_payment_reminder"/);
  assert.match(serverSource, /p_admin_id: authResult\.user\.id/);
  assert.match(serverSource, /p_override_reason: overrideReason \|\| null/);
  assert.match(serverSource, /p_action_url: paymentLink/);
  assert.match(serverSource, /buildOrderPaymentReminderUrl\(order\.id\)/);
});

test("new reminder creation never initializes Paystack or sends email directly", () => {
  const start = serverSource.indexOf('supabaseAdmin.rpc("create_admin_payment_reminder"');
  const end = serverSource.indexOf('message: email.status === "queued"', start);
  assert.ok(start >= 0 && end > start);
  const creationBlock = serverSource.slice(start, end);
  assert.doesNotMatch(creationBlock, /initializePaystack|sendOrderPaymentEmail|fetch\(/);
});

test("admin UI exposes reminder, cooldown, override, history, and terminal states", () => {
  for (const label of [
    "Send Payment Reminder",
    "Cooldown active until",
    "Override 24-hour cooldown",
    "Reminder history",
    "Reminder record created",
    "Email provider accepted the reminder.",
    "This order is cancelled and cannot receive payment reminders.",
  ]) {
    assert.match(adminSource, new RegExp(label.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")));
  }
  assert.match(adminSource, /window\.confirm\(confirmationMessage\)/);
  assert.match(adminSource, /Last reminder:/);
  assert.match(adminSource, /cooldownUntil/);
  assert.match(adminSource, /cooldownActive/);
  assert.match(adminSource, /result\?\.code === "reminder_queued"/);
  assert.match(adminSource, /result\?\.code === "reminder_cooldown"/);
  const appCss = fs.readFileSync(path.join(root, "src/App.css"), "utf8");
  assert.match(appCss, /\.admin-orders-modal__panel[\s\S]*?box-sizing: border-box/);
  assert.match(appCss, /\.admin-orders-modal__panel[\s\S]*?max-height: 90dvh/);
  assert.match(appCss, /\.admin-orders-modal__body[\s\S]*?overflow-y: auto/);
});
