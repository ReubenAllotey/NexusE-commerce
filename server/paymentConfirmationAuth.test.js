import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appSource = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
const paymentSource = await readFile(new URL("../src/pages/payment/payment.jsx", import.meta.url), "utf8");
const serverSource = await readFile(new URL("../server.js", import.meta.url), "utf8");

test("payment confirmation waits for Supabase auth restoration before verification and receipt loading", () => {
  assert.match(paymentSource, /authReady = false/);
  assert.match(paymentSource, /if \(!authReady \|\| !reference \|\| !authUser\?\.id\)/);
  assert.match(paymentSource, /if \(!authReady \|\| !reference \|\| variant === "failed"\)/);
  assert.match(appSource, /authReady=\{authReady\}/);
});

test("registered confirmation actions continue to use the authenticated account", () => {
  assert.match(paymentSource, /if \(!authUser\?\.id\) \{\s*handleGuestNext\(\);/);
  assert.match(paymentSource, /navigate\("\/profile\/orders"\)/);
  assert.match(paymentSource, /Authorization: `Bearer \$\{accessToken\}`/);
});

test("guest receipt access remains order-scoped and token protected", () => {
  assert.match(paymentSource, /"X-Guest-Checkout-Token": session\.guestAccessToken/);
  assert.match(serverSource, /verifyGuestCheckoutAccessToken\(guestCheckoutToken, cleanReference, paymentRow\.order_id\)/);
  assert.match(serverSource, /paymentRow\.payment_purpose === "order"/);
  assert.match(serverSource, /!guestShippingAccess && !guestCheckoutAccess/);
  assert.match(serverSource, /clean\(paymentRow\.user_id\) !== clean\(authResult\.user\?\.id\)/);
});

test("expired or invalid guest access remains rejected by the existing backend guard", () => {
  assert.match(serverSource, /Please sign in to view this receipt\./);
  assert.match(serverSource, /verifyGuestCheckoutAccessToken\(guestCheckoutToken, cleanReference, paymentRow\.order_id\)/);
  assert.match(serverSource, /You do not have permission to access this receipt\./);
});
