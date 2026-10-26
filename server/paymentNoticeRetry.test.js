import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const serverSource = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "server.js"),
  "utf8",
);

function extractFunction(name) {
  const match = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(serverSource);
  assert.ok(match, `Expected ${name} to exist in server.js`);
  const openBrace = serverSource.indexOf("{", match.index);
  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let index = openBrace; index < serverSource.length; index += 1) {
    const character = serverSource[index];
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
    if (character === "}" && --depth === 0) return serverSource.slice(match.index, index + 1);
  }
  throw new Error(`Could not extract ${name}`);
}

function buildHarness(state) {
  const query = {
    select() { return query; },
    eq(column, value) {
      state.filters.push([column, value]);
      return query;
    },
    lt(column, value) {
      state.filters.push([column, value]);
      return query;
    },
    maybeSingle: async () => {
      if (state.updateValues) {
        if (state.concurrentUpdate || state.delivery.status !== "failed") return { data: null, error: null };
        Object.assign(state.delivery, state.updateValues);
        return { data: { id: state.delivery.id, status: state.delivery.status, attempts: state.delivery.attempts }, error: null };
      }
      return { data: state.delivery, error: null };
    },
    update(values) {
      state.updateValues = values;
      return query;
    },
  };

  const context = {
    Date,
    console: { info() {}, warn() {}, error() {} },
    isEmailQueueProcessingEnabled: () => state.queueEnabled,
    isEmailQueueAvailable: async () => state.queueAvailable,
    supabaseAdmin: { from: () => query },
  };

  vm.runInNewContext(`${extractFunction("requeueNotificationEmail")}\nthis.api = { requeueNotificationEmail };`, context, {
    filename: "server.js payment notice retry harness",
  });
  return context.api;
}

function createState(overrides = {}) {
  return {
    queueEnabled: true,
    queueAvailable: true,
    filters: [],
    updateValues: null,
    concurrentUpdate: false,
    delivery: {
      id: "delivery-fictional-001",
      status: "failed",
      attempts: 1,
      max_attempts: 5,
      last_attempt_at: new Date(Date.now() - (6 * 60 * 1000)).toISOString(),
      updated_at: new Date(Date.now() - (6 * 60 * 1000)).toISOString(),
      next_attempt_at: new Date().toISOString(),
    },
    ...overrides,
  };
}

test("disabled or unavailable queues never send or update a delivery", async () => {
  const disabled = createState({ queueEnabled: false });
  const disabledResult = await buildHarness(disabled).requeueNotificationEmail("notification-fictional-001");
  assert.equal(disabledResult.code, "queue_disabled");
  assert.equal(disabled.updateValues, null);

  const unavailable = createState({ queueAvailable: false });
  const unavailableResult = await buildHarness(unavailable).requeueNotificationEmail("notification-fictional-001");
  assert.equal(unavailableResult.code, "queue_unavailable");
  assert.equal(unavailable.updateValues, null);
});

test("only failed deliveries past the cooldown can be requeued", async () => {
  const active = createState({ delivery: { ...createState().delivery, status: "pending" } });
  const activeResult = await buildHarness(active).requeueNotificationEmail("notification-fictional-001");
  assert.match(activeResult.message, /Only failed/);

  const cooling = createState({
    delivery: {
      ...createState().delivery,
      last_attempt_at: new Date(Date.now() - (60 * 1000)).toISOString(),
    },
  });
  const coolingResult = await buildHarness(cooling).requeueNotificationEmail("notification-fictional-001");
  assert.equal(coolingResult.code, "retry_cooldown");
  assert.equal(cooling.updateValues, null);

  const ready = createState();
  const readyResult = await buildHarness(ready).requeueNotificationEmail("notification-fictional-001");
  assert.equal(readyResult.ok, true);
  assert.equal(readyResult.status, "queued");
  assert.equal(ready.delivery.status, "pending");
  assert.equal(ready.delivery.attempts, 1);
});

test("retry limit and concurrent updates fail closed", async () => {
  const exhausted = createState({ delivery: { ...createState().delivery, attempts: 5 } });
  const exhaustedResult = await buildHarness(exhausted).requeueNotificationEmail("notification-fictional-001");
  assert.equal(exhaustedResult.code, "retry_limit_reached");

  const concurrent = createState({ concurrentUpdate: true });
  const concurrentResult = await buildHarness(concurrent).requeueNotificationEmail("notification-fictional-001");
  assert.equal(concurrentResult.ok, false);
  assert.equal(concurrent.updateValues !== null, true);
});

test("admin authorization and Pay Now link regeneration remain server-side", () => {
  assert.match(serverSource, /Only active administrators can send order payment notices/);
  assert.match(serverSource, /buildOrderPaymentReminderUrl\(orderResult\.order\.id\)/);
  assert.match(serverSource, /order-payment-request:/);
  const retryStart = serverSource.indexOf("if (body?.retryEmail)");
  const retryEnd = serverSource.indexOf("sendJson(res, 409", retryStart);
  assert.ok(retryStart >= 0 && retryEnd > retryStart);
  assert.doesNotMatch(serverSource.slice(retryStart, retryEnd), /sendOrderPaymentEmail/);
});
