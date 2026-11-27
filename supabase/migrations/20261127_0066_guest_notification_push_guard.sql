begin;

-- Guest notifications are email-addressed and intentionally have no auth user.
-- They must not enter the authenticated push queue, whose user_id is required.
create or replace function private.queue_notification_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.user_id is null then
    return new;
  end if;

  insert into public.push_delivery_queue (notification_id, user_id)
  values (new.id, new.user_id)
  on conflict (notification_id) do nothing;

  return new;
end;
$function$;

revoke all on function private.queue_notification_push() from public, anon, authenticated;

commit;
