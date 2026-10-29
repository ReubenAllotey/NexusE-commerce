begin;

-- Provider timeouts and worker crashes can leave a delivery in an unknown state.
-- Such rows must be held for explicit provider reconciliation, never auto-sent.
alter table public.notification_email_deliveries
  drop constraint if exists notification_email_deliveries_status_check;

alter table public.notification_email_deliveries
  add constraint notification_email_deliveries_status_check
  check (status in ('pending', 'processing', 'sent', 'failed', 'manual_review'));

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

  update public.notification_email_deliveries
  set status = 'manual_review',
      next_attempt_at = now(),
      locked_at = null,
      lock_token = null,
      last_error = 'Processing lease expired; provider outcome requires manual review.',
      updated_at = now()
  where status = 'processing'
    and locked_at is not null
    and locked_at < now() - p_lease_timeout;

  return query
  with candidates as (
    select q.id
    from public.notification_email_deliveries as q
    where q.attempts < q.max_attempts
      and q.next_attempt_at <= now()
      and q.status in ('pending', 'failed')
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

create or replace function public.claim_notification_email_job(
  p_delivery_id uuid,
  p_lease_timeout interval default interval '5 minutes'
)
returns setof public.notification_email_deliveries
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_delivery_id is null then
    raise exception 'p_delivery_id is required.';
  end if;
  if p_lease_timeout is null or p_lease_timeout <= interval '0 seconds' then
    raise exception 'p_lease_timeout must be a positive interval.';
  end if;

  update public.notification_email_deliveries
  set status = 'manual_review',
      next_attempt_at = now(),
      locked_at = null,
      lock_token = null,
      last_error = 'Processing lease expired; provider outcome requires manual review.',
      updated_at = now()
  where id = p_delivery_id
    and status = 'processing'
    and locked_at is not null
    and locked_at < now() - p_lease_timeout;

  return query
  with candidate as (
    select q.id
    from public.notification_email_deliveries as q
    where q.id = p_delivery_id
      and q.attempts < q.max_attempts
      and q.next_attempt_at <= now()
      and q.status in ('pending', 'failed')
    for update skip locked
    limit 1
  )
  update public.notification_email_deliveries as q
  set status = 'processing',
      attempts = q.attempts + 1,
      last_attempt_at = now(),
      locked_at = now(),
      lock_token = gen_random_uuid(),
      last_error = null,
      updated_at = now()
  from candidate
  where q.id = candidate.id
  returning q.*;
end;
$function$;

revoke all on function public.claim_notification_email_jobs(integer, interval) from public, anon, authenticated;
grant execute on function public.claim_notification_email_jobs(integer, interval) to service_role;
revoke all on function public.claim_notification_email_job(uuid, interval) from public, anon, authenticated;
grant execute on function public.claim_notification_email_job(uuid, interval) to service_role;

commit;
