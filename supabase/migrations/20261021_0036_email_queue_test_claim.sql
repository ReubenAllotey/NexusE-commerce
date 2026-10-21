begin;

-- Test-only claim path. This does not alter the existing unrestricted worker RPC.
-- Apply manually only after reviewing the production queue and test procedure.
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

  return query
  with candidate as (
    select q.id
    from public.notification_email_deliveries as q
    where q.id = p_delivery_id
      and q.attempts < q.max_attempts
      and q.next_attempt_at <= now()
      and (
        q.status in ('pending', 'failed')
        or (
          q.status = 'processing'
          and q.locked_at is not null
          and q.locked_at < now() - p_lease_timeout
        )
      )
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

revoke all on function public.claim_notification_email_job(uuid, interval) from public, anon, authenticated;
grant execute on function public.claim_notification_email_job(uuid, interval) to service_role;

commit;
