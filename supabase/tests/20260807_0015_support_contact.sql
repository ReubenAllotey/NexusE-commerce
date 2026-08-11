-- Support and contact message verification for the deployed Supabase schema.

begin;

do $$
declare
  v_admin_id uuid;
  v_support_customer_a_id uuid := '51111111-1111-4111-8111-111111111111';
  v_support_customer_b_id uuid := '52222222-2222-4222-8222-222222222222';
  v_contact_customer_id uuid := '53333333-3333-4333-8333-333333333333';
  v_support_customer_a_email text := 'support-a-51111111111141118111111111111111@example.com';
  v_support_customer_b_email text := 'support-b-52222222222242228222222222222222@example.com';
  v_contact_customer_email text := 'contact-53333333333343338333333333333333@example.com';
  v_support_message public.support_messages%rowtype;
  v_contact_message public.contact_messages%rowtype;
  v_support_message_id uuid;
  v_contact_message_id uuid;
  v_sqlstate text;
  v_message text;
  v_count integer;
  v_old_timestamp timestamptz := timestamptz '2000-01-01 00:00:00+00';
begin
  select id
    into v_admin_id
  from public.profiles
  where role = 'admin'
    and status = 'active'
  order by created_at asc
  limit 1;

  if v_admin_id is null then
    raise exception 'Expected an active admin profile for support/contact tests.';
  end if;

  delete from public.support_messages
  where subject like 'SUPPORTTEST-%'
     or user_id in (v_support_customer_a_id, v_support_customer_b_id);

  delete from public.contact_messages
  where subject like 'CONTACTTEST-%'
     or email like 'contact-%@example.com'
     or user_id = v_contact_customer_id;

  delete from auth.users
  where id in (v_support_customer_a_id, v_support_customer_b_id, v_contact_customer_id)
     or email in (v_support_customer_a_email, v_support_customer_b_email, v_contact_customer_email);

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
    v_contact_customer_id,
    v_contact_customer_email,
    'trusted-fixture-password-hash',
    now(),
    jsonb_build_object('full_name', 'Contact Customer'),
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
  ) values
    (
      v_support_customer_a_id,
      v_support_customer_a_email,
      'trusted-fixture-password-hash',
      now(),
      jsonb_build_object('full_name', 'Support Customer A'),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      'authenticated',
      'authenticated'
    ),
    (
      v_support_customer_b_id,
      v_support_customer_b_email,
      'trusted-fixture-password-hash',
      now(),
      jsonb_build_object('full_name', 'Support Customer B'),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      'authenticated',
      'authenticated'
    ),
    (
      v_contact_customer_id,
      v_contact_customer_email,
      'trusted-fixture-password-hash',
      now(),
      jsonb_build_object('full_name', 'Contact Customer'),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      'authenticated',
      'authenticated'
    );

  execute 'reset role';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_support_customer_a_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.email', v_support_customer_a_email, true);

  v_support_message := public.create_support_message(
    jsonb_build_object(
      'title', 'SUPPORTTEST-Title-A',
      'message', 'SUPPORTTEST message A',
      'category', 'shipping',
      'priority', 'high'
    )
  );

  if v_support_message.user_id is distinct from v_support_customer_a_id then
    raise exception 'Expected support message to use auth.uid() as the owner.';
  end if;

  select count(*)
    into v_count
  from public.support_messages
  where user_id = v_support_customer_a_id;

  if v_count <> 1 then
    raise exception 'Expected customer A to read exactly one support message.';
  end if;

  perform set_config('request.jwt.claim.sub', v_support_customer_b_id::text, true);
  perform set_config('request.jwt.claim.email', v_support_customer_b_email, true);

  select count(*)
    into v_count
  from public.support_messages
  where user_id = v_support_customer_a_id;

  if v_count <> 0 then
    raise exception 'Expected customer B to be blocked from reading customer A support messages.';
  end if;

  begin
    update public.support_messages
       set admin_reply = 'Blocked reply'
     where id = v_support_message.id;
    raise exception 'Expected customer support reply update to be blocked.';
  exception
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      if v_sqlstate not in ('42501', '23514') and position('row-level security' in lower(v_message)) = 0 then
        raise;
      end if;
  end;

  begin
    delete from public.support_messages
     where id = v_support_message.id;
    raise exception 'Expected customer support delete to be blocked.';
  exception
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      if v_sqlstate not in ('42501', '23514') and position('row-level security' in lower(v_message)) = 0 then
        raise;
      end if;
  end;

  begin
    perform public.reply_to_support_message(v_support_message.id, 'Blocked admin reply', 'open');
    raise exception 'Expected customer support admin reply RPC to be blocked.';
  exception
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      if v_sqlstate not in ('42501', '42883', 'P0001')
         and position('permission denied' in lower(v_message)) = 0
         and position('only active administrators can reply to support messages' in lower(v_message)) = 0 then
        raise;
      end if;
  end;

  begin
    perform public.delete_support_message(v_support_message.id);
    raise exception 'Expected customer support admin delete RPC to be blocked.';
  exception
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      if v_sqlstate not in ('42501', '42883', 'P0001')
         and position('permission denied' in lower(v_message)) = 0
         and position('only active administrators can delete support messages' in lower(v_message)) = 0 then
        raise;
      end if;
  end;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.email', 'admin@nexus.com', true);

  v_support_message := public.reply_to_support_message(
    v_support_message.id,
    'SUPPORTTEST admin reply',
    'resolved'
  );

  if v_support_message.replied_by is distinct from v_admin_id then
    raise exception 'Expected support reply to record the admin id.';
  end if;

  if v_support_message.replied_at is null then
    raise exception 'Expected support reply to set replied_at.';
  end if;

  if v_support_message.status <> 'resolved' then
    raise exception 'Expected support reply to update the status.';
  end if;

  execute 'reset role';

  insert into public.support_messages (
    user_id,
    subject,
    message,
    status,
    created_at,
    updated_at
  ) values (
    v_support_customer_a_id,
    'SUPPORTTEST updated_at fixture',
    'SUPPORTTEST update body',
    'new',
    v_old_timestamp,
    v_old_timestamp
  )
  returning id into v_support_message_id;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.email', 'admin@nexus.com', true);

  v_support_message := public.set_support_message_status(v_support_message_id, 'open');

  if v_support_message.updated_at <= v_old_timestamp then
    raise exception 'Expected support message updated_at to advance after update.';
  end if;

  execute 'reset role';

  delete from public.support_messages where id = v_support_message_id;

  execute 'reset role';

  execute 'set local role anon';

  v_contact_message := public.create_contact_message(
    jsonb_build_object(
      'fullName', 'Anonymous Contact',
      'email', 'anon-support-contact@example.com',
      'phoneNumber', '+233500000000',
      'subject', 'CONTACTTEST-Anon',
      'message', 'Anonymous contact test message.'
    )
  );

  if v_contact_message.user_id is not null then
    raise exception 'Expected anonymous contact submission to leave user_id null.';
  end if;

  begin
    select count(*)
      into v_count
    from public.contact_messages
    where subject = 'CONTACTTEST-Anon';
    raise exception 'Expected anonymous contact inbox read to be blocked.';
  exception
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      if v_sqlstate not in ('42501', '23505') and position('permission denied' in lower(v_message)) = 0 then
        raise;
      end if;
  end;

  begin
    update public.contact_messages
       set admin_reply = 'Blocked contact reply'
     where subject = 'CONTACTTEST-Anon';
    raise exception 'Expected anonymous contact update to be blocked.';
  exception
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      if v_sqlstate not in ('42501', '23514') and position('row-level security' in lower(v_message)) = 0 then
        raise;
      end if;
  end;

  begin
    delete from public.contact_messages
     where subject = 'CONTACTTEST-Anon';
    raise exception 'Expected anonymous contact delete to be blocked.';
  exception
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      if v_sqlstate not in ('42501', '23514') and position('row-level security' in lower(v_message)) = 0 then
        raise;
      end if;
  end;

  execute 'reset role';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_contact_customer_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.email', v_contact_customer_email, true);

  v_contact_message := public.create_contact_message(
    jsonb_build_object(
      'fullName', 'Contact Customer',
      'email', v_contact_customer_email,
      'phoneNumber', '+233500000001',
      'subject', 'CONTACTTEST-Customer',
      'message', 'Authenticated contact message.'
    )
  );

  if v_contact_message.user_id is distinct from v_contact_customer_id then
    raise exception 'Expected authenticated contact submission to use auth.uid().';
  end if;

  select count(*)
    into v_count
  from public.contact_messages
  where subject = 'CONTACTTEST-Customer';

  if v_count <> 0 then
    raise exception 'Expected customer to be blocked from enumerating contact inbox rows.';
  end if;

  begin
    perform public.reply_to_contact_message(
      v_contact_message.id,
      'Blocked contact reply',
      'open'
    );
    raise exception 'Expected customer contact reply RPC to be blocked.';
  exception
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      if v_sqlstate not in ('42501', '42883', 'P0001')
         and position('permission denied' in lower(v_message)) = 0
         and position('only active administrators can reply to contact messages' in lower(v_message)) = 0 then
        raise;
      end if;
  end;

  begin
    perform public.delete_contact_message(v_contact_message.id);
    raise exception 'Expected customer contact delete RPC to be blocked.';
  exception
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      if v_sqlstate not in ('42501', '42883', 'P0001')
         and position('permission denied' in lower(v_message)) = 0
         and position('only active administrators can delete contact messages' in lower(v_message)) = 0 then
        raise;
      end if;
  end;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.email', 'admin@nexus.com', true);

  v_contact_message := public.reply_to_contact_message(
    v_contact_message.id,
    'CONTACTTEST admin reply',
    'resolved'
  );

  if v_contact_message.replied_by is distinct from v_admin_id then
    raise exception 'Expected contact reply to record the admin id.';
  end if;

  if v_contact_message.replied_at is null then
    raise exception 'Expected contact reply to set replied_at.';
  end if;

  if v_contact_message.status <> 'resolved' then
    raise exception 'Expected contact reply to update the status.';
  end if;

  execute 'reset role';

  select count(*)
    into v_count
  from public.contact_messages;

  if v_count = 0 then
    raise exception 'Expected admin to be able to read contact inbox rows.';
  end if;

  insert into public.contact_messages (
    user_id,
    full_name,
    email,
    phone_number,
    subject,
    message,
    status,
    created_at,
    updated_at
  ) values (
    v_contact_customer_id,
    'Contact Updated',
    v_contact_customer_email,
    '+233500000002',
    'CONTACTTEST updated_at fixture',
    'CONTACTTEST update body',
    'new',
    v_old_timestamp,
    v_old_timestamp
  )
  returning id into v_contact_message_id;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.email', 'admin@nexus.com', true);

  v_contact_message := public.set_contact_message_status(v_contact_message_id, 'open');

  if v_contact_message.updated_at <= v_old_timestamp then
    raise exception 'Expected contact message updated_at to advance after update.';
  end if;

  execute 'reset role';

  delete from public.contact_messages where id = v_contact_message_id;

  delete from public.support_messages
  where subject like 'SUPPORTTEST-%'
     or user_id in (v_support_customer_a_id, v_support_customer_b_id);

  delete from public.contact_messages
  where subject like 'CONTACTTEST-%'
     or email like 'contact-%@example.com'
     or user_id = v_contact_customer_id;

  delete from auth.users
  where id in (v_support_customer_a_id, v_support_customer_b_id, v_contact_customer_id)
     or email in (v_support_customer_a_email, v_support_customer_b_email, v_contact_customer_email);
end $$;

rollback;
