import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migration = fs.readFileSync(
  path.join(projectRoot, "supabase", "migrations", "20261026_0042_transactional_shipment_notifications.sql"),
  "utf8",
);

test("shipment notification migration uses current transactional notification values", () => {
  assert.match(migration, /security definer/i);
  assert.match(migration, /set search_path = ''/i);
  assert.match(migration, /'shipping'/);
  assert.match(migration, /'shipment_event'/);
  assert.doesNotMatch(migration, /'shipments'/);
  assert.doesNotMatch(migration, /'shipment_status'/);
  assert.match(migration, /recipient_email/);
  assert.match(migration, /shipment-track-event:%s:/);
  assert.match(migration, /on conflict do nothing/i);
});

test("shipment notification migration limits recipients to paid eligible orders", () => {
  assert.match(migration, /lower\(coalesce\(p\.status, ''\)\) = 'successful'/i);
  assert.match(migration, /p\.payment_purpose[\s\S]*= 'order'/i);
  assert.match(migration, /sibling_payment\.payment_purpose[\s\S]*= 'order'/i);
  assert.match(migration, /not in \('cancelled', 'canceled', 'failed', 'abandoned'\)/i);
  assert.match(migration, /o\.user_id is not null or nullif\(btrim\(o\.customer_email\), ''\) is not null/i);
  assert.match(migration, /sibling\.customer_email.*o\.customer_email/s);
  assert.doesNotMatch(migration, /sibling\.user_id is not distinct from o\.user_id/i);
});

test("guest shipment notifications omit authenticated-only action links", () => {
  assert.match(migration, /null, v_order\.customer_email, v_order\.customer_name, 'shipping'[\s\S]*?v_order\.order_id, null, null, null, null,/i);
});
