import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { buildOrderConfirmationEmail } from "./services/orderConfirmationEmail.js";
import {
  buildShippingPaymentConfirmationEmail,
  buildShippingPaymentRequiredEmail,
  buildShipmentUpdateEmail,
} from "./services/shipmentNotificationEmail.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverSource = fs.readFileSync(path.join(projectRoot, "server.js"), "utf8");

function extractFunction(source, name) {
  const match = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(source);
  assert.ok(match, `Expected ${name} to exist in server.js`);
  const start = match.index;
  const signatureEnd = source.indexOf(")", match.index);
  const openBrace = source.indexOf("{", signatureEnd);
  let depth = 0;
  let quote = null;
  let regexLiteral = false;
  let regexClass = false;
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
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (regexLiteral) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === "[") regexClass = true;
      else if (character === "]") regexClass = false;
      else if (character === "/" && !regexClass) regexLiteral = false;
      continue;
    }
    if (["'", '"', "`"].includes(character)) {
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
    if (character === "/") {
      regexLiteral = true;
      continue;
    }
    if (character === "{") depth += 1;
    if (character === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Could not extract ${name}`);
}

const functionNames = [
  "loadOrderBundle",
  "loadOrderConfirmationContext",
  "getServerShippingAccounting",
  "createGuestCheckoutAccessToken",
  "createShippingPaymentReminderToken",
  "getPublicAppUrl",
  "buildShippingPaymentReminderUrl",
  "buildOrderPaymentReminderEmail",
  "sendTransactionalEmail",
  "sendNotificationEmailForRow",
  "isEmailQueueProcessingEnabled",
  "getEmailQueueTestDeliveryId",
  "getEmailRetryDelaySeconds",
  "isValidQueuedEmailAddress",
  "updateClaimedEmailJob",
  "drainNotificationEmailQueue",
  "runNotificationEmailWorkerCycle",
];
const deployedFunctions = functionNames.map((name) => {
  const extracted = extractFunction(serverSource, name);
  try {
    new vm.Script(extracted);
  } catch (error) {
    throw new Error(`Unable to parse extracted ${name}: ${error.message}`);
  }
  return extracted;
}).join("\n");

function createState(overrides = {}) {
  const order = {
    id: "order-fictional-001",
    order_number: "NX-EMAIL-TEST-001",
    checkout_group_id: null,
    user_id: null,
    customer_name: "Test Customer",
    customer_email: "guest@example.invalid",
    guest_email: "guest@example.invalid",
    created_at: "2026-10-25T10:00:00.000Z",
    shipping_address_snapshot: { country: "Ghana", region: "Greater Accra", town: "Accra" },
    subtotal: 3800,
    shipping_total: 0,
    shipping_payment_mode: "pay_later",
  };
  const payment = {
    id: "payment-fictional-001",
    order_id: order.id,
    user_id: null,
    payment_purpose: "order",
    provider_reference: "ref-fictional-001",
    status: "successful",
    amount: 3800,
    amount_minor: 380000,
    currency: "GHS",
    paid_at: "2026-10-25T10:05:00.000Z",
    created_at: "2026-10-25T10:05:00.000Z",
  };
  return {
    orders: [{ ...order, ...(overrides.order ?? {}) }],
    payments: [{ ...payment, ...(overrides.payment ?? {}) }],
    orderItems: overrides.orderItems ?? [{
      id: "item-fictional-001",
      order_id: order.id,
      product_name: "Fictional Product",
      selected_options: [{ groupName: "Color", value: "Blue" }],
      quantity: 2,
      unit_price: 1900,
      line_subtotal: 3800,
    }],
    notifications: overrides.notifications ?? [],
    jobs: overrides.jobs ?? [],
    queueUpdates: [],
    rpcCalls: [],
    fetchCalls: [],
    fetchResponse: { ok: true, status: 201, json: async () => ({ messageId: "brevo-fictional-message-001" }) },
    notificationError: null,
    ...overrides.state,
  };
}

function createQuery(state, table, operation = "read") {
  const filters = [];
  const query = {
    select() { return query; },
    eq(column, value) { filters.push([column, value]); return query; },
    order() { return query; },
    update(values) {
      operation = "update";
      query.updateValues = values;
      return query;
    },
    maybeSingle: async () => {
      const id = filters.find(([column]) => column === "id")?.[1];
      const reference = filters.find(([column]) => column === "provider_reference")?.[1];
      if (table === "notification_email_deliveries" && operation === "update") {
        const token = filters.find(([column]) => column === "lock_token")?.[1];
        const status = filters.find(([column]) => column === "status")?.[1];
        const job = state.jobs.find((row) => row.id === id && row.lock_token === token && row.status === status);
        if (job) Object.assign(job, query.updateValues);
        state.queueUpdates.push({ id, values: query.updateValues, matched: Boolean(job) });
        return { data: job ? { id: job.id } : null, error: null };
      }
      if (table === "orders") return { data: state.orders.find((row) => row.id === id) ?? null, error: null };
      if (table === "payments") return { data: state.payments.find((row) => row.id === id || row.provider_reference === reference) ?? null, error: null };
      if (table === "notifications") return { data: state.notifications.find((row) => row.id === id) ?? null, error: null };
      if (table === "notification_email_deliveries") return { data: state.jobs[0] ?? null, error: null };
      return { data: null, error: null };
    },
    then(resolve) {
      if (table === "order_items") {
        const orderId = filters.find(([column]) => column === "order_id")?.[1];
        return resolve({ data: state.orderItems.filter((item) => item.order_id === orderId), error: null });
      }
      if (table === "notification_email_deliveries" && operation === "update") {
        const id = filters.find(([column]) => column === "id")?.[1];
        const token = filters.find(([column]) => column === "lock_token")?.[1];
        const status = filters.find(([column]) => column === "status")?.[1];
        const job = state.jobs.find((row) => row.id === id && row.lock_token === token && row.status === status);
        if (job) Object.assign(job, query.updateValues);
        state.queueUpdates.push({ id, values: query.updateValues, matched: Boolean(job) });
        return resolve({ data: job ? { id: job.id } : null, error: null });
      }
      return resolve({ data: [], error: null });
    },
  };
  return query;
}

function createSupabaseMock(state) {
  return {
    from(table) {
      return createQuery(state, table);
    },
    rpc(name, payload) {
      state.rpcCalls.push({ name, payload });
      if (name === "claim_notification_email_job" || name === "claim_notification_email_jobs") {
        return Promise.resolve({ data: state.jobs, error: state.claimError ?? null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  };
}

function buildHarness(state, {
  emailQueueEnabled = "true",
  testDeliveryId = "",
  supabaseAvailable = true,
  workerAlreadyRunning = false,
} = {}) {
  const context = {
    AbortController,
    Buffer,
    crypto,
    Date,
    Intl,
    URL,
    console: { warn() {}, error() {}, info() {}, log() {} },
    process: { env: {
      EMAIL_QUEUE_ENABLED: emailQueueEnabled,
      EMAIL_QUEUE_TEST_DELIVERY_ID: testDeliveryId,
      BREVO_API_KEY: "fictional-brevo-key",
      BREVO_SENDER_EMAIL: "sender@example.invalid",
      BREVO_SENDER_NAME: "Nexus Test",
      PUBLIC_APP_URL: "https://example.invalid",
    } },
    paystackSecret: "fictional-paystack-secret",
    GUEST_CHECKOUT_ACCESS_TOKEN_TTL_SECONDS: 30 * 60,
    isTruthyEnv: (value) => ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase()),
    emailWorkerRunning: workerAlreadyRunning,
    supabaseAdmin: supabaseAvailable ? createSupabaseMock(state) : null,
    fetch: async (...args) => {
      state.fetchCalls.push(args);
      return state.fetchResponse;
    },
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
    escapeHtml: (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]),
    formatGhanaCedis: (value) => `GH₵${Number(value || 0).toFixed(2)}`,
    formatOrderDate: (value) => String(value || "Not available"),
    normalizePaymentStatus: (value) => String(value ?? "").trim().toLowerCase() === "success" ? "successful" : String(value ?? "").trim().toLowerCase(),
    isSuccessfulPayment: (payment) => String(payment?.status ?? "").toLowerCase() === "successful",
    getReceiptPaymentPurpose: (payment) => payment?.payment_purpose || "order",
    sanitizeEmailDiagnostic: (value) => String(value ?? "").replace(/[\r\n]/g, "").slice(0, 200),
    logEmailProviderFailure() {},
    buildOrderConfirmationEmail,
    buildShippingPaymentConfirmationEmail,
    buildShippingPaymentRequiredEmail,
    buildShipmentUpdateEmail,
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(`${deployedFunctions}\nthis.api = { sendNotificationEmailForRow, buildOrderPaymentReminderEmail, drainNotificationEmailQueue, runNotificationEmailWorkerCycle };`, context, { filename: "server.js email worker harness" });
  return context.api;
}

function paymentNotification(state, overrides = {}) {
  const payment = state.payments[0] || { id: "payment-fictional-001", user_id: null };
  const order = state.orders[0] || { id: "order-fictional-001", customer_email: "guest@example.invalid", customer_name: "Test Customer" };
  return {
    id: "notification-fictional-001",
    user_id: payment.user_id,
    recipient_email: order.customer_email,
    recipient_name: order.customer_name,
    source_type: "payment_status",
    source_key: `payment:${payment.id}:status:successful`,
    payment_id: payment.id,
    order_id: order.id,
    title: "Order confirmation",
    message: "Payment confirmed.",
    ...overrides,
  };
}

function genericNotification() {
  return {
    id: "notification-generic-001",
    user_id: null,
    recipient_email: "generic@example.invalid",
    recipient_name: "Generic Customer",
    source_type: "order_status",
    source_key: "order-status:fictional-001",
    title: "Order update",
    message: "Your fictional order is being processed.",
    order_id: null,
    payment_id: null,
  };
}

function lockedJob(state, overrides = {}) {
  if (!state.notifications.some((notification) => notification.id === "notification-fictional-001")) {
    state.notifications.push(paymentNotification(state));
  }
  return {
    id: "00000000-0000-4000-8000-000000000001",
    notification_id: "notification-fictional-001",
    recipient_email: state.orders[0]?.customer_email || "guest@example.invalid",
    attempts: 1,
    max_attempts: 5,
    status: "processing",
    lock_token: "lock-fictional-001",
    ...overrides,
  };
}

test("guest successful payment uses the branded itemized receipt", async () => {
  const state = createState();
  const { sendNotificationEmailForRow } = buildHarness(state, { emailQueueEnabled: "false" });
  const result = await sendNotificationEmailForRow(paymentNotification(state), { recipientEmail: state.orders[0].customer_email });

  assert.equal(result.ok, true);
  assert.match(state.fetchCalls[0][1].body, /Fictional Product/);
  assert.match(state.fetchCalls[0][1].body, /Blue/);
  assert.match(state.fetchCalls[0][1].body, /Payment successful/);
});

test("registered successful payment uses the branded itemized receipt", async () => {
  const state = createState({ payment: { user_id: "user-fictional-001" }, order: { user_id: "user-fictional-001" } });
  const { sendNotificationEmailForRow } = buildHarness(state, { emailQueueEnabled: "false" });
  const result = await sendNotificationEmailForRow(paymentNotification(state), { recipientEmail: "registered@example.invalid" });

  assert.equal(result.ok, true);
  assert.match(state.fetchCalls[0][1].body, /Nexus Test/);
  assert.match(state.fetchCalls[0][1].body, /Fictional Product/);
});

test("missing order or payment context returns a retryable failure without calling Brevo", async () => {
  const state = createState({ state: { orders: [] } });
  const { sendNotificationEmailForRow } = buildHarness(state, { emailQueueEnabled: "false" });
  const result = await sendNotificationEmailForRow(paymentNotification(state), { recipientEmail: "guest@example.invalid" });

  assert.equal(result.ok, false);
  assert.equal(result.permanent, undefined);
  assert.equal(state.fetchCalls.length, 0);
  assert.match(result.message, /retried/i);
});

test("generic notifications keep the generic branded notification template", async () => {
  const state = createState();
  const { sendNotificationEmailForRow } = buildHarness(state, { emailQueueEnabled: "false" });
  const result = await sendNotificationEmailForRow(genericNotification());

  assert.equal(result.ok, true);
  assert.match(state.fetchCalls[0][1].body, /Your fictional order is being processed/);
  assert.doesNotMatch(state.fetchCalls[0][1].body, /Items purchased/);
});

test("order payment reminders use Pay Now and preserve the secure payment link", () => {
  const state = createState();
  const { buildOrderPaymentReminderEmail } = buildHarness(state, { emailQueueEnabled: "false" });
  const email = buildOrderPaymentReminderEmail({
    customerName: "Test Customer",
    orderNumber: "NX-EMAIL-TEST-001",
    outstanding: 150,
    message: "Your order has an outstanding balance.",
    paymentLink: "https://example.invalid/payment?purpose=order-balance&token=fictional-token",
  });

  assert.match(email.html, />Pay Now</);
  assert.doesNotMatch(email.html, /View Order|View your orders/);
  assert.match(email.html, /purpose=order-balance/);
  assert.match(email.text, /Pay Now|payment\?purpose=order-balance/);
});

test("shipping payment confirmation uses its dedicated branded template", async () => {
  const state = createState({ payment: { payment_purpose: "shipping", amount: 75, provider_reference: "ship-pay-fictional" } });
  const { sendNotificationEmailForRow } = buildHarness(state, { emailQueueEnabled: "false" });
  const notification = paymentNotification(state, {
    title: "Shipping payment confirmed",
  });
  const result = await sendNotificationEmailForRow(notification, { recipientEmail: state.orders[0].customer_email });

  assert.equal(result.ok, true);
  assert.match(state.fetchCalls[0][1].body, /Shipping payment confirmed/);
  assert.match(state.fetchCalls[0][1].body, /ship-pay-fictional/);
  assert.doesNotMatch(state.fetchCalls[0][1].body, /Items purchased/);
});

test("shipping payment reminder uses the persisted outstanding balance", async () => {
  const state = createState({
    orderItems: [{ order_id: "order-fictional-001", line_shipping: 125, shipping_paid_amount: 25, shipping_fee_status: "ready" }],
  });
  const { sendNotificationEmailForRow } = buildHarness(state, { emailQueueEnabled: "false" });
  const result = await sendNotificationEmailForRow({
    ...genericNotification(),
    source_type: "payment_status",
    source_key: "shipping-payment-request:order-fictional-001",
    order_id: state.orders[0].id,
  });

  assert.equal(result.ok, true);
  assert.match(state.fetchCalls[0][1].body, /GH/);
  assert.match(state.fetchCalls[0][1].body, /Shipping payment required/);
});

test("shipment events use the branded shipment update template", async () => {
  const state = createState();
  const { sendNotificationEmailForRow } = buildHarness(state, { emailQueueEnabled: "false" });
  const result = await sendNotificationEmailForRow({
    ...genericNotification(),
    source_type: "shipment_event",
    title: "Shipment arrived in Ghana",
    message: "Your shipment has arrived at Ghana's airport.",
    order_id: state.orders[0].id,
    action_url: "/profile/shipments?batch=42&freight=air",
    action_description: "Shipment Batch 42 Air freight tracking for order NX-EMAIL-TEST-001.",
  });

  assert.equal(result.ok, true);
  assert.match(state.fetchCalls[0][1].body, /Shipment arrived in Ghana/);
  assert.match(state.fetchCalls[0][1].body, /Batch 42 Air freight/);
  assert.match(state.fetchCalls[0][1].body, /NX-EMAIL-TEST-001/);
});

test("Brevo success records provider message ID and sent status", async () => {
  const state = createState({ jobs: [] });
  state.jobs.push(lockedJob(state));
  const { drainNotificationEmailQueue } = buildHarness(state);
  const result = await drainNotificationEmailQueue();

  assert.equal(result.ok, true);
  assert.equal(result.processed, 1);
  assert.equal(state.fetchCalls.length, 1);
  assert.equal(state.queueUpdates[0].values.status, "sent");
  assert.equal(state.queueUpdates[0].values.provider, "brevo");
  assert.equal(state.queueUpdates[0].values.provider_message_id, "brevo-fictional-message-001");
});

test("temporary Brevo failure schedules a retry", async () => {
  const state = createState();
  state.jobs.push(lockedJob(state));
  state.fetchResponse = { ok: false, status: 503, statusText: "Unavailable", json: async () => ({ message: "temporary" }) };
  const { drainNotificationEmailQueue } = buildHarness(state);
  await drainNotificationEmailQueue();

  const update = state.queueUpdates[0].values;
  assert.equal(update.status, "failed");
  assert.equal(update.attempts, 1);
  assert.ok(Date.parse(update.next_attempt_at) > Date.now());
});

test("missing receipt context remains failed and retryable at queue level", async () => {
  const state = createState({ state: { orders: [] } });
  state.jobs.push(lockedJob(state));
  const { drainNotificationEmailQueue } = buildHarness(state);
  const result = await drainNotificationEmailQueue();

  assert.equal(result.ok, true);
  assert.equal(state.fetchCalls.length, 0);
  assert.equal(state.queueUpdates[0].values.status, "failed");
  assert.equal(state.queueUpdates[0].values.attempts, 1);
  assert.ok(Date.parse(state.queueUpdates[0].values.next_attempt_at) > Date.now());
});

test("permanent Brevo failure exhausts the configured attempt limit", async () => {
  const state = createState();
  state.jobs.push(lockedJob(state, { attempts: 1, max_attempts: 5 }));
  state.fetchResponse = { ok: false, status: 401, statusText: "Unauthorized", json: async () => ({ message: "invalid key" }) };
  const { drainNotificationEmailQueue } = buildHarness(state);
  await drainNotificationEmailQueue();

  const update = state.queueUpdates[0].values;
  assert.equal(update.status, "failed");
  assert.equal(update.attempts, 5);
  assert.equal(update.next_attempt_at, update.updated_at);
});

test("test delivery allowlist claims only the intended delivery ID", async () => {
  const state = createState();
  state.jobs.push(lockedJob(state));
  const { drainNotificationEmailQueue } = buildHarness(state, {
    testDeliveryId: "00000000-0000-4000-8000-000000000001",
  });
  await drainNotificationEmailQueue();

  assert.equal(state.rpcCalls.length, 1);
  assert.equal(state.rpcCalls[0].name, "claim_notification_email_job");
  assert.equal(state.rpcCalls[0].payload.p_delivery_id, "00000000-0000-4000-8000-000000000001");
  assert.equal(state.rpcCalls[0].payload.p_lease_timeout, "5 minutes");
});

test("worker reports a distinct disabled code without claiming a job", async () => {
  const state = createState();
  const { runNotificationEmailWorkerCycle } = buildHarness(state, { emailQueueEnabled: "false" });
  const result = await runNotificationEmailWorkerCycle();

  assert.deepEqual({ ...result }, { ok: false, code: "worker_disabled", skipped: true, processed: 0 });
  assert.equal(state.rpcCalls.length, 0);
});

test("worker reports unavailable Supabase without claiming a job", async () => {
  const state = createState();
  const { runNotificationEmailWorkerCycle } = buildHarness(state, { supabaseAvailable: false });
  const result = await runNotificationEmailWorkerCycle();

  assert.deepEqual({ ...result }, { ok: false, code: "supabase_unavailable", skipped: true, processed: 0 });
  assert.equal(state.rpcCalls.length, 0);
});

test("worker reports an already-running cycle without claiming a job", async () => {
  const state = createState();
  const { runNotificationEmailWorkerCycle } = buildHarness(state, { workerAlreadyRunning: true });
  const result = await runNotificationEmailWorkerCycle();

  assert.deepEqual({ ...result }, { ok: false, code: "worker_already_running", skipped: true, processed: 0 });
  assert.equal(state.rpcCalls.length, 0);
});

test("worker reports an invalid allowlist delivery ID without claiming a job", async () => {
  const state = createState();
  const { runNotificationEmailWorkerCycle } = buildHarness(state, { testDeliveryId: "not-a-uuid" });
  const result = await runNotificationEmailWorkerCycle();

  assert.deepEqual({ ...result }, {
    ok: false,
    code: "invalid_delivery_id",
    message: "The configured delivery ID is invalid; no email job was claimed.",
    processed: 0,
  });
  assert.equal(state.rpcCalls.length, 0);
});

test("worker reports claim failure without exposing the database error", async () => {
  const state = createState({ state: { claimError: { code: "PGRST202", message: "private database detail" } } });
  const { runNotificationEmailWorkerCycle } = buildHarness(state);
  const result = await runNotificationEmailWorkerCycle();

  assert.deepEqual({ ...result }, {
    ok: false,
    code: "claim_failed",
    message: "The email queue claim failed.",
    processed: 0,
  });
  assert.doesNotMatch(JSON.stringify(result), /private database detail/);
});

test("worker harness performs no external network operations", async () => {
  const state = createState();
  state.jobs.push(lockedJob(state));
  const { drainNotificationEmailQueue } = buildHarness(state);
  await drainNotificationEmailQueue();

  assert.equal(state.fetchCalls.length, 1);
  assert.match(state.fetchCalls[0][0], /api\.brevo\.com/);
  assert.equal(state.fetchCalls[0][1].headers["api-key"], "fictional-brevo-key");
});
