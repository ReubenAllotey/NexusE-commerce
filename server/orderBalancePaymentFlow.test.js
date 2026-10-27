import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const serverSource = await readFile(new URL("../server.js", import.meta.url), "utf8");
const paymentSource = await readFile(
  new URL("../src/pages/payment/payment.jsx", import.meta.url),
  "utf8",
);
const apiSource = await readFile(
  new URL("../src/pages/payment/paystackApi.js", import.meta.url),
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
