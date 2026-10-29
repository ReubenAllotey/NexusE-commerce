import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverSource = fs.readFileSync(path.join(projectRoot, "server.js"), "utf8");

test("guest account setup recovery is admin-authenticated and uses persisted successful order payments", () => {
  const start = serverSource.indexOf("async function handleAdminGuestAccountSetupReconcile");
  const end = serverSource.indexOf("async function handleAdminPaymentReconcile", start);
  assert.ok(start >= 0 && end > start);
  const endpoint = serverSource.slice(start, end);

  assert.match(endpoint, /getAuthenticatedUser\(req\)/);
  assert.match(endpoint, /isActiveAdminProfile\(profileResult\.profile\)/);
  assert.match(endpoint, /reconcileGuestAccountSetupForOrder\(order\.id\)/);
  assert.doesNotMatch(endpoint, /fetch\(`https:\/\/api\.paystack\.co/);
  assert.doesNotMatch(endpoint, /updatePaymentRow|createPendingPaymentRecord|initialize/);
});

test("guest account recovery is bounded, idempotent, and does not touch delivery rows", () => {
  const start = serverSource.indexOf("async function reconcileGuestAccountSetupForOrder");
  const end = serverSource.indexOf("async function sendNotificationEmailForRow", start);
  assert.ok(start >= 0 && end > start);
  const recovery = serverSource.slice(start, end);

  assert.match(recovery, /payment_purpose.*order/);
  assert.match(recovery, /status.*successful/);
  assert.match(recovery, /guestAccountSetupReconciliationInFlight/);
  assert.match(recovery, /account setup notification/);
  assert.match(recovery, /updateGuestOrderBundle/);
  assert.doesNotMatch(recovery, /notification_email_deliveries/);
  assert.doesNotMatch(recovery, /push_delivery_queue/);
});

test("recovery route is registered separately from payment verification", () => {
  assert.match(serverSource, /pathname === "\/api\/admin\/guest-account-setup\/reconcile"/);
  assert.match(serverSource, /req\.method === "POST"/);
  assert.match(serverSource, /ensureGuestAccountSetupNotification/);
});
