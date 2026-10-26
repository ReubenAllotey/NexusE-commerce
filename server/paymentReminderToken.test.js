import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const serverPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "server.js");
const source = fs.readFileSync(serverPath, "utf8");

function extractFunction(name) {
  const match = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(source);
  assert.ok(match, `Expected ${name} to exist in server.js`);
  const signatureEnd = source.indexOf(")", match.index);
  const openBrace = source.indexOf("{", signatureEnd);
  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let index = openBrace; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (["'", '"', "`"].includes(character)) {
      quote = character;
      continue;
    }
    if (character === "{") depth += 1;
    if (character === "}" && --depth === 0) return source.slice(match.index, index + 1);
  }
  throw new Error(`Could not extract ${name}`);
}

const context = {
  Buffer,
  Date,
  crypto,
  GUEST_CHECKOUT_ACCESS_TOKEN_TTL_SECONDS: 30 * 60,
  process: { env: { GUEST_CHECKOUT_ACCESS_SECRET: "fictional-reminder-secret" } },
  paystackSecret: "unused-fictional-paystack-secret",
  clean: (value) => String(value ?? "").trim(),
};

vm.runInNewContext(
  [
    "createGuestCheckoutAccessToken",
    "verifyGuestCheckoutAccessToken",
    "createOrderPaymentReminderToken",
    "verifyOrderPaymentReminderToken",
    "getPublicAppUrl",
    "buildOrderPaymentReminderUrl",
  ]
    .map(extractFunction)
    .join("\n") + "\nthis.api = { createOrderPaymentReminderToken, verifyOrderPaymentReminderToken, buildOrderPaymentReminderUrl };",
  context,
  { filename: "server.js payment reminder token harness" },
);

const {
  createOrderPaymentReminderToken,
  verifyOrderPaymentReminderToken,
  buildOrderPaymentReminderUrl,
} = context.api;

test("payment reminder tokens bind to the order and expire", () => {
  const token = createOrderPaymentReminderToken("order-fictional-001");

  assert.equal(verifyOrderPaymentReminderToken(token, "order-fictional-001"), true);
  assert.equal(verifyOrderPaymentReminderToken(token, "order-fictional-002"), false);
  assert.equal(verifyOrderPaymentReminderToken(`${token}tampered`, "order-fictional-001"), false);

  const payload = Buffer.from(JSON.stringify({
    reference: "payment-reminder",
    orderId: "order-fictional-001",
    expiresAt: Math.floor(Date.now() / 1000) - 1,
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", "fictional-reminder-secret").update(payload).digest("base64url");
  assert.equal(verifyOrderPaymentReminderToken(`${payload}.${signature}`, "order-fictional-001"), false);
});

test("backend Pay Now URLs target the existing payment route with an order-scoped token", () => {
  const orderId = "order-fictional-001";
  const paymentUrl = new URL(buildOrderPaymentReminderUrl(orderId));

  assert.equal(paymentUrl.origin, "https://nexuse-commerce.onrender.com");
  assert.equal(paymentUrl.pathname, "/payment");
  assert.equal(paymentUrl.searchParams.get("purpose"), "order-balance");
  assert.equal(paymentUrl.searchParams.get("orderId"), orderId);
  assert.equal(paymentUrl.searchParams.get("token")?.length > 20, true);
  assert.equal(
    verifyOrderPaymentReminderToken(paymentUrl.searchParams.get("token"), orderId),
    true,
  );
});
