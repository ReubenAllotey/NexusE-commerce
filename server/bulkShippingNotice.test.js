import assert from "node:assert/strict";
import http from "node:http";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import {
  evaluateShippingNoticeEligibility,
  summarizeShippingNoticeResults,
} from "./services/shippingNoticeEligibility.js";

const serverSource = await readFile(new URL("../server.js", import.meta.url), "utf8");
const migrationSource = await readFile(
  new URL("../supabase/migrations/20261117_0059_bulk_shipping_notice_jobs.sql", import.meta.url),
  "utf8",
);
const adminOrdersSource = await readFile(
  new URL("../src/pages/Admin/AdminOrdersPage.jsx", import.meta.url),
  "utf8",
);
const actionHelperStart = adminOrdersSource.indexOf("export function getShippingNoticeActionState");
const actionHelperEnd = adminOrdersSource.indexOf("\nfunction getOrderItemCount", actionHelperStart);
const actionHelperContext = {};
vm.runInNewContext(
  `${adminOrdersSource.slice(actionHelperStart, actionHelperEnd).replace(/^export /, "")}\nthis.getShippingNoticeActionState = getShippingNoticeActionState;`,
  actionHelperContext,
);

const account = (id, email = `${id}@example.com`) => ({
  id,
  user_id: id,
  customer_email: email,
  status: "confirmed",
  shipping_payment_mode: "pay_later",
});

test("bulk eligibility preserves each order's independent outstanding balance", () => {
  const first = evaluateShippingNoticeEligibility(account("customer-a"), {
    status: "unpaid",
    outstandingShipping: 2,
  });
  const second = evaluateShippingNoticeEligibility(account("customer-b"), {
    status: "partial",
    outstandingShipping: 5,
  });

  assert.equal(first.eligible, true);
  assert.equal(second.eligible, true);
  const summary = summarizeShippingNoticeResults([
    { ...first, customerKey: "customer-a", accounting: { outstandingShipping: 2 } },
    { ...second, customerKey: "customer-b", accounting: { outstandingShipping: 5 } },
  ]);
  assert.equal(summary.eligibleOrders, 2);
  assert.equal(summary.uniqueCustomers, 2);
  assert.equal(summary.totalOutstandingShipping, 7);
});

test("bulk eligibility excludes paid, zero, pending, cancelled, and missing-recipient orders", () => {
  const cases = [
    [account("paid"), { status: "paid", outstandingShipping: 0 }, true, "already_paid"],
    [account("free"), { status: "free", outstandingShipping: 0 }, true, "no_balance"],
    [account("pending"), { status: "pending", outstandingShipping: 2 }, true, "pending_shipping"],
    [{ ...account("cancelled"), status: "cancelled" }, { status: "unpaid", outstandingShipping: 2 }, true, "cancelled"],
    [{ id: "guest", user_id: null, guest_email: "" }, { status: "unpaid", outstandingShipping: 2 }, false, "missing_recipient"],
  ];

  for (const [order, accounting, recipientValid, reason] of cases) {
    const result = evaluateShippingNoticeEligibility(order, accounting, { recipientValid });
    assert.equal(result.eligible, false);
    assert.equal(result.reason, reason);
  }
});

test("bulk eligibility rejects an invalid registered recipient even when the order has a user id", () => {
  const result = evaluateShippingNoticeEligibility(
    account("registered-without-profile"),
    { status: "unpaid", outstandingShipping: 4 },
    { recipientValid: false },
  );

  assert.equal(result.eligible, false);
  assert.equal(result.reason, "missing_recipient");
});

test("bulk summaries distinguish duplicate protection and eligible totals", () => {
  const summary = summarizeShippingNoticeResults([
    { eligible: true, customerKey: "a", accounting: { outstandingShipping: 2 } },
    { eligible: false, reason: "already_pending", accounting: { outstandingShipping: 3 } },
    { eligible: false, reason: "already_sent", accounting: { outstandingShipping: 5 } },
    { eligible: false, reason: "missing_delivery", accounting: { outstandingShipping: 1 } },
  ]);

  assert.equal(summary.totalOutstandingShipping, 11);
  assert.equal(summary.eligibleOutstandingShipping, 2);
  assert.equal(summary.eligibleOrders, 1);
  assert.equal(summary.blockedByDuplicateProtection, 3);
  assert.equal(summary.alreadyQueued, 1);
  assert.equal(summary.alreadySent, 1);
  assert.equal(summary.missingDelivery, 1);
});

test("bulk summaries expose shipping-credit coverage without changing payable totals", () => {
  const summary = summarizeShippingNoticeResults([
    {
      eligible: true,
      customerKey: "registered-customer",
      accounting: { outstandingShipping: 0.7 },
      shippingCreditApplied: 0.3,
    },
    {
      eligible: false,
      reason: "already_sent",
      customerKey: "guest@example.com",
      accounting: { outstandingShipping: 0 },
      shippingCreditIssued: 1,
    },
  ]);

  assert.equal(summary.eligibleOutstandingShipping, 0.7);
  assert.equal(summary.totalOutstandingShipping, 0.7);
  assert.equal(summary.withShippingCredit, 2);
});

test("bulk summary totals use integer pesewas for decimal GHS values", () => {
  const summary = summarizeShippingNoticeResults([
    { eligible: true, customerKey: "a", accounting: { outstandingShipping: 0.1 } },
    { eligible: true, customerKey: "b", accounting: { outstandingShipping: 0.2 } },
  ]);

  assert.equal(summary.totalOutstandingShipping, 0.3);
  assert.equal(summary.eligibleOutstandingShipping, 0.3);
});

test("bulk endpoint is admin-only, revalidates, and uses the existing queue source key", () => {
  assert.match(serverSource, /pathname === "\/api\/admin\/shipping-payment-notices\/bulk"/);
  assert.match(serverSource, /handleAdminBulkShippingPaymentNotices\(req, res\)/);
  assert.match(serverSource, /isActiveAdminProfile\(profileResult\.profile\)/);
  assert.match(serverSource, /action === "preview"/);
  assert.match(serverSource, /\[['"]preview['"], ['"]queue['"], ['"]process['"], ['"]status['"], ['"]list['"]\]/);
  assert.match(serverSource, /loadShippingPaymentDetails\(item\.order_id\)/);
  assert.match(serverSource, /claim_bulk_shipping_notice_items/);
  assert.match(serverSource, /p_limit: 25/);
  assert.match(serverSource, /shipping-payment-request:\$\{order\.id\}/);
  assert.match(serverSource, /create_admin_shipping_payment_reminder/);
  assert.match(serverSource, /mode: noticeMode/);
  assert.match(serverSource, /\.eq\("order_id", order\.id\)/);
  assert.match(serverSource, /recipient\.valid/);
  assert.match(serverSource, /No email was sent/);
  assert.match(serverSource, /startsWith\("shipping-fee-adjustment:"\)/);
  assert.match(serverSource, /action_label === "Pay Shipping Balance"/);
  assert.match(serverSource, /get_shipping_notice_credit_summary/);
  assert.match(adminOrdersSource, /Orders with shipping credit/);
  assert.match(adminOrdersSource, /recipientType/);
});

test("durable bulk migration is service-role-only and resumable", () => {
  assert.match(migrationSource, /create table if not exists public\.bulk_shipping_notice_jobs/);
  assert.match(migrationSource, /idempotency_key text not null unique/);
  assert.match(migrationSource, /create table if not exists public\.bulk_shipping_notice_job_items/);
  assert.match(migrationSource, /unique \(job_id, order_id\)/);
  assert.match(migrationSource, /for update skip locked/);
  assert.match(migrationSource, /grant execute on function public\.claim_bulk_shipping_notice_job/);
  assert.match(migrationSource, /grant execute on function public\.claim_bulk_shipping_notice_items/);
  assert.match(migrationSource, /revoke all on function public\.claim_bulk_shipping_notice_job\(uuid, integer\)/);
  assert.match(migrationSource, /alter table public\.bulk_shipping_notice_jobs enable row level security/);
});

test("bulk job completion and cursor updates are fenced by the active job lease", () => {
  assert.match(serverSource, /persist_bulk_shipping_notice_job_items/);
  assert.match(serverSource, /\.eq\("lock_token", job\.lock_token\)\s*\.select\("id"\)\s*\.maybeSingle\(\)/);
  assert.match(serverSource, /status: completedStatus \? "complete" : "partial"/);
  assert.match(serverSource, /Bulk shipping notice item lease was lost/);
  assert.match(serverSource, /assertBulkShippingNoticeJobLease\(job\)/);
  assert.doesNotMatch(serverSource, /\.update\(\{ status: "complete", updated_at: new Date\(\)\.toISOString\(\) \}\)\s*\.eq\("id", jobId\)/);
});

test("the additive claim migration caps every item claim at 25", async () => {
  const cappedMigration = await readFile(
    new URL("../supabase/migrations/20261118_0060_cap_bulk_shipping_notice_claims.sql", import.meta.url),
    "utf8",
  );
  assert.match(cappedMigration, /limit least\(greatest\(coalesce\(p_limit, 25\), 1\), 25\)/);
  assert.match(cappedMigration, /revoke all on function public\.claim_bulk_shipping_notice_items/);
  assert.match(cappedMigration, /persist_bulk_shipping_notice_job_items/);
  assert.match(cappedMigration, /where id = p_job_id\s+and lock_token = p_lock_token/);
});

test("item claims pass the active parent lock token", () => {
  assert.match(serverSource, /claim_bulk_shipping_notice_items[\s\S]*p_job_id: job\.id,[\s\S]*p_lock_token: job\.lock_token/);
});

test("migration 0061 fences item claims to an unexpired processing parent job", async () => {
  const fencedMigration = await readFile(
    new URL("../supabase/migrations/20261118_0061_fence_bulk_shipping_notice_item_claims.sql", import.meta.url),
    "utf8",
  );
  assert.match(fencedMigration, /p_lock_token uuid/);
  assert.match(fencedMigration, /from public\.bulk_shipping_notice_jobs\s+where id = p_job_id\s+for update/);
  assert.match(fencedMigration, /v_status <> 'processing'/);
  assert.match(fencedMigration, /v_lock_token <> p_lock_token/);
  assert.match(fencedMigration, /v_locked_at <= clock_timestamp\(\) - make_interval/);
  assert.match(fencedMigration, /locked_at <= clock_timestamp\(\) - make_interval/);
  assert.match(fencedMigration, /create or replace function public\.claim_bulk_shipping_notice_job/);
  assert.match(fencedMigration, /or locked_at <= clock_timestamp\(\) - make_interval/);
  assert.match(fencedMigration, /for update skip locked/);
  assert.match(fencedMigration, /limit least\(greatest\(coalesce\(p_limit, 25\), 1\), 25\)/);
  assert.match(fencedMigration, /revoke all on function public\.claim_bulk_shipping_notice_items\(uuid, integer, integer\)/);
  assert.match(fencedMigration, /grant execute on function public\.claim_bulk_shipping_notice_items\(uuid, uuid, integer, integer\)\s+to service_role/);
  assert.match(fencedMigration, /revoke all on function public\.claim_bulk_shipping_notice_items\(uuid, integer, integer\)[\s\S]*service_role/);
  assert.match(fencedMigration, /persist_bulk_shipping_notice_job_items[\s\S]*v_locked_at <= clock_timestamp\(\) - make_interval/);
  assert.match(fencedMigration, /revoke all on function public\.persist_bulk_shipping_notice_job_items\(uuid, uuid, jsonb\)[\s\S]*grant execute on function public\.persist_bulk_shipping_notice_job_items\(uuid, uuid, jsonb\)\s+to service_role/);
});

test("bulk admin UI previews all eligible orders before queueing", () => {
  assert.match(adminOrdersSource, /Send Bulk Shipping Notices/);
  assert.match(adminOrdersSource, /action: "preview"/);
  assert.match(adminOrdersSource, /action: "queue"/);
  assert.match(adminOrdersSource, /Confirm & Queue Shipping Notices/);
  assert.match(adminOrdersSource, /all eligible orders/);
});

test("shipping notice modal explains cooldowns and uses one stateful primary action", () => {
  assert.match(adminOrdersSource, /Send Shipping Payment Notice/);
  assert.match(adminOrdersSource, /Resend Shipping Payment Notice/);
  assert.match(adminOrdersSource, /48-hour resend cooldown is active/);
  assert.match(adminOrdersSource, /formatCooldownRemaining/);
  assert.match(adminOrdersSource, /Notice queued/);
  assert.match(adminOrdersSource, /shippingNoticeOverrideMissingReason/);
  assert.match(adminOrdersSource, /shippingNoticeHistoryLoading/);
  assert.match(adminOrdersSource, /getShippingNoticeActionState/);
  assert.match(adminOrdersSource, /shippingNoticeHistoryRequestRef/);
  assert.match(adminOrdersSource, /Loading authoritative shipping notice history/);
  assert.match(adminOrdersSource, /disabled=\{shippingNoticeSaving \|\| Boolean\(shippingNoticeSuccess\) \|\| shippingNoticeIneligible \|\| shippingNoticeNeedsOverride \|\| shippingNoticeOverrideMissingReason \|\| shippingNoticeSubmissionBlocked\}/);
  assert.match(adminOrdersSource, /historyResponse = await fetch\(`\/api\/admin\/shipping-payment-notice\?orderId=/);
  assert.doesNotMatch(adminOrdersSource, /onClick=\{\(\) => setShippingNoticeMode\("resend"\)\}/);
});

test("shipping notice action mode follows loaded history and fails closed during loading", () => {
  const decide = actionHelperContext.getShippingNoticeActionState;
  assert.equal(decide({ history: null, historyLoading: true }).mode, "loading");
  assert.equal(decide({ history: {}, historyLoading: false }).mode, "initial");
  assert.equal(decide({
    history: { notification: { status: "sent" }, cooldownActive: true, canResend: false },
    historyLoading: false,
  }).mode, "resend");
  assert.equal(decide({
    history: { notification: { status: "sent" }, cooldownActive: true, canResend: false },
    historyLoading: false,
  }).submissionBlocked, true);
  assert.equal(decide({
    history: { notification: { status: "sent" }, cooldownActive: true, canResend: false },
    historyLoading: false,
    override: true,
  }).missingOverrideReason, true);
  assert.equal(decide({
    history: { notification: { status: "sent" }, cooldownActive: true, canResend: false },
    historyLoading: false,
    override: true,
    overrideReason: "Customer requested an early resend",
  }).submissionBlocked, false);
  assert.equal(decide({
    history: { notification: { status: "retryable_failed" }, cooldownActive: false, canResend: false },
    historyLoading: false,
  }).retryableFailed, true);
  assert.equal(decide({
    history: { notification: { status: "sent" }, cooldownActive: false, canResend: true },
    historyLoading: false,
  }).submissionBlocked, false);
});

test("bulk HTTP routes enforce auth and execute the real preview and job creation handlers", async (t) => {
  const state = { profileRole: "admin", failOrders: false };
  const supabaseStub = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    res.setHeader("content-type", "application/json");

    if (url.pathname === "/auth/v1/user") {
      if (req.headers.authorization === "Bearer admin-token") {
        res.writeHead(200);
        res.end(JSON.stringify({ id: "admin-id", email: "admin@example.com" }));
        return;
      }
      if (req.headers.authorization === "Bearer customer-token") {
        res.writeHead(200);
        res.end(JSON.stringify({ id: "customer-id", email: "customer@example.com" }));
        return;
      }
      res.writeHead(401);
      res.end(JSON.stringify({ message: "Invalid token" }));
      return;
    }

    if (url.pathname === "/rest/v1/profiles") {
      const id = url.searchParams.get("id")?.replace("eq.", "");
      const role = id === "admin-id" ? state.profileRole : "customer";
      res.writeHead(200);
      res.end(JSON.stringify([{ id, role, status: "active", email: `${id}@example.com` }]));
      return;
    }

    if (url.pathname === "/rest/v1/orders") {
      if (state.failOrders) {
        res.writeHead(503);
        res.end(JSON.stringify({ code: "stub_failure", message: "stub failure" }));
        return;
      }
      res.writeHead(200);
      res.end(JSON.stringify([]));
      return;
    }

    if (url.pathname === "/rest/v1/bulk_shipping_notice_jobs" && req.method === "POST") {
      res.writeHead(201);
      res.end(JSON.stringify({ id: "job-id", idempotency_key: "bulk-key", status: "pending", scan_complete: false }));
      return;
    }

    if (url.pathname === "/rest/v1/rpc/claim_bulk_shipping_notice_job") {
      res.writeHead(200);
      res.end(JSON.stringify([]));
      return;
    }

    if (url.pathname === "/rest/v1/bulk_shipping_notice_jobs") {
      res.writeHead(200);
      res.end(JSON.stringify([{ id: "job-id", idempotency_key: "bulk-key", status: "pending", scan_complete: true }]));
      return;
    }

    if (url.pathname === "/rest/v1/bulk_shipping_notice_job_items") {
      res.writeHead(200);
      res.end(JSON.stringify([]));
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ message: "stub route not found" }));
  });
  await new Promise((resolve) => supabaseStub.listen(0, "127.0.0.1", resolve));
  t.after(() => supabaseStub.close());

  process.env.SUPABASE_URL = `http://127.0.0.1:${supabaseStub.address().port}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "local-test-service-role";
  process.env.PAYSTACK_SECRET_KEY = "local-test-paystack";
  process.env.NEXUS_DISABLE_LISTEN = "1";
  const { createHttpServer } = await import("../server.js");
  const app = createHttpServer();
  await new Promise((resolve) => app.listen(0, "127.0.0.1", resolve));
  t.after(() => app.close());
  const baseUrl = `http://127.0.0.1:${app.address().port}`;
  const request = (token, body) => fetch(`${baseUrl}/api/admin/shipping-payment-notices/bulk`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

  const unauthenticated = await request("", { action: "preview" });
  assert.equal(unauthenticated.status, 401);

  const nonAdmin = await request("customer-token", { action: "preview" });
  assert.equal(nonAdmin.status, 403);

  const preview = await request("admin-token", { action: "preview" });
  assert.equal(preview.status, 200);
  assert.equal((await preview.json()).ok, true);

  const queued = await request("admin-token", { action: "queue", idempotencyKey: "bulk-key" });
  assert.equal(queued.status, 200);
  assert.equal((await queued.json()).job.id, "job-id");

  const jobs = await request("admin-token", { action: "list" });
  assert.equal(jobs.status, 200);
  assert.deepEqual((await jobs.json()).jobs, []);

  state.profileRole = "customer";
  const inactiveAdmin = await request("admin-token", { action: "preview" });
  assert.equal(inactiveAdmin.status, 403);
});
