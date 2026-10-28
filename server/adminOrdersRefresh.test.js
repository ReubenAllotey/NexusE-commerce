import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildAdminPaymentSummary,
  getProductAmountDueMinor,
  summarizePaymentAttempts,
} from "./services/adminPaymentSummary.js";

const appSource = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
const adminOrdersSource = await readFile(
  new URL("../src/pages/Admin/AdminOrdersPage.jsx", import.meta.url),
  "utf8",
);
const paymentSource = await readFile(
  new URL("../src/pages/payment/payment.jsx", import.meta.url),
  "utf8",
);
const ordersStorageSource = await readFile(
  new URL("../src/pages/Profile/ordersStorage.js", import.meta.url),
  "utf8",
);
const serverSource = await readFile(new URL("../server.js", import.meta.url), "utf8");
const adminHelpersSource = await readFile(
  new URL("../src/pages/Admin/adminHelpers.js", import.meta.url),
  "utf8",
);
const dashboardSource = await readFile(
  new URL("../src/pages/Admin/dashboard/adminDashboard.jsx", import.meta.url),
  "utf8",
);
const paymentSummarySource = await readFile(
  new URL("./services/adminPaymentSummary.js", import.meta.url),
  "utf8",
);

test("App exposes a request-id guarded order refresh callback", () => {
  assert.match(appSource, /const refreshOrders = useCallback\(async/);
  assert.match(appSource, /const requestId = \+\+orderRequestIdRef\.current/);
  assert.match(appSource, /onRefreshOrders=\{refreshOrders\}/);
  assert.match(appSource, /Keep the last known order state visible/);
});

test("Admin Orders provides manual refresh and preserves local view state", () => {
  assert.match(adminOrdersSource, /onRefreshOrders = null/);
  assert.match(adminOrdersSource, /Refresh orders/);
  assert.match(adminOrdersSource, /disabled=\{ordersRefreshing\}/);
  assert.match(adminOrdersSource, /ordersRefreshInFlightRef/);
  assert.match(adminOrdersSource, /setOrdersRefreshError/);
  assert.match(adminOrdersSource, /statusFilter|query|openOrderId/);
});

test("Admin Orders polls only while visible and cleans up its timer", () => {
  assert.match(adminOrdersSource, /setInterval\(refreshIfVisible, 30_000\)/);
  assert.match(adminOrdersSource, /document\.visibilityState === "visible"/);
  assert.match(adminOrdersSource, /addEventListener\("visibilitychange", refreshIfVisible\)/);
  assert.match(adminOrdersSource, /clearInterval\(interval\)/);
  assert.match(adminOrdersSource, /removeEventListener\("visibilitychange", refreshIfVisible\)/);
});

test("shipping notice refreshes persisted state and distinguishes queueing from delivery", () => {
  assert.match(adminOrdersSource, /void runOrdersRefresh\(\{ silent: true \}\)/);
  assert.match(adminOrdersSource, /Shipping notice saved and email queued for delivery/);
  assert.match(adminOrdersSource, /Email delivery was accepted by the provider/);
  assert.match(adminOrdersSource, /Unable to send the shipping payment notice/);
});

test("payment page retains persisted payment update callbacks and verification flow", () => {
  assert.match(appSource, /onUpdateOrder=\{handleUpdateOrder\}/);
  assert.match(appSource, /onReplaceOrders=\{setOrders\}/);
  assert.match(paymentSource, /verifyPayment/);
  assert.match(paymentSource, /setResolvedVariant\("success"\)/);
});

test("admin payment summaries are batched, admin-only, and separate product and shipping payments", () => {
  assert.match(serverSource, /async function handleAdminPaymentSummary\(req, res\)/);
  assert.match(serverSource, /Only active administrators can view payment summaries/);
  assert.match(serverSource, /payment_purpose, status, amount, amount_minor/);
  assert.match(serverSource, /buildAdminPaymentSummary\(/);
  assert.match(paymentSummarySource, /summarizePaymentAttempts\(payments, "order"\)/);
  assert.match(paymentSummarySource, /summarizePaymentAttempts\(payments, "shipping"\)/);
  assert.match(serverSource, /verifiedProductRevenue/);
  assert.match(serverSource, /outstandingConfirmedShipping/);
  assert.match(serverSource, /shipping_paid_amount/);
  assert.match(serverSource, /payment-summary/);
});

test("admin orders and dashboard expose verified and outstanding accounting", () => {
  assert.match(adminOrdersSource, /Verified order payments|verifiedOrderPayments/);
  assert.match(adminOrdersSource, /Outstanding.*outstandingOrderPayment|outstandingOrderPayment.*Outstanding/);
  assert.match(adminOrdersSource, /getPaymentStatusLabel/);
  assert.match(adminOrdersSource, /Last attempt/);
  assert.match(adminHelpersSource, /verifiedProductRevenue/);
  assert.match(adminHelpersSource, /outstandingProductPayments/);
  assert.match(adminHelpersSource, /verifiedShippingPayments/);
  assert.match(adminHelpersSource, /outstandingConfirmedShipping/);
  assert.match(dashboardSource, /Product Revenue/);
  assert.match(dashboardSource, /Product Outstanding/);
  assert.match(dashboardSource, /Shipping Collected/);
  assert.match(dashboardSource, /Shipping Outstanding/);
});

test("admin refresh loads payment summaries and fails closed instead of showing stale figures as current", () => {
  assert.match(ordersStorageSource, /\/api\/admin\/payment-summary/);
  assert.match(ordersStorageSource, /Unable to load payment summaries/);
  assert.match(ordersStorageSource, /paymentSummary/);
  assert.match(adminOrdersSource, /void runOrdersRefresh\(\{ silent: true \}\)/);
});

test("legacy deferred-shipping totals exclude shipping from product balance", () => {
  assert.equal(
    getProductAmountDueMinor({
      total: 1.2,
      amount_due_now: null,
      shipping_total: 0.2,
      shipping_payment_mode: "pay_later",
      shipping_payment_status: "outstanding",
    }),
    100,
  );
  assert.equal(
    getProductAmountDueMinor({
      total: 1.2,
      amount_due_now: null,
      shipping_total: 0.2,
      shipping_payment_mode: "pay_now",
      shipping_payment_status: "paid",
    }),
    120,
  );
});

test("payment summaries deduplicate repeated references without collapsing distinct successful payments", () => {
  const attempts = summarizePaymentAttempts([
    { id: "a", provider_reference: "REF-A", payment_purpose: "order", status: "successful", amount_minor: 50 },
    { id: "a-retry", provider_reference: "REF-A", payment_purpose: "order", status: "successful", amount_minor: 50 },
    { id: "b", provider_reference: "REF-B", payment_purpose: "order", status: "successful", amount_minor: 25 },
    { id: "no-ref-1", provider_reference: null, payment_purpose: "order", status: "failed", amount_minor: 10 },
    { id: "no-ref-2", provider_reference: null, payment_purpose: "order", status: "pending", amount_minor: 10 },
  ], "order");

  assert.equal(attempts.successfulMinor, 75);
  assert.equal(attempts.pendingCount, 1);
  assert.equal(attempts.failedCount, 1);
});

test("partial product and shipping payments remain separate and failed payments do not become revenue", () => {
  const summary = buildAdminPaymentSummary(
    {
      id: "order-1",
      order_number: "ORD-1",
      total: 1.2,
      amount_due_now: null,
      shipping_total: 0.2,
      shipping_payment_mode: "pay_later",
      shipping_payment_status: "outstanding",
      status: "pending_payment",
    },
    [
      { id: "product-paid", provider_reference: "P-1", payment_purpose: "order", status: "successful", amount_minor: 50 },
      { id: "product-failed", provider_reference: "P-2", payment_purpose: "order", status: "failed", amount_minor: 50 },
      { id: "shipping-paid", provider_reference: "S-1", payment_purpose: "shipping", status: "successful", amount_minor: 20 },
    ],
    [{ line_shipping: 0.2, shipping_paid_amount: 0.2, shipping_fee_status: "ready" }],
  );

  assert.equal(summary.verifiedOrderPayments, 0.5);
  assert.equal(summary.outstandingOrderPayment, 0.5);
  assert.equal(summary.productPaymentStatus, "partial");
  assert.equal(summary.verifiedShippingPayments, 0.2);
  assert.equal(summary.outstandingShippingPayment, 0);
  assert.equal(summary.shippingPaymentStatus, "paid");
});
