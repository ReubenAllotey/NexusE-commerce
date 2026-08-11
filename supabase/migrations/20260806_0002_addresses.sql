begin;

create extension if not exists pgcrypto;
create schema if not exists private;

create table public.addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  address_label text,
  full_name text not null,
  phone_number text not null,
  email_address text,
  country text not null,
  region text not null,
  city text not null,
  street_address text not null,
  house_number text,
  landmark text,
  postal_code text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index addresses_user_id_idx
  on public.addresses (user_id);

create unique index addresses_one_default_per_user_idx
  on public.addresses (user_id)
  where is_default;

-- The advisory lock below only serializes concurrent writes for a single user.
-- hashtext(user_id) is stable for a given user, but it is not collision-free, so the
-- partial unique index above is the final guarantee that no user can end up with more
-- than one default address.

create or replace function private.set_addresses_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.ensure_single_default_address(
  p_user_id uuid,
  p_keep_address_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.addresses a
  set is_default = false
  where a.user_id = p_user_id
    and a.is_default
    and a.id <> p_keep_address_id;
end;
$$;

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
  -- pg_trigger_depth() keeps recursive cleanup writes from being validated repeatedly.
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
     or new.city is null
     or new.street_address is null then
    raise exception 'Address requires full name, phone number, country, region, city, and street address.';
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

create or replace function private.promote_default_address_after_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_replacement_id uuid;
begin
  if not coalesce(old.is_default, false) then
    return old;
  end if;

  perform pg_advisory_xact_lock(hashtext(old.user_id::text));

  if exists (
    select 1
    from public.addresses a
    where a.user_id = old.user_id
      and a.is_default
  ) then
    return old;
  end if;

  select a.id
    into v_replacement_id
  from public.addresses a
  where a.user_id = old.user_id
  -- Deleting the current default promotes the oldest remaining address.
  -- The created_at, updated_at, and id ordering keeps the choice deterministic.
  order by a.created_at asc, a.updated_at asc, a.id asc
  limit 1;

  if v_replacement_id is null then
    return old;
  end if;

  update public.addresses
  set is_default = true
  where id = v_replacement_id
    and user_id = old.user_id;

  return old;
end;
$$;

drop trigger if exists trg_addresses_updated_at on public.addresses;
create trigger trg_addresses_updated_at
before update on public.addresses
for each row
execute function private.set_addresses_updated_at();

drop trigger if exists trg_addresses_normalize_write on public.addresses;
create trigger trg_addresses_normalize_write
before insert or update on public.addresses
for each row
execute function private.normalize_addresses_write();

drop trigger if exists trg_addresses_promote_default_after_delete on public.addresses;
create trigger trg_addresses_promote_default_after_delete
after delete on public.addresses
for each row
execute function private.promote_default_address_after_delete();

alter table public.addresses enable row level security;

drop policy if exists addresses_select_own on public.addresses;
create policy addresses_select_own
on public.addresses
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists addresses_select_admin on public.addresses;
create policy addresses_select_admin
on public.addresses
for select
to authenticated
using ((select private.is_admin_user()));

drop policy if exists addresses_insert_own on public.addresses;
create policy addresses_insert_own
on public.addresses
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists addresses_update_own on public.addresses;
create policy addresses_update_own
on public.addresses
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists addresses_delete_own on public.addresses;
create policy addresses_delete_own
on public.addresses
for delete
to authenticated
using (auth.uid() = user_id);

grant usage on schema private to authenticated;

revoke all on public.addresses from public;
revoke all on public.addresses from anon;
grant select, insert, update, delete on public.addresses to authenticated;

revoke all on function private.set_addresses_updated_at() from public;
revoke all on function private.set_addresses_updated_at() from anon;
revoke all on function private.set_addresses_updated_at() from authenticated;

revoke all on function private.ensure_single_default_address(uuid, uuid) from public;
revoke all on function private.ensure_single_default_address(uuid, uuid) from anon;
revoke all on function private.ensure_single_default_address(uuid, uuid) from authenticated;

revoke all on function private.normalize_addresses_write() from public;
revoke all on function private.normalize_addresses_write() from anon;
revoke all on function private.normalize_addresses_write() from authenticated;

revoke all on function private.promote_default_address_after_delete() from public;
revoke all on function private.promote_default_address_after_delete() from anon;
revoke all on function private.promote_default_address_after_delete() from authenticated;

commit;
