import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync(new URL("../supabase/migrations/20261125_0063_currency_exchange_pricing.sql", import.meta.url), "utf8");
const server = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
const editor = fs.readFileSync(new URL("../src/pages/Admin/products/ProductEditorForm.jsx", import.meta.url), "utf8");

test("currency pricing migration keeps private tables service-role-only", () => {
  for (const table of ["exchange_rate_settings", "exchange_rate_history", "exchange_rate_refresh_leases", "product_pricing_metadata", "product_repricing_history", "product_repricing_operations"]) {
    assert.match(migration, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated;`));
    if (["exchange_rate_history", "product_repricing_history"].includes(table)) {
      assert.match(migration, new RegExp(`grant select on table public\\.${table} to service_role;`));
    } else {
      assert.match(migration, new RegExp(`grant all on table public\\.${table} to service_role;`));
    }
  }
  assert.match(migration, /alter table public\.product_repricing_operations enable row level security;/);
  assert.match(migration, /create or replace function public\.update_exchange_rate_settings/);
  assert.match(migration, /provider_next_update_at timestamptz/);
  assert.match(migration, /manual_rate_version uuid/);
  assert.match(migration, /manual_rate_version', v_settings\.manual_rate_version/);
  assert.match(migration, /create or replace function public\.save_priced_product_bundle\(\s*payload jsonb,\s*pricing_metadata jsonb,\s*p_administrator_id uuid\s*\)/);
  assert.match(migration, /grant execute on function public\.save_priced_product_bundle\(jsonb, jsonb, uuid\) to service_role;/);
  assert.match(migration, /set_config\('request\.jwt\.claim\.sub', p_administrator_id::text, true\)/);
  assert.match(migration, /prevent_untracked_cny_pricing_mutation/);
  assert.match(migration, /save_product_variation_combinations/);
  assert.match(migration, /Complete variation pricing metadata is required/);
  assert.match(migration, /revoke all on function public\.prevent_untracked_cny_pricing_mutation\(\) from public, anon, authenticated, service_role;/);
  assert.match(migration, /p_max_live_age_seconds integer default 86400/);
  assert.match(migration, /grant execute on function public\.apply_product_currency_repricing\(uuid, uuid, numeric, text, uuid, uuid\[\], jsonb, integer\) to service_role;/);
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
  assert.match(refreshFunction, /fetchJson/);
  assert.match(refreshFunction, /baseCurrency !== "CNY"/);
  assert.match(refreshFunction, /typeof leaseToken !== "string"/);
  assert.match(refreshFunction, /finally/);
});

test("currency endpoints require active admins and save CNY through server conversion", () => {
  assert.match(server, /pathname === "\/api\/admin\/exchange-rates\/refresh" && req\.method === "POST"/);
  assert.match(server, /pathname === "\/api\/admin\/products\/priced" && req\.method === "POST"/);
  assert.match(server, /const admin = await getActiveAdminForRequest\(req\);/);
  assert.match(server, /convertCnyToGhs\(originalCnyPrice, activeRate\.rate\)/);
  assert.match(server, /save_priced_product_bundle/);
  assert.match(server, /p_administrator_id: admin\.user\.id/);
  assert.match(server, /variation_combinations: convertedVariationCombinations/);
});

test("product editor exposes CNY and GHS pricing explicitly", () => {
  assert.match(editor, /name="pricingCurrency"/);
  assert.match(editor, /value=\{formData\.pricingCurrency\}/);
  assert.match(editor, /originalCnyPrice/);
  assert.match(editor, /Preview at current active rate/);
});
