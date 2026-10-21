begin;

-- PostgREST cannot address the private schema. Keep the queue implementation
-- private and expose only this service-role-only RPC forwarding surface.
create or replace function public.claim_push_delivery_jobs(
  p_limit integer default 25,
  p_lease_timeout interval default interval '2 minutes'
)
returns setof public.push_delivery_queue
language sql
security definer
set search_path = ''
as $function$
  select *
  from private.claim_push_delivery_jobs(p_limit, p_lease_timeout);
$function$;

revoke all on function public.claim_push_delivery_jobs(integer, interval) from public, anon, authenticated;
grant execute on function public.claim_push_delivery_jobs(integer, interval) to service_role;

commit;
