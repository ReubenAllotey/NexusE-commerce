begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table if not exists public.shipping_fee_adjustment_notification_intents (
  id uuid primary key default gen_random_uuid(),
  adjustment_id uuid not null references public.shipping_fee_adjustments(id) on delete restrict,
  order_id uuid not null references public.orders(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  old_shipping_fee numeric not null,
  new_shipping_fee numeric not null,
  amount_paid numeric not null default 0,
  credit_applied numeric not null default 0,
  additional_due numeric not null default 0,
  credit_issued_minor bigint not null default 0,
  automatic_recovery boolean not null default true,
  status text not null default 'pending' check (status in ('pending', 'processing', 'queued', 'sent', 'failed', 'skipped', 'manual_review')),
  notification_id uuid unique references public.notifications(id) on delete restrict,
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (adjustment_id, order_id)
);

create index if not exists shipping_fee_adjustment_notification_intents_status_idx
  on public.shipping_fee_adjustment_notification_intents(status, updated_at);

alter table public.shipping_fee_adjustment_notification_intents
  drop constraint if exists shipping_fee_adjustment_notification_intents_status_check;
alter table public.shipping_fee_adjustment_notification_intents
  add constraint shipping_fee_adjustment_notification_intents_status_check
  check (status in ('pending', 'processing', 'queued', 'sent', 'failed', 'skipped', 'manual_review'));
alter table public.shipping_fee_adjustment_notification_intents
  add column if not exists automatic_recovery boolean not null default true;

alter table public.shipping_fee_adjustment_notification_intents enable row level security;
revoke all on table public.shipping_fee_adjustment_notification_intents from public, anon, authenticated, service_role;
grant select on table public.shipping_fee_adjustment_notification_intents to service_role;

create or replace function private.sync_shipping_fee_adjustment_notification_intent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_adjustment public.shipping_fee_adjustments%rowtype;
  v_totals record;
begin
  select * into v_adjustment
  from public.shipping_fee_adjustments
  where id = new.adjustment_id;

  select
    coalesce(sum(ao.cash_paid_before), 0) as amount_paid,
    coalesce(sum(ao.credit_applied), 0) as credit_applied,
    coalesce(sum(ao.additional_due), 0) as additional_due,
    coalesce(sum(ao.credit_issued_minor), 0) as credit_issued_minor
  into v_totals
  from public.shipping_fee_adjustment_orders ao
  where ao.adjustment_id = new.adjustment_id
    and ao.order_id = new.order_id;

  insert into public.shipping_fee_adjustment_notification_intents (
    adjustment_id, order_id, product_id, old_shipping_fee, new_shipping_fee,
    amount_paid, credit_applied, additional_due, credit_issued_minor
  ) values (
    new.adjustment_id, new.order_id, v_adjustment.product_id,
    v_adjustment.old_shipping_fee, v_adjustment.new_shipping_fee,
    v_totals.amount_paid, v_totals.credit_applied,
    v_totals.additional_due, v_totals.credit_issued_minor
  )
  on conflict (adjustment_id, order_id) do update set
    amount_paid = excluded.amount_paid,
    credit_applied = excluded.credit_applied,
    additional_due = excluded.additional_due,
    credit_issued_minor = excluded.credit_issued_minor,
    updated_at = clock_timestamp();
  return new;
end;
$function$;

drop trigger if exists shipping_fee_adjustment_notification_intent_trigger
  on public.shipping_fee_adjustment_orders;
create constraint trigger shipping_fee_adjustment_notification_intent_trigger
after insert on public.shipping_fee_adjustment_orders
deferrable initially deferred
for each row execute function private.sync_shipping_fee_adjustment_notification_intent();

create or replace function private.sync_shipping_fee_adjustment_notification_delivery()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  update public.shipping_fee_adjustment_notification_intents
  set status = case new.status
      when 'pending' then 'queued'
      when 'processing' then 'processing'
      when 'sent' then 'sent'
      when 'failed' then 'failed'
      when 'manual_review' then 'manual_review'
      else status
    end,
    last_error = case when new.status in ('failed', 'manual_review') then new.last_error else null end,
    updated_at = clock_timestamp()
  where notification_id = new.notification_id;
  return new;
end;
$function$;

drop trigger if exists shipping_fee_adjustment_notification_delivery_trigger
  on public.notification_email_deliveries;
create trigger shipping_fee_adjustment_notification_delivery_trigger
after update of status, last_error on public.notification_email_deliveries
for each row execute function private.sync_shipping_fee_adjustment_notification_delivery();

create or replace function private.coordinate_shipping_payment_notification_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_adjustment_request boolean;
  v_conflict boolean;
begin
  if new.source_type <> 'payment_status' or new.order_id is null then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('shipping-payment-notice:' || new.order_id::text, 0)
  );
  v_adjustment_request := new.source_key like 'shipping-fee-adjustment:%'
    and new.action_label = 'Pay Shipping Balance';

  select exists (
    select 1
    from public.notifications n
    join public.notification_email_deliveries d on d.notification_id = n.id
    where n.order_id = new.order_id
      and n.source_type = 'payment_status'
      and n.source_key like 'shipping-payment-request:%'
      and d.status in ('pending', 'processing')
  ) into v_conflict;

  if v_adjustment_request and v_conflict then
    new.action_url := null;
    new.action_label := 'View Shipping Update';
  elsif not v_adjustment_request then
    select v_conflict or exists (
      select 1
      from public.notifications n
      join public.notification_email_deliveries d on d.notification_id = n.id
      where n.order_id = new.order_id
        and n.source_type = 'payment_status'
        and n.source_key like 'shipping-fee-adjustment:%'
        and n.action_label = 'Pay Shipping Balance'
        and (d.status in ('pending', 'processing')
          or (d.status = 'sent' and d.sent_at is not null
            and d.sent_at > clock_timestamp() - interval '48 hours'))
    ) into v_conflict;
    if v_conflict then
      raise exception 'An active shipping payment notice already exists for this order.' using errcode = '40001';
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists coordinate_shipping_payment_notification_insert_trigger
  on public.notifications;
create trigger coordinate_shipping_payment_notification_insert_trigger
before insert on public.notifications
for each row execute function private.coordinate_shipping_payment_notification_insert();

revoke all on function private.coordinate_shipping_payment_notification_insert() from public, anon, authenticated, service_role;

-- Backfill durable intents for adjustments completed before this migration.
insert into public.shipping_fee_adjustment_notification_intents (
  adjustment_id, order_id, product_id, old_shipping_fee, new_shipping_fee,
  amount_paid, credit_applied, additional_due, credit_issued_minor, automatic_recovery
)
select
  ao.adjustment_id,
  ao.order_id,
  a.product_id,
  a.old_shipping_fee,
  a.new_shipping_fee,
  coalesce(sum(ao.cash_paid_before), 0),
  coalesce(sum(ao.credit_applied), 0),
  coalesce(sum(ao.additional_due), 0),
  coalesce(sum(ao.credit_issued_minor), 0), false
from public.shipping_fee_adjustment_orders ao
join public.shipping_fee_adjustments a on a.id = ao.adjustment_id
group by ao.adjustment_id, ao.order_id, a.product_id, a.old_shipping_fee, a.new_shipping_fee
on conflict (adjustment_id, order_id) do nothing;

create or replace function public.create_shipping_fee_adjustment_notification(p_intent_id uuid)
returns table(result_code text, notification_id uuid, intent_id uuid, status text)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_intent public.shipping_fee_adjustment_notification_intents%rowtype;
  v_order public.orders%rowtype;
  v_product public.products%rowtype;
  v_profile public.profiles%rowtype;
  v_email text;
  v_title text;
  v_message text;
  v_source_key text;
  v_notification_id uuid;
  v_delivery_exists boolean;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;

  select * into v_intent
  from public.shipping_fee_adjustment_notification_intents
  where id = p_intent_id
  for update;
  if not found then
    return query select 'not_found'::text, null::uuid, p_intent_id, null::text;
    return;
  end if;
  if v_intent.notification_id is not null then
    return query select 'already_created'::text, v_intent.notification_id, v_intent.id, v_intent.status;
    return;
  end if;

  select * into v_order from public.orders where id = v_intent.order_id;
  if not found then
    update public.shipping_fee_adjustment_notification_intents
    set status = 'skipped', last_error = 'Order no longer exists.', updated_at = clock_timestamp()
    where id = v_intent.id;
    return query select 'skipped'::text, null::uuid, v_intent.id, 'skipped'::text;
    return;
  end if;

  select * into v_product from public.products where id = v_intent.product_id;
  if not found then
    update public.shipping_fee_adjustment_notification_intents
    set status = 'skipped', last_error = 'Adjusted product no longer exists.', updated_at = clock_timestamp()
    where id = v_intent.id;
    return query select 'skipped'::text, null::uuid, v_intent.id, 'skipped'::text;
    return;
  end if;

  if v_order.user_id is null then
    v_email := lower(nullif(btrim(coalesce(v_order.customer_email, '')), ''));
    if v_email is null then
      v_email := lower(nullif(btrim(coalesce(v_order.guest_email, '')), ''));
    end if;
  else
    select * into v_profile from public.profiles where id = v_order.user_id;
    if v_profile.id is null or lower(coalesce(v_profile.role, '')) <> 'customer'
      or lower(coalesce(v_profile.status, '')) <> 'active' then
      update public.shipping_fee_adjustment_notification_intents
      set status = 'skipped', last_error = 'Registered recipient is not active.', updated_at = clock_timestamp()
      where id = v_intent.id;
      return query select 'skipped'::text, null::uuid, v_intent.id, 'skipped'::text;
      return;
    end if;
    v_email := lower(nullif(btrim(v_profile.email), ''));
  end if;

  if v_email is null or position('@' in v_email) < 2 then
    update public.shipping_fee_adjustment_notification_intents
    set status = 'skipped', last_error = 'Recipient email is missing or invalid.', updated_at = clock_timestamp()
    where id = v_intent.id;
    return query select 'skipped'::text, null::uuid, v_intent.id, 'skipped'::text;
    return;
  end if;

  v_title := case
    when v_intent.additional_due > 0 then 'Shipping Fee Increased'
    when v_intent.credit_issued_minor > 0 then 'Shipping Credit Added'
    when v_intent.credit_applied > 0 then 'Shipping Credit Applied'
    else 'Shipping Fee Reduced'
  end;
  v_message := format(
    'Order %s: shipping fee changed from GHS %s to GHS %s for product %s. Amount already paid: GHS %s. Credit applied: GHS %s. Current outstanding shipping balance: GHS %s. %s',
    coalesce(v_order.order_number, v_order.id::text),
    to_char(v_intent.old_shipping_fee, 'FM999999990.00'),
    to_char(v_intent.new_shipping_fee, 'FM999999990.00'),
    coalesce(v_product.name, v_intent.product_id::text),
    to_char(v_intent.amount_paid, 'FM999999990.00'),
    to_char(v_intent.credit_applied, 'FM999999990.00'),
    to_char(v_intent.additional_due, 'FM999999990.00'),
    case when v_intent.credit_issued_minor > 0 then 'Credit issued: GHS ' || to_char(v_intent.credit_issued_minor / 100.0, 'FM999999990.00') || '. It will be deducted from the next eligible shipping fee.' else '' end
  );
  v_source_key := 'shipping-fee-adjustment:' || v_intent.adjustment_id::text || ':' || v_intent.order_id::text;

  insert into public.notifications (
    user_id, recipient_email, recipient_name, category, title, message, order_id,
    source_type, source_key, action_url, action_label, action_description
  ) values (
    v_order.user_id, case when v_order.user_id is null then v_email else null end,
    coalesce(v_order.customer_name, v_profile.full_name, 'Customer'), 'shipping', v_title,
    v_message, v_order.id, 'payment_status', v_source_key,
    case when v_intent.additional_due > 0 then '/payment?purpose=shipping-balance&orderId=' || v_order.id::text else '/profile/orders' end,
    case when v_intent.additional_due > 0 then 'Pay Shipping Balance' else 'View Shipping Credit' end,
    'Shipping fee adjustment notification.'
  )
  on conflict do nothing
  returning id into v_notification_id;

  if v_notification_id is null then
    select n.id into v_notification_id from public.notifications n
    where n.source_type = 'payment_status' and n.source_key = v_source_key;
  end if;
  select exists (select 1 from public.notification_email_deliveries d where d.notification_id = v_notification_id)
    into v_delivery_exists;
  update public.shipping_fee_adjustment_notification_intents
  set notification_id = v_notification_id,
      status = case when v_delivery_exists then 'queued' else 'skipped' end,
      last_error = case when v_delivery_exists then null else 'Email delivery was not created.' end,
      attempts = attempts + 1,
      updated_at = clock_timestamp()
  where id = v_intent.id;
  return query select case when v_delivery_exists then 'created' else 'skipped' end,
    v_notification_id, v_intent.id,
    case when v_delivery_exists then 'queued' else 'skipped' end;
end;
$function$;

revoke all on function public.create_shipping_fee_adjustment_notification(uuid) from public, anon, authenticated, service_role;
grant execute on function public.create_shipping_fee_adjustment_notification(uuid) to service_role;

create or replace function public.get_shipping_notice_credit_summary(p_order_ids uuid[])
returns table(order_id uuid, issued_minor bigint, consumed_minor bigint)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;

  return query
  select l.order_id,
    coalesce(sum(l.amount_minor) filter (where l.entry_type = 'issue'), 0)::bigint,
    coalesce(sum(l.amount_minor) filter (where l.entry_type = 'consume'), 0)::bigint
  from public.shipping_credit_ledger l
  where l.order_id = any(coalesce(p_order_ids, '{}'::uuid[]))
  group by l.order_id;
end;
$function$;

revoke all on function public.get_shipping_notice_credit_summary(uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.get_shipping_notice_credit_summary(uuid[]) to service_role;

commit;
