-- Read-only pre-migration audit. Do not delete or update rows based only on
-- this report; preserve every notification and delivery as history.
select
  n.source_type,
  n.source_key,
  count(*) as notification_count,
  array_agg(n.id order by n.created_at, n.id) as notification_ids,
  array_agg(n.user_id order by n.created_at, n.id) as user_ids,
  array_agg(n.recipient_email order by n.created_at, n.id) as recipient_emails,
  array_agg(d.id order by n.created_at, n.id) as delivery_ids,
  array_agg(d.status order by n.created_at, n.id) as delivery_statuses
from public.notifications as n
left join public.notification_email_deliveries as d
  on d.notification_id = n.id
where n.source_type in ('payment_status', 'account_setup')
group by n.source_type, n.source_key
having count(*) > 1
order by min(n.created_at);

select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'notifications'
  and indexname in (
    'notifications_source_unique_idx',
    'notifications_guest_source_unique_idx',
    'notifications_event_source_unique_idx'
  );
