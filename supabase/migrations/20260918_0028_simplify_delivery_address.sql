begin;

alter table public.addresses
  alter column street_address drop not null;

create or replace function private.normalize_addresses_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auth_uid uuid := auth.uid();
  v_existing_default_count integer := 0;
begin
  -- Internal maintenance updates may re-enter the trigger path once.
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  if v_auth_uid is null then
    raise exception 'You must be signed in to manage addresses.';
  end if;

  if tg_op = 'INSERT' then
    if new.user_id is null then
      raise exception 'user_id is required for address inserts.';
    end if;

    if new.user_id is distinct from v_auth_uid then
      raise exception 'You can only create addresses for your own account.';
    end if;
  elsif tg_op = 'UPDATE' then
    if new.user_id is null then
      raise exception 'user_id cannot be null.';
    end if;

    if new.user_id is distinct from old.user_id then
      raise exception 'user_id cannot be changed through this operation.';
    end if;

    if new.user_id is distinct from v_auth_uid then
      raise exception 'You can only update your own addresses.';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtext(new.user_id::text));

  new.address_label := nullif(btrim(new.address_label), '');
  new.full_name := nullif(btrim(new.full_name), '');
  new.phone_number := nullif(btrim(new.phone_number), '');
  new.email_address := nullif(btrim(new.email_address), '');
  new.country := nullif(btrim(new.country), '');
  new.region := nullif(btrim(new.region), '');
  new.city := nullif(btrim(new.city), '');
  new.street_address := nullif(btrim(new.street_address), '');
  new.house_number := nullif(btrim(new.house_number), '');
  new.landmark := nullif(btrim(new.landmark), '');
  new.postal_code := nullif(btrim(new.postal_code), '');

  if new.full_name is null
     or new.phone_number is null
     or new.country is null
     or new.region is null
     or new.city is null then
    raise exception 'Address requires full name, phone number, country, region, and delivery location.';
  end if;

  select count(*)
    into v_existing_default_count
  from public.addresses a
  where a.user_id = new.user_id
    and a.is_default
    and (tg_op <> 'UPDATE' or a.id <> old.id);

  if new.is_default then
    perform private.ensure_single_default_address(new.user_id, coalesce(old.id, new.id));
  elsif v_existing_default_count = 0 then
    new.is_default := true;
  end if;

  return new;
end;
$$;

revoke all on function private.normalize_addresses_write() from public;
revoke all on function private.normalize_addresses_write() from anon;
revoke all on function private.normalize_addresses_write() from authenticated;

commit;
