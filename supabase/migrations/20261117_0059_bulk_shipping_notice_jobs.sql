begin;

create table if not exists public.bulk_shipping_notice_jobs (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  created_by uuid not null references auth.users(id) on delete restrict,
  status text not null default 'pending',
  cursor_created_at timestamptz,
  cursor_order_id uuid,
  scan_complete boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  locked_at timestamptz,
  lock_token uuid,
  constraint bulk_shipping_notice_jobs_status_check
    check (status in ('pending', 'processing', 'complete', 'partial', 'failed')),
  constraint bulk_shipping_notice_jobs_idempotency_key_check
    check (btrim(idempotency_key) <> '')
);

create table if not exists public.bulk_shipping_notice_job_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.bulk_shipping_notice_jobs(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete restrict,
  status text not null default 'pending',
  reason text,
  outstanding_shipping numeric not null default 0,
  notification_id uuid references public.notifications(id) on delete set null,
  attempts integer not null default 0,
  last_error text,
  locked_at timestamptz,
  lock_token uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bulk_shipping_notice_job_items_status_check
    check (status in (
      'pending', 'processing', 'queued', 'already_pending', 'already_processing',
      'already_sent', 'retryable_failed', 'permanent_failed', 'missing_delivery',
      'skipped', 'failed'
    )),
  constraint bulk_shipping_notice_job_items_unique_order
    unique (job_id, order_id),
  constraint bulk_shipping_notice_job_items_amount_check
    check (outstanding_shipping >= 0)
);

create index if not exists bulk_shipping_notice_jobs_created_by_idx
  on public.bulk_shipping_notice_jobs (created_by, created_at desc);

create index if not exists bulk_shipping_notice_job_items_claim_idx
  on public.bulk_shipping_notice_job_items (job_id, status, created_at);

alter table public.bulk_shipping_notice_jobs enable row level security;
alter table public.bulk_shipping_notice_job_items enable row level security;
revoke all on table public.bulk_shipping_notice_jobs from public, anon, authenticated;
revoke all on table public.bulk_shipping_notice_job_items from public, anon, authenticated;
grant select, insert, update on table public.bulk_shipping_notice_jobs to service_role;
grant select, insert, update on table public.bulk_shipping_notice_job_items to service_role;

create or replace function public.claim_bulk_shipping_notice_job(
  p_job_id uuid,
  p_lease_seconds integer default 300
)
returns setof public.bulk_shipping_notice_jobs
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required';
  end if;

  return query
  update public.bulk_shipping_notice_jobs
  set status = 'processing',
      locked_at = now(),
      lock_token = gen_random_uuid(),
      updated_at = now()
  where id = p_job_id
    and status not in ('complete', 'failed')
    and (
      locked_at is null
      or locked_at < now() - make_interval(secs => greatest(p_lease_seconds, 30))
    )
  returning *;
end;
$function$;

create or replace function public.claim_bulk_shipping_notice_items(
  p_job_id uuid,
  p_limit integer default 25,
  p_lease_seconds integer default 300
)
returns setof public.bulk_shipping_notice_job_items
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required';
  end if;

  update public.bulk_shipping_notice_job_items
  set status = 'pending',
      locked_at = null,
      lock_token = null,
      updated_at = now()
  where job_id = p_job_id
    and status = 'processing'
    and locked_at < now() - make_interval(secs => greatest(p_lease_seconds, 30));

  return query
  with claimable as (
    select id
    from public.bulk_shipping_notice_job_items
    where job_id = p_job_id
      and status = 'pending'
    order by created_at, id
    for update skip locked
    limit greatest(p_limit, 1)
  )
  update public.bulk_shipping_notice_job_items as item
  set status = 'processing',
      attempts = item.attempts + 1,
      locked_at = now(),
      lock_token = gen_random_uuid(),
      updated_at = now()
  from claimable
  where item.id = claimable.id
  returning item.*;
end;
$function$;

revoke all on function public.claim_bulk_shipping_notice_job(uuid, integer)
  from public, anon, authenticated;
revoke all on function public.claim_bulk_shipping_notice_items(uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_bulk_shipping_notice_job(uuid, integer) to service_role;
grant execute on function public.claim_bulk_shipping_notice_items(uuid, integer, integer) to service_role;

commit;
