import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migration = fs.readFileSync(
  path.join(projectRoot, "supabase", "migrations", "20261025_0041_guest_account_setup_email.sql"),
  "utf8",
);
const serverSource = fs.readFileSync(path.join(projectRoot, "server.js"), "utf8");

test("guest account migration preserves existing notification source types", () => {
  for (const sourceType of ["announcement", "order_status", "payment_status", "shipment_event", "account_setup"]) {
    assert.match(migration, new RegExp(`'${sourceType}'`));
  }
});

test("notification normalization only references OLD during UPDATE", () => {
  const updateBlock = migration.match(/if tg_op = 'UPDATE' then[\s\S]*?end if;\s*\n\s*if coalesce\(new\.is_read, false\)/)?.[0] ?? "";
  const readStateBlock = migration.match(/if coalesce\(new\.is_read, false\) then[\s\S]*?end if;\s*\n\s*if new\.is_read is null/)?.[0] ?? "";

  assert.match(updateBlock, /old\.read_at/);
  assert.doesNotMatch(readStateBlock.replace(/if tg_op = 'UPDATE'[\s\S]*?end if;/, ""), /old\./);
});

test("account setup remains server-triggered and not client-insertable", () => {
  const normalizeFunction = migration.slice(
    migration.indexOf("create or replace function private.normalize_notifications_write()"),
    migration.indexOf("create or replace function private.queue_notification_email()"),
  );
  const queueFunction = migration.slice(migration.indexOf("create or replace function private.queue_notification_email()"));

  assert.match(normalizeFunction, /security invoker/);
  assert.doesNotMatch(normalizeFunction, /security definer/);
  assert.match(queueFunction, /security definer/);
  assert.match(normalizeFunction, /set search_path = ''/);
  assert.match(queueFunction, /set search_path = ''/);
  assert.match(migration, /revoke insert on table public\.notifications from public, anon, authenticated/);
  assert.match(migration, /revoke all on function private\.queue_notification_email\(\) from public, anon, authenticated/);
  assert.match(migration, /revoke all on function private\.normalize_notifications_write\(\) from public, anon, authenticated/);
  assert.match(migration, /on conflict \(notification_id\) do nothing/);
});

test("account setup delivery binds recovery links to the Auth email", () => {
  assert.match(serverSource, /auth\.admin\.getUserById\(userId\)/);
  assert.match(serverSource, /email: authEmail/);
  assert.match(serverSource, /to: authEmail/);
  assert.doesNotMatch(serverSource, /linkError\.message/);
});
