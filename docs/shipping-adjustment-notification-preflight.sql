-- READ-ONLY preflight for migration 0070.
select to_regclass('public.shipping_fee_adjustments') as adjustments_table,
       to_regclass('public.shipping_fee_adjustment_orders') as adjustment_orders_table,
       to_regclass('public.notifications') as notifications_table,
       to_regclass('public.notification_email_deliveries') as deliveries_table;

select indexrelid::regclass as index_name, indexrelid::regclass is not null as present
from pg_catalog.pg_index
where indexrelid::regclass::text in (
  'public.notifications_event_source_unique_idx',
  'public.notifications_guest_source_unique_idx'
);

select count(*)::bigint as existing_adjustments
from public.shipping_fee_adjustments;

select count(*)::bigint as existing_adjustment_order_rows
from public.shipping_fee_adjustment_orders;

select count(*)::bigint as existing_shipping_notifications
from public.notifications
where source_type = 'payment_status'
  and (source_key like 'shipping-payment-request:%'
       or source_key like 'shipping-fee-adjustment:%');

select p.oid::regprocedure as function_name,
       p.prosecdef as security_definer,
       has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_execute
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('apply_shipping_fee_adjustment', 'create_admin_shipping_payment_reminder');
