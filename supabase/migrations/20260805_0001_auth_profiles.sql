begin;

create schema private;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text not null,
  phone_number text,
  photo_url text,
  date_of_birth date,
  gender text,
  role text not null default 'customer'
    check (role in ('customer', 'admin')),
  account_type text not null default 'member'
    check (account_type in ('member', 'guest')),
  status text not null default 'active'
    check (status in ('active', 'suspended', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index profiles_email_lower_unique
  on public.profiles (lower(email));

create index profiles_role_idx
  on public.profiles (role);

create index profiles_status_idx
  on public.profiles (status);

create table private.profile_internal_context (
  txid bigint primary key,
  purpose text not null
    check (purpose in ('email_sync')),
  created_at timestamptz not null default now()
);

revoke all on schema private from public;
revoke all on schema private from anon;
revoke all on schema private from authenticated;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function private.is_admin_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
      and p.status = 'active'
  );
$$;

create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_raw_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_email text;
  v_full_name text;
  v_account_type text;
  v_phone_number text;
  v_photo_url text;
  v_date_of_birth date;
  v_gender text;
begin
  if new.email is null or btrim(new.email) = '' then
    raise exception 'Email is required for email-based accounts.';
  end if;

  v_email := lower(btrim(new.email));

  v_full_name := coalesce(
    nullif(btrim(v_raw_meta ->> 'full_name'), ''),
    nullif(btrim(v_raw_meta ->> 'name'), ''),
    nullif(btrim(v_raw_meta ->> 'display_name'), ''),
    split_part(v_email, '@', 1),
    'New User'
  );

  v_account_type := case
    when lower(coalesce(v_raw_meta ->> 'account_type', '')) = 'guest' then 'guest'
    else 'member'
  end;

  v_phone_number := nullif(btrim(v_raw_meta ->> 'phone_number'), '');
  v_photo_url := nullif(btrim(v_raw_meta ->> 'photo_url'), '');
  v_gender := nullif(btrim(v_raw_meta ->> 'gender'), '');

  if nullif(btrim(v_raw_meta ->> 'date_of_birth'), '') is null then
    v_date_of_birth := null;
  else
    v_date_of_birth := nullif(btrim(v_raw_meta ->> 'date_of_birth'), '')::date;
  end if;

  insert into public.profiles (
    id,
    full_name,
    email,
    phone_number,
    photo_url,
    date_of_birth,
    gender,
    role,
    account_type,
    status,
    created_at,
    updated_at
  ) values (
    new.id,
    v_full_name,
    v_email,
    v_phone_number,
    v_photo_url,
    v_date_of_birth,
    v_gender,
    'customer',
    v_account_type,
    'active',
    now(),
    now()
  );

  return new;
end;
$$;

create or replace function private.sync_profile_email_from_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  if new.email is null or btrim(new.email) = '' then
    raise exception 'Email is required for email-based accounts.';
  end if;

  v_email := lower(btrim(new.email));

  insert into private.profile_internal_context (txid, purpose)
  values (txid_current(), 'email_sync')
  on conflict (txid) do update
    set purpose = excluded.purpose,
        created_at = now();

  -- This intentionally updates updated_at because the mirrored profile record changed.
  update public.profiles
  set email = v_email
  where id = new.id;

  delete from private.profile_internal_context
  where txid = txid_current();

  return new;
exception
  when others then
    delete from private.profile_internal_context
    where txid = txid_current();
    raise;
end;
$$;

create or replace function private.enforce_profile_update_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_admin boolean := private.is_admin_user();
  v_internal_email_sync boolean := exists (
    select 1
    from private.profile_internal_context c
    where c.txid = txid_current()
      and c.purpose = 'email_sync'
  );
begin
  if v_internal_email_sync then
    if new.id is distinct from old.id
       or new.full_name is distinct from old.full_name
       or new.phone_number is distinct from old.phone_number
       or new.photo_url is distinct from old.photo_url
       or new.date_of_birth is distinct from old.date_of_birth
       or new.gender is distinct from old.gender
       or new.role is distinct from old.role
       or new.account_type is distinct from old.account_type
       or new.status is distinct from old.status then
      raise exception 'Internal email sync may only update the email column.';
    end if;

    return new;
  end if;

  if auth.uid() = old.id then
    if new.id is distinct from old.id
       or new.email is distinct from old.email
       or new.role is distinct from old.role
       or new.account_type is distinct from old.account_type
       or new.status is distinct from old.status then
      raise exception 'Privileged profile fields cannot be changed through this operation.';
    end if;

    return new;
  end if;

  if v_is_admin then
    if old.role <> 'customer' then
      raise exception 'Administrators can update customer profiles only.';
    end if;

    if new.role is distinct from old.role
       or new.account_type is distinct from old.account_type
       or new.id is distinct from old.id
       or new.email is distinct from old.email then
      raise exception 'Privileged profile fields cannot be changed through this operation.';
    end if;

    return new;
  end if;

  raise exception 'You are not allowed to update this profile.';
end;
$$;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();

drop trigger if exists trg_profiles_enforce_rules on public.profiles;
create trigger trg_profiles_enforce_rules
before update on public.profiles
for each row execute function private.enforce_profile_update_rules();

drop trigger if exists trg_auth_user_created on auth.users;
create trigger trg_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_auth_user();

drop trigger if exists trg_auth_user_email_updated on auth.users;
create trigger trg_auth_user_email_updated
after update of email on auth.users
for each row
when (old.email is distinct from new.email)
execute function private.sync_profile_email_from_auth_user();

alter table public.profiles enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
on public.profiles
for select
to authenticated
using (auth.uid() = id);

drop policy if exists profiles_select_admin on public.profiles;
create policy profiles_select_admin
on public.profiles
for select
to authenticated
using (private.is_admin_user());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists profiles_update_customer_by_admin on public.profiles;
create policy profiles_update_customer_by_admin
on public.profiles
for update
to authenticated
using (private.is_admin_user() and role = 'customer')
with check (private.is_admin_user() and role = 'customer');

grant usage on schema private to authenticated;

revoke all on function private.is_admin_user() from public;
revoke all on function private.is_admin_user() from anon;
revoke all on function private.is_admin_user() from authenticated;
grant execute on function private.is_admin_user() to authenticated;

revoke all on function private.handle_new_auth_user() from public;
revoke all on function private.handle_new_auth_user() from anon;
revoke all on function private.handle_new_auth_user() from authenticated;

revoke all on function private.sync_profile_email_from_auth_user() from public;
revoke all on function private.sync_profile_email_from_auth_user() from anon;
revoke all on function private.sync_profile_email_from_auth_user() from authenticated;

revoke all on function private.enforce_profile_update_rules() from public;
revoke all on function private.enforce_profile_update_rules() from anon;
revoke all on function private.enforce_profile_update_rules() from authenticated;

revoke all on function private.set_updated_at() from public;
revoke all on function private.set_updated_at() from anon;
revoke all on function private.set_updated_at() from authenticated;

grant select, update on public.profiles to authenticated;

commit;
