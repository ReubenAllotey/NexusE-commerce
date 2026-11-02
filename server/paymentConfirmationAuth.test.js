import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const appSource = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
const paymentSource = await readFile(new URL("../src/pages/payment/payment.jsx", import.meta.url), "utf8");
const paymentStorageSource = await readFile(new URL("../src/pages/payment/paymentStorage.js", import.meta.url), "utf8");
const receiptSource = await readFile(new URL("../src/pages/receipt/receipt.jsx", import.meta.url), "utf8");
const serverSource = await readFile(new URL("../server.js", import.meta.url), "utf8");

function extractFunction(source, name) {
  const marker = `export async function ${name}`;
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `Expected ${name} in source`);
  if (name === "loadPaymentReceipt") {
    const end = source.indexOf("\nexport {", start);
    assert.ok(end > start, `Expected the end of ${name}`);
    return source.slice(start, end).replace(/^export\s+/, "");
  }
  const openBrace = source.indexOf("{", start);
  let depth = 0;
  for (let index = openBrace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}" && --depth === 0) {
      return source.slice(start, index + 1).replace(/^export\s+/, "");
    }
  }
  throw new Error(`Could not extract ${name}`);
}

test("payment confirmation waits for Supabase auth restoration before verification and receipt loading", () => {
  assert.match(paymentSource, /authReady = false/);
  assert.match(paymentSource, /if \(!authReady \|\| !reference \|\| \(!authUser\?\.id && !guestAccessToken && !activeShippingReceiptToken\)\)/);
  assert.match(paymentSource, /if \(!authReady \|\| !reference \|\| variant === "failed"\)/);
  assert.match(appSource, /authReady=\{authReady\}/);
  assert.doesNotMatch(appSource, /clearPaymentSession\(\);[\s\S]{0,80}setAuthSession\(null\)/);
});

test("registered confirmation actions continue to use the authenticated account", () => {
  assert.match(paymentSource, /if \(!authUser\?\.id\) \{\s*handleGuestNext\(\);/);
  assert.match(paymentSource, /navigate\("\/profile\/orders"\)/);
  assert.match(paymentSource, /Authorization: `Bearer \$\{accessToken\}`/);
});

test("guest receipt access remains order-scoped and token protected", () => {
  assert.match(paymentSource, /"X-Guest-Checkout-Token": session\.guestAccessToken/);
  assert.match(paymentSource, /verifiedOrderStatus/);
  assert.match(paymentSource, /session\?\.orderStatus \?\? "Awaiting confirmation"/);
  assert.match(paymentSource, /setResolvedVariant\("success"\)/);
  assert.match(serverSource, /verifyGuestCheckoutAccessToken\(guestCheckoutToken, cleanReference, paymentRow\.order_id\)/);
  assert.match(serverSource, /paymentRow\.payment_purpose === "order"/);
  assert.match(serverSource, /!guestShippingAccess && !guestCheckoutAccess/);
  assert.match(serverSource, /clean\(paymentRow\.user_id\) !== clean\(authResult\.user\?\.id\)/);
  assert.match(serverSource, /async function handleReceiptJson/);
  assert.match(serverSource, /guestProfile\.profile\?\.account_type !== "guest"/);
});

test("expired or invalid guest access remains rejected by the existing backend guard", () => {
  assert.match(serverSource, /Please sign in to view this receipt\./);
  assert.match(serverSource, /verifyGuestCheckoutAccessToken\(guestCheckoutToken, cleanReference, paymentRow\.order_id\)/);
  assert.match(serverSource, /You do not have permission to access this receipt\./);
});

test("confirmation cannot use a payment-attempt state as the persisted order status", () => {
  assert.doesNotMatch(paymentSource, /activeOrder\?\.status \?\? session\?\.status/);
  assert.match(paymentSource, /receiptRecord\?\.orderStatus \?\? verifiedOrderStatus/);
  assert.match(paymentSource, /orderStatus: serverOrder\?\.status/);
});

test("guest receipt loading uses the existing signed token without putting it in the URL", () => {
  const storageStart = paymentSource.indexOf("const guestAccessToken = paymentPurpose === \"shipping-balance\"");
  assert.ok(storageStart >= 0);
  assert.match(paymentSource, /loadPaymentReceipt\(reference, \{[\s\S]*shippingReceiptToken,[\s\S]*\}\)/);
  assert.match(paymentSource, /shippingPaymentToken: isShippingBalancePayment \? paymentIntent\.token : ""/);
  assert.match(paymentSource, /const activeShippingReceiptToken = paymentPurpose === "shipping-balance"/);
  assert.match(paymentSource, /paymentPurpose !== "shipping-balance" && session\?\.guestAccessToken/);
  assert.match(paymentSource, /"X-Shipping-Receipt-Token": activeShippingReceiptToken/);
  assert.doesNotMatch(paymentSource, /shippingPaymentToken,\s*\}/);
  assert.match(serverSource, /pathname\.startsWith\("\/api\/receipts\/"\)[\s\S]*handleReceiptJson/);
  assert.doesNotMatch(paymentSource.slice(storageStart, storageStart + 1200), /searchParams\.set\([^)]*guest/i);
});

test("guest receipt loader executes the token-authenticated JSON path", async () => {
  const requests = [];
  const context = {
    fetch: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        async json() {
          return { ok: true, receipt: { orderId: "order-guest-001", orderStatus: "confirmed" } };
        },
      };
    },
  };
  vm.runInNewContext(`function clean(value) { return String(value ?? "").trim(); }\n${extractFunction(paymentStorageSource, "loadPaymentReceipt")}\nthis.load = loadPaymentReceipt;`, context);

  const result = await context.load("PAY-guest-001", { guestAccessToken: "signed-token" });
  assert.equal(result.ok, true);
  assert.equal(result.receipt.orderStatus, "confirmed");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "/api/receipts/PAY-guest-001");
  assert.equal(requests[0].options.headers["X-Guest-Checkout-Token"], "signed-token");
});

test("shipping receipt loader sends only the shipping payment token", async () => {
  const requests = [];
  const context = {
    fetch: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        async json() {
          return { ok: true, receipt: { orderId: "order-shipping-001" } };
        },
      };
    },
  };
  vm.runInNewContext(`function clean(value) { return String(value ?? "").trim(); }\n${extractFunction(paymentStorageSource, "loadPaymentReceipt")}\nthis.load = loadPaymentReceipt;`, context);

  const result = await context.load("PAY-shipping-001", {
    shippingReceiptToken: "shipping-token",
  });
  assert.equal(result.ok, true);
  assert.equal(requests[0].options.headers["X-Shipping-Receipt-Token"], "shipping-token");
  assert.equal(requests[0].options.headers["X-Guest-Checkout-Token"], undefined);
});

test("receipt authorization failures cannot fall back to cached session details", () => {
  const normalizedReceiptSource = receiptSource.replace(/\r\n/g, "\n");
  assert.doesNotMatch(normalizedReceiptSource, /fallbackReceipt\s*=\s*authUser\?\.id/);
  assert.doesNotMatch(normalizedReceiptSource, /buildSessionReceipt\(session\)/);
  assert.match(normalizedReceiptSource, /setReceiptState\(\{[\s\S]*receipt: null[\s\S]*result\.message/);
});
