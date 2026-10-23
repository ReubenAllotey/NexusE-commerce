begin;

-- Allow verified guest order emails without creating or linking an account.
alter table public.notifications
  alter column user_id drop not null;

alter table public.notifications
  add column if not exists recipient_email text,
  add column if not exists recipient_name text;

create unique index if not exists notifications_guest_source_unique_idx
  on public.notifications (
    lower(btrim(recipient_email)),
    source_type,
    source_key
  )
  where user_id is null and recipient_email is not null;

do $function$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'notifications_recipient_email_not_blank'
      and conrelid = 'public.notifications'::regclass
  ) then
    alter table public.notifications
      add constraint notifications_recipient_email_not_blank
      check (recipient_email is null or btrim(recipient_email) <> '');
  end if;
end;
$function$;

alter table public.notification_email_deliveries
  alter column recipient_user_id drop not null;

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
  if new.source_type not in ('order_status', 'payment_status', 'shipment_event') then
    return new;
  end if;

  if new.user_id is null then
    v_email := lower(nullif(btrim(new.recipient_email), ''));
    v_role := 'customer';
    v_status := 'active';
  else
    select lower(btrim(p.email)), p.role, p.status
      into v_email, v_role, v_status
    from public.profiles as p
    where p.id = new.user_id;
  end if;

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

commit;
