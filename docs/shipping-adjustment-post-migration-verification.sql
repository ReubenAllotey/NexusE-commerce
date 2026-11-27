-- READ-ONLY post-migration verification for shipping fee adjustments and credits.

select table_name, row_security
from information_schema.tables
where table_schema = 'public'
  and table_name in ('shipping_fee_adjustments', 'shipping_fee_adjustment_orders', 'shipping_credit_ledger')
order by table_name;

select to_regclass('public.shipping_payment_allocations') as shipping_payment_allocations;

select tg.tgname, c.relname, pg_get_triggerdef(tg.oid)
from pg_trigger tg
join pg_class c on c.oid = tg.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where not tg.tgisinternal
  and n.nspname = 'public'
  and tg.tgname in ('order_items_apply_shipping_credit');

select conrelid::regclass as table_name, conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid in (
  'public.shipping_fee_adjustments'::regclass,
  'public.shipping_fee_adjustment_orders'::regclass,
  'public.shipping_credit_ledger'::regclass
)
order by table_name, conname;

select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as arguments,
       p.prosecdef, p.proconfig,
       has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('preview_shipping_fee_adjustment','apply_shipping_fee_adjustment','reverse_shipping_credit','get_my_shipping_credit_ledger')
order by p.proname, arguments;

select p.proname, pg_get_function_identity_arguments(p.oid) as arguments,
       p.prosecdef, p.proconfig,
       has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'finalize_shipping_payment';

select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('shipping_fee_adjustments','shipping_fee_adjustment_orders','shipping_credit_ledger')
order by tablename, policyname;

select tg.tgname, c.relname, pg_get_triggerdef(tg.oid)
from pg_trigger tg
join pg_class c on c.oid = tg.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where not tg.tgisinternal
  and n.nspname = 'public'
  and (c.relname in ('products','notifications') or tg.tgname like '%shipping%');

select count(*)::bigint as adjustment_rows from public.shipping_fee_adjustments;
select count(*)::bigint as credit_ledger_rows, coalesce(sum(amount_minor), 0)::bigint as credit_minor
from public.shipping_credit_ledger;

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
