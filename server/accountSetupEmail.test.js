import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildAccountSetupEmail, buildGuestAccountSetupNotification } from "./services/accountSetupEmail.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverSource = fs.readFileSync(path.join(projectRoot, "server.js"), "utf8");

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
