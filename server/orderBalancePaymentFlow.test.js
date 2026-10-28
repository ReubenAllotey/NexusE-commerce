import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getShippingAccounting } from "../src/shared/shippingPayment.js";

const serverSource = await readFile(new URL("../server.js", import.meta.url), "utf8");
const paymentSource = await readFile(
  new URL("../src/pages/payment/payment.jsx", import.meta.url),
  "utf8",
);
const notificationSource = await readFile(
  new URL("../src/pages/Profile/notificationsStorage.js", import.meta.url),
  "utf8",
);
const adminSource = await readFile(
  new URL("../src/pages/Admin/AdminOrdersPage.jsx", import.meta.url),
  "utf8",
);
const apiSource = await readFile(
  new URL("../src/pages/payment/paystackApi.js", import.meta.url),
  "utf8",
);
const notificationMigration = await readFile(
  new URL("../supabase/migrations/20261027_0044_guest_order_notification_guard.sql", import.meta.url),
  "utf8",
);
const shippingAttemptMigration = await readFile(
  new URL("../supabase/migrations/20261027_0045_claim_shipping_payment_attempt.sql", import.meta.url),
  "utf8",
);
const shippingLeaseMigration = await readFile(
  new URL("../supabase/migrations/20261027_0046_shipping_payment_initialization_lease.sql", import.meta.url),
  "utf8",
);
const shippingReconcileMigration = await readFile(
  new URL("../supabase/migrations/20261028_0047_reconcile_successful_shipping_payment_order.sql", import.meta.url),
  "utf8",
);
const shippingFinalizeRecoveryMigration = await readFile(
  new URL("../supabase/migrations/20261028_0048_finalize_successful_shipping_payment_allocation.sql", import.meta.url),
  "utf8",
);
const legacyShippingStatusMigration = await readFile(
  new URL("../supabase/migrations/20261028_0049_repair_legacy_shipping_fee_status.sql", import.meta.url),
  "utf8",
);
const shippingPreMigrationAudit = await readFile(
  new URL("../supabase/queries/audit_shipping_allocations_pre_migration.sql", import.meta.url),
  "utf8",
);
const legacyShippingStatusAudit = await readFile(
  new URL("../supabase/queries/audit_legacy_shipping_fee_status.sql", import.meta.url),
  "utf8",
);

test("order-balance context is token-protected and server-calculated", () => {
  assert.ok(serverSource.includes('pathname === "/api/payments/order-balance"'));
  assert.match(serverSource, /verifyOrderPaymentReminderToken\(paymentToken, orderId\)/);
  assert.match(serverSource, /loadAdminOrderPaymentNotice\(orderId\)/);
  assert.match(serverSource, /amountDueNow: notice\.accounting\.outstanding/);
  assert.match(serverSource, /notice\.accounting\.outstanding <= 0/);
  assert.match(serverSource, /providerReference = buildPaymentReference\(`\$\{notice\.order\.order_number\}-reminder`\)/);
  const orderBalanceStart = serverSource.indexOf("if (isOrderBalancePayment) {");
  const guestCheckoutStart = serverSource.indexOf("if (isGuestCheckout) {", orderBalanceStart);
  assert.ok(orderBalanceStart >= 0 && guestCheckoutStart > orderBalanceStart);
  assert.doesNotMatch(
    serverSource.slice(orderBalanceStart, guestCheckoutStart),
    /authorization_url: paymentRow\.authorization_url/,
  );
});

test("payment page hydrates empty-cart reminder links from the backend", () => {
  assert.match(apiSource, /loadOrderBalancePaymentContext/);
  assert.match(apiSource, /X-Payment-Reminder-Token/);
  assert.match(paymentSource, /loadOrderBalancePaymentContext\(paymentIntent\.orderId, paymentIntent\.token\)/);
  assert.match(paymentSource, /Number\(orderBalanceContext\?\.amountDueNow\) \|\| 0/);
  assert.match(paymentSource, /paymentIntent\?\.purpose !== "order-balance"/);
  assert.match(paymentSource, /getCallbackUrl\(paymentIntent\)/);
  assert.match(paymentSource, /callbackUrl\.searchParams\.set\("token", paymentIntent\.token\)/);
  assert.match(paymentSource, /callbackPaymentToken = clean\(query\.get\("token"\)/);
  assert.match(paymentSource, /paymentReminderToken: callbackPaymentToken \|\| session\?\.paymentReminderToken/);
  assert.match(paymentSource, /searchParams\.delete\("token"\)/);
  assert.match(paymentSource, /window\.history\.replaceState/);
  assert.doesNotMatch(paymentSource, /paymentReminderToken: paymentIntent\.token/);
  assert.match(
    paymentSource,
    /!isShippingBalancePayment && !isOrderBalancePayment && \(!shippingAddress \|\| cartRows\.length === 0\)/,
  );
  assert.doesNotMatch(
    paymentSource,
    /if \(!isShippingBalancePayment && \(!shippingAddress \|\| cartRows\.length === 0\)\)/,
  );
});

test("order-balance initialization remains separate from shipping payments", () => {
  assert.match(serverSource, /paymentPurpose: "order-balance"/);
  assert.match(serverSource, /paymentPurpose: "order"/);
  assert.match(serverSource, /paymentPurpose === "shipping-balance"/);
  assert.match(paymentSource, /paymentToken: paymentIntent\.token/);
});

test("shipping reminder links use a purpose-specific order-scoped token", () => {
  assert.match(serverSource, /createShippingPaymentReminderToken/);
  assert.match(serverSource, /verifyShippingPaymentReminderToken/);
  assert.match(serverSource, /buildShippingPaymentReminderUrl\(order\.id\)/);
  assert.match(serverSource, /action_url: shippingPaymentUrl/);
  assert.match(serverSource, /pathname === "\/api\/payments\/shipping-balance"/);
});

test("shipping payment context supports guest tokens and authenticated customers", () => {
  assert.match(serverSource, /x-shipping-payment-token/);
  assert.match(serverSource, /handleShippingBalancePaymentContext/);
  assert.match(serverSource, /loadShippingPaymentDetails\(orderId, userId\)/);
  assert.match(apiSource, /loadShippingBalancePaymentContext/);
  assert.match(apiSource, /X-Shipping-Payment-Token/);
  assert.match(paymentSource, /loadShippingBalancePaymentContext\(paymentIntent\.orderId, paymentIntent\.token\)/);
  assert.match(paymentSource, /shippingPaymentToken: paymentPurpose === "shipping-balance"/);
});

test("shipping accounting handles unpaid, partial, paid, and pending item shapes", () => {
  assert.deepEqual(getShippingAccounting({ items: [
    { lineShipping: 20, shippingPaidAmount: 0, shippingFeeStatus: "ready" },
  ] }), {
    knownShipping: 20,
    paidShipping: 0,
    outstandingShipping: 20,
    hasPendingShipping: false,
    hasUnconfirmedShipping: false,
    status: "unpaid",
  });
  assert.equal(getShippingAccounting({ items: [
    { line_shipping: 20, shipping_paid_amount: 8, shipping_fee_status: "ready" },
  ] }).status, "partial");
  assert.equal(getShippingAccounting({ items: [
    { lineShipping: 20, shippingPaidAmount: 20, shippingFeeStatus: "ready" },
  ] }).status, "paid");
  assert.equal(getShippingAccounting({ items: [
    { lineShipping: 0, shippingPaidAmount: 0, shippingFeeStatus: "pending" },
  ] }).status, "pending");
  assert.equal(getShippingAccounting({ items: [
    { lineShipping: 20, shippingPaidAmount: 0, shippingFeeStatus: "pending" },
  ] }).status, "pending");
  assert.equal(getShippingAccounting({ items: [
    { lineShipping: 20, shippingPaidAmount: 0, shippingFeeStatus: "pending" },
    { lineShipping: 20, shippingPaidAmount: 0, shippingFeeStatus: "ready" },
  ] }).hasUnconfirmedShipping, true);
});

test("shipping notices reject cancelled orders and guest orders can use guest_email", () => {
  assert.match(serverSource, /guest_email, status, shipping_payment_mode, shipping_payment_status/);
  assert.match(serverSource, /order.customer_email \|\| order.guest_email/);
  assert.match(serverSource, /isCancelledOrder\(order\)/);
  assert.match(serverSource, /shipping balance is already paid/);
});

test("shipping notices are queue-only and fail closed when delivery creation is unavailable", () => {
  const noticeStart = serverSource.indexOf("async function handleAdminShippingPaymentNotice");
  const noticeEnd = serverSource.indexOf("async function loadAdminOrderPaymentNotice", noticeStart);
  assert.ok(noticeStart >= 0 && noticeEnd > noticeStart);
  const noticeSource = serverSource.slice(noticeStart, noticeEnd);

  assert.doesNotMatch(noticeSource, /sendNotificationEmailForRow/);
  assert.doesNotMatch(noticeSource, /isEmailQueueAvailable/);
  assert.match(noticeSource, /loadPaymentNoticeDelivery\(inserted\.id\)/);
  assert.match(noticeSource, /code: "notification_queue_failed"/);
  assert.match(noticeSource, /code: "email_queue_unavailable"/);
  assert.match(noticeSource, /No email was sent/);
  assert.match(noticeSource, /notificationError\.code !== "23505"/);
});

test("successful order confirmations remain notification-triggered queue jobs", () => {
  assert.match(serverSource, /ensureOrderConfirmationNotification/);
  assert.match(serverSource, /sourceKey = `payment:\$\{payment\.id\}:status:successful`/);
  assert.match(serverSource, /private\.queue_notification_email|notification_email_deliveries/);
});

test("shipping initialization claims one active attempt and preserves verified finalization", () => {
  assert.match(serverSource, /claimShippingPaymentAttempt/);
  assert.match(serverSource, /claim_shipping_payment_attempt/);
  assert.match(shippingAttemptMigration, /pg_advisory_xact_lock/);
  assert.match(shippingAttemptMigration, /status in \('pending', 'processing'\)/);
  assert.match(shippingAttemptMigration, /grant execute .* to service_role/);
  assert.match(serverSource, /finalize_shipping_payment/);
  assert.match(serverSource, /payment_purpose === "shipping"/);
});

test("shipping success verification uses its dedicated token without changing product payment logic", () => {
  assert.match(serverSource, /x-shipping-payment-token/);
  assert.match(serverSource, /verifyShippingPaymentReminderToken\(shippingPaymentToken, paymentRow\.order_id\)/);
  assert.match(serverSource, /finalize_shipping_payment/);
  assert.match(paymentSource, /paymentPurpose === "shipping-balance"/);
  assert.match(paymentSource, /paymentStatus: serverPayment.status/);
  assert.match(paymentSource, /callbackUrl: getCallbackUrl\(paymentIntent\)/);
  assert.match(serverSource, /reconcile_successful_shipping_payment_order/);
});

test("shipping success amount display uses the shipping principal, not the order total", () => {
  assert.match(paymentSource, /paymentPurpose === "shipping-balance"\s*\? session\?\.shippingBalanceDue/);
  assert.match(paymentSource, /paymentPurpose === "shipping-balance"\s*\n\s*\? Number\(session\?\.shippingBalanceDue\)/);
  assert.doesNotMatch(paymentSource, /amountPaid: Number\(serverPayment\.amount\) \|\| summaryTotal/);
});

test("shipping receipt access is scoped to a valid guest token and remains authenticated for registered users", () => {
  assert.match(serverSource, /guestShippingAccess = paymentRow\.payment_purpose === "shipping"/);
  assert.match(serverSource, /verifyShippingPaymentReminderToken\(shippingToken, paymentRow\.order_id\)/);
  assert.match(serverSource, /X-Shipping-Payment-Token|x-shipping-payment-token/);
  assert.match(paymentSource, /X-Shipping-Payment-Token/);
});

test("successful shipping reconciliation recalculates locked item accounting without touching product payment", () => {
  assert.match(shippingReconcileMigration, /security definer/);
  assert.match(shippingReconcileMigration, /set search_path = ''/);
  assert.match(shippingReconcileMigration, /for update/);
  assert.match(shippingReconcileMigration, /shipping_payment_status = v_next_status/);
  assert.doesNotMatch(shippingReconcileMigration, /\n\s*payment_status\s*=/);
  assert.match(shippingReconcileMigration, /grant execute .* to service_role/);
});

test("shipping finalization allocates pending and stale-successful payments exactly once", () => {
  assert.match(shippingFinalizeRecoveryMigration, /create table public\.shipping_payment_allocations/);
  assert.match(shippingFinalizeRecoveryMigration, /constraint shipping_payment_allocations_payment_unique unique \(payment_id\)/);
  assert.match(shippingFinalizeRecoveryMigration, /v_existing_allocation public\.shipping_payment_allocations%rowtype/);
  assert.match(shippingFinalizeRecoveryMigration, /v_has_allocation boolean := false/);
  assert.match(shippingFinalizeRecoveryMigration, /where payment_id = v_payment\.id[\s\S]*?for update/);
  assert.match(shippingFinalizeRecoveryMigration, /if v_has_allocation then/);
  assert.match(shippingFinalizeRecoveryMigration, /Shipping payment allocation history requires manual reconciliation/);
  assert.match(shippingFinalizeRecoveryMigration, /v_remaining := v_verified_amount/);
  assert.match(shippingFinalizeRecoveryMigration, /set shipping_paid_amount = least\(/);
  assert.match(shippingFinalizeRecoveryMigration, /insert into public\.shipping_payment_allocations/);
  assert.match(shippingFinalizeRecoveryMigration, /set status = 'successful'/);
  assert.match(shippingFinalizeRecoveryMigration, /'alreadyFinalized', v_has_allocation/);
  assert.match(shippingFinalizeRecoveryMigration, /from public\.payments[\s\S]*?for update/);
  assert.match(shippingFinalizeRecoveryMigration, /from public\.orders[\s\S]*?for update/);
  assert.match(shippingFinalizeRecoveryMigration, /from public\.order_items[\s\S]*?for update/);
  assert.doesNotMatch(shippingFinalizeRecoveryMigration, /insert\s+into\s+public\.payments/i);
});

test("shipping allocation ledger binds retries and preserves product payments", () => {
  assert.match(shippingFinalizeRecoveryMigration, /payment_id uuid not null references public\.payments\(id\) on delete restrict/);
  assert.match(shippingFinalizeRecoveryMigration, /order_id uuid not null references public\.orders\(id\) on delete restrict/);
  assert.match(shippingFinalizeRecoveryMigration, /amount_minor bigint not null check \(amount_minor > 0\)/);
  assert.match(shippingFinalizeRecoveryMigration, /revoke all on table public\.shipping_payment_allocations from public, anon, authenticated, service_role/);
  assert.match(shippingFinalizeRecoveryMigration, /alter table public\.shipping_payment_allocations enable row level security/);
  assert.match(shippingFinalizeRecoveryMigration, /v_existing_allocation\.amount_minor <> v_verified_amount_minor/);
  assert.match(shippingFinalizeRecoveryMigration, /v_existing_allocation\.order_id <> v_payment\.order_id/);
  assert.match(shippingFinalizeRecoveryMigration, /v_payment\.amount_minor <> v_verified_amount_minor/);
  assert.match(shippingFinalizeRecoveryMigration, /v_verified_amount \* 100/);
  assert.match(shippingFinalizeRecoveryMigration, /v_untracked_successful_payment_id uuid/);
  assert.match(shippingFinalizeRecoveryMigration, /not exists \([\s\S]*?shipping_payment_allocations/);
  assert.match(shippingFinalizeRecoveryMigration, /historical successful shipping payment requires manual reconciliation/);
  assert.match(shippingFinalizeRecoveryMigration, /shipping_payment_status = v_next_status/);
  assert.doesNotMatch(shippingFinalizeRecoveryMigration, /\n\s*payment_status\s*=/);
});

test("legacy NULL shipping statuses are promoted only for proven fee snapshots", () => {
  assert.match(legacyShippingStatusMigration, /742c03ee-87a4-4018-b99b-dbfe8e4f916f/);
  assert.match(legacyShippingStatusMigration, /c3f2e4f4-a9bf-479e-8af6-026b1c678ea1/);
  assert.match(legacyShippingStatusMigration, /shipping_fee_status is null/);
  assert.match(legacyShippingStatusMigration, /v_item\.shipping_fee is null/);
  assert.match(legacyShippingStatusMigration, /v_item\.line_shipping <= 0/);
  assert.match(legacyShippingStatusMigration, /v_item\.quantity <= 0/);
  assert.match(legacyShippingStatusMigration, /abs\(v_item\.line_shipping - \(v_item\.shipping_fee \* v_item\.quantity\)\) > 0\.000001/);
  assert.match(legacyShippingStatusMigration, /set shipping_fee_status = 'ready'/);
  assert.match(legacyShippingStatusMigration, /set shipping_fee_status = 'pending'/);
  assert.match(legacyShippingStatusMigration, /has_unconfirmed_shipping/);
  assert.match(legacyShippingStatusMigration, /alter column shipping_fee_status set not null/);
  assert.match(legacyShippingStatusMigration, /check \(shipping_fee_status in \('pending', 'ready'\)\)/);
  assert.match(legacyShippingStatusMigration, /not in \('cancelled', 'canceled'\)/);
  assert.match(legacyShippingStatusMigration, /create temporary table legacy_shipping_status_orders/);
  assert.match(legacyShippingStatusMigration, /lower\(coalesce\(o\.status, ''\)\) not in \('cancelled', 'canceled'\)/);
  assert.match(legacyShippingStatusMigration, /and oi\.order_id = 'c3f2e4f4-a9bf-479e-8af6-026b1c678ea1'::uuid/);
  assert.match(legacyShippingStatusMigration, /and shipping_fee_status is null/);
  assert.doesNotMatch(legacyShippingStatusMigration, /update public\.order_items as oi[\s\S]*where oi\.shipping_fee_status is null[\s\S]*set shipping_fee_status = 'ready'/);
});

test("legacy shipping status audit is read-only and classifies ambiguous rows as ineligible", () => {
  assert.doesNotMatch(legacyShippingStatusAudit, /\b(update|insert|delete|alter|drop)\b/i);
  assert.match(legacyShippingStatusAudit, /unambiguous_ready_candidate/);
  assert.match(legacyShippingStatusAudit, /ambiguous_ineligible_candidate/);
  assert.match(legacyShippingStatusAudit, /cancelled_order_review/);
  assert.match(legacyShippingStatusAudit, /invalid_status_manual_review/);
  assert.match(legacyShippingStatusAudit, /lower\(oi\.shipping_fee_status\) not in \('pending', 'ready'\)/);
  assert.match(legacyShippingStatusAudit, /shipping_fee_status is null/);
});

test("pre-migration shipping audit uses only existing payment and item tables", () => {
  assert.doesNotMatch(shippingPreMigrationAudit, /shipping_payment_allocations/);
  assert.match(shippingPreMigrationAudit, /successful_amount_minor/);
  assert.match(shippingPreMigrationAudit, /aggregate_matches_but_payment_mapping_unproven/);
  assert.match(shippingPreMigrationAudit, /successful_payment_not_reflected_in_items/);
  assert.match(shippingPreMigrationAudit, /partial_or_ambiguous_manual_review/);
});

test("reminder verification remains token-bound even if Paystack metadata is incomplete", () => {
  assert.match(serverSource, /const paymentReminderToken = clean\(req\.headers\["x-payment-reminder-token"\]\)/);
  assert.match(
    serverSource,
    /verifyOrderPaymentReminderToken\(paymentReminderToken, paymentRow\.order_id\)/,
  );
  assert.match(paymentSource, /paymentReminderToken: callbackPaymentToken \|\| session\?\.paymentReminderToken/);
});

test("verified order finalization persists core order status before shipping reconciliation", () => {
  const syncStart = serverSource.indexOf("async function syncCheckoutPaymentStatus(");
  const loopStart = serverSource.indexOf("for (const order of", syncStart);
  const itemLookup = serverSource.indexOf('.from("order_items")', loopStart);
  const coreOrderUpdate = serverSource.indexOf('.from("orders")', loopStart);

  assert.ok(syncStart >= 0);
  assert.ok(loopStart > syncStart);
  assert.ok(coreOrderUpdate > loopStart);
  assert.ok(itemLookup > coreOrderUpdate);
  assert.match(serverSource.slice(loopStart, itemLookup), /payment_status: orderPaymentStatus/);
});

test("order finalization calculates partial balances from successful order payments only", () => {
  assert.match(serverSource, /payment_purpose, status, amount/);
  assert.match(serverSource, /payment\.payment_purpose\)\.toLowerCase\(\) !== "order"/);
  assert.match(serverSource, /orderAmountDue > verifiedOrderPayments \+ 0\.000001/);
  assert.match(serverSource, /const orderPaymentStatus = normalizedStatus === "paid"/);
  assert.match(serverSource, /payment_status: orderPaymentStatus \|\| "paid"/);
});

test("guest order status updates cannot be rolled back by the legacy order notification trigger", () => {
  assert.match(notificationMigration, /create or replace function private\.handle_order_notification_change\(\)/);
  assert.match(notificationMigration, /security definer/);
  assert.match(notificationMigration, /set search_path = ''/);
  assert.match(notificationMigration, /if new\.user_id is null then\s+return new;/s);
  assert.match(notificationMigration, /private\.upsert_notification\(/);
  assert.match(notificationMigration, /revoke all on function private\.handle_order_notification_change\(\) from public, anon, authenticated/);
});

test("a 0.01 GHS order payment remains separate from deferred shipping", () => {
  assert.match(serverSource, /Math\.max\(Number\(order\.amount_due_now \?\? order\.total\) \|\| 0, 0\)/);
  assert.match(serverSource, /clean\(payment\.payment_purpose\)\.toLowerCase\(\) !== "order"/);
  assert.match(serverSource, /shipping_payment_mode === "pay_later"/);
  assert.match(serverSource, /payment_status: orderPaymentStatus/);
  assert.match(serverSource, /shipping_payment_status: shippingPaymentStatus/);
});

test("the success route does not claim payment success before backend verification", () => {
  const statusStart = paymentSource.indexOf("function PaymentStatusPage(");
  const verifyStart = paymentSource.indexOf("async function verifyPayment", statusStart);
  const statusSource = paymentSource.slice(statusStart, verifyStart);

  assert.match(statusSource, /session\?\.status === "successful" && variant === "success"/);
  assert.doesNotMatch(statusSource, /setResolvedVariant\(variant\)/);
  assert.match(paymentSource, /setResolvedVariant\("success"\)/);
  assert.match(paymentSource, /setVerificationState\("error"\)/);
});

test("shipping reminder emails regenerate an order-scoped token at delivery time", () => {
  assert.match(
    serverSource,
    /source_key\)\.startsWith\("shipping-payment-request:"\)[\s\S]*?actionUrl: buildShippingPaymentReminderUrl\(notification\.order_id\)/,
  );
});

test("shipping initialization uses an owner-bound lease and does not retry unknown Paystack outcomes", () => {
  assert.match(serverSource, /acquireShippingPaymentInitializationLease/);
  assert.match(serverSource, /shipping_initialization_in_progress/);
  assert.match(serverSource, /shipping_initialization_unresolved/);
  assert.match(serverSource, /completeShippingPaymentInitialization/);
  assert.match(serverSource, /releaseShippingPaymentInitialization/);
  assert.match(shippingLeaseMigration, /initialization_lease_id uuid/);
  assert.match(shippingLeaseMigration, /initialization_lease_expires_at timestamptz/);
  assert.match(shippingLeaseMigration, /grant execute on function public\.acquire_shipping_payment_initialization_lease/);
  assert.match(shippingLeaseMigration, /grant execute on function public\.complete_shipping_payment_initialization/);
  assert.match(shippingLeaseMigration, /grant execute on function public\.release_shipping_payment_initialization/);
  assert.match(shippingLeaseMigration, /v_payment\.status = 'successful'/);
  assert.match(shippingLeaseMigration, /recoveryRequired/);
  assert.match(serverSource, /Paystack's response could not be confirmed/);
  assert.match(serverSource, /shipping_attempt_expired/);
});

test("registered shipping notification actions use authenticated access instead of stored expiring tokens", () => {
  assert.match(notificationSource, /shipping-payment-request:/);
  assert.match(notificationSource, /purpose=shipping-balance&orderId=/);
  assert.match(notificationSource, /clean\(row\.user_id\)/);
});

test("shipping notice controls prevent sending for paid or cancelled orders", () => {
  assert.match(adminSource, /shippingNoticeIneligible/);
  assert.match(adminSource, /shippingAccounting\.outstandingShipping <= 0/);
  assert.match(adminSource, /shippingOrderCancelled/);
});
