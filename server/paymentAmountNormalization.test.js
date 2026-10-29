import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { getPaymentAmountCedis } from "../src/shared/paymentAmount.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appSource = fs.readFileSync(path.join(root, "src", "App.jsx"), "utf8");
const paymentSource = fs.readFileSync(path.join(root, "src", "pages", "payment", "payment.jsx"), "utf8");
const storageSource = fs.readFileSync(path.join(root, "src", "pages", "payment", "paymentStorage.js"), "utf8");
const serverSource = fs.readFileSync(path.join(root, "server.js"), "utf8");

test("Admin Orders receives the scoped refresh callback without a ReferenceError", () => {
  assert.match(appSource, /function AppShell\([\s\S]*?onRefreshOrders/);
  assert.match(appSource, /onRefreshOrders=\{onRefreshOrders\}/);
  assert.match(appSource, /onRefreshOrders=\{refreshOrders\}/);
});

test("payment amount normalization prefers valid minor units", () => {
  assert.equal(getPaymentAmountCedis({ amount: 0.02, amount_minor: 2 }), 0.02);
  assert.equal(getPaymentAmountCedis({ amount: 0.02, amount_minor: 20 }), 0.2);
  assert.equal(getPaymentAmountCedis({ amount: 0.2, amount_minor: 20 }), 0.2);
  assert.equal(getPaymentAmountCedis({ amount: 0, amount_minor: 0 }), 0);
});

test("legacy payment amounts fall back to decimal cedis when minor units are unavailable", () => {
  assert.equal(getPaymentAmountCedis({ amount: 0.2, amount_minor: null }), 0.2);
  assert.equal(getPaymentAmountCedis({ amount: 0.2 }), 0.2);
  assert.equal(getPaymentAmountCedis({ amount: "not-a-number", amount_minor: null }), 0);
});

test("failed and pending attempts use the same persisted amount units without becoming successful", () => {
  assert.equal(getPaymentAmountCedis({ status: "failed", amount: 0.02, amount_minor: 20 }), 0.2);
  assert.equal(getPaymentAmountCedis({ status: "pending", amount: 0.02, amount_minor: 20 }), 0.2);
});

test("customer history, success receipts, and server receipts use the shared normalization", () => {
  assert.match(paymentSource, /getPaymentAmountCedis\(serverPayment\)/);
  assert.match(storageSource, /getPaymentAmountCedis\(paymentRow\)/);
  assert.match(serverSource, /amountPaid: getPaymentAmountCedis\(paymentRow\)/);
});

test("admin refresh behavior remains request-scoped and polling-compatible", () => {
  assert.match(appSource, /const refreshOrders = useCallback\(async/);
  assert.match(appSource, /orderRequestIdRef/);
  assert.match(appSource, /onRefreshOrders=\{onRefreshOrders\}/);
});
