begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.bulk_shipping_notice_jobs
  add column if not exists notice_mode text not null default 'initial',
  add column if not exists override_cooldown boolean not null default false,
  add column if not exists override_reason text;

do $function$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'bulk_shipping_notice_jobs_notice_mode_check'
      and conrelid = 'public.bulk_shipping_notice_jobs'::regclass
  ) then
    alter table public.bulk_shipping_notice_jobs
      add constraint bulk_shipping_notice_jobs_notice_mode_check
      check (notice_mode in ('initial', 'resend'));
  end if;
end;
$function$;

create table if not exists public.shipping_payment_reminder_audit (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  notification_id uuid not null unique references public.notifications(id) on delete restrict,
  admin_id uuid not null references auth.users(id) on delete restrict,
  bulk_job_id uuid references public.bulk_shipping_notice_jobs(id) on delete set null,
  bulk_job_item_id uuid references public.bulk_shipping_notice_job_items(id) on delete set null,
  is_override boolean not null default false,
  override_reason text,
  created_at timestamptz not null default now(),
  constraint shipping_payment_reminder_audit_override_reason_check
    check (not is_override or nullif(btrim(override_reason), '') is not null)
);

create index if not exists shipping_payment_reminder_audit_order_created_idx
  on public.shipping_payment_reminder_audit (order_id, created_at desc);

create index if not exists shipping_payment_reminder_audit_bulk_job_idx
  on public.shipping_payment_reminder_audit (bulk_job_id, created_at desc);

create unique index if not exists shipping_payment_reminder_audit_item_unique_idx
  on public.shipping_payment_reminder_audit (bulk_job_item_id)
  where bulk_job_item_id is not null;

alter table public.shipping_payment_reminder_audit enable row level security;
revoke all on table public.shipping_payment_reminder_audit from public, anon, authenticated, service_role;

create or replace function public.create_admin_shipping_payment_reminder(
  p_order_id uuid,
  p_admin_id uuid,
  p_mode text default 'initial',
  p_override boolean default false,
  p_override_reason text default null,
  p_action_url text default null,
  p_app_origin text default null,
  p_bulk_job_id uuid default null,
  p_bulk_job_item_id uuid default null,
  p_bulk_job_lock_token uuid default null,
  p_bulk_job_item_lock_token uuid default null
)
returns table (
  result_code text,
  notification_id uuid,
  audit_id uuid,
  source_key text,
  outstanding_shipping numeric,
  cooldown_until timestamptz,
  override_recorded boolean
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_order public.orders%rowtype;
  v_profile public.profiles%rowtype;
  v_total_shipping numeric := 0;
  v_paid_shipping numeric := 0;
  v_outstanding numeric := 0;
  v_has_pending boolean := false;
  v_recipient_email text;
  v_existing record;
  v_latest_sent_at timestamptz;
  v_cooldown_until timestamptz;
  v_notification_id uuid;
  v_audit_id uuid;
  v_source_key text;
  v_mode text := lower(btrim(coalesce(p_mode, 'initial')));
  v_job public.bulk_shipping_notice_jobs%rowtype;
  v_item public.bulk_shipping_notice_job_items%rowtype;
  v_order_item_id uuid;
  v_existing_audit record;
  v_pending_delivery record;
  v_has_invalid_sent boolean := false;
begin
  if p_order_id is null then
    raise exception 'An order is required.' using errcode = '22023';
  end if;

  if p_admin_id is null or not exists (
    select 1 from public.profiles p
    where p.id = p_admin_id
      and lower(coalesce(p.role, '')) = 'admin'
      and lower(coalesce(p.status, '')) = 'active'
  ) then
    raise exception 'Only active administrators can create shipping payment reminders.' using errcode = '42501';
  end if;

  if auth.uid() is not null and auth.uid() <> p_admin_id then
    raise exception 'The authenticated administrator does not match the request.' using errcode = '42501';
  end if;

  if v_mode not in ('initial', 'resend') then
    raise exception 'Unsupported shipping reminder mode.' using errcode = '22023';
  end if;

  if (p_bulk_job_id is null) <> (p_bulk_job_item_id is null)
    or (p_bulk_job_id is null) <> (p_bulk_job_lock_token is null)
    or (p_bulk_job_id is null) <> (p_bulk_job_item_lock_token is null) then
    raise exception 'Bulk reminder ownership parameters are incomplete.' using errcode = '22023';
  end if;

  if p_action_url is not null
    and (
      p_app_origin is null
      or p_app_origin !~ '^https?://[^/[:space:]]+$'
      or split_part(p_action_url, '/payment?', 1) <> p_app_origin
      or p_action_url !~ ('^https?://[^/[:space:]]+/payment\?purpose=shipping-balance&orderId=' || p_order_id::text || '&token=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$')
    ) then
    raise exception 'The shipping reminder action URL is invalid.' using errcode = '22023';
  end if;

  -- Use the same order-scoped advisory lock first as shipping payment
  -- initialization. Payment finalization coordinates through the order and
  -- order-item row locks acquired below.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_order_id::text || ':shipping-payment', 0));

  if p_bulk_job_id is not null then
    select * into v_job
    from public.bulk_shipping_notice_jobs j
    where j.id = p_bulk_job_id
    for update;

    if not found
      or v_job.created_by <> p_admin_id
      or v_job.status <> 'processing'
      or v_job.lock_token is null
      or v_job.lock_token <> p_bulk_job_lock_token
      or v_job.locked_at is null
      or v_job.locked_at <= clock_timestamp() - interval '300 seconds'
      or v_job.notice_mode <> v_mode
      or coalesce(v_job.override_cooldown, false) <> coalesce(p_override, false)
      or nullif(btrim(coalesce(v_job.override_reason, '')), '') is distinct from nullif(btrim(coalesce(p_override_reason, '')), '') then
      raise exception 'The bulk shipping notice job lease or parameters are invalid.' using errcode = '42501';
    end if;

    select * into v_item
    from public.bulk_shipping_notice_job_items i
    where i.id = p_bulk_job_item_id
      and i.job_id = p_bulk_job_id
    for update;

    if not found
      or v_item.order_id <> p_order_id
      or v_item.status <> 'processing'
      or v_item.lock_token is null
      or v_item.lock_token <> p_bulk_job_item_lock_token
      or v_item.locked_at is null
      or v_item.locked_at <= clock_timestamp() - interval '300 seconds' then
      raise exception 'The bulk shipping notice item lease or parameters are invalid.' using errcode = '42501';
    end if;

  end if;

  select * into v_order
  from public.orders o
  where o.id = p_order_id
  for update;
  if not found then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;

  -- A completed bulk operation is idempotent even if the order changed after
  -- the notification was created. Return its original result before current
  -- payment eligibility checks.
  if p_bulk_job_id is not null then
    select a.notification_id, a.id, n.source_key
      into v_existing_audit
    from public.shipping_payment_reminder_audit a
    join public.notifications n on n.id = a.notification_id
    where a.bulk_job_item_id = p_bulk_job_item_id
    order by a.created_at desc, a.id desc
    limit 1;

    if found then
      return query select 'already_created'::text, v_existing_audit.notification_id,
        v_existing_audit.id, v_existing_audit.source_key, null::numeric,
        null::timestamptz, false;
      return;
    end if;
  end if;

  if lower(coalesce(v_order.status, '')) in ('cancelled', 'canceled')
    or lower(coalesce(v_order.payment_status, '')) in ('cancelled', 'canceled') then
    raise exception 'This order is cancelled and cannot receive a shipping payment reminder.' using errcode = 'P0001';
  end if;

  -- Lock every order item before calculating the balance, matching the
  -- shipping finalization path and preventing a concurrent allocation from
  -- changing the amount after eligibility has been established.
  for v_order_item_id in
    select i.id
    from public.order_items i
    where i.order_id = v_order.id
    order by i.created_at, i.id
    for update
  loop
    null;
  end loop;

  select coalesce(sum(greatest(coalesce(i.line_shipping, 0), 0)), 0),
         coalesce(sum(least(greatest(coalesce(i.shipping_paid_amount, 0), 0), greatest(coalesce(i.line_shipping, 0), 0))), 0),
         coalesce(bool_or(lower(coalesce(i.shipping_fee_status, '')) = 'pending'), false)
    into v_total_shipping, v_paid_shipping, v_has_pending
  from public.order_items i
  where i.order_id = v_order.id;

  v_outstanding := greatest(v_total_shipping - v_paid_shipping, 0);

  if v_has_pending then
    return query select 'pending_shipping'::text, null::uuid, null::uuid, null::text, v_outstanding, null::timestamptz, false;
    return;
  end if;
  if v_outstanding <= 0 then
    return query select 'already_paid'::text, null::uuid, null::uuid, null::text, v_outstanding, null::timestamptz, false;
    return;
  end if;

  if v_order.user_id is null then
    v_recipient_email := lower(nullif(btrim(coalesce(v_order.customer_email, '')), ''));
    if v_recipient_email is null then
      v_recipient_email := lower(nullif(btrim(coalesce(v_order.guest_email, '')), ''));
    end if;
    if v_recipient_email is null or position('@' in v_recipient_email) < 2 then
      return query select 'missing_recipient'::text, null::uuid, null::uuid, null::text, v_outstanding, null::timestamptz, false;
      return;
    end if;
  else
    select * into v_profile from public.profiles p where p.id = v_order.user_id;
    v_recipient_email := lower(nullif(btrim(v_profile.email), ''));
    if v_profile.id is null or lower(coalesce(v_profile.role, '')) <> 'customer'
      or lower(coalesce(v_profile.status, '')) <> 'active'
      or v_recipient_email is null or position('@' in v_recipient_email) < 2 then
      return query select 'missing_recipient'::text, null::uuid, null::uuid, null::text, v_outstanding, null::timestamptz, false;
      return;
    end if;
  end if;

  -- Any active delivery blocks another notice. Looking only at the newest
  -- notification could miss an older pending delivery after a retry/reminder.
  select n.id, n.source_key, d.status, d.sent_at, d.attempts, d.max_attempts, d.last_attempt_at, d.updated_at, d.last_error
    into v_pending_delivery
  from public.notifications n
  join public.notification_email_deliveries d on d.notification_id = n.id
  where n.source_type = 'payment_status'
    and n.order_id = v_order.id
    and (
      n.source_key = 'shipping-payment-request:' || v_order.id::text
      or n.source_key like 'shipping-payment-request:' || v_order.id::text || ':reminder:%'
    )
    and d.status in ('pending', 'processing')
  order by n.created_at desc, n.id desc
  limit 1;

  if v_pending_delivery.id is not null then
    return query select case when v_pending_delivery.status = 'pending' then 'already_pending' else 'already_processing' end,
      v_pending_delivery.id, null::uuid, v_pending_delivery.source_key, v_outstanding, null::timestamptz, false;
    return;
  end if;

  select n.id, n.source_key, d.status, d.sent_at, d.attempts, d.max_attempts,
         d.last_attempt_at, d.updated_at, d.last_error
    into v_existing
  from public.notifications n
  left join public.notification_email_deliveries d on d.notification_id = n.id
  where n.source_type = 'payment_status'
    and n.order_id = v_order.id
    and (
      n.source_key = 'shipping-payment-request:' || v_order.id::text
      or n.source_key like 'shipping-payment-request:' || v_order.id::text || ':reminder:%'
    )
  order by n.created_at desc, n.id desc
  limit 1;

  if v_existing.id is null then
    if v_mode = 'resend' then
      return query select 'no_previous_notice'::text, null::uuid, null::uuid, null::text, v_outstanding, null::timestamptz, false;
      return;
    end if;
  elsif v_existing.status = 'pending' then
    return query select 'already_pending'::text, v_existing.id, null::uuid, v_existing.source_key, v_outstanding, null::timestamptz, false;
    return;
  elsif v_existing.status = 'processing' then
    return query select 'already_processing'::text, v_existing.id, null::uuid, v_existing.source_key, v_outstanding, null::timestamptz, false;
    return;
  elsif v_existing.status = 'manual_review' then
    return query select 'manual_review'::text, v_existing.id, null::uuid, v_existing.source_key, v_outstanding, null::timestamptz, false;
    return;
  elsif v_existing.status = 'failed' then
    if coalesce(v_existing.last_error, '') like 'Superseded by canonical payment notification %'
      or coalesce(v_existing.attempts, 0) >= coalesce(v_existing.max_attempts, 5) then
      return query select 'permanent_failed'::text, v_existing.id, null::uuid, v_existing.source_key, v_outstanding, null::timestamptz, false;
      return;
    end if;
    if coalesce(v_existing.last_attempt_at, v_existing.updated_at) is null then
      return query select 'retry_timestamp_missing'::text, v_existing.id, null::uuid, v_existing.source_key, v_outstanding, null::timestamptz, false;
      return;
    end if;
    if clock_timestamp() < coalesce(v_existing.last_attempt_at, v_existing.updated_at) + interval '5 minutes' then
      return query select 'retry_cooldown'::text, v_existing.id, null::uuid, v_existing.source_key, v_outstanding, coalesce(v_existing.last_attempt_at, v_existing.updated_at) + interval '5 minutes', false;
      return;
    end if;
    return query select 'retryable_failed'::text, v_existing.id, null::uuid, v_existing.source_key, v_outstanding, null::timestamptz, false;
    return;
  elsif v_existing.status is null then
    return query select 'missing_delivery'::text, v_existing.id, null::uuid, v_existing.source_key, v_outstanding, null::timestamptz, false;
    return;
  elsif v_existing.status <> 'sent' then
    return query select 'unknown_delivery'::text, v_existing.id, null::uuid, v_existing.source_key, v_outstanding, null::timestamptz, false;
    return;
  elsif v_existing.sent_at is null then
    return query select 'invalid_sent_timestamp'::text, v_existing.id, null::uuid, v_existing.source_key, v_outstanding, null::timestamptz, false;
    return;
  elsif v_mode = 'initial' then
    return query select 'already_notified'::text, v_existing.id, null::uuid, v_existing.source_key, v_outstanding, null::timestamptz, false;
    return;
  end if;

  select max(d.sent_at) filter (where d.status = 'sent'),
         coalesce(bool_or(d.status = 'sent' and d.sent_at is null), false)
    into v_latest_sent_at, v_has_invalid_sent
  from public.notifications n
  join public.notification_email_deliveries d on d.notification_id = n.id
  where n.source_type = 'payment_status'
    and n.order_id = v_order.id
    and (
      n.source_key = 'shipping-payment-request:' || v_order.id::text
      or n.source_key like 'shipping-payment-request:' || v_order.id::text || ':reminder:%'
    );

  if v_has_invalid_sent then
    return query select 'invalid_sent_timestamp'::text, v_existing.id, null::uuid, v_existing.source_key, v_outstanding, null::timestamptz, false;
    return;
  end if;

  v_cooldown_until := v_latest_sent_at + interval '48 hours';
  if v_latest_sent_at is not null
    and clock_timestamp() < v_cooldown_until
    and not coalesce(p_override, false) then
    return query select 'cooldown'::text, null::uuid, null::uuid, null::text, v_outstanding, v_cooldown_until, false;
    return;
  end if;

  if coalesce(p_override, false) and nullif(btrim(coalesce(p_override_reason, '')), '') is null then
    raise exception 'An override reason is required.' using errcode = '22023';
  end if;

  v_notification_id := gen_random_uuid();
  v_source_key := case when v_existing.id is null
    then 'shipping-payment-request:' || v_order.id::text
    else 'shipping-payment-request:' || v_order.id::text || ':reminder:' || v_notification_id::text
  end;

  if p_bulk_job_id is not null
    and (
      v_job.status <> 'processing'
      or v_job.lock_token <> p_bulk_job_lock_token
      or v_job.locked_at is null
      or v_job.locked_at <= clock_timestamp() - interval '300 seconds'
      or v_item.status <> 'processing'
      or v_item.lock_token <> p_bulk_job_item_lock_token
      or v_item.locked_at is null
      or v_item.locked_at <= clock_timestamp() - interval '300 seconds'
    ) then
    raise exception 'The bulk shipping notice lease expired before notification creation.' using errcode = '42501';
  end if;

  insert into public.notifications (
    id, user_id, recipient_email, recipient_name, category, title, message,
    order_id, payment_id, source_type, source_key, action_url, action_label,
    action_description, is_read, read_at
  ) values (
    v_notification_id,
    v_order.user_id,
    case when v_order.user_id is null then v_recipient_email else null end,
    v_order.customer_name,
    'shipping',
    'Shipping Fee Payment Required',
    'Shipping payment of ' || v_outstanding::text || ' is required for order ' || coalesce(v_order.order_number, v_order.id::text) || '.',
    v_order.id,
    null,
    'payment_status',
    v_source_key,
    nullif(btrim(coalesce(p_action_url, '')), ''),
    'Pay Shipping Fee',
    case when coalesce(p_override, false) then 'Shipping payment reminder sent with an administrator override.' else 'Complete the remaining shipping payment for this order.' end,
    false,
    null
  );

  select d.id into v_existing from public.notification_email_deliveries d where d.notification_id = v_notification_id;
  if v_existing.id is null then
    raise exception 'The shipping reminder email delivery was not created.' using errcode = 'P0001';
  end if;

  insert into public.shipping_payment_reminder_audit (
    order_id, notification_id, admin_id, bulk_job_id, bulk_job_item_id, is_override, override_reason
  ) values (
    v_order.id, v_notification_id, p_admin_id, p_bulk_job_id, p_bulk_job_item_id,
    coalesce(p_override, false), case when coalesce(p_override, false) then btrim(p_override_reason) else null end
  ) returning id into v_audit_id;

  return query select 'created'::text, v_notification_id, v_audit_id, v_source_key,
    v_outstanding, v_cooldown_until, coalesce(p_override, false);
end;
$function$;

create or replace function public.retry_shipping_payment_notice_delivery(
  p_notification_id uuid
)
returns table (
  result_code text,
  retry_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_order_id uuid;
  v_notification_created_at timestamptz;
  v_order public.orders%rowtype;
  v_profile public.profiles%rowtype;
  v_order_item_id uuid;
  v_total_shipping numeric := 0;
  v_paid_shipping numeric := 0;
  v_has_pending_shipping boolean := false;
  v_recipient_email text;
  v_delivery public.notification_email_deliveries%rowtype;
  v_retry_at timestamptz;
  v_newer_successful_delivery boolean := false;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required';
  end if;

  select n.order_id, n.created_at into v_order_id, v_notification_created_at
  from public.notifications n
  where n.id = p_notification_id
    and n.source_type = 'payment_status'
    and (
      n.source_key = 'shipping-payment-request:' || n.order_id::text
      or n.source_key like 'shipping-payment-request:' || n.order_id::text || ':reminder:%'
    );
  if v_order_id is null then
    return query select 'not_shipping_notice'::text, null::timestamptz;
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_order_id::text || ':shipping-payment', 0));

  select * into v_order
  from public.orders o
  where o.id = v_order_id
  for update;
  if not found then
    return query select 'order_ineligible'::text, null::timestamptz;
    return;
  end if;
  if lower(coalesce(v_order.status, '')) in ('cancelled', 'canceled')
    or lower(coalesce(v_order.payment_status, '')) in ('cancelled', 'canceled') then
    return query select 'order_ineligible'::text, null::timestamptz;
    return;
  end if;

  for v_order_item_id in
    select i.id
    from public.order_items i
    where i.order_id = v_order_id
    order by i.created_at, i.id
    for update
  loop
    null;
  end loop;
  select coalesce(sum(greatest(coalesce(i.line_shipping, 0), 0)), 0),
         coalesce(sum(least(greatest(coalesce(i.shipping_paid_amount, 0), 0), greatest(coalesce(i.line_shipping, 0), 0))), 0),
         coalesce(bool_or(lower(coalesce(i.shipping_fee_status, '')) = 'pending'), false)
    into v_total_shipping, v_paid_shipping, v_has_pending_shipping
  from public.order_items i
  where i.order_id = v_order_id;
  if v_has_pending_shipping or greatest(v_total_shipping - v_paid_shipping, 0) <= 0 then
    return query select 'order_ineligible'::text, null::timestamptz;
    return;
  end if;

  if v_order.user_id is null then
    v_recipient_email := lower(nullif(btrim(coalesce(v_order.customer_email, '')), ''));
    if v_recipient_email is null then
      v_recipient_email := lower(nullif(btrim(coalesce(v_order.guest_email, '')), ''));
    end if;
  else
    select * into v_profile from public.profiles p where p.id = v_order.user_id;
    v_recipient_email := lower(nullif(btrim(v_profile.email), ''));
    if v_profile.id is null
      or lower(coalesce(v_profile.role, '')) <> 'customer'
      or lower(coalesce(v_profile.status, '')) <> 'active' then
      return query select 'invalid_recipient'::text, null::timestamptz;
      return;
    end if;
  end if;
  if v_recipient_email is null or position('@' in v_recipient_email) < 2 then
    return query select 'invalid_recipient'::text, null::timestamptz;
    return;
  end if;

  if exists (
    select 1
    from public.notifications n
    where n.order_id = v_order_id
      and n.source_type = 'payment_status'
      and (
        n.source_key = 'shipping-payment-request:' || v_order_id::text
        or n.source_key like 'shipping-payment-request:' || v_order_id::text || ':reminder:%'
      )
      and (
        n.created_at > v_notification_created_at
        or (n.created_at = v_notification_created_at and n.id > p_notification_id)
      )
  ) then
    select exists (
      select 1
      from public.notifications n
      join public.notification_email_deliveries d on d.notification_id = n.id
      where n.order_id = v_order_id
        and n.source_type = 'payment_status'
        and (
          n.source_key = 'shipping-payment-request:' || v_order_id::text
          or n.source_key like 'shipping-payment-request:' || v_order_id::text || ':reminder:%'
        )
        and (
          n.created_at > v_notification_created_at
          or (n.created_at = v_notification_created_at and n.id > p_notification_id)
        )
        and d.status = 'sent'
        and d.sent_at is not null
    ) into v_newer_successful_delivery;

    return query select case when v_newer_successful_delivery then 'superseded' else 'not_latest' end,
      null::timestamptz;
    return;
  end if;

  select * into v_delivery
  from public.notification_email_deliveries d
  where d.notification_id = p_notification_id
  for update;
  if not found then
    return query select 'missing_delivery'::text, null::timestamptz;
    return;
  end if;

  if exists (
    select 1
    from public.notifications n
    join public.notification_email_deliveries d on d.notification_id = n.id
    where n.order_id = v_order_id
      and n.source_type = 'payment_status'
      and (
        n.source_key = 'shipping-payment-request:' || v_order_id::text
        or n.source_key like 'shipping-payment-request:' || v_order_id::text || ':reminder:%'
      )
      and d.status in ('pending', 'processing')
      and n.id <> p_notification_id
  ) then
    return query select 'active_delivery'::text, null::timestamptz;
    return;
  end if;

  if v_delivery.status <> 'failed' then
    return query select 'not_retryable'::text, null::timestamptz;
    return;
  end if;
  if coalesce(v_delivery.last_error, '') like 'Superseded by canonical payment notification %' then
    return query select 'delivery_suppressed'::text, null::timestamptz;
    return;
  end if;
  if coalesce(v_delivery.attempts, 0) >= coalesce(v_delivery.max_attempts, 5) then
    return query select 'retry_limit_reached'::text, null::timestamptz;
    return;
  end if;
  if coalesce(v_delivery.last_attempt_at, v_delivery.updated_at) is null then
    return query select 'retry_timestamp_missing'::text, null::timestamptz;
    return;
  end if;

  v_retry_at := coalesce(v_delivery.last_attempt_at, v_delivery.updated_at) + interval '5 minutes';
  if clock_timestamp() < v_retry_at then
    return query select 'retry_cooldown'::text, v_retry_at;
    return;
  end if;

  update public.notification_email_deliveries
  set status = 'pending',
      next_attempt_at = clock_timestamp(),
      sent_at = null,
      locked_at = null,
      lock_token = null,
      last_error = null,
      updated_at = clock_timestamp()
  where id = v_delivery.id
    and status = 'failed';

  if not found then
    return query select 'not_retryable'::text, null::timestamptz;
    return;
  end if;
  return query select 'queued'::text, clock_timestamp();
end;
$function$;

do $privileges$
begin
  if to_regprocedure('public.create_admin_shipping_payment_reminder(uuid,uuid,text,boolean,text,text,uuid,uuid)') is not null then
    execute 'revoke all on function public.create_admin_shipping_payment_reminder(uuid, uuid, text, boolean, text, text, uuid, uuid) from public, anon, authenticated, service_role';
  end if;
end;
$privileges$;

do $legacy_privileges$
begin
  if to_regprocedure('public.create_admin_shipping_payment_reminder(uuid,uuid,text,boolean,text,text,uuid,uuid,uuid,uuid)') is not null then
    execute 'revoke all on function public.create_admin_shipping_payment_reminder(uuid, uuid, text, boolean, text, text, uuid, uuid, uuid, uuid) from public, anon, authenticated, service_role';
  end if;
end;
$legacy_privileges$;

revoke all on function public.create_admin_shipping_payment_reminder(uuid, uuid, text, boolean, text, text, text, uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.create_admin_shipping_payment_reminder(uuid, uuid, text, boolean, text, text, text, uuid, uuid, uuid, uuid)
  to service_role;

revoke all on function public.retry_shipping_payment_notice_delivery(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.retry_shipping_payment_notice_delivery(uuid)
  to service_role;

commit;
