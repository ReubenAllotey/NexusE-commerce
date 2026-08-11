-- Trusted test harness for the addresses migration.
-- Run in a trusted SQL context that can insert and delete temporary auth.users fixtures.

begin;

do $$
declare
  v_admin_id uuid;
  v_user_a_id uuid := 'f1111111-1111-4111-8111-111111111111';
  v_user_b_id uuid := 'f2222222-2222-4222-8222-222222222222';
  v_user_a_email text := 'address-a-f11111111111411181111111111111111@example.com';
  v_user_b_email text := 'address-b-f22222222222422282222222222222222@example.com';
  v_address_one_id uuid;
  v_address_two_id uuid;
  v_count integer;
  v_blocked boolean;
  v_sqlstate text;
  v_message text;
begin
  select id
    into v_admin_id
  from public.profiles
  where lower(email) = lower('reubenallotey434@gmail.com')
    and role = 'admin'
    and status = 'active'
  limit 1;

  if v_admin_id is null then
    raise exception 'Expected the bootstrap admin profile to exist.';
  end if;

  insert into auth.users (
    id,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_user_meta_data,
    raw_app_meta_data,
    aud,
    role
  ) values (
    v_user_a_id,
    v_user_a_email,
    'trusted-fixture-password-hash',
    now(),
    jsonb_build_object('full_name', 'Address Customer A'),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    'authenticated',
    'authenticated'
  );

  insert into auth.users (
    id,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_user_meta_data,
    raw_app_meta_data,
    aud,
    role
  ) values (
    v_user_b_id,
    v_user_b_email,
    'trusted-fixture-password-hash',
    now(),
    jsonb_build_object('full_name', 'Address Customer B'),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    'authenticated',
    'authenticated'
  );

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_user_a_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.email', v_user_a_email, true);

  insert into public.addresses (
    user_id,
    address_label,
    full_name,
    phone_number,
    email_address,
    country,
    region,
    city,
    street_address,
    house_number,
    landmark,
    postal_code,
    is_default,
    updated_at
  ) values (
    v_user_a_id,
    'Home',
    'Address Customer A',
    '0240000001',
    v_user_a_email,
    'Ghana',
    'Greater Accra',
    'Accra',
    '123 Test Street',
    null,
    null,
    null,
    false,
    timestamptz '2000-01-01 00:00:00+00'
  )
  returning id into v_address_one_id;

  select count(*)
    into v_count
  from public.addresses
  where user_id = v_user_a_id
    and is_default;

  if v_count <> 1 then
    raise exception 'Expected the first address to become the default address.';
  end if;

  insert into public.addresses (
    user_id,
    address_label,
    full_name,
    phone_number,
    email_address,
    country,
    region,
    city,
    street_address,
    house_number,
    landmark,
    postal_code,
    is_default
  ) values (
    v_user_a_id,
    'Office',
    'Address Customer A',
    '0240000002',
    v_user_a_email,
    'Ghana',
    'Greater Accra',
    'Accra',
    '456 Test Avenue',
    null,
    null,
    null,
    false
  )
  returning id into v_address_two_id;

  select count(*)
    into v_count
  from public.addresses
  where user_id = v_user_a_id
    and is_default;

  if v_count <> 1 then
    raise exception 'Expected the second address to remain non-default while one default exists.';
  end if;

  if exists (
    select 1
    from public.addresses
    where id = v_address_two_id
      and is_default
  ) then
    raise exception 'Expected the second address to remain non-default.';
  end if;

  update public.addresses
  set is_default = true
  where id = v_address_two_id
    and user_id = v_user_a_id;

  get diagnostics v_count = row_count;

  if v_count <> 1 then
    raise exception 'Expected the default address switch to update exactly one row.';
  end if;

  if exists (
    select 1
    from public.addresses
    where id = v_address_one_id
      and is_default
  ) then
    raise exception 'Expected the previous default address to be cleared.';
  end if;

  if not exists (
    select 1
    from public.addresses
    where id = v_address_two_id
      and is_default
  ) then
    raise exception 'Expected the selected address to become the default.';
  end if;

  select count(*)
    into v_count
  from public.addresses
  where user_id = v_user_a_id
    and is_default;

  if v_count <> 1 then
    raise exception 'Expected exactly one default address after switching defaults.';
  end if;

  v_blocked := false;

  begin
    insert into public.addresses (
      user_id,
      address_label,
      full_name,
      phone_number,
      email_address,
      country,
      region,
      city,
      street_address,
      house_number,
      landmark,
      postal_code,
      is_default
    ) values (
      v_user_b_id,
      'Bad Address',
      'Address Customer A',
      '0240000003',
      v_user_a_email,
      'Ghana',
      'Greater Accra',
      'Accra',
      '789 Test Road',
      null,
      null,
      null,
      false
    );

    raise exception 'Expected the wrong user_id insert to be blocked.';
  exception
    when sqlstate 'P0001' then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;

      if v_message like '%You can only create addresses for your own account.%' then
        v_blocked := true;
      else
        raise exception 'Unexpected rejection for wrong user_id insert: [%] %', v_sqlstate, v_message;
      end if;
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      raise exception 'Unexpected SQL error for wrong user_id insert: [%] %', v_sqlstate, v_message;
  end;

  if not v_blocked then
    raise exception 'Expected the wrong user_id insert to be blocked.';
  end if;

  v_blocked := false;

  begin
    update public.addresses
    set user_id = v_user_b_id
    where id = v_address_one_id
      and user_id = v_user_a_id;

    raise exception 'Expected the ownership-changing update to be blocked.';
  exception
    when sqlstate 'P0001' then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;

      if v_message like '%user_id cannot be changed through this operation.%' then
        v_blocked := true;
      else
        raise exception 'Unexpected rejection for ownership change: [%] %', v_sqlstate, v_message;
      end if;
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      raise exception 'Unexpected SQL error for ownership change: [%] %', v_sqlstate, v_message;
  end;

  if not v_blocked then
    raise exception 'Expected the ownership-changing update to be blocked.';
  end if;

  execute 'reset role';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_user_a_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.email', v_user_a_email, true);

  select count(*)
    into v_count
  from public.addresses
  where user_id = v_user_b_id;

  if v_count <> 0 then
    raise exception 'Expected customer A to be unable to read customer B addresses.';
  end if;

  execute 'reset role';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.email', 'reubenallotey434@gmail.com', true);

  select count(*)
    into v_count
  from public.addresses
  where user_id = v_user_a_id;

  if v_count <> 2 then
    raise exception 'Expected the admin to read the customer addresses.';
  end if;

  update public.addresses
  set city = 'Blocked City'
  where id = v_address_one_id
    and user_id = v_user_a_id;

  get diagnostics v_count = row_count;

  if v_count <> 0 then
    raise exception 'Expected the admin frontend flow to be unable to update customer addresses.';
  end if;

  delete from public.addresses
  where id = v_address_one_id
    and user_id = v_user_a_id;

  get diagnostics v_count = row_count;

  if v_count <> 0 then
    raise exception 'Expected the admin frontend flow to be unable to delete customer addresses.';
  end if;

  execute 'reset role';
exception
  when others then
    execute 'reset role';
    delete from auth.users
    where id in (v_user_a_id, v_user_b_id);
    raise;
end;
$$;

commit;

begin;

do $$
declare
  v_user_a_id uuid := 'f1111111-1111-4111-8111-111111111111';
  v_user_b_id uuid := 'f2222222-2222-4222-8222-222222222222';
  v_user_a_email text := 'address-a-f11111111111411181111111111111111@example.com';
  v_before_updated_at timestamptz;
  v_after_updated_at timestamptz;
  v_count integer;
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_user_a_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.email', v_user_a_email, true);

  select updated_at
    into v_before_updated_at
  from public.addresses
  where id = '0c66901d-6d6c-4d7a-8790-ad3544c2a7fb';

  update public.addresses
  set city = 'Tema'
  where id = 'b7994c9d-c2b2-48de-bd8e-d9d13c6fbedc'
    and user_id = v_user_a_id;

  select updated_at
    into v_after_updated_at
  from public.addresses
  where id = 'b7994c9d-c2b2-48de-bd8e-d9d13c6fbedc';

  if v_after_updated_at <= v_before_updated_at then
    raise exception 'Expected updated_at to change after a successful update.';
  end if;

  delete from public.addresses
  where id = '0c66901d-6d6c-4d7a-8790-ad3544c2a7fb'
    and user_id = v_user_a_id;

  get diagnostics v_count = row_count;

  if v_count <> 1 then
    raise exception 'Expected deleting the default address to affect exactly one row.';
  end if;

  if not exists (
    select 1
    from public.addresses
    where id = 'b7994c9d-c2b2-48de-bd8e-d9d13c6fbedc'
      and is_default
  ) then
    raise exception 'Expected the remaining address to be promoted to default after deletion.';
  end if;

  delete from public.addresses
  where id = 'b7994c9d-c2b2-48de-bd8e-d9d13c6fbedc'
    and user_id = v_user_a_id;

  get diagnostics v_count = row_count;

  if v_count <> 1 then
    raise exception 'Expected deleting the last address to affect exactly one row.';
  end if;

  select count(*)
    into v_count
  from public.addresses
  where user_id = v_user_a_id
    and is_default;

  if v_count <> 0 then
    raise exception 'Expected zero defaults after deleting the last address.';
  end if;

  delete from auth.users
  where id in (v_user_a_id, v_user_b_id);
exception
  when others then
    execute 'reset role';
    delete from auth.users
    where id in (v_user_a_id, v_user_b_id);
    raise;
end;
$$;

commit;
