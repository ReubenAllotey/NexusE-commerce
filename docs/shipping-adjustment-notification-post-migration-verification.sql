-- READ-ONLY post-migration verification for migration 0070.
select
  c.relname as object_name,
  c.relkind,
  c.relrowsecurity as rls_enabled
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'shipping_fee_adjustment_notification_intents';

select
  tg.tgname as trigger_name,
  pg_get_triggerdef(tg.oid) as trigger_definition
from pg_catalog.pg_trigger tg
join pg_catalog.pg_class c on c.oid = tg.tgrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('shipping_fee_adjustment_orders', 'notification_email_deliveries')
  and not tg.tgisinternal;

select
  p.oid::regprocedure as function_name,
  p.prosecdef as security_definer,
  has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_execute,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('create_shipping_fee_adjustment_notification', 'get_shipping_notice_credit_summary');

select
  has_table_privilege('service_role', 'public.shipping_fee_adjustment_notification_intents', 'SELECT') as service_role_select,
  has_table_privilege('service_role', 'public.shipping_fee_adjustment_notification_intents', 'INSERT') as service_role_insert,
  has_table_privilege('anon', 'public.shipping_fee_adjustment_notification_intents', 'SELECT') as anon_select,
  has_table_privilege('authenticated', 'public.shipping_fee_adjustment_notification_intents', 'SELECT') as authenticated_select;

select
  has_function_privilege('service_role', 'public.get_shipping_notice_credit_summary(uuid[])', 'EXECUTE') as service_role_credit_summary_execute,
  has_function_privilege('anon', 'public.get_shipping_notice_credit_summary(uuid[])', 'EXECUTE') as anon_credit_summary_execute,
  has_function_privilege('authenticated', 'public.get_shipping_notice_credit_summary(uuid[])', 'EXECUTE') as authenticated_credit_summary_execute;

select
  count(*) filter (where status = 'pending') as pending_intents,
  count(*) filter (where status = 'queued') as queued_intents,
  count(*) filter (where status = 'sent') as sent_intents,
  count(*) filter (where status = 'failed') as failed_intents,
  count(*) filter (where status = 'skipped') as skipped_intents,
  count(*) as total_intents
from public.shipping_fee_adjustment_notification_intents;
