begin;

create table if not exists public.payment_reminder_audit (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete restrict,
  order_id uuid not null references public.orders(id) on delete restrict,
  admin_id uuid not null references auth.users(id),
  is_override boolean not null default false,
  override_reason text,
  created_at timestamptz not null default now(),
  constraint payment_reminder_audit_override_reason_check
    check (not is_override or nullif(btrim(override_reason), '') is not null)
);

create index if not exists payment_reminder_audit_order_created_idx
  on public.payment_reminder_audit (order_id, created_at desc);

alter table public.payment_reminder_audit enable row level security;
revoke all on table public.payment_reminder_audit from public, anon, authenticated, service_role;

-- Create one new reminder notification atomically. Existing legacy reminder
-- notifications keep their original source keys and delivery history.
create or replace function public.create_admin_payment_reminder(
  p_order_id uuid,
  p_admin_id uuid,
  p_message text default null,
  p_override boolean default false,
  p_override_reason text default null,
  p_action_url text default null
)
returns table (
  result_code text,
  notification_id uuid,
  source_key text,
  outstanding numeric,
  cooldown_until timestamptz,
  override_recorded boolean
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_order public.orders%rowtype;
  v_linked_order record;
  v_order_ids uuid[] := array[]::uuid[];
  v_order_amount numeric := 0;
  v_verified_amount numeric := 0;
  v_outstanding numeric := 0;
  v_scope text;
  v_latest_reminder timestamptz;
  v_latest_notification_id uuid;
  v_latest_delivery_status text;
  v_pending_notification_id uuid;
  v_cooldown_until timestamptz;
  v_notification_id uuid;
  v_source_key text;
  v_recipient_email text;
  v_message text;
begin
  if p_order_id is null then
    raise exception 'An order is required.' using errcode = '22023';
  end if;

  if p_admin_id is null or not exists (
    select 1
    from public.profiles as p
    where p.id = p_admin_id
      and lower(coalesce(p.role, '')) = 'admin'
      and lower(coalesce(p.status, '')) = 'active'
  ) then
    raise exception 'Only active administrators can create payment reminders.' using errcode = '42501';
  end if;

  select o.*
    into v_order
  from public.orders as o
  where o.id = p_order_id;

  if not found then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;

  if lower(coalesce(v_order.status, '')) in ('cancelled', 'canceled')
    or lower(coalesce(v_order.payment_status, '')) in ('cancelled', 'canceled') then
    raise exception 'This order is cancelled and cannot receive a payment reminder.' using errcode = 'P0001';
  end if;

  v_scope := coalesce(v_order.checkout_group_id::text, v_order.id::text);

  -- Serialize reminder operations for one checkout scope before row locks.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_scope, 0));

  -- Lock the eligible checkout scope before calculating balance or cooldown.
  -- Guest rows must have the same normalized persisted email.
  if v_order.checkout_group_id is null then
    perform 1
    from public.orders as o
    where o.id = v_order.id
    for update;
    v_order_ids := array[v_order.id];
  else
    for v_linked_order in
      select o.id
      from public.orders as o
      where o.checkout_group_id = v_order.checkout_group_id
        and (
          (v_order.user_id is not null and o.user_id = v_order.user_id)
          or (
            v_order.user_id is null
            and o.user_id is null
            and lower(btrim(coalesce(o.customer_email, o.guest_email)))
              = lower(btrim(coalesce(v_order.customer_email, v_order.guest_email)))
          )
        )
      order by o.id
      for update
    loop
      v_order_ids := array_append(v_order_ids, v_linked_order.id);
    end loop;
  end if;

  if coalesce(array_length(v_order_ids, 1), 0) = 0 then
    v_order_ids := array[v_order.id];
  end if;

  if exists (
    select 1
    from public.orders as o
    where o.id = any(v_order_ids)
      and (
        lower(coalesce(o.status, '')) in ('cancelled', 'canceled')
        or lower(coalesce(o.payment_status, '')) in ('cancelled', 'canceled')
      )
  ) then
    raise exception 'A linked order is cancelled and cannot receive a payment reminder.' using errcode = 'P0001';
  end if;

  -- Serialize status changes on existing payments before calculating the balance.
  -- Payment creation/finalization remains responsible for its own transaction;
  -- this prevents a concurrent update from being read halfway through.
  perform 1
  from public.payments as p
  where p.order_id = any(v_order_ids)
  for update;

  select coalesce(sum(greatest(coalesce(o.amount_due_now, o.total), 0)), 0)
    into v_order_amount
  from public.orders as o
  where o.id = any(v_order_ids);

  select coalesce(sum(greatest(coalesce(p.amount, 0), 0)), 0)
    into v_verified_amount
  from public.payments as p
  where p.order_id = any(v_order_ids)
    and lower(coalesce(p.payment_purpose, '')) = 'order'
    and lower(coalesce(p.status, '')) = 'successful';

  v_outstanding := greatest(v_order_amount - v_verified_amount, 0);
  if v_outstanding <= 0 then
    raise exception 'This order has no outstanding order payment.' using errcode = 'P0001';
  end if;

  v_recipient_email := nullif(btrim(coalesce(v_order.customer_email, v_order.guest_email)), '');
  if v_order.user_id is null and (v_recipient_email is null or position('@' in v_recipient_email) < 2) then
    raise exception 'This order does not have an eligible customer recipient.' using errcode = 'P0001';
  end if;

  -- Do not create another reminder while any eligible reminder is pending or processing.
  -- Checking the whole scope avoids bypassing this guard when an older reminder is
  -- still queued but a newer reminder has already completed or failed.
  select n.id
    into v_pending_notification_id
  from public.notifications as n
  join public.notification_email_deliveries as d
    on d.notification_id = n.id
  where n.source_type = 'payment_status'
    and (
      n.source_key = 'order-payment-request:' || v_scope
      or n.source_key like 'order-payment-request:' || v_scope || ':reminder:%'
    )
    and n.order_id = any(v_order_ids)
    and d.status in ('pending', 'processing')
  order by n.created_at desc, n.id desc
  limit 1;

  if v_pending_notification_id is not null then
    return query
    select 'queued'::text, v_pending_notification_id, null::text, v_outstanding, null::timestamptz, false;
    return;
  end if;

  select n.id, n.created_at, d.status
    into v_latest_notification_id, v_latest_reminder, v_latest_delivery_status
  from public.notifications as n
  left join public.notification_email_deliveries as d on d.notification_id = n.id
  where n.source_type = 'payment_status'
    and (
      n.source_key = 'order-payment-request:' || v_scope
      or n.source_key like 'order-payment-request:' || v_scope || ':reminder:%'
    )
    and n.order_id = any(v_order_ids)
  order by n.created_at desc, n.id desc
  limit 1;

  if v_latest_delivery_status in ('pending', 'processing') then
    return query
    select 'queued'::text, v_latest_notification_id, null::text, v_outstanding, null::timestamptz, false;
    return;
  end if;

  if v_latest_reminder is not null then
    v_cooldown_until := v_latest_reminder + interval '24 hours';
    if now() < v_cooldown_until and not coalesce(p_override, false) then
      return query
      select 'cooldown'::text, null::uuid, null::text, v_outstanding, v_cooldown_until, false;
      return;
    end if;
  end if;

  if coalesce(p_override, false) and nullif(btrim(coalesce(p_override_reason, '')), '') is null then
    raise exception 'An override reason is required.' using errcode = '22023';
  end if;

  v_notification_id := gen_random_uuid();
  v_source_key := 'order-payment-request:' || v_scope || ':reminder:' || v_notification_id::text;
  v_message := nullif(btrim(coalesce(p_message, '')), '');

  insert into public.notifications (
    id,
    user_id,
    recipient_email,
    recipient_name,
    category,
    title,
    message,
    order_id,
    payment_id,
    source_type,
    source_key,
    action_url,
    action_label,
    action_description,
    is_read,
    read_at
  ) values (
    v_notification_id,
    v_order.user_id,
    case when v_order.user_id is null then lower(v_recipient_email) else null end,
    v_order.customer_name,
    'orders',
    'Payment Required for Your Order',
    coalesce(v_message, 'Your order has an outstanding payment. Please complete your payment to continue processing your order.'),
    v_order.id,
    null,
    'payment_status',
    v_source_key,
    nullif(btrim(coalesce(p_action_url, '')), ''),
    'Pay Now',
    case when coalesce(p_override, false)
      then 'Payment reminder sent with an administrator override.'
      else 'Review the outstanding payment for this order.'
    end,
    false,
    null
  );

  insert into public.payment_reminder_audit (
    notification_id,
    order_id,
    admin_id,
    is_override,
    override_reason
  ) values (
    v_notification_id,
    v_order.id,
    p_admin_id,
    coalesce(p_override, false),
    case when coalesce(p_override, false) then btrim(p_override_reason) else null end
  );

  return query
  select 'created'::text,
    v_notification_id,
    v_source_key,
    v_outstanding,
    case when v_latest_reminder is null then null else v_latest_reminder + interval '24 hours' end,
    coalesce(p_override, false);
end;
$function$;

revoke all on function public.create_admin_payment_reminder(uuid, uuid, text, boolean, text, text)
  from public, anon, authenticated;
grant execute on function public.create_admin_payment_reminder(uuid, uuid, text, boolean, text, text)
  to service_role;

commit;
