begin;

alter table public.orders
  alter column user_id drop not null;

alter table public.orders
  add column if not exists guest_email text,
  add column if not exists guest_full_name text;

alter table public.orders
  drop constraint if exists orders_guest_email_not_blank;

alter table public.orders
  add constraint orders_guest_email_not_blank
    check (guest_email is null or btrim(guest_email) <> '');

alter table public.orders
  drop constraint if exists orders_guest_full_name_not_blank;

alter table public.orders
  add constraint orders_guest_full_name_not_blank
    check (guest_full_name is null or btrim(guest_full_name) <> '');

alter table public.payments
  alter column user_id drop not null;

alter table public.profiles
  add column if not exists must_change_password boolean not null default false;

create index if not exists orders_guest_email_idx
  on public.orders (lower(guest_email));

create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_raw_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_email text;
  v_full_name text;
  v_account_type text;
  v_phone_number text;
  v_photo_url text;
  v_date_of_birth date;
  v_gender text;
  v_must_change_password boolean;
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
  v_must_change_password := lower(coalesce(v_raw_meta ->> 'must_change_password', 'false')) in ('true', '1', 'yes', 'y', 'on');

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
    must_change_password,
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
    v_must_change_password,
    now(),
    now()
  );

  return new;
end;
$function$;

create or replace function private.enforce_profile_update_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
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
       or new.status is distinct from old.status
       or new.must_change_password is distinct from old.must_change_password then
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

    if new.must_change_password is distinct from old.must_change_password then
      if not (old.must_change_password = true and new.must_change_password = false) then
        raise exception 'Privileged profile fields cannot be changed through this operation.';
      end if;
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
       or new.email is distinct from old.email
       or new.must_change_password is distinct from old.must_change_password then
      raise exception 'Privileged profile fields cannot be changed through this operation.';
    end if;

    return new;
  end if;

  raise exception 'You are not allowed to update this profile.';
end;
$function$;

create or replace function public.clear_profile_password_requirement()
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
begin
  if v_user_id is null then
    raise exception 'Please sign in to continue.';
  end if;

  update public.profiles as p
  set must_change_password = false
  where p.id = v_user_id
  returning * into v_profile;

  if not found then
    raise exception 'Your profile could not be found.';
  end if;

  return v_profile;
end;
$function$;

revoke all on function public.clear_profile_password_requirement() from public;
revoke all on function public.clear_profile_password_requirement() from anon;
revoke all on function public.clear_profile_password_requirement() from authenticated;
grant execute on function public.clear_profile_password_requirement() to authenticated;

commit;
