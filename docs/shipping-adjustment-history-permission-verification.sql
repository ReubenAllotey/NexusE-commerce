-- READ-ONLY verification for migration 0069.
-- Run after applying the migration. This script performs no writes.

select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'shipping_fee_adjustments',
    'shipping_fee_adjustment_orders',
    'shipping_credit_ledger'
  )
order by c.relname;

select
  table_name,
  grantee,
  privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in (
    'shipping_fee_adjustments',
    'shipping_fee_adjustment_orders',
    'shipping_credit_ledger'
  )
  and grantee in ('public', 'anon', 'authenticated', 'service_role')
order by table_name, grantee, privilege_type;

select
  has_table_privilege('service_role', 'public.shipping_fee_adjustments', 'SELECT') as service_role_adjustments_select,
  has_table_privilege('service_role', 'public.shipping_fee_adjustment_orders', 'SELECT') as service_role_adjustment_orders_select,
  has_table_privilege('service_role', 'public.shipping_credit_ledger', 'SELECT') as service_role_credit_ledger_select,
  has_table_privilege('service_role', 'public.shipping_fee_adjustments', 'INSERT') as service_role_adjustments_insert,
  has_table_privilege('service_role', 'public.shipping_fee_adjustment_orders', 'INSERT') as service_role_adjustment_orders_insert,
  has_table_privilege('service_role', 'public.shipping_credit_ledger', 'INSERT') as service_role_credit_ledger_insert,
  has_table_privilege('anon', 'public.shipping_fee_adjustments', 'SELECT') as anon_adjustments_select,
  has_table_privilege('authenticated', 'public.shipping_fee_adjustments', 'SELECT') as authenticated_adjustments_select;

select
  n.nspname as function_schema,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments,
  p.prosecdef as security_definer,
  has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_execute,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'get_my_shipping_credit_ledger';
