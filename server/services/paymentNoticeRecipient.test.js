import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { resolvePaymentNoticeRecipient } from "./paymentNoticeRecipient.js";

const serverSource = fs.readFileSync(
  fileURLToPath(new URL("../../server.js", import.meta.url)),
  "utf8",
);
const paymentPageSource = fs.readFileSync(
  fileURLToPath(new URL("../../src/pages/payment/payment.jsx", import.meta.url)),
  "utf8",
);

test("guest orders use the persisted customer email", () => {
  assert.deepEqual(
    resolvePaymentNoticeRecipient({ user_id: null, customer_email: " Guest@example.com " }),
    { eligible: true, userId: null, email: "guest@example.com" },
  );
});

test("legacy guest orders can use their persisted guest email", () => {
  assert.deepEqual(
    resolvePaymentNoticeRecipient({ user_id: null, customer_email: null, guest_email: " Legacy@example.com " }),
    { eligible: true, userId: null, email: "legacy@example.com" },
  );
});

test("registered orders remain eligible with their persisted email", () => {
  assert.deepEqual(
    resolvePaymentNoticeRecipient({ user_id: "user-001", customer_email: "customer@example.com" }),
    { eligible: true, userId: "user-001", email: "customer@example.com" },
  );
});

test("missing or malformed persisted emails are rejected", () => {
  assert.equal(resolvePaymentNoticeRecipient({ user_id: null, customer_email: "" }).eligible, false);
  assert.equal(resolvePaymentNoticeRecipient({ user_id: "user-001", customer_email: "not-an-email" }).eligible, false);
});

test("payment reminders preserve legacy keys while allowing unique reminder history", () => {
  assert.match(serverSource, /legacySourceKey/);
  assert.match(serverSource, /reminderSourcePrefix/);
  assert.match(serverSource, /create_admin_payment_reminder/);
  assert.match(serverSource, /order-payment-request:/);
});

test("payment reminders use an expiring order-bound Pay Now link", () => {
  assert.match(serverSource, /createOrderPaymentReminderToken\(orderId\)/);
  assert.match(serverSource, /purpose=order-balance/);
  assert.match(paymentPageSource, /paymentToken: paymentIntent\.token/);
  assert.match(fs.readFileSync(fileURLToPath(new URL("../../supabase/migrations/20261026_0043_repeated_payment_reminders.sql", import.meta.url)), "utf8"), /'Pay Now'/);
  assert.match(serverSource, /verifyOrderPaymentReminderToken\(body\.paymentToken, orderId\)/);
});

test("payment reminders cannot authorize shipping or arbitrary order payments", () => {
  assert.match(serverSource, /orderId: notice\.order\.id/);
  assert.match(serverSource, /paymentPurpose: "order-balance"/);
  assert.match(serverSource, /paymentReminder: true/);
  assert.match(serverSource, /paymentPurpose: "order"/);
  assert.match(serverSource, /getReceiptPaymentPurpose\(payment\) !== "order"/);
});
