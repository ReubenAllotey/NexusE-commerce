import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const serverSource = await readFile(new URL("../server.js", import.meta.url), "utf8");
const endpointStart = serverSource.indexOf("async function handleAdminPaymentReconcile(");
const endpointEnd = serverSource.indexOf("async function handleGenerateProductContent", endpointStart);
const endpointSource = serverSource.slice(endpointStart, endpointEnd);
const routeStart = serverSource.indexOf('pathname === "/api/admin/payments/reconcile"');

test("reconciliation is restricted to authenticated active administrators", () => {
  assert.ok(endpointStart >= 0);
  assert.ok(routeStart > endpointStart);
  assert.match(endpointSource, /getAuthenticatedUser\(req\)/);
  assert.match(endpointSource, /isActiveAdminProfile\(profileResult\.profile\)/);
  assert.match(serverSource.slice(routeStart, routeStart + 180), /req\.method === "POST"/);
});

test("reconciliation verifies Paystack against the persisted product payment", () => {
  assert.match(endpointSource, /getPaymentByReference\(reference\)/);
  assert.match(endpointSource, /transaction\/verify/);
  assert.match(endpointSource, /validatePaystackSuccessfulTransaction\(paymentRow, paystackData, reference, "order"\)/);
  assert.match(endpointSource, /getReceiptPaymentPurpose\(paymentRow\) !== "order"/);
  assert.doesNotMatch(endpointSource, /body\.(orderId|amount|currency|paymentPurpose)/);
});

test("reconciliation is idempotent and does not create a new charge or order", () => {
  assert.match(endpointSource, /recordPaymentEvent\(paymentRow\.id/);
  assert.match(endpointSource, /status: "processing"/);
  assert.match(endpointSource, /recordReconciliationOutcome\(paymentRow\.id, "successful"/);
  assert.match(endpointSource, /successAuditRecorded/);
  assert.match(endpointSource, /if \(!successAuditRecorded\)/);
  assert.match(endpointSource, /normalizePaymentStatus\(paymentRow\.status\) !== "successful"/);
  assert.match(endpointSource, /updatePaymentRow\(paymentRow\.id/);
  assert.match(endpointSource, /syncCheckoutPaymentStatus\(paymentRow\.order_id, "paid"/);
  assert.doesNotMatch(endpointSource, /createPendingPaymentRecord|initializePaystack|ensureOrderConfirmationNotification|ensureGuestAccountSetupNotification/);
});

test("reconciliation returns persisted payment, order, and shipping statuses", () => {
  assert.match(endpointSource, /getPaymentByReference\(reference\)/g);
  assert.match(endpointSource, /loadOrderBundle\(paymentRow\.order_id\)/);
  assert.match(endpointSource, /paymentStatus: persistedPayment\.status/);
  assert.match(endpointSource, /shippingPaymentStatus: orderResult\.order\.shipping_payment_status/);
  assert.match(serverSource, /select\("id, payment_status, status"\)[\r\n]+\s+\.single\(\)/);
  assert.match(endpointSource, /expectedPaymentStatus = balanceNotice\.accounting\.outstanding <= 0 \? "paid" : "pending"/);
  assert.match(endpointSource, /persistedPaymentStatus !== expectedPaymentStatus/);
});

test("reconciliation preserves deferred shipping and zero-row failure handling", () => {
  assert.match(serverSource, /shipping_payment_status: shippingPaymentStatus/);
  assert.match(serverSource, /shipping_payment_mode === "pay_later"/);
  assert.match(serverSource, /if \(!coreUpdatedOrder\)/);
  assert.match(serverSource, /The verified payment order could not be updated/);
  assert.match(endpointSource, /recordReconciliationOutcome\(paymentRow\.id, "failed"/);
  assert.match(endpointSource, /Payment reconciliation could not be completed\. Please retry\./);
  assert.doesNotMatch(endpointSource, /message: error\.message/);
  assert.match(endpointSource, /Payment reconciliation payment lookup failed/);
});

test("payment event audit upsert matches the production uniqueness index", () => {
  assert.match(serverSource, /onConflict: "payment_id,provider_event_type,provider_reference,status"/);
  assert.match(serverSource, /provider_event_type: "admin_reconcile"/);
  assert.match(serverSource, /status: "processing"/);
  assert.match(serverSource, /status: "successful"/);
  assert.match(serverSource, /status: "failed"/);
});
