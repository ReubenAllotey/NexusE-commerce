import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { buildAccountSetupEmail, buildGuestAccountSetupNotification } from "./services/accountSetupEmail.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverSource = fs.readFileSync(path.join(projectRoot, "server.js"), "utf8");
const accountSetupSource = fs.readFileSync(path.join(projectRoot, "server/services/accountSetupEmail.js"), "utf8");

function extractFunction(source, name) {
  const match = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(source);
  assert.ok(match, `Expected ${name} in server.js`);
  const openBrace = source.indexOf("{", match.index);
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = openBrace; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (["'", '"', "`"].includes(character)) {
      quote = character;
      continue;
    }
    if (character === "/" && next === "/") {
      index = source.indexOf("\n", index);
      continue;
    }
    if (character === "{") depth += 1;
    if (character === "}" && --depth === 0) return source.slice(match.index, index + 1);
  }
  throw new Error(`Could not extract ${name}`);
}

const authorizationScript = [
  "const GUEST_CHECKOUT_ACCESS_TOKEN_TTL_SECONDS = 30 * 60;",
  "const paystackSecret = 'isolated-test-secret';",
  extractFunction(serverSource, "clean"),
  extractFunction(serverSource, "createGuestCheckoutAccessToken"),
  extractFunction(serverSource, "verifyGuestCheckoutAccessToken"),
  extractFunction(serverSource, "authorizeLinkedGuestAccountSetupAccess"),
].join("\n");

function createAuthorizationHarness(overrides = {}) {
  const state = {
    profile: {
      id: "guest-user-001",
      email: "guest@example.invalid",
      account_type: "guest",
      role: "customer",
      status: "active",
      must_change_password: true,
    },
    authUser: {
      id: "guest-user-001",
      email: "guest@example.invalid",
      user_metadata: { account_type: "guest", must_change_password: true },
    },
    ...overrides,
  };
  const context = {
    Buffer,
    crypto,
    process: { env: {} },
    console: { error() {} },
    supabaseAdmin: {
      auth: {
        admin: {
          getUserById: async () => ({ data: { user: state.authUser }, error: null }),
        },
      },
    },
    loadProfileById: async () => state.profile,
    isValidQueuedEmailAddress: (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? "")),
  };
  vm.runInNewContext(`${authorizationScript}\nthis.createToken = createGuestCheckoutAccessToken; this.authorize = authorizeLinkedGuestAccountSetupAccess;`, context);
  return context;
}

function makeExpiredToken(reference, orderId) {
  const payload = Buffer.from(JSON.stringify({ reference, orderId, expiresAt: 1 })).toString("base64url");
  const signature = crypto.createHmac("sha256", "isolated-test-secret").update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

const linkedGuestOrder = {
  id: "order-guest-001",
  user_id: "guest-user-001",
  customer_email: "guest@example.invalid",
};

test("account setup notification is order-scoped and contains no credentials", () => {
  const notification = buildGuestAccountSetupNotification({ id: "order-guest-001", user_id: "guest-user-001" });

  assert.equal(notification.source_type, "account_setup");
  assert.equal(notification.source_key, "account-setup:order-guest-001");
  assert.equal(notification.action_url, "/account/set-password");
  assert.equal(Object.hasOwn(notification, "password"), false);
  assert.doesNotMatch(JSON.stringify(notification), /temporary password|plaintext password|credential/i);
});

test("account setup email uses the supplied secure recovery link and never includes a password", () => {
  const email = buildAccountSetupEmail({
    customerName: "Guest Customer",
    actionLink: "https://auth.example.invalid/recovery?token=single-use-token",
    appUrl: "https://nexuse-commerce.onrender.com",
  });

  assert.match(email.html, /Set Up My Account/);
  assert.match(email.html, /single-use-token/);
  assert.doesNotMatch(email.text, /temporary password|plaintext password/i);
});

test("email worker verifies active guest identity before generating a setup link", () => {
  const workerStart = serverSource.indexOf('if (clean(notification.source_type) === "account_setup")');
  const workerEnd = serverSource.indexOf('if (clean(notification.source_type) === "payment_status"', workerStart);
  assert.ok(workerStart >= 0 && workerEnd > workerStart);
  const worker = serverSource.slice(workerStart, workerEnd);

  assert.match(worker, /account_type/);
  assert.match(worker, /must_change_password/);
  assert.match(worker, /profile\.role !== "customer"/);
  assert.match(worker, /profile\.status !== "active"/);
  assert.match(worker, /generateLink/);
  assert.match(worker, /type: "recovery"/);
});

test("guest setup failures remain retryable and phone propagation is server-side", () => {
  const ensureStart = serverSource.indexOf("async function ensureGuestAccountSetupNotification");
  const ensureEnd = serverSource.indexOf("const guestAccountSetupReconciliationInFlight", ensureStart);
  const ensureSource = serverSource.slice(ensureStart, ensureEnd);
  assert.match(ensureSource, /eligibility check deferred/);
  assert.match(ensureSource, /retryable: true/);
  assert.match(serverSource, /user_metadata: \{[\s\S]*phone_number: normalizedPhone/);
  assert.match(serverSource, /syncGuestProfilePhone/);
  assert.match(serverSource, /sync_guest_customer_phone/);
});

test("browser verification can reconcile a linked paid guest order without Paystack guest metadata", () => {
  const verifyStart = serverSource.indexOf("async function handleVerify");
  const webhookStart = serverSource.indexOf("async function handleWebhook", verifyStart);
  const verifySource = serverSource.slice(verifyStart, webhookStart);

  assert.match(verifySource, /hasPersistedGuestAccess/);
  assert.match(verifySource, /isPersistedGuestOrderRecovery/);
  assert.match(verifySource, /verifyGuestCheckoutAccessToken\(guestAccessToken, cleanReference, paymentRow\.order_id\)/);
  assert.match(verifySource, /reconcileGuestAccountSetupForOrder\(paymentRow\.order_id\)/);
});

test("browser and webhook verification share idempotent account setup reconciliation", () => {
  const verifyStart = serverSource.indexOf("async function handleVerify");
  const webhookStart = serverSource.indexOf("async function handleWebhook", verifyStart);
  const verifySource = serverSource.slice(verifyStart, webhookStart);
  const webhookSource = serverSource.slice(webhookStart);

  assert.match(verifySource, /reconcileGuestAccountSetupForOrder\(paymentRow\.order_id\)/);
  assert.match(webhookSource, /reconcileGuestAccountSetupForOrder\(paymentRow\.order_id\)/);
  assert.match(accountSetupSource, /source_key: `account-setup:\$\{orderId\}`/);
  assert.match(serverSource, /guestAccountSetupReconciliationInFlight/);
});

test("linked guest recovery executes token, identity, email, status, and password checks", async () => {
  const valid = createAuthorizationHarness();
  const token = valid.createToken("payment-reference", linkedGuestOrder.id);
  assert.equal((await valid.authorize(linkedGuestOrder, "payment-reference", token)).ok, true);

  const wrongOrder = { ...linkedGuestOrder, id: "order-other" };
  assert.equal((await valid.authorize(wrongOrder, "payment-reference", token)).ok, false);
  assert.equal((await valid.authorize(linkedGuestOrder, "payment-reference", makeExpiredToken("payment-reference", linkedGuestOrder.id))).ok, false);

  const registered = createAuthorizationHarness({
    profile: { ...valid.profile, account_type: "member" },
    authUser: { ...valid.authUser, user_metadata: { account_type: "customer" } },
  });
  assert.equal((await registered.authorize(linkedGuestOrder, "payment-reference", registered.createToken("payment-reference", linkedGuestOrder.id))).ok, false);

  const mismatchedId = createAuthorizationHarness({
    profile: { ...valid.profile, id: "different-user" },
  });
  assert.equal((await mismatchedId.authorize(linkedGuestOrder, "payment-reference", mismatchedId.createToken("payment-reference", linkedGuestOrder.id))).ok, false);

  const mismatchedEmail = createAuthorizationHarness({
    profile: { ...valid.profile, email: "other@example.invalid" },
  });
  assert.equal((await mismatchedEmail.authorize(linkedGuestOrder, "payment-reference", mismatchedEmail.createToken("payment-reference", linkedGuestOrder.id))).ok, false);

  const inactive = createAuthorizationHarness({
    profile: { ...valid.profile, status: "disabled" },
  });
  assert.equal((await inactive.authorize(linkedGuestOrder, "payment-reference", inactive.createToken("payment-reference", linkedGuestOrder.id))).ok, false);

  const passwordAlreadySet = createAuthorizationHarness({
    profile: { ...valid.profile, must_change_password: false },
  });
  assert.equal((await passwordAlreadySet.authorize(linkedGuestOrder, "payment-reference", passwordAlreadySet.createToken("payment-reference", linkedGuestOrder.id))).ok, false);
});
