import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAccountSetupEmail,
  buildGuestAccountSetupNotification,
} from "./accountSetupEmail.js";

test("account setup notification is stable and idempotent by order", () => {
  const first = buildGuestAccountSetupNotification({ id: "order-1", user_id: "user-1" });
  const second = buildGuestAccountSetupNotification({ id: "order-1", user_id: "user-1" });

  assert.deepEqual(first, second);
  assert.equal(first.source_type, "account_setup");
  assert.equal(first.source_key, "account-setup:order-1");
  assert.equal(buildGuestAccountSetupNotification({ id: "order-1" }), null);
});

test("account setup email escapes customer content and includes secure link", () => {
  const email = buildAccountSetupEmail({
    customerName: '<Test Customer & Co>',
    actionLink: "https://example.test/account/set-password?token=abc",
    appUrl: "https://example.test",
  });

  assert.match(email.subject, /Set up/);
  assert.match(email.text, /https:\/\/example\.test\/account\/set-password/);
  assert.match(email.html, /&lt;Test Customer &amp; Co&gt;/);
  assert.doesNotMatch(email.html, /<Test Customer & Co>/);
});
