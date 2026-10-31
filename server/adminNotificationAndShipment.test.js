import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverSource = fs.readFileSync(path.join(root, "server.js"), "utf8");
const notificationPage = fs.readFileSync(path.join(root, "src/pages/Admin/notification/notifications.jsx"), "utf8");
const storageSource = fs.readFileSync(path.join(root, "src/shared/shipmentStorage.js"), "utf8");
const archiveMigration = fs.readFileSync(path.join(root, "supabase/migrations/20261031_0055_admin_notification_archive.sql"), "utf8");

test("admin notification mutations require active admin routes and preserve history", () => {
  assert.match(serverSource, /handleAdminNotificationStatus/);
  assert.match(serverSource, /handleAdminNotificationArchive/);
  assert.match(serverSource, /isActiveAdminProfile\(profileResult\.profile\)/);
  assert.match(serverSource, /admin_deleted_at: new Date\(\)\.toISOString\(\)/);
  assert.doesNotMatch(serverSource, /from\("notifications"\)\.delete/);
  assert.match(notificationPage, /window\.confirm\("Hide this notification/);
  assert.match(notificationPage, /Mark read/);
  assert.match(notificationPage, /Mark unread/);
});

test("notification archive migration adds an admin-only soft-delete marker", () => {
  assert.match(archiveMigration, /add column if not exists admin_deleted_at timestamptz/i);
  assert.match(archiveMigration, /where admin_deleted_at is null/i);
  assert.match(archiveMigration, /coalesce\(auth\.role\(\), ''\) <> 'service_role'/i);
  assert.match(archiveMigration, /notifications_guard_admin_archive/);
  assert.doesNotMatch(archiveMigration, /delete\s+from/i);
});

test("shipment storage maps common RPC failures to safe admin messages", () => {
  assert.match(storageSource, /Only active administrators/);
  assert.match(storageSource, /This tracking status is not supported/);
  assert.match(storageSource, /A tracking update with these details already exists/);
  assert.match(storageSource, /Unable to connect to the server/);
  assert.match(storageSource, /The tracking update could not be saved/);
});

test("shipment saves remain admin-only RPC operations with duplicate-submit guards in the UI", () => {
  assert.match(storageSource, /supabase\.rpc\("save_shipment_track"/);
  const page = fs.readFileSync(path.join(root, "src/pages/Admin/shipment/shipment.jsx"), "utf8");
  assert.match(page, /disabled=\{saving\}/);
  assert.match(page, /setSaving\(true\)/);
  assert.match(page, /setError\(result\.message\)/);
});
