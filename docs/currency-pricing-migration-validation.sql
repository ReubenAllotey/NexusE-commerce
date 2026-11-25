-- Nexus currency pricing migration validation
-- These statements are for a Supabase SQL Editor review. Do not run the
-- permanent application section until migration 0063 has been approved.

-- A. Read-only production compatibility checks
select table_schema, table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('products', 'product_variation_combinations', 'profiles', 'orders', 'payments', 'exchange_rate_settings', 'exchange_rate_history', 'exchange_rate_refresh_leases', 'product_pricing_metadata', 'product_repricing_history', 'product_repricing_operations');

select column_name, data_type, numeric_precision, numeric_scale
from information_schema.columns
where table_schema = 'public'
  and table_name in ('products', 'product_variation_combinations')
order by table_name, ordinal_position;

select count(*) as product_count,
       coalesce(sum(price), 0) as product_price_sum,
       count(*) filter (where price < 0) as negative_price_count
from public.products;

select count(*) as order_count, coalesce(sum(amount_due_now), 0) as order_amount_due_sum
from public.orders;

select n.nspname as routine_schema, p.proname as routine_name, pg_get_function_identity_arguments(p.oid) as arguments
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('save_product_bundle', 'save_priced_product_bundle', 'get_exchange_rate_settings', 'update_exchange_rate_settings', 'apply_product_currency_repricing', 'claim_exchange_rate_refresh', 'release_exchange_rate_refresh');

select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('exchange_rate_settings', 'exchange_rate_history', 'product_pricing_metadata', 'product_repricing_history', 'product_repricing_operations')
order by table_name, grantee, privilege_type;

-- B. Rollback rehearsal
-- In a disposable database, or in a controlled SQL Editor session after a
-- fresh backup, execute:
-- begin;
-- set local lock_timeout = '5s';
-- set local statement_timeout = '60s';
-- paste the contents of 20261125_0063_currency_exchange_pricing.sql here,
-- omitting its first BEGIN and final COMMIT;
-- rollback;

-- C. Post-rehearsal verification
select to_regclass('public.exchange_rate_settings') as settings_table,
       to_regclass('public.product_pricing_metadata') as metadata_table,
       to_regprocedure('public.get_exchange_rate_settings()') as settings_function,
       to_regprocedure('public.apply_product_currency_repricing(uuid,uuid,numeric,text,uuid,uuid[],jsonb)') as repricing_function,
       to_regprocedure('public.claim_exchange_rate_refresh(integer)') as claim_function,
       to_regprocedure('public.release_exchange_rate_refresh(uuid)') as release_function;

-- D. Permanent application
-- Run the complete migration file exactly once through the normal Supabase
-- migration process. Do not remove its BEGIN/COMMIT and do not use the
-- rollback rehearsal in place of the permanent migration.

-- E. Post-migration verification
select to_regclass('public.exchange_rate_settings') as settings_table,
       to_regclass('public.exchange_rate_history') as history_table,
       to_regclass('public.product_pricing_metadata') as metadata_table,
       to_regclass('public.product_repricing_history') as repricing_history,
       to_regclass('public.product_repricing_operations') as repricing_operations;

select routine_schema, routine_name, security_type, data_type
from information_schema.routines
where routine_schema = 'public'
  and routine_name in ('get_exchange_rate_settings', 'update_exchange_rate_settings', 'save_priced_product_bundle', 'apply_product_currency_repricing', 'claim_exchange_rate_refresh', 'release_exchange_rate_refresh');

select conrelid::regclass as table_name, conname, contype
from pg_catalog.pg_constraint
where conrelid in (
  'public.exchange_rate_settings'::regclass,
  'public.product_pricing_metadata'::regclass,
  'public.product_repricing_operations'::regclass,
  'public.product_repricing_history'::regclass
)
order by table_name, conname;

select routine_schema, routine_name, specific_name, grantee, privilege_type
from information_schema.routine_privileges
where routine_schema = 'public'
  and routine_name in ('get_exchange_rate_settings', 'update_exchange_rate_settings', 'save_priced_product_bundle', 'apply_product_currency_repricing', 'claim_exchange_rate_refresh', 'release_exchange_rate_refresh')
order by routine_name, grantee;

select schemaname, tablename, rowsecurity
from pg_catalog.pg_tables
where schemaname = 'public'
  and tablename in ('exchange_rate_settings', 'exchange_rate_history', 'product_pricing_metadata', 'product_repricing_history', 'product_repricing_operations');

-- Capture this before and after migration; the two values must match.
select count(*) as product_count,
       coalesce(sum(price), 0) as product_price_sum,
       coalesce(sum(compare_at), 0) as product_compare_at_sum
from public.products;

select count(*) as orders, count(*) filter (where status is not null) as orders_with_status
from public.orders;

select count(*) as payments, coalesce(sum(amount), 0) as payment_amount_sum
from public.payments;
