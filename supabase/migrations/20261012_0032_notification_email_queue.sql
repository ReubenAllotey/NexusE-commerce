begin;

-- The existing notifications migration creates this schema, but keep this
-- migration safe when applied independently or to a partially initialized DB.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists public.notification_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  -- Delivery state follows the notification lifecycle. This is not a
  -- permanent audit ledger; retain sent history by retaining notifications.
  notification_id uuid not null references public.notifications(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  recipient_email text not null,
  notification_type text not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  next_attempt_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  sent_at timestamptz,
  provider text,
  provider_message_id text,
  last_error text,
  locked_at timestamptz,
  lock_token uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_email_deliveries_notification_key unique (notification_id),
  constraint notification_email_deliveries_status_check check (status in ('pending', 'processing', 'sent', 'failed')),
  constraint notification_email_deliveries_attempts_check check (attempts >= 0),
  constraint notification_email_deliveries_max_attempts_check check (max_attempts > 0),
  constraint notification_email_deliveries_email_not_blank check (btrim(recipient_email) <> '')
);

create index if not exists notification_email_deliveries_pending_idx
  on public.notification_email_deliveries (status, next_attempt_at, created_at);

alter table public.notification_email_deliveries enable row level security;
revoke all on table public.notification_email_deliveries from public, anon, authenticated;

create or replace function public.claim_notification_email_jobs(
  p_limit integer default 25,
  p_lease_timeout interval default interval '5 minutes'
)
returns setof public.notification_email_deliveries
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_lease_timeout is null or p_lease_timeout <= interval '0 seconds' then
    raise exception 'p_lease_timeout must be a positive interval.';
  end if;

  return query
  with candidates as (
    select q.id
    from public.notification_email_deliveries as q
    where q.attempts < q.max_attempts
      and q.next_attempt_at <= now()
      and (
        q.status in ('pending', 'failed')
        or (
          q.status = 'processing'
          and q.locked_at is not null
          and q.locked_at < now() - p_lease_timeout
        )
      )
    order by q.created_at asc, q.id asc
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 25), 100))
  )
  update public.notification_email_deliveries as q
  set status = 'processing',
      attempts = q.attempts + 1,
      last_attempt_at = now(),
      locked_at = now(),
      lock_token = gen_random_uuid(),
      last_error = null,
      updated_at = now()
  from candidates
  where q.id = candidates.id
  returning q.*;
end;
$function$;

create or replace function private.queue_notification_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_email text;
  v_role text;
  v_status text;
begin
  -- Announcements may be promotional and there is no email-preference field
  -- in the current profiles schema. Queue only transactional events until a
  -- reviewed preference model exists.
  if new.source_type not in ('order_status', 'payment_status', 'shipment_event') then
    return new;
  end if;

  select lower(btrim(p.email)), p.role, p.status
    into v_email, v_role, v_status
  from public.profiles as p
  where p.id = new.user_id;

  if v_email is null or v_email = '' or v_role <> 'customer' or v_status <> 'active' then
    return new;
  end if;

  insert into public.notification_email_deliveries (
    notification_id,
    recipient_user_id,
    recipient_email,
    notification_type
  ) values (
    new.id,
    new.user_id,
    v_email,
    new.source_type
  ) on conflict (notification_id) do nothing;

  return new;
end;
$function$;

drop trigger if exists notifications_email_queue on public.notifications;
create trigger notifications_email_queue
after insert on public.notifications
for each row
execute function private.queue_notification_email();

revoke all on function private.queue_notification_email() from public, anon, authenticated;
revoke all on function public.claim_notification_email_jobs(integer, interval) from public, anon, authenticated;
grant execute on function public.claim_notification_email_jobs(integer, interval) to service_role;

commit;
