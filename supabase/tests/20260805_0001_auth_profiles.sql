-- Trusted test context note:
-- Run these tests in a trusted SQL session that can impersonate authenticated/admin JWT claims.
-- The signup-trigger rollback test below executes directly against auth.users in a trusted SQL session.
-- If your local auth schema requires additional fixture columns, run the same block through a trusted
-- Supabase Admin API fixture instead of weakening the assertions here.

-- Replace these placeholders before running the tests:
-- <NEW_USER_ID>, <CUSTOMER_ID>, <OTHER_CUSTOMER_ID>, <ADMIN_ID>

-- 1. A normal Auth user creates one customer profile.
-- Assert that the profile exists and has customer defaults.

-- 2. Signup metadata cannot create an admin.
-- Assert that raw_user_meta_data containing role=admin still results in role='customer'.

do $$
declare
  v_profile_count integer;
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', '<CUSTOMER_ID>', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  select count(*)
    into v_profile_count
  from public.profiles
  where id = '<CUSTOMER_ID>';

  if v_profile_count <> 1 then
    raise exception 'Expected exactly one visible customer profile for the authenticated user.';
  end if;
end;
$$;

-- 3. A user can update full_name and phone_number.
do $$
declare
  v_rows_updated integer;
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', '<CUSTOMER_ID>', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  update public.profiles
  set full_name = 'Updated Name',
      phone_number = '0240000000'
  where id = '<CUSTOMER_ID>';

  get diagnostics v_rows_updated = row_count;

  if v_rows_updated <> 1 then
    raise exception 'Expected full_name and phone_number update to succeed.';
  end if;
end;
$$;

-- 4. A user cannot update role, status, account_type, email, or id.
do $$
declare
  v_blocked boolean := false;
  v_sqlstate text;
  v_message text;
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', '<CUSTOMER_ID>', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  begin
    update public.profiles
    set role = 'admin'
    where id = '<CUSTOMER_ID>';

    raise exception 'Expected role update to be blocked.';
  exception
    when SQLSTATE 'P0001' then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      if v_message like '%Privileged profile fields cannot be changed through this operation.%' then
        v_blocked := true;
      else
        raise exception 'Unexpected rejection for blocked role update: [%] %', v_sqlstate, v_message;
      end if;
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      raise exception 'Unexpected SQL error for blocked role update: [%] %', v_sqlstate, v_message;
  end;

  if not v_blocked then
    raise exception 'Expected role update to be blocked.';
  end if;
end;
$$;

do $$
declare
  v_blocked boolean := false;
  v_sqlstate text;
  v_message text;
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', '<CUSTOMER_ID>', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  begin
    update public.profiles
    set status = 'disabled'
    where id = '<CUSTOMER_ID>';

    raise exception 'Expected status update to be blocked.';
  exception
    when SQLSTATE 'P0001' then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      if v_message like '%Privileged profile fields cannot be changed through this operation.%' then
        v_blocked := true;
      else
        raise exception 'Unexpected rejection for blocked status update: [%] %', v_sqlstate, v_message;
      end if;
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      raise exception 'Unexpected SQL error for blocked status update: [%] %', v_sqlstate, v_message;
  end;

  if not v_blocked then
    raise exception 'Expected status update to be blocked.';
  end if;
end;
$$;

do $$
declare
  v_blocked boolean := false;
  v_sqlstate text;
  v_message text;
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', '<CUSTOMER_ID>', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  begin
    update public.profiles
    set account_type = 'guest'
    where id = '<CUSTOMER_ID>';

    raise exception 'Expected account_type update to be blocked.';
  exception
    when SQLSTATE 'P0001' then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      if v_message like '%Privileged profile fields cannot be changed through this operation.%' then
        v_blocked := true;
      else
        raise exception 'Unexpected rejection for blocked account_type update: [%] %', v_sqlstate, v_message;
      end if;
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      raise exception 'Unexpected SQL error for blocked account_type update: [%] %', v_sqlstate, v_message;
  end;

  if not v_blocked then
    raise exception 'Expected account_type update to be blocked.';
  end if;
end;
$$;

do $$
declare
  v_blocked boolean := false;
  v_sqlstate text;
  v_message text;
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', '<CUSTOMER_ID>', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  begin
    update public.profiles
    set email = 'tampered@example.com'
    where id = '<CUSTOMER_ID>';

    raise exception 'Expected email update to be blocked.';
  exception
    when SQLSTATE 'P0001' then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      if v_message like '%Privileged profile fields cannot be changed through this operation.%' then
        v_blocked := true;
      else
        raise exception 'Unexpected rejection for blocked email update: [%] %', v_sqlstate, v_message;
      end if;
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      raise exception 'Unexpected SQL error for blocked email update: [%] %', v_sqlstate, v_message;
  end;

  if not v_blocked then
    raise exception 'Expected email update to be blocked.';
  end if;
end;
$$;

do $$
declare
  v_blocked boolean := false;
  v_sqlstate text;
  v_message text;
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', '<CUSTOMER_ID>', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  begin
    update public.profiles
    set id = '<OTHER_CUSTOMER_ID>'
    where id = '<CUSTOMER_ID>';

    raise exception 'Expected id update to be blocked.';
  exception
    when SQLSTATE 'P0001' then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      if v_message like '%Privileged profile fields cannot be changed through this operation.%' then
        v_blocked := true;
      else
        raise exception 'Unexpected rejection for blocked id update: [%] %', v_sqlstate, v_message;
      end if;
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      raise exception 'Unexpected SQL error for blocked id update: [%] %', v_sqlstate, v_message;
  end;

  if not v_blocked then
    raise exception 'Expected id update to be blocked.';
  end if;
end;
$$;

-- 5. An admin can update a customer status.
do $$
declare
  v_rows_updated integer;
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', '<ADMIN_ID>', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  update public.profiles
  set status = 'suspended'
  where id = '<CUSTOMER_ID>';

  get diagnostics v_rows_updated = row_count;

  if v_rows_updated <> 1 then
    raise exception 'Expected admin status update to succeed.';
  end if;
end;
$$;

-- 6. An admin cannot promote a customer through normal profile updates.
do $$
declare
  v_blocked boolean := false;
  v_sqlstate text;
  v_message text;
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', '<ADMIN_ID>', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  begin
    update public.profiles
    set role = 'admin'
    where id = '<CUSTOMER_ID>';

    raise exception 'Expected admin promotion to be blocked.';
  exception
    when SQLSTATE 'P0001' then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      if v_message like '%Privileged profile fields cannot be changed through this operation.%' then
        v_blocked := true;
      else
        raise exception 'Unexpected rejection for blocked admin promotion: [%] %', v_sqlstate, v_message;
      end if;
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      raise exception 'Unexpected SQL error for blocked admin promotion: [%] %', v_sqlstate, v_message;
  end;

  if not v_blocked then
    raise exception 'Expected admin promotion to be blocked.';
  end if;
end;
$$;

-- 7. A customer cannot read another profile.
do $$
declare
  v_visible_count integer;
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', '<CUSTOMER_ID>', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  select count(*)
    into v_visible_count
  from public.profiles
  where id = '<OTHER_CUSTOMER_ID>';

  if v_visible_count <> 0 then
    raise exception 'Expected another customer profile to remain hidden.';
  end if;
end;
$$;

-- 8. An admin can read customer profiles.
do $$
declare
  v_visible_count integer;
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', '<ADMIN_ID>', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  select count(*)
    into v_visible_count
  from public.profiles
  where id = '<CUSTOMER_ID>';

  if v_visible_count <> 1 then
    raise exception 'Expected the admin to read the customer profile.';
  end if;
end;
$$;

-- 9. Changing auth.users.email synchronizes profiles.email.
-- Trusted context: update auth.users.email for <CUSTOMER_ID> and assert the mirrored profile email changes.

-- 10. The first-admin bootstrap works.
-- Run supabase/bootstrap/first_admin.sql in a trusted SQL session and assert the target row becomes admin.

-- 11. A failed profile trigger does not leave a partial Auth setup.
do $$
declare
  v_test_email text := format('rollback-%s@example.com', replace(txid_current()::text, '-', ''));
  v_sqlstate text;
  v_message text;
  v_blocked boolean := false;
  v_inserted_user_id uuid;
begin
  begin
    insert into auth.users (
      email,
      encrypted_password,
      email_confirmed_at,
      raw_user_meta_data,
      raw_app_meta_data,
      aud,
      role
    ) values (
      v_test_email,
      'trusted-fixture-password-hash',
      now(),
      jsonb_build_object('date_of_birth', 'not-a-valid-date'),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      'authenticated',
      'authenticated'
    )
    returning id into v_inserted_user_id;
  exception
    when sqlstate '22P02' then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      if v_message like '%date_of_birth%' or v_message like '%invalid input syntax for type date%' then
        v_blocked := true;
      else
        raise exception 'Unexpected date parsing error during signup rollback test: [%] %', v_sqlstate, v_message;
      end if;
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      if v_sqlstate = 'P0001'
         and v_message like '%date_of_birth%'
         and v_message like '%invalid%' then
        v_blocked := true;
      else
        raise exception 'Unexpected signup-trigger failure: [%] %', v_sqlstate, v_message;
      end if;
  end;

  if not v_blocked then
    delete from public.profiles
    where email = v_test_email;

    delete from auth.users
    where email = v_test_email
       or id = v_inserted_user_id;

    raise exception 'Expected signup with invalid date_of_birth metadata to fail.';
  end if;

  if exists (
    select 1
    from auth.users
    where email = v_test_email
  ) then
    raise exception 'Expected no matching auth.users row to remain after signup failure.';
  end if;

  if exists (
    select 1
    from public.profiles
    where email = v_test_email
  ) then
    raise exception 'Expected no matching public.profiles row to remain after signup failure.';
  end if;
end;
$$;
