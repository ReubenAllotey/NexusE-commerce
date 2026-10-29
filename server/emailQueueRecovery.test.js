import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runEmailQueueRecovery } from "../scripts/emailQueueRecovery.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const queueMigration = fs.readFileSync(
  path.join(projectRoot, "supabase", "migrations", "20261012_0032_notification_email_queue.sql"),
  "utf8",
);

test("scheduled recovery invokes the existing worker without changing the allowlist", async () => {
  const calls = [];
  const result = await runEmailQueueRecovery({
    workerUrl: "https://nexuse-commerce.onrender.com/internal/email-queue/worker",
    workerSecret: "fictional-worker-secret",
    fetchImpl: async (...args) => {
      calls.push(args);
      return { ok: true, status: 200, json: async () => ({ ok: true, processed: 0 }) };
    },
  });

  assert.deepEqual(result, { ok: true, status: 200, processed: 0 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "https://nexuse-commerce.onrender.com/internal/email-queue/worker");
  assert.equal(calls[0][1].method, "POST");
  assert.equal(calls[0][1].headers.authorization, "Bearer fictional-worker-secret");
  assert.deepEqual(JSON.parse(calls[0][1].body), { source: "scheduled_recovery" });
  assert.doesNotMatch(calls[0][1].body, /EMAIL_QUEUE_TEST_DELIVERY_ID/);
});

test("scheduled recovery fails closed when worker credentials are missing", async () => {
  let fetchCalled = false;
  await assert.rejects(
    () => runEmailQueueRecovery({ fetchImpl: async () => { fetchCalled = true; } }),
    /worker URL and worker secret/,
  );
  assert.equal(fetchCalled, false);
});

test("scheduled recovery reports worker failures without retrying the request", async () => {
  let callCount = 0;
  await assert.rejects(
    () => runEmailQueueRecovery({
      workerUrl: "https://nexuse-commerce.onrender.com/internal/email-queue/worker",
      workerSecret: "fictional-worker-secret",
      fetchImpl: async () => {
        callCount += 1;
      return { ok: false, status: 503, json: async () => ({ ok: false }) };
      },
    }),
    /HTTP 503/,
  );
  assert.equal(callCount, 1);
});

test("scheduled recovery rejects malformed worker responses and unsafe URL overrides", async () => {
  await assert.rejects(
    () => runEmailQueueRecovery({
      workerSecret: "fictional-worker-secret",
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new Error("invalid json"); } }),
    }),
    /malformed JSON/,
  );
  await assert.rejects(
    () => runEmailQueueRecovery({
      workerUrl: "https://attacker.example.invalid/internal/email-queue/worker",
      workerSecret: "fictional-worker-secret",
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }),
    }),
    /not trusted/,
  );
});

test("existing queue claim logic recovers only due retryable or expired processing jobs", () => {
  assert.match(queueMigration, /q\.attempts < q\.max_attempts/);
  assert.match(queueMigration, /q\.status in \('pending', 'failed'\)/);
  assert.match(queueMigration, /q\.status = 'processing'[\s\S]*q\.locked_at < now\(\) - p_lease_timeout/);
  assert.match(queueMigration, /for update skip locked/);

  const hardenedMigration = fs.readFileSync(
    path.join(projectRoot, "supabase", "migrations", "20261029_0052_email_delivery_manual_review.sql"),
    "utf8",
  );
  assert.match(hardenedMigration, /manual_review/);
  assert.match(hardenedMigration, /status in \('pending', 'failed'\)/);
  assert.match(hardenedMigration, /status = 'manual_review'/);
  assert.doesNotMatch(hardenedMigration, /status in \('pending', 'failed', 'processing'\)/);
});
