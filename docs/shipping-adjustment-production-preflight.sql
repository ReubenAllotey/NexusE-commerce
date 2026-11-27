-- READ-ONLY production preflight for shipping fee adjustments and credits.
-- Do not run this file with a transaction that writes data.

select current_database(), current_user;

select n.nspname as table_schema, c.relname as table_name, c.relrowsecurity as row_security
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'shipping_fee_adjustments',
    'shipping_fee_adjustment_orders',
    'shipping_credit_ledger'
  )
  and c.relkind = 'r'
order by c.relname;

select to_regclass('public.shipping_payment_allocations') as shipping_payment_allocations;

select tg.tgname, c.relname, pg_get_triggerdef(tg.oid)
from pg_trigger tg
join pg_class c on c.oid = tg.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where not tg.tgisinternal
  and n.nspname = 'public'
  and tg.tgname in ('order_items_apply_shipping_credit');

select n.nspname as schema_name, p.proname, pg_get_function_identity_arguments(p.oid) as arguments,
       p.prosecdef, p.proconfig
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'preview_shipping_fee_adjustment',
    'apply_shipping_fee_adjustment',
    'reverse_shipping_credit',
    'get_my_shipping_credit_ledger'
  )
order by p.proname, arguments;

select p.proname, pg_get_function_identity_arguments(p.oid) as arguments, p.prosecdef, p.proconfig
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'finalize_shipping_payment';

select routine_schema, routine_name, grantee, privilege_type
from information_schema.routine_privileges
where routine_schema = 'public'
  and routine_name in (
    'preview_shipping_fee_adjustment',
    'apply_shipping_fee_adjustment',
    'reverse_shipping_credit',
    'get_my_shipping_credit_ledger'
  )
order by routine_name, grantee, privilege_type;

select schemaname, tablename, policyname, roles, cmd
from pg_policies
where schemaname = 'public'
  and tablename in ('shipping_fee_adjustments', 'shipping_fee_adjustment_orders', 'shipping_credit_ledger')
order by tablename, policyname;

select tg.tgname, c.relname, pg_get_triggerdef(tg.oid)
from pg_trigger tg
join pg_class c on c.oid = tg.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where not tg.tgisinternal
  and n.nspname = 'public'
  and (c.relname in ('products', 'notifications') or tg.tgname like '%shipping%');

select 'products' as entity, count(*)::bigint as row_count,
       coalesce(sum(coalesce(price, 0)), 0) as amount_total
from public.products
union all
select 'orders', count(*)::bigint, coalesce(sum(coalesce(total, 0)), 0)
from public.orders
union all
select 'payments', count(*)::bigint, coalesce(sum(coalesce(amount, 0)), 0)
from public.payments
union all
select 'notifications', count(*)::bigint, 0
from public.notifications;
