import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync(new URL("../supabase/migrations/20261125_0063_currency_exchange_pricing.sql", import.meta.url), "utf8");
const server = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
const editor = fs.readFileSync(new URL("../src/pages/Admin/products/ProductEditorForm.jsx", import.meta.url), "utf8");

test("currency pricing migration keeps private tables service-role-only", () => {
  for (const table of ["exchange_rate_settings", "exchange_rate_history", "exchange_rate_refresh_leases", "product_pricing_metadata", "product_repricing_history", "product_repricing_operations"]) {
    assert.match(migration, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated;`));
    if (table === "product_repricing_history") {
      assert.match(migration, /grant select on table public\.product_repricing_history to service_role;/);
    } else {
      assert.match(migration, new RegExp(`grant all on table public\\.${table} to service_role;`));
    }
  }
  assert.match(migration, /alter table public\.product_repricing_operations enable row level security;/);
  assert.match(migration, /create or replace function public\.update_exchange_rate_settings/);
  assert.match(migration, /provider_next_update_at timestamptz/);
  assert.match(migration, /manual_rate_version uuid/);
  assert.match(migration, /manual_rate_version', v_settings\.manual_rate_version/);
  assert.match(migration, /create or replace function public\.save_priced_product_bundle\(payload jsonb, pricing_metadata jsonb\)/);
  assert.match(migration, /grant execute on function public\.save_priced_product_bundle\(jsonb, jsonb\) to service_role;/);
  assert.match(migration, /create or replace function public\.claim_exchange_rate_refresh\(p_lease_seconds integer default 300\)/);
  assert.match(migration, /returns uuid/);
  assert.match(migration, /create or replace function public\.release_exchange_rate_refresh\(p_lease_token uuid\)/);
  assert.doesNotMatch(migration, /jsonb_object_length/);
  assert.match(migration, /jsonb_object_keys/);
  assert.match(migration, /p_refresh_lease_token uuid/);
  assert.match(migration, /for update|lease_until <= clock_timestamp\(\)/);
  assert.match(migration, /grant execute on function public\.claim_exchange_rate_refresh\(integer\) to service_role;/);
  assert.match(migration, /grant execute on function public\.release_exchange_rate_refresh\(uuid\) to service_role;/);
  assert.match(migration, /set search_path = ''/);
});

test("scheduled refresh claims a durable lease before calling the provider and releases it", () => {
  const refreshFunction = fs.readFileSync(new URL("../supabase/functions/refresh-exchange-rate/index.ts", import.meta.url), "utf8");
  assert.match(refreshFunction, /rpc\/claim_exchange_rate_refresh/);
  assert.match(refreshFunction, /p_lease_seconds: 300/);
  assert.match(refreshFunction, /refresh_in_progress/);
  assert.match(refreshFunction, /rpc\/release_exchange_rate_refresh/);
  assert.match(refreshFunction, /p_refresh_lease_token: leaseToken/);
  assert.match(refreshFunction, /p_lease_token: leaseToken/);
  assert.match(refreshFunction, /finally/);
});

test("currency endpoints require active admins and save CNY through server conversion", () => {
  assert.match(server, /pathname === "\/api\/admin\/exchange-rates\/refresh" && req\.method === "POST"/);
  assert.match(server, /pathname === "\/api\/admin\/products\/priced" && req\.method === "POST"/);
  assert.match(server, /const admin = await getActiveAdminForRequest\(req\);/);
  assert.match(server, /convertCnyToGhs\(originalCnyPrice, activeRate\.rate\)/);
  assert.match(server, /save_priced_product_bundle/);
});

test("product editor exposes CNY and GHS pricing explicitly", () => {
  assert.match(editor, /name="pricingCurrency"/);
  assert.match(editor, /value=\{formData\.pricingCurrency\}/);
  assert.match(editor, /originalCnyPrice/);
  assert.match(editor, /Preview at current active rate/);
});
