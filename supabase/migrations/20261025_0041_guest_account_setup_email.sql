begin;

-- Required by the server-side, idempotent guest account setup notification.
alter table public.notifications
  drop constraint if exists notifications_source_type_check;

alter table public.notifications
  add constraint notifications_source_type_check
  check (source_type in ('announcement', 'order_status', 'payment_status', 'shipment_event', 'account_setup'));

create or replace function private.normalize_notifications_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  new.category := lower(btrim(coalesce(new.category, '')));
  new.title := btrim(coalesce(new.title, ''));
  new.message := btrim(coalesce(new.message, ''));
  new.source_type := lower(btrim(coalesce(new.source_type, '')));
  new.source_key := btrim(coalesce(new.source_key, ''));
  new.action_url := nullif(btrim(coalesce(new.action_url, '')), '');
  new.action_label := nullif(btrim(coalesce(new.action_label, '')), '');
  new.action_description := nullif(btrim(coalesce(new.action_description, '')), '');

  if new.category not in ('orders', 'shipping', 'announcement', 'more') then
    raise exception 'Invalid notification category.';
  end if;

  if new.source_type not in ('announcement', 'order_status', 'payment_status', 'shipment_event', 'account_setup') then
    raise exception 'Invalid notification source type.';
  end if;

  if tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id
       or new.category is distinct from old.category
       or new.title is distinct from old.title
       or new.message is distinct from old.message
       or new.order_id is distinct from old.order_id
       or new.shipment_id is distinct from old.shipment_id
       or new.payment_id is distinct from old.payment_id
       or new.action_url is distinct from old.action_url
       or new.action_label is distinct from old.action_label
       or new.action_description is distinct from old.action_description
       or new.source_type is distinct from old.source_type
       or new.source_key is distinct from old.source_key then
      raise exception 'Only notification read state can be changed through this operation.';
    end if;

    if new.read_at is distinct from old.read_at
       and new.is_read is not distinct from old.is_read then
      raise exception 'Only notification read state can be changed through this operation.';
    end if;
  end if;

  if coalesce(new.is_read, false) then
    if tg_op = 'UPDATE' then
      new.read_at := coalesce(new.read_at, old.read_at, now());
    else
      new.read_at := coalesce(new.read_at, now());
    end if;
  else
    new.read_at := null;
  end if;

  if new.is_read is null then
    new.is_read := false;
  end if;

  return new;
end;
$function$;

revoke all on function private.normalize_notifications_write() from public, anon, authenticated;
revoke insert on table public.notifications from public, anon, authenticated;

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
  if new.source_type not in ('order_status', 'payment_status', 'shipment_event', 'account_setup') then
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

revoke all on function private.queue_notification_email() from public, anon, authenticated;

commit;
