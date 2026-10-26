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
});

test("order-balance initialization remains separate from shipping payments", () => {
  assert.match(serverSource, /paymentPurpose: "order-balance"/);
  assert.match(serverSource, /paymentPurpose: "order"/);
  assert.match(serverSource, /paymentPurpose === "shipping-balance"/);
  assert.match(paymentSource, /paymentToken: paymentIntent\.token/);
});
