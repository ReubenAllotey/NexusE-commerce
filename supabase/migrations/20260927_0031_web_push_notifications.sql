begin;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  platform text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz,
  constraint push_subscriptions_endpoint_key unique (endpoint),
  constraint push_subscriptions_endpoint_not_blank check (btrim(endpoint) <> ''),
  constraint push_subscriptions_p256dh_not_blank check (btrim(p256dh) <> ''),
  constraint push_subscriptions_auth_not_blank check (btrim(auth) <> '')
);

create index if not exists push_subscriptions_user_active_idx
  on public.push_subscriptions (user_id, is_active);

create table if not exists public.push_delivery_queue (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending',
  attempts integer not null default 0,
  claimed_at timestamptz,
  delivered_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint push_delivery_queue_notification_key unique (notification_id),
  constraint push_delivery_queue_status_check check (status in ('pending', 'processing', 'sent', 'failed')),
  constraint push_delivery_queue_attempts_check check (attempts >= 0)
);

create index if not exists push_delivery_queue_pending_idx
  on public.push_delivery_queue (status, created_at);

create or replace function private.claim_push_delivery_jobs(
  p_limit integer default 25,
  p_lease_timeout interval default interval '2 minutes'
)
returns setof public.push_delivery_queue
language sql
security definer
set search_path = ''
as $function$
with candidates as (
  select q.id
  from public.push_delivery_queue as q
  where (
    q.status in ('pending', 'failed')
    or (
      q.status = 'processing'
      and q.claimed_at is not null
      and q.claimed_at < now() - coalesce(p_lease_timeout, interval '2 minutes')
    )
  )
  and q.attempts < 5
  order by q.created_at asc, q.id asc
  for update skip locked
  limit greatest(1, least(coalesce(p_limit, 25), 100))
)
update public.push_delivery_queue as q
set status = 'processing',
    attempts = q.attempts + 1,
    claimed_at = now(),
    updated_at = now(),
    last_error = null
from candidates
where q.id = candidates.id
returning q.*;
$function$;

alter table public.push_subscriptions enable row level security;
alter table public.push_delivery_queue enable row level security;

revoke all on table public.push_subscriptions from public, anon, authenticated;
revoke all on table public.push_delivery_queue from public, anon, authenticated;

create or replace function private.queue_notification_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into public.push_delivery_queue (notification_id, user_id)
  values (new.id, new.user_id)
  on conflict (notification_id) do nothing;

  return new;
end;
$function$;

drop trigger if exists notifications_push_queue on public.notifications;
create trigger notifications_push_queue
after insert on public.notifications
for each row
execute function private.queue_notification_push();

revoke all on function private.queue_notification_push() from public, anon, authenticated;
revoke all on function private.claim_push_delivery_jobs(integer, interval) from public, anon, authenticated;
grant execute on function private.claim_push_delivery_jobs(integer, interval) to service_role;

commit;
