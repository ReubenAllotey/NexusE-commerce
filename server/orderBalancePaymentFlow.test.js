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
});

test("shipping notices reject cancelled orders and guest orders can use guest_email", () => {
  assert.match(serverSource, /guest_email, status, shipping_payment_mode, shipping_payment_status/);
  assert.match(serverSource, /order.customer_email \|\| order.guest_email/);
  assert.match(serverSource, /isCancelledOrder\(order\)/);
  assert.match(serverSource, /shipping balance is already paid/);
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
