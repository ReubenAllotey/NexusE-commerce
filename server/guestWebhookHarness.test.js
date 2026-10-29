import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverSource = fs.readFileSync(path.join(projectRoot, "server.js"), "utf8");
const WEBHOOK_SECRET = "fictional-paystack-webhook-secret";

function extractFunction(source, name) {
  const match = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(source);
  assert.ok(match, `Expected ${name} to exist in server.js`);

  const start = match.index;
  const openBrace = source.indexOf("{", match.index);
  assert.notEqual(openBrace, -1, `${name} has no function body`);

  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = openBrace; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];

    if (lineComment) {
      if (character === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      continue;
    }
    if (character === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === "{") depth += 1;
    if (character === "}" && --depth === 0) return source.slice(start, index + 1);
  }

  throw new Error(`Could not extract complete ${name} function`);
}

const deployedFunctions = [
  "loadOrderBundle",
  "getPaymentByReference",
  "ensureOrderConfirmationNotification",
  "ensureShippingPaymentConfirmationNotification",
  "ensureGuestAccountSetupNotification",
  "provisionGuestAccountAfterVerifiedPayment",
  "getVerifiedGuestAccountId",
  "parsePaystackMetadata",
  "normalizePaystackPaymentPurpose",
  "validatePaystackSuccessfulTransaction",
  "handleWebhook",
].map((name) => extractFunction(serverSource, name)).join("\n");

function makeQuery(table, state) {
  const query = {
    select() {
      return query;
    },
    eq(column, value) {
      state.filters.push([column, value]);
      return query;
    },
    order() {
      return query;
    },
    maybeSingle: async () => {
      if (table === "payments") {
        const reference = state.filters.find(([column]) => column === "provider_reference")?.[1];
        return {
          data: state.paymentLookupOverride
            ?? state.payments.find((payment) => payment.provider_reference === reference)
            ?? null,
          error: null,
        };
      }
      if (table === "orders") {
        const id = state.filters.find(([column]) => column === "id")?.[1];
        return { data: state.orders.find((order) => order.id === id) ?? null, error: null };
      }
      return { data: null, error: null };
    },
    insert: async (notification) => {
      state.insertAttempts += 1;
      if (state.notificationInsertError) return { error: state.notificationInsertError };

      const duplicate = state.notifications.some(
        (existing) => existing.source_type === notification.source_type && existing.source_key === notification.source_key,
      );
      if (duplicate) return { error: { code: "23505", message: "duplicate source key" } };

      state.notifications.push(notification);
      return { error: null };
    },
  };

  if (table === "order_items") {
    query.maybeSingle = undefined;
    query.order = () => query;
    query.then = (resolve) => resolve({
      data: state.orderItems.filter((item) => state.filters.some(([column, value]) => column === "order_id" && item.order_id === value)),
      error: null,
    });
  }

  return query;
}

function createSupabaseMock(state) {
  return {
    auth: {
      admin: {
        getUserById: async (userId) => ({
          data: {
            user: {
              id: userId,
              email: state.guestAccountEmail ?? "guest@example.invalid",
              user_metadata: state.guestAccountUserId === userId
                ? { account_type: "guest", must_change_password: true }
                : { account_type: "customer" },
            },
          },
          error: null,
        }),
      },
    },
    from(table) {
      const queryState = { filters: [] };
      const query = makeQuery(table, { ...state, filters: queryState.filters });
      if (table === "notifications") {
        query.insert = async (notification) => {
          state.insertAttempts += 1;
          if (state.notificationInsertError) return { error: state.notificationInsertError };
          const duplicate = state.notifications.some(
            (existing) => existing.source_type === notification.source_type && existing.source_key === notification.source_key,
          );
          if (duplicate) return { error: { code: "23505", message: "duplicate source key" } };
          state.notifications.push(notification);
          return { error: null };
        };
      }
      return query;
    },
    rpc(name, payload) {
      state.rpcCalls.push({ name, payload });
      return Promise.resolve({ error: null });
    },
  };
}

function createHarnessState(overrides = {}) {
  const payment = {
    id: "payment-fictional-001",
    order_id: "order-fictional-001",
    user_id: null,
    payment_purpose: "order",
    provider_reference: "ref-fictional-001",
    status: "pending",
    amount: 3800,
    amount_minor: 380000,
    currency: "GHS",
  };
  const order = {
    id: payment.order_id,
    order_number: "NX-TEST-001",
    user_id: null,
    customer_name: "Test Customer",
    customer_email: "test.customer@example.invalid",
    guest_email: "test.customer@example.invalid",
  };

  return {
    payments: [{ ...payment, ...(overrides.payment ?? {}) }],
    orders: [{ ...order, ...(overrides.order ?? {}) }],
    orderItems: [{ id: "item-fictional-001", order_id: payment.order_id, product_name: "Test Product" }],
    notifications: [],
    insertAttempts: 0,
    notificationInsertError: null,
    rpcCalls: [],
    paymentUpdates: [],
    paymentEvents: [],
    orderSyncs: [],
    accountProvisioning: "disabled",
    accountCalls: 0,
    guestAccountUserId: "guest-user-fictional-001",
    guestAccountEmail: "test.customer@example.invalid",
    profileUnavailable: false,
    orderUpdates: [],
    ...overrides.state,
  };
}

function buildWebhookModule(state) {
  const context = {
    Buffer,
    console: { warn() {}, error() {}, log() {} },
    crypto,
    supabaseAdmin: createSupabaseMock(state),
    paystackSecret: WEBHOOK_SECRET,
    clean: (value) => (value == null ? "" : String(value).trim()),
    getPaymentAmountCedis: (payment = {}) => {
      const minor = Number(payment?.amount_minor);
      if (Number.isSafeInteger(minor)
        && payment?.amount_minor !== null
        && payment?.amount_minor !== undefined
        && String(payment.amount_minor).trim() !== "") {
        return minor / 100;
      }
      const amount = Number(payment?.amount);
      return Number.isFinite(amount) ? amount : 0;
    },
    loadProfileById: async (userId) => state.profileUnavailable
      ? null
      : ({
        id: userId,
        role: "customer",
        status: "active",
        account_type: state.guestAccountUserId === userId ? "guest" : "customer",
        email: state.guestAccountUserId === userId
          ? state.guestAccountEmail
          : "registered.customer@example.invalid",
      }),
    provisionGuestAccountAfterVerifiedPayment: undefined,
    createGuestAuthAccount: undefined,
    buildGuestAccountSetupNotification: (order) => ({
      user_id: order.user_id,
      category: "orders",
      title: "Set up your Nexus Import Hub account",
      message: "Your order was confirmed.",
      order_id: order.id,
      source_type: "account_setup",
      source_key: `account-setup:${order.id}`,
    }),
    normalizePaymentStatus: (value) => {
      const normalized = String(value ?? "").trim().toLowerCase();
      return normalized === "success" || normalized === "successful" || normalized === "charge.success" ? "successful" : normalized;
    },
    isSuccessfulPayment: (payment) => String(payment?.status ?? "").toLowerCase() === "successful",
    getReceiptPaymentPurpose: (payment) => {
      const purpose = String(payment?.payment_purpose ?? "").trim().toLowerCase();
      return purpose === "shipping" || purpose === "order" ? purpose : "";
    },
    isValidQueuedEmailAddress: (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? "").trim()),
    formatGhanaCedis: (value) => `GH₵${(Number(value) || 0).toFixed(2)}`,
    readRequestBody: async (request) => request.body,
    recordPaymentEvent: async (paymentId, payload) => state.paymentEvents.push({ paymentId, payload }),
    updatePaymentRow: async (paymentId, values) => {
      state.paymentUpdates.push({ paymentId, values });
      const payment = state.payments.find((row) => row.id === paymentId);
      Object.assign(payment, values);
      return payment;
    },
    updateGuestOrderBundle: async (orderId, values) => {
      state.orderUpdates.push({ orderId, values });
      const order = state.orders.find((row) => row.id === orderId);
      Object.assign(order, values);
      return { order, items: state.orderItems };
    },
    syncCheckoutPaymentStatus: async (orderId, status, amount, allocate) => {
      state.orderSyncs.push({ orderId, status, amount, allocate });
      return { order: state.orders.find((order) => order.id === orderId), items: state.orderItems };
    },
    sendJson: (response, statusCode, payload) => response.finish(statusCode, payload),
  };

  context.createGuestAuthAccount = async () => {
    state.accountCalls += 1;
    if (state.accountProvisioning === "disabled") {
      return { created: false, user: null, profile: null, eligible: false };
    }
    if (state.accountProvisioning === "failure") {
      throw new Error("fictional auth outage");
    }
    if (state.accountProvisioning === "existing"
      || (state.accountProvisioning === "concurrent" && state.accountCalls > 1)) {
      return {
        created: false,
        user: {
          id: state.accountProvisioning === "concurrent"
            ? state.guestAccountUserId
            : "registered-user-fictional-001",
          email: state.guestAccountEmail,
          user_metadata: state.accountProvisioning === "concurrent"
            ? { account_type: "guest", must_change_password: true }
            : { account_type: "customer" },
        },
        profile: {
          role: "customer",
          status: "active",
          account_type: state.accountProvisioning === "concurrent" ? "guest" : "customer",
          email: state.guestAccountEmail,
        },
      };
    }
    return {
      created: true,
      user: {
        id: state.guestAccountUserId,
        email: state.guestAccountEmail,
        user_metadata: { account_type: "guest", must_change_password: true },
      },
      profile: { role: "customer", status: "active", account_type: "guest", email: state.guestAccountEmail },
    };
  };

  const script = `${deployedFunctions}\nthis.webhook = handleWebhook;`;
  vm.runInNewContext(script, context, { filename: "server.js guest webhook harness" });
  return context.webhook;
}

async function invokeWebhook(webhook, state, event = {}) {
  const body = JSON.stringify(event);
  const signature = crypto.createHmac("sha512", WEBHOOK_SECRET).update(body).digest("hex");
  const response = {
    statusCode: null,
    payload: null,
    finish(statusCode, payload) {
      this.statusCode = statusCode;
      this.payload = payload;
    },
  };
  await webhook(
    { body, headers: { "x-paystack-signature": signature } },
    response,
  );
  return response;
}

function successfulEvent(reference, overrides = {}) {
  return {
    event: "charge.success",
    data: {
      reference,
      status: "success",
      amount: 380000,
      currency: "GHS",
      metadata: { paymentPurpose: "order" },
      ...overrides,
    },
  };
}

test("guest successful payment queues one notification from persisted order email", async () => {
  const state = createHarnessState();
  const response = await invokeWebhook(buildWebhookModule(state), state, successfulEvent("ref-fictional-001"));

  assert.equal(response.statusCode, 200);
  assert.equal(state.notifications.length, 1);
  assert.equal(state.notifications[0].recipient_email, "test.customer@example.invalid");
  assert.equal(state.notifications[0].user_id, null);
  assert.equal(state.notifications[0].order_id, "order-fictional-001");
  assert.equal(state.notifications[0].payment_id, "payment-fictional-001");
});

test("webhook-first guest payment provisions one account and queues both notifications", async () => {
  const state = createHarnessState({ state: { accountProvisioning: "new" } });
  const response = await invokeWebhook(
    buildWebhookModule(state),
    state,
    successfulEvent("ref-fictional-001"),
  );

  assert.equal(response.statusCode, 200);
  assert.equal(state.accountCalls, 1);
  assert.equal(state.orders[0].user_id, state.guestAccountUserId);
  assert.equal(state.payments[0].user_id, state.guestAccountUserId);
  assert.deepEqual(
    state.notifications.map((notification) => notification.source_type).sort(),
    ["account_setup", "payment_status"],
  );
  assert.equal(state.notifications.filter((notification) => notification.source_type === "account_setup").length, 1);
  assert.equal(state.notifications.filter((notification) => notification.source_type === "payment_status").length, 1);
  assert.equal(state.notifications.some((notification) => Object.hasOwn(notification, "password")), false);
  assert.equal(state.notifications.some((notification) => /temporary password|plaintext password/i.test(JSON.stringify(notification))), false);
});

test("browser verification uses the same post-payment provisioning entry point", () => {
  const start = serverSource.indexOf("async function handleVerify");
  const end = serverSource.indexOf("async function handleWebhook", start);
  assert.ok(start >= 0 && end > start);
  assert.match(
    serverSource.slice(start, end),
    /provisionGuestAccountAfterVerifiedPayment\(guestEmail, guestName\)/,
  );
});

test("existing registered account is not linked or sent a setup notification", async () => {
  const state = createHarnessState({ state: { accountProvisioning: "existing" } });
  const response = await invokeWebhook(
    buildWebhookModule(state),
    state,
    successfulEvent("ref-fictional-001"),
  );

  assert.equal(response.statusCode, 200);
  assert.equal(state.accountCalls, 1);
  assert.equal(state.orders[0].user_id, null);
  assert.equal(state.payments[0].user_id, null);
  assert.equal(state.notifications.length, 1);
  assert.equal(state.notifications[0].source_type, "payment_status");
});

test("account provisioning failure preserves the verified payment and order confirmation", async () => {
  const state = createHarnessState({ state: { accountProvisioning: "failure" } });
  const response = await invokeWebhook(
    buildWebhookModule(state),
    state,
    successfulEvent("ref-fictional-001"),
  );

  assert.equal(response.statusCode, 200);
  assert.equal(state.payments[0].status, "successful");
  assert.equal(state.orders[0].user_id, null);
  assert.equal(state.notifications.length, 1);
  assert.equal(state.notifications[0].source_type, "payment_status");
});

test("concurrent browser and webhook provisioning remains one guest account and one setup notification", async () => {
  const state = createHarnessState({ state: { accountProvisioning: "concurrent" } });
  const webhook = buildWebhookModule(state);
  const event = successfulEvent("ref-fictional-001");

  const responses = await Promise.all([
    invokeWebhook(webhook, state, event),
    invokeWebhook(webhook, state, event),
  ]);

  assert.deepEqual(responses.map((response) => response.statusCode), [200, 200]);
  assert.equal(state.accountCalls, 2);
  assert.equal(state.orders[0].user_id, state.guestAccountUserId);
  assert.equal(state.notifications.filter((notification) => notification.source_type === "account_setup").length, 1);
  assert.equal(state.notifications.filter((notification) => notification.source_type === "payment_status").length, 1);
});

test("account setup remains retryable when the linked guest profile is temporarily unavailable", async () => {
  const state = createHarnessState({ state: { accountProvisioning: "new", profileUnavailable: true } });
  const response = await invokeWebhook(
    buildWebhookModule(state),
    state,
    successfulEvent("ref-fictional-001"),
  );

  assert.equal(response.statusCode, 500);
  assert.equal(state.payments[0].status, "successful");
  assert.equal(state.orders[0].user_id, state.guestAccountUserId);
  assert.equal(state.notifications.filter((notification) => notification.source_type === "account_setup").length, 0);
  assert.equal(state.notifications.filter((notification) => notification.source_type === "payment_status").length, 1);
});

test("JSON-string Paystack metadata remains compatible with successful order payments", async () => {
  const state = createHarnessState();
  const response = await invokeWebhook(
    buildWebhookModule(state),
    state,
    successfulEvent("ref-fictional-001", { metadata: JSON.stringify({ paymentPurpose: "order" }) }),
  );

  assert.equal(response.statusCode, 200);
  assert.equal(state.notifications.length, 1);
});

test("missing metadata uses the recognized persisted payment purpose for legacy payments", async () => {
  const state = createHarnessState();
  const response = await invokeWebhook(
    buildWebhookModule(state),
    state,
    successfulEvent("ref-fictional-001", { metadata: null }),
  );

  assert.equal(response.statusCode, 200);
  assert.equal(state.notifications.length, 1);
});

test("missing metadata with an unknown persisted purpose is rejected", async () => {
  const state = createHarnessState({ payment: { payment_purpose: "" } });
  const response = await invokeWebhook(
    buildWebhookModule(state),
    state,
    successfulEvent("ref-fictional-001", { metadata: null }),
  );

  assert.equal(response.statusCode, 400);
  assert.equal(state.payments[0].status, "pending");
  assert.equal(state.paymentEvents.length, 0);
  assert.equal(state.paymentUpdates.length, 0);
  assert.equal(state.notifications.length, 0);
});

test("malformed Paystack metadata is rejected before payment writes", async () => {
  const state = createHarnessState();
  const response = await invokeWebhook(
    buildWebhookModule(state),
    state,
    successfulEvent("ref-fictional-001", { metadata: "not-json" }),
  );

  assert.equal(response.statusCode, 400);
  assert.equal(state.payments[0].status, "pending");
  assert.equal(state.paymentEvents.length, 0);
  assert.equal(state.paymentUpdates.length, 0);
  assert.equal(state.notifications.length, 0);
});

test("guest payment without a valid email is retryable and does not create a notification", async () => {
  const state = createHarnessState({ order: { customer_email: "", guest_email: "invalid" } });
  const response = await invokeWebhook(buildWebhookModule(state), state, successfulEvent("ref-fictional-001"));

  assert.equal(response.statusCode, 500);
  assert.equal(state.notifications.length, 0);
  assert.equal(state.payments[0].status, "successful");
});

test("duplicate successful webhooks do not create duplicate notifications", async () => {
  const state = createHarnessState();
  const webhook = buildWebhookModule(state);
  const event = successfulEvent("ref-fictional-001");

  assert.equal((await invokeWebhook(webhook, state, event)).statusCode, 200);
  assert.equal((await invokeWebhook(webhook, state, event)).statusCode, 200);
  assert.equal(state.notifications.length, 1);
  assert.equal(state.insertAttempts, 2);
});

test("notification insertion failure returns 500 without reversing payment", async () => {
  const state = createHarnessState();
  state.notificationInsertError = { code: "42501", message: "permission denied" };
  const response = await invokeWebhook(buildWebhookModule(state), state, successfulEvent("ref-fictional-001"));

  assert.equal(response.statusCode, 500);
  assert.equal(state.payments[0].status, "successful");
  assert.equal(state.notifications.length, 0);
});

test("incorrect successful amount is rejected before payment writes", async () => {
  const state = createHarnessState();
  const response = await invokeWebhook(
    buildWebhookModule(state),
    state,
    successfulEvent("ref-fictional-001", { amount: 379999 }),
  );

  assert.equal(response.statusCode, 400);
  assert.equal(state.payments[0].status, "pending");
  assert.equal(state.paymentEvents.length, 0);
  assert.equal(state.paymentUpdates.length, 0);
  assert.equal(state.orderSyncs.length, 0);
  assert.equal(state.notifications.length, 0);
});

test("incorrect successful currency is rejected before payment writes", async () => {
  const state = createHarnessState();
  const response = await invokeWebhook(
    buildWebhookModule(state),
    state,
    successfulEvent("ref-fictional-001", { currency: "USD" }),
  );

  assert.equal(response.statusCode, 400);
  assert.equal(state.payments[0].status, "pending");
  assert.equal(state.paymentEvents.length, 0);
  assert.equal(state.paymentUpdates.length, 0);
  assert.equal(state.notifications.length, 0);
});

test("successful reference mismatch is rejected before payment writes", async () => {
  const state = createHarnessState();
  state.paymentLookupOverride = {
    ...state.payments[0],
    provider_reference: "ref-persisted-other",
  };
  const response = await invokeWebhook(
    buildWebhookModule(state),
    state,
    successfulEvent("ref-fictional-001", { reference: "ref-other-payment" }),
  );

  assert.equal(response.statusCode, 400);
  assert.equal(state.payments[0].status, "pending");
  assert.equal(state.paymentEvents.length, 0);
  assert.equal(state.paymentUpdates.length, 0);
  assert.equal(state.notifications.length, 0);
});

test("successful payment-purpose mismatch is rejected before payment writes", async () => {
  const state = createHarnessState();
  const response = await invokeWebhook(
    buildWebhookModule(state),
    state,
    successfulEvent("ref-fictional-001", { metadata: { paymentPurpose: "shipping-balance" } }),
  );

  assert.equal(response.statusCode, 400);
  assert.equal(state.payments[0].status, "pending");
  assert.equal(state.paymentEvents.length, 0);
  assert.equal(state.paymentUpdates.length, 0);
  assert.equal(state.notifications.length, 0);
});

test("registered customer payment keeps user ownership and queues one notification", async () => {
  const state = createHarnessState({ payment: { user_id: "user-fictional-001" }, order: { user_id: "user-fictional-001" } });
  const response = await invokeWebhook(buildWebhookModule(state), state, successfulEvent("ref-fictional-001"));

  assert.equal(response.statusCode, 200);
  assert.equal(state.notifications.length, 1);
  assert.equal(state.notifications[0].user_id, "user-fictional-001");
  assert.equal(state.notifications[0].recipient_email, null);
});

test("shipping payment finalizes shipping and does not create an order confirmation", async () => {
  const state = createHarnessState({ payment: { payment_purpose: "shipping", status: "successful" } });
  const webhook = buildWebhookModule(state);
  const response = await invokeWebhook(
    webhook,
    state,
    successfulEvent("ref-fictional-001", { metadata: { paymentPurpose: "shipping-balance" } }),
  );

  assert.equal(response.statusCode, 200);
  assert.equal(state.notifications.length, 1);
  assert.equal(state.notifications[0].source_type, "payment_status");
  assert.equal(state.notifications[0].payment_id, "payment-fictional-001");
  assert.equal(state.notifications[0].category, "shipping");
  assert.equal(state.rpcCalls[0].name, "finalize_shipping_payment");
  assert.equal(
    (await invokeWebhook(
      webhook,
      state,
      successfulEvent("ref-fictional-001", { metadata: { paymentPurpose: "shipping-balance" } }),
    )).statusCode,
    200,
  );
  assert.equal(state.notifications.length, 1);
});

test("harness makes no external network calls", async () => {
  const state = createHarnessState();
  const networkCalls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    networkCalls.push(args);
    throw new Error("External network access is forbidden in this test");
  };
  try {
    await invokeWebhook(buildWebhookModule(state), state, successfulEvent("ref-fictional-001"));
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.deepEqual(networkCalls, []);
});
