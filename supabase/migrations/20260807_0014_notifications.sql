begin;

create extension if not exists pgcrypto;

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null,
  title text not null,
  message text not null,
  order_id uuid references public.orders(id) on delete set null,
  shipment_id uuid references public.shipments(id) on delete set null,
  payment_id uuid references public.payments(id) on delete set null,
  action_url text,
  action_label text,
  action_description text,
  source_type text not null,
  source_key text not null,
  is_read boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notifications_category_not_blank check (btrim(category) <> ''),
  constraint notifications_title_not_blank check (btrim(title) <> ''),
  constraint notifications_message_not_blank check (btrim(message) <> ''),
  constraint notifications_source_type_not_blank check (btrim(source_type) <> ''),
  constraint notifications_source_key_not_blank check (btrim(source_key) <> ''),
  constraint notifications_category_check check (category in ('orders', 'shipping', 'announcement', 'more')),
  constraint notifications_source_type_check check (source_type in ('announcement', 'order_status', 'payment_status', 'shipment_event'))
);

create unique index notifications_source_unique_idx
  on public.notifications (user_id, source_type, source_key);

create index notifications_user_id_idx
  on public.notifications (user_id);

create index notifications_created_at_idx
  on public.notifications (created_at);

create index notifications_is_read_idx
  on public.notifications (is_read);

create index notifications_category_idx
  on public.notifications (category);

create index notifications_order_id_idx
  on public.notifications (order_id);

create index notifications_shipment_id_idx
  on public.notifications (shipment_id);

create index notifications_payment_id_idx
  on public.notifications (payment_id);

create or replace function private.normalize_notifications_write()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  new.category := lower(btrim(coalesce(new.category, '')));
  new.title := btrim(coalesce(new.title, ''));
  new.message := btrim(coalesce(new.message, ''));
  new.source_type := lower(btrim(coalesce(new.source_type, '')));
  new.source_key := btrim(coalesce(new.source_key, ''));
  new.action_url := nullif(btrim(coalesce(new.action_url, '')), '');
  new.action_label := nullif(btrim(coalesce(new.action_label, '')), '');
  new.action_description := nullif(btrim(coalesce(new.action_description, '')), '');

  if new.category not in ('orders', 'shipping', 'announcement', 'more') then
    raise exception 'Invalid notification category.';
  end if;

  if new.source_type not in ('announcement', 'order_status', 'payment_status', 'shipment_event') then
    raise exception 'Invalid notification source type.';
  end if;

  if tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id
       or new.category is distinct from old.category
       or new.title is distinct from old.title
       or new.message is distinct from old.message
       or new.order_id is distinct from old.order_id
       or new.shipment_id is distinct from old.shipment_id
       or new.payment_id is distinct from old.payment_id
       or new.action_url is distinct from old.action_url
       or new.action_label is distinct from old.action_label
       or new.action_description is distinct from old.action_description
       or new.source_type is distinct from old.source_type
       or new.source_key is distinct from old.source_key then
      raise exception 'Only notification read state can be changed through this operation.';
    end if;

    if new.read_at is distinct from old.read_at
       and new.is_read is not distinct from old.is_read then
      raise exception 'Only notification read state can be changed through this operation.';
    end if;
  end if;

  if coalesce(new.is_read, false) then
    new.read_at := coalesce(new.read_at, old.read_at, now());
  else
    new.read_at := null;
  end if;

  if new.is_read is null then
    new.is_read := false;
  end if;

  return new;
end;
$function$;

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

  if btrim(coalesce(p_source_type, '')) = '' then
    raise exception 'A notification source type is required.';
  end if;

  if btrim(coalesce(p_source_key, '')) = '' then
    raise exception 'A notification source key is required.';
  end if;

  insert into public.notifications as n (
    user_id,
    category,
    title,
    message,
    order_id,
    shipment_id,
    payment_id,
    action_url,
    action_label,
    action_description,
    source_type,
    source_key,
    is_read,
    read_at
  )
  values (
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
    lower(btrim(p_source_type)),
    btrim(p_source_key),
    false,
    null
  )
  on conflict (user_id, source_type, source_key) do nothing
  returning * into v_notification;

  if not found then
    select *
      into v_notification
    from public.notifications as n
    where n.user_id = p_user_id
      and n.source_type = lower(btrim(p_source_type))
      and n.source_key = btrim(p_source_key);
  end if;

  return v_notification;
end;
$function$;

create or replace function public.create_user_notification(payload jsonb)
returns public.notifications
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid;
  v_category text;
  v_title text;
  v_message text;
  v_order_id uuid;
  v_shipment_id uuid;
  v_payment_id uuid;
  v_action_url text;
  v_action_label text;
  v_action_description text;
  v_source_type text;
  v_source_key text;
begin
  if auth.uid() is null then
    raise exception 'Please sign in to continue.';
  end if;

  if not private.is_admin_user() then
    raise exception 'Only active administrators can create notifications.';
  end if;

  v_user_id := nullif(btrim(coalesce(payload ->> 'userId', payload ->> 'user_id', payload #>> '{customer,id}', payload ->> 'customerId', payload ->> 'customer_id')), '')::uuid;
  v_category := lower(btrim(coalesce(payload ->> 'category', payload ->> 'notificationCategory', 'announcement')));
  v_title := btrim(coalesce(payload ->> 'title', ''));
  v_message := btrim(coalesce(payload ->> 'message', ''));
  v_order_id := nullif(btrim(coalesce(payload ->> 'orderId', payload ->> 'order_id')), '')::uuid;
  v_shipment_id := nullif(btrim(coalesce(payload ->> 'shipmentId', payload ->> 'shipment_id')), '')::uuid;
  v_payment_id := nullif(btrim(coalesce(payload ->> 'paymentId', payload ->> 'payment_id')), '')::uuid;
  v_action_url := nullif(btrim(coalesce(payload ->> 'actionUrl', payload ->> 'action_url')), '');
  v_action_label := nullif(btrim(coalesce(payload ->> 'actionLabel', payload ->> 'action_label')), '');
  v_action_description := nullif(btrim(coalesce(payload ->> 'actionDescription', payload ->> 'action_description')), '');
  v_source_type := lower(btrim(coalesce(payload ->> 'sourceType', payload ->> 'source_type', 'announcement')));
  v_source_key := nullif(btrim(coalesce(payload ->> 'sourceKey', payload ->> 'source_key')), '');

  if v_user_id is null then
    raise exception 'Please choose a customer for this notification.';
  end if;

  if v_category not in ('orders', 'shipping', 'announcement', 'more') then
    v_category := 'announcement';
  end if;

  if v_source_type not in ('announcement', 'order_status', 'payment_status', 'shipment_event') then
    v_source_type := 'announcement';
  end if;

  if v_source_key is null then
    v_source_key := md5(
      coalesce(v_source_type, 'announcement')
      || ':'
      || coalesce(v_user_id::text, 'broadcast')
      || ':'
      || coalesce(v_order_id::text, '')
      || ':'
      || coalesce(v_shipment_id::text, '')
      || ':'
      || coalesce(v_payment_id::text, '')
      || ':'
      || lower(v_title)
      || ':'
      || lower(v_message)
    );
  end if;

  return private.upsert_notification(
    v_user_id,
    v_category,
    v_title,
    v_message,
    v_source_type,
    v_source_key,
    v_order_id,
    v_shipment_id,
    v_payment_id,
    v_action_url,
    v_action_label,
    v_action_description
  );
end;
$function$;

create or replace function private.handle_order_notification_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_status text := lower(btrim(coalesce(new.status, '')));
  v_status_label text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  v_status_label := case v_status
    when 'pending' then 'Pending'
    when 'pending_payment' then 'Pending payment'
    when 'processing' then 'Processing'
    when 'in_transit' then 'In transit'
    when 'delivered' then 'Delivered'
    when 'cancelled' then 'Cancelled'
    else initcap(replace(v_status, '_', ' '))
  end;

  perform private.upsert_notification(
    new.user_id,
    'orders',
    case v_status
      when 'delivered' then 'Order delivered'
      when 'cancelled' then 'Order cancelled'
      when 'processing' then 'Order processing'
      when 'in_transit' then 'Order on the way'
      else 'Order updated'
    end,
    format('Order %s is now %s.', new.order_number, lower(v_status_label)),
    'order_status',
    'order:' || new.id::text || ':status:' || v_status,
    new.id,
    null,
    null,
    '/profile/orders',
    'View order',
    'Open the order details page.'
  );

  return new;
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

  select *
    into v_order
  from public.orders as o
  where o.id = new.order_id;

  if not found then
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

create or replace function private.handle_shipment_event_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_shipment public.shipments%rowtype;
  v_order public.orders%rowtype;
  v_title text := nullif(btrim(coalesce(new.title, '')), '');
  v_message text := nullif(btrim(coalesce(new.message, '')), '');
  v_status text := lower(btrim(coalesce(new.status, '')));
begin
  select *
    into v_shipment
  from public.shipments as s
  where s.id = new.shipment_id;

  if not found then
    return new;
  end if;

  select *
    into v_order
  from public.orders as o
  where o.id = v_shipment.order_id;

  if not found then
    return new;
  end if;

  perform private.upsert_notification(
    v_order.user_id,
    'shipping',
    coalesce(v_title, private.shipment_step_label(new.step_index)),
    coalesce(
      v_message,
      format('Shipment update for order %s.', v_order.order_number)
    ),
    'shipment_event',
    'shipment:' || new.shipment_id::text || ':step:' || new.step_index::text || ':status:' || v_status,
    v_order.id,
    new.shipment_id,
    null,
    '/profile/shipments',
    'View shipment',
    'Open the shipment tracking timeline.'
  );

  return new;
end;
$function$;

drop trigger if exists notifications_normalize_write on public.notifications;
create trigger notifications_normalize_write
before insert or update on public.notifications
for each row
execute function private.normalize_notifications_write();

drop trigger if exists notifications_order_status on public.orders;
create trigger notifications_order_status
after update on public.orders
for each row
when (old.status is distinct from new.status)
execute function private.handle_order_notification_change();

drop trigger if exists notifications_payment_status on public.payments;
create trigger notifications_payment_status
after update on public.payments
for each row
when (old.status is distinct from new.status)
execute function private.handle_payment_notification_change();

drop trigger if exists notifications_shipment_event on public.shipment_events;
create trigger notifications_shipment_event
after insert on public.shipment_events
for each row
execute function private.handle_shipment_event_notification();

alter table public.notifications enable row level security;

drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own
  on public.notifications
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists notifications_select_admin on public.notifications;
create policy notifications_select_admin
  on public.notifications
  for select
  to authenticated
  using ((select private.is_admin_user()));

drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own
  on public.notifications
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

revoke all on table public.notifications from public;
revoke all on table public.notifications from anon;
revoke all on table public.notifications from authenticated;

grant select, update on table public.notifications to authenticated;

revoke all on function private.normalize_notifications_write() from public;
revoke all on function private.normalize_notifications_write() from anon;
revoke all on function private.normalize_notifications_write() from authenticated;

revoke all on function private.upsert_notification(uuid, text, text, text, text, text, uuid, uuid, uuid, text, text, text) from public;
revoke all on function private.upsert_notification(uuid, text, text, text, text, text, uuid, uuid, uuid, text, text, text) from anon;
revoke all on function private.upsert_notification(uuid, text, text, text, text, text, uuid, uuid, uuid, text, text, text) from authenticated;

revoke all on function private.handle_order_notification_change() from public;
revoke all on function private.handle_order_notification_change() from anon;
revoke all on function private.handle_order_notification_change() from authenticated;

revoke all on function private.handle_payment_notification_change() from public;
revoke all on function private.handle_payment_notification_change() from anon;
revoke all on function private.handle_payment_notification_change() from authenticated;

revoke all on function private.handle_shipment_event_notification() from public;
revoke all on function private.handle_shipment_event_notification() from anon;
revoke all on function private.handle_shipment_event_notification() from authenticated;

revoke all on function public.create_user_notification(jsonb) from public;
revoke all on function public.create_user_notification(jsonb) from anon;
revoke all on function public.create_user_notification(jsonb) from authenticated;
grant execute on function public.create_user_notification(jsonb) to authenticated;

commit;
