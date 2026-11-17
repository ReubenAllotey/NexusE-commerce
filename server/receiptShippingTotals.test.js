import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const serverSource = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "server.js"), "utf8");

function extractFunction(name) {
  const start = serverSource.search(new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`));
  assert.ok(start >= 0, `Expected ${name} in server.js`);
  const openBrace = serverSource.indexOf("{", start);
  let depth = 0;
  for (let index = openBrace; index < serverSource.length; index += 1) {
    if (serverSource[index] === "{") depth += 1;
    if (serverSource[index] === "}" && --depth === 0) return serverSource.slice(start, index + 1);
  }
  throw new Error(`Could not extract ${name}`);
}

function buildHarness(result) {
  const messages = [];
  const context = {
    supabaseAdmin: {
      from() {
        let rows = Array.isArray(result.data) ? [...result.data] : [];
        return {
          select() { return this; },
          eq(column, value) {
            rows = rows.filter((row) => row[column] === value);
            return this;
          },
          async then(resolve) { resolve({ data: rows, error: result.error }); },
        };
      },
    },
    console: { error(message) { messages.push(message); } },
  };
  const script = [
    "function clean(value) { return String(value ?? '').trim(); }",
    "function getPaymentAmountCedis(payment = {}) { const minor = Number(payment?.amount_minor); if (Number.isSafeInteger(minor) && payment?.amount_minor !== null && payment?.amount_minor !== undefined && clean(payment.amount_minor) !== '') return minor / 100; const amount = Number(payment?.amount); return Number.isFinite(amount) ? amount : 0; }",
    "function normalizePaymentStatus(status) { const value = clean(status).toLowerCase(); return ['success', 'successful', 'charge.success', 'transaction.success', 'paid'].includes(value) ? 'successful' : value; }",
    extractFunction("getSuccessfulReceiptPaymentTotals"),
    extractFunction("getSuccessfulShippingReceiptTotals"),
    "this.calculate = getSuccessfulShippingReceiptTotals;",
  ].join("\n");
  vm.runInNewContext(script, context);
  return { calculate: context.calculate, messages };
}

test("pay-later receipt product charge excludes the separately billed shipping fee", () => {
  const script = [
    "function clean(value) { return String(value ?? '').trim(); }",
    extractFunction("getReceiptProductCharge"),
    "this.calculate = getReceiptProductCharge;",
  ].join("\n");
  const context = {};
  vm.runInNewContext(script, context);

  assert.equal(context.calculate({ total: 5, amount_due_now: 5, shipping_payment_mode: "pay_later" }, 3), 2);
  assert.equal(context.calculate({ total: 5, amount_due_now: 5, shipping_payment_mode: "pay_now" }, 3), 5);
});

test("shipping totals include only successful shipping payments and count the current payment once", async () => {
  const harness = buildHarness({
    data: [
      { id: "shipping-old", order_id: "order-001", payment_purpose: "shipping", status: "successful", amount_minor: 20 },
      { id: "shipping-current", order_id: "order-001", payment_purpose: "shipping", status: "successful", amount_minor: 30 },
      { id: "product-payment", order_id: "order-001", payment_purpose: "order", status: "successful", amount_minor: 9000 },
      { id: "failed-shipping", order_id: "order-001", payment_purpose: "shipping", status: "failed", amount_minor: 500 },
    ],
    error: null,
  });

  const totals = await harness.calculate("order-001", "shipping-current");
  assert.equal(totals.totalShippingPaid, 0.5);
  assert.equal(totals.previousShippingPaid, 0.2);
});

test("shipping total query failures reject receipt generation with a sanitized diagnostic", async () => {
  const harness = buildHarness({ data: null, error: { message: "sensitive database detail" } });

  await assert.rejects(
    () => harness.calculate("order-001", "shipping-current"),
    { message: "Unable to calculate the shipping receipt totals." },
  );
  assert.deepEqual(harness.messages, ["[receipt] Unable to load successful shipping payment totals."]);
});
