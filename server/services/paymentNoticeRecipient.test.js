import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { resolvePaymentNoticeRecipient } from "./paymentNoticeRecipient.js";

const serverSource = fs.readFileSync(
  fileURLToPath(new URL("../../server.js", import.meta.url)),
  "utf8",
);

test("guest orders use the persisted customer email", () => {
  assert.deepEqual(
    resolvePaymentNoticeRecipient({ user_id: null, customer_email: " Guest@example.com " }),
    { eligible: true, userId: null, email: "guest@example.com" },
  );
});

test("registered orders remain eligible with their persisted email", () => {
  assert.deepEqual(
    resolvePaymentNoticeRecipient({ user_id: "user-001", customer_email: "customer@example.com" }),
    { eligible: true, userId: "user-001", email: "customer@example.com" },
  );
});

test("missing or malformed persisted emails are rejected", () => {
  assert.equal(resolvePaymentNoticeRecipient({ user_id: null, customer_email: "" }).eligible, false);
  assert.equal(resolvePaymentNoticeRecipient({ user_id: "user-001", customer_email: "not-an-email" }).eligible, false);
});

test("payment reminders retain source-key duplicate protection", () => {
  assert.match(serverSource, /source_key: accounting\.sourceKey/);
  assert.match(serverSource, /\.eq\("source_key", accounting\.sourceKey\)/);
  assert.match(serverSource, /A payment notice has already been sent for this outstanding balance/);
});
