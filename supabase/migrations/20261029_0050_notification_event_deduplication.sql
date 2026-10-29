begin;

-- Apply only after the read-only duplicate audit has been reviewed and any
-- existing event duplicates have been remediated without deleting history.
do $function$
declare
  duplicate_count bigint;
begin
  select count(*)
    into duplicate_count
  from (
    select source_type, source_key
    from public.notifications
    where source_type in ('payment_status', 'account_setup')
    group by source_type, source_key
    having count(*) > 1
  ) as duplicates;

  if duplicate_count > 0 then
    raise exception 'Notification event duplicates must be remediated before applying migration 0050.'
      using errcode = '23505', detail = format('%s duplicate event key group(s) remain.', duplicate_count);
  end if;
end;
$function$;

create unique index if not exists notifications_event_source_unique_idx
  on public.notifications (source_type, source_key)
  where source_type in ('payment_status', 'account_setup');

create or replace function private.upsert_notification(
  p_user_id uuid,
  p_category text,
  p_title text,
  p_message text,
  p_source_type text,
  p_source_key text,
  p_order_id uuid default null,
  p_shipment_id uuid default null,
  p_payment_id uuid default null,
  p_action_url text default null,
  p_action_label text default null,
  p_action_description text default null
)
returns public.notifications
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_notification public.notifications%rowtype;
  v_source_type text := lower(btrim(coalesce(p_source_type, '')));
  v_source_key text := btrim(coalesce(p_source_key, ''));
begin
  if p_user_id is null then
    raise exception 'A notification user is required.';
  end if;
  if btrim(coalesce(p_category, '')) = '' then
    raise exception 'A notification category is required.';
  end if;
  if btrim(coalesce(p_title, '')) = '' then
    raise exception 'A notification title is required.';
  end if;
  if btrim(coalesce(p_message, '')) = '' then
    raise exception 'A notification message is required.';
  end if;
  if v_source_type = '' then
    raise exception 'A notification source type is required.';
  end if;
  if v_source_key = '' then
    raise exception 'A notification source key is required.';
  end if;

  insert into public.notifications (
    user_id, category, title, message, order_id, shipment_id, payment_id,
    action_url, action_label, action_description, source_type, source_key,
    is_read, read_at
  ) values (
    p_user_id,
    lower(btrim(p_category)),
    btrim(p_title),
    btrim(p_message),
    p_order_id,
    p_shipment_id,
    p_payment_id,
    nullif(btrim(coalesce(p_action_url, '')), ''),
    nullif(btrim(coalesce(p_action_label, '')), ''),
    nullif(btrim(coalesce(p_action_description, '')), ''),
    v_source_type,
    v_source_key,
    false,
    null
  )
  on conflict do nothing
  returning * into v_notification;

  if not found then
    if v_source_type in ('payment_status', 'account_setup') then
      select * into v_notification
      from public.notifications as n
      where n.source_type = v_source_type
        and n.source_key = v_source_key
      order by n.created_at asc, n.id asc
      limit 1;
    else
      select * into v_notification
      from public.notifications as n
      where n.user_id = p_user_id
        and n.source_type = v_source_type
        and n.source_key = v_source_key;
    end if;
  end if;

  return v_notification;
end;
$function$;

create or replace function private.handle_payment_notification_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_status text := lower(btrim(coalesce(new.status, '')));
  v_order public.orders%rowtype;
  v_title text;
  v_message text;
  v_action_url text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  select * into v_order
  from public.orders as o
  where o.id = new.order_id;

  if not found or v_order.user_id is null then
    return new;
  end if;

  v_title := case v_status
    when 'successful' then 'Payment successful'
    when 'failed' then 'Payment failed'
    when 'cancelled' then 'Payment cancelled'
    when 'processing' then 'Payment processing'
    else 'Payment updated'
  end;
  v_message := format(
    'Payment %s for order %s is now %s.',
    coalesce(nullif(btrim(new.provider_reference), ''), new.id::text),
    v_order.order_number,
    initcap(replace(v_status, '_', ' '))
  );
  v_action_url := case
    when v_status = 'successful' then '/receipt/' || coalesce(nullif(btrim(new.provider_reference), ''), new.id::text)
    else '/profile/payments'
  end;

  perform private.upsert_notification(
    v_order.user_id,
    'orders',
    v_title,
    v_message,
    'payment_status',
    'payment:' || new.id::text || ':status:' || v_status,
    v_order.id,
    null,
    new.id,
    v_action_url,
    case when v_status = 'successful' then 'View receipt' else 'View payment' end,
    case when v_status = 'successful' then 'Open the payment receipt and order summary.' else 'Open the payment history page.' end
  );
  return new;
end;
$function$;

revoke all on function private.upsert_notification(uuid, text, text, text, text, text, uuid, uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function private.handle_payment_notification_change() from public, anon, authenticated;

commit;

-- Rollback (manual, only after restoring the previous function definitions):
-- drop index if exists public.notifications_event_source_unique_idx;
