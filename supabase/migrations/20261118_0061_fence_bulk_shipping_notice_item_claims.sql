begin;

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
      locked_at = clock_timestamp(),
      lock_token = gen_random_uuid(),
      updated_at = clock_timestamp()
  where id = p_job_id
    and status not in ('complete', 'failed')
    and (
      locked_at is null
      or locked_at <= clock_timestamp() - make_interval(secs => greatest(coalesce(p_lease_seconds, 300), 30))
    )
  returning *;
end;
$function$;

create or replace function public.claim_bulk_shipping_notice_items(
  p_job_id uuid,
  p_lock_token uuid,
  p_limit integer default 25,
  p_lease_seconds integer default 300
)
returns setof public.bulk_shipping_notice_job_items
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_status text;
  v_lock_token uuid;
  v_locked_at timestamptz;
  v_lease_seconds integer := greatest(coalesce(p_lease_seconds, 300), 30);
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required';
  end if;

  select status, lock_token, locked_at
  into v_status, v_lock_token, v_locked_at
  from public.bulk_shipping_notice_jobs
  where id = p_job_id
  for update;

  if not found
    or v_status <> 'processing'
    or v_lock_token is null
    or v_lock_token <> p_lock_token
    or v_locked_at is null
    or v_locked_at <= clock_timestamp() - make_interval(secs => v_lease_seconds) then
    raise exception 'Bulk shipping notice job lease is invalid or expired';
  end if;

  update public.bulk_shipping_notice_job_items
  set status = 'pending',
      locked_at = null,
      lock_token = null,
      updated_at = now()
  where job_id = p_job_id
    and status = 'processing'
    and locked_at <= clock_timestamp() - make_interval(secs => v_lease_seconds);

  return query
  with claimable as (
    select id
    from public.bulk_shipping_notice_job_items
    where job_id = p_job_id
      and status = 'pending'
    order by created_at, id
    for update skip locked
    limit least(greatest(coalesce(p_limit, 25), 1), 25)
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

-- The legacy signature cannot prove parent-job ownership. Leave it present for
-- migration compatibility, but make it unavailable to every runtime role.
revoke all on function public.claim_bulk_shipping_notice_items(uuid, integer, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.claim_bulk_shipping_notice_items(uuid, uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_bulk_shipping_notice_items(uuid, uuid, integer, integer)
  to service_role;

create or replace function public.persist_bulk_shipping_notice_job_items(
  p_job_id uuid,
  p_lock_token uuid,
  p_items jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_status text;
  v_lock_token uuid;
  v_locked_at timestamptz;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required';
  end if;

  select status, lock_token, locked_at
  into v_status, v_lock_token, v_locked_at
  from public.bulk_shipping_notice_jobs
  where id = p_job_id
  for update;

  if not found
    or v_status <> 'processing'
    or v_lock_token is null
    or v_lock_token <> p_lock_token
    or v_locked_at is null
    or v_locked_at <= clock_timestamp() - make_interval(secs => 300) then
    raise exception 'Bulk shipping notice job lease is invalid or expired';
  end if;

  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    raise exception 'Job items must be a JSON array';
  end if;

  insert into public.bulk_shipping_notice_job_items (
    job_id,
    order_id,
    status,
    reason,
    outstanding_shipping,
    notification_id,
    last_error
  )
  select
    p_job_id,
    item.order_id,
    item.status,
    item.reason,
    item.outstanding_shipping,
    item.notification_id,
    item.last_error
  from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as item(
    order_id uuid,
    status text,
    reason text,
    outstanding_shipping numeric,
    notification_id uuid,
    last_error text
  )
  on conflict (job_id, order_id) do nothing;
end;
$function$;

revoke all on function public.persist_bulk_shipping_notice_job_items(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.persist_bulk_shipping_notice_job_items(uuid, uuid, jsonb)
  to service_role;

revoke all on function public.claim_bulk_shipping_notice_job(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.claim_bulk_shipping_notice_job(uuid, integer)
  to service_role;

commit;
