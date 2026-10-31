begin;

-- Preserve notification and delivery history while allowing an administrator
-- to hide one notification from the admin feed without deleting shared data.
alter table public.notifications
  add column if not exists admin_deleted_at timestamptz;

create index if not exists notifications_admin_deleted_at_idx
  on public.notifications (admin_deleted_at)
  where admin_deleted_at is null;

create or replace function private.guard_admin_notification_archive()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'UPDATE'
     and new.admin_deleted_at is distinct from old.admin_deleted_at
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only the authorized admin service can archive notifications.';
  end if;
  return new;
end;
$function$;

drop trigger if exists notifications_guard_admin_archive on public.notifications;
create trigger notifications_guard_admin_archive
before update on public.notifications
for each row
execute function private.guard_admin_notification_archive();

revoke all on function private.guard_admin_notification_archive() from public, anon, authenticated;

commit;
