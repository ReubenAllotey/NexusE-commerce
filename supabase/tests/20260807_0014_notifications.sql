-- Notifications verification for the deployed Supabase schema.

begin;

do $$
declare
  v_admin_id uuid;
  v_customer_a_id uuid := '41111111-1111-4111-8111-111111111111';
  v_customer_b_id uuid := '42222222-2222-4222-8222-222222222222';
  v_customer_a_email text := 'notifications-a-41111111111141118111111111111111@example.com';
  v_customer_b_email text := 'notifications-b-42222222222242228222222222222222@example.com';
  v_order_a_id uuid;
  v_order_b_id uuid;
  v_payment_id uuid;
  v_shipment_id uuid;
  v_rpc_notification_a public.notifications%rowtype;
  v_rpc_notification_b public.notifications%rowtype;
  v_source_key_a text := 'NOTIFTEST-RPC-A-001';
  v_source_key_b text := 'NOTIFTEST-RPC-B-001';
  v_order_source_key text;
  v_payment_source_key text;
  v_shipment_source_key text;
  v_sqlstate text;
  v_message text;
  v_count integer;
  v_read_at timestamptz;
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
    raise exception 'Expected an active admin profile to exist for notification tests.';
  end if;

  delete from public.notifications
  where source_key like 'NOTIFTEST-%';

  delete from public.shipment_events
  where shipment_id in (
    select id
    from public.shipments
    where batch_number like 'NOTIFTEST-%'
  );

  delete from public.shipments
  where batch_number like 'NOTIFTEST-%';

  delete from public.payment_events
  where provider_reference like 'NOTIFTEST-%';

  delete from public.payments
  where provider_reference like 'NOTIFTEST-%';

  delete from public.order_items
  where order_id in (
    select id
    from public.orders
    where order_number like 'NOTIFTEST-%'
  );

  delete from public.orders
  where order_number like 'NOTIFTEST-%';

  delete from auth.users
  where id in (v_customer_a_id, v_customer_b_id)
     or email in (v_customer_a_email, v_customer_b_email);

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
      v_customer_a_id,
      v_customer_a_email,
      'trusted-fixture-password-hash',
      now(),
      jsonb_build_object('full_name', 'Notifications Customer A'),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      'authenticated',
      'authenticated'
    ),
    (
      v_customer_b_id,
      v_customer_b_email,
      'trusted-fixture-password-hash',
      now(),
      jsonb_build_object('full_name', 'Notifications Customer B'),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      'authenticated',
      'authenticated'
    );

  execute 'reset role';

  insert into public.orders (
    order_number,
    user_id,
    customer_name,
    customer_email,
    status,
    payment_status,
    shipment_type,
    batch_number,
    shipping_address_snapshot,
    subtotal,
    shipping_total,
    total,
    created_at,
    updated_at
  ) values (
    'NOTIFTEST-ORD-A',
    v_customer_a_id,
    'Notifications Customer A',
    v_customer_a_email,
    'pending_payment',
    'pending',
    'air',
    'NOTIFTEST-BATCH-A',
    jsonb_build_object(
      'id', '00000000-0000-4000-8000-000000000001',
      'addressLabel', 'Notification Test Home A',
      'fullName', 'Notifications Customer A',
      'phoneNumber', '+233540000011',
      'emailAddress', v_customer_a_email,
      'country', 'Ghana',
      'region', 'Greater Accra',
      'city', 'Accra',
      'streetAddress', 'Notification Test Street A',
      'houseNumber', '1',
      'landmark', 'Near the market',
      'postalCode', 'GA-100-001',
      'isDefault', true
    ),
    100,
    10,
    110,
    v_old_timestamp,
    v_old_timestamp
  )
  returning id into v_order_a_id;

  insert into public.orders (
    order_number,
    user_id,
    customer_name,
    customer_email,
    status,
    payment_status,
    shipment_type,
    batch_number,
    shipping_address_snapshot,
    subtotal,
    shipping_total,
    total,
    created_at,
    updated_at
  ) values (
    'NOTIFTEST-ORD-B',
    v_customer_b_id,
    'Notifications Customer B',
    v_customer_b_email,
    'pending_payment',
    'pending',
    'air',
    'NOTIFTEST-BATCH-B',
    jsonb_build_object(
      'id', '00000000-0000-4000-8000-000000000002',
      'addressLabel', 'Notification Test Home B',
      'fullName', 'Notifications Customer B',
      'phoneNumber', '+233540000022',
      'emailAddress', v_customer_b_email,
      'country', 'Ghana',
      'region', 'Central',
      'city', 'Cape Coast',
      'streetAddress', 'Notification Test Street B',
      'houseNumber', '2',
      'landmark', 'Near the school',
      'postalCode', 'CC-200-002',
      'isDefault', true
    ),
    120,
    15,
    135,
    v_old_timestamp,
    v_old_timestamp
  )
  returning id into v_order_b_id;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_customer_a_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.email', v_customer_a_email, true);

  begin
    insert into public.notifications (
      user_id,
      category,
      title,
      message,
      source_type,
      source_key
    ) values (
      v_customer_a_id,
      'announcement',
      'Blocked insert',
      'This insert should fail.',
      'announcement',
      'NOTIFTEST-BLOCKED-INSERT'
    );
    raise exception 'Expected customer notification insert to be blocked.';
  exception
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      if v_sqlstate not in ('42501', '23514') and position('row-level security' in lower(v_message)) = 0 then
        raise;
      end if;
  end;

  begin
    delete from public.notifications
    where source_key = 'NOTIFTEST-BLOCKED-INSERT';
    raise exception 'Expected customer notification delete to be blocked.';
  exception
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      if v_sqlstate not in ('42501', '23514') and position('row-level security' in lower(v_message)) = 0 then
        raise;
      end if;
  end;

  execute 'reset role';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.email', 'admin@nexus.com', true);

  v_rpc_notification_a := public.create_user_notification(
    jsonb_build_object(
      'userId', v_customer_a_id,
      'category', 'announcement',
      'title', 'Admin notice A',
      'message', 'Read this admin-created notification.',
      'sourceType', 'announcement',
      'sourceKey', v_source_key_a,
      'actionUrl', '/profile/notifications',
      'actionLabel', 'Open notifications',
      'actionDescription', 'Open your notification inbox.'
    )
  );

  if v_rpc_notification_a.id is null then
    raise exception 'Expected the admin notification RPC to create a notification for customer A.';
  end if;

  select count(*) into v_count
  from public.notifications
  where user_id = v_customer_a_id
    and source_key = v_source_key_a;

  if v_count <> 1 then
    raise exception 'Expected exactly one admin RPC notification for customer A.';
  end if;

  v_rpc_notification_b := public.create_user_notification(
    jsonb_build_object(
      'userId', v_customer_b_id,
      'category', 'announcement',
      'title', 'Admin notice B',
      'message', 'Read this admin-created notification.',
      'sourceType', 'announcement',
      'sourceKey', v_source_key_b
    )
  );

  v_rpc_notification_b := public.create_user_notification(
    jsonb_build_object(
      'userId', v_customer_b_id,
      'category', 'announcement',
      'title', 'Admin notice B',
      'message', 'Read this admin-created notification.',
      'sourceType', 'announcement',
      'sourceKey', v_source_key_b
    )
  );

  select count(*) into v_count
  from public.notifications
  where user_id = v_customer_b_id
    and source_key = v_source_key_b;

  if v_count <> 1 then
    raise exception 'Expected duplicate admin RPC notification calls to remain a single row.';
  end if;

  execute 'reset role';

  insert into public.payments (
    order_id,
    user_id,
    provider,
    payment_method,
    payment_network,
    payment_phone_number,
    provider_reference,
    status,
    amount,
    currency,
    amount_minor,
    created_at,
    updated_at
  ) values (
    v_order_a_id,
    v_customer_a_id,
    'paystack',
    'mobile_money',
    'mtn',
    '+233540000011',
    'NOTIFTEST-PAY-A-001',
    'pending',
    110,
    'GHS',
    11000,
    v_old_timestamp,
    v_old_timestamp
  )
  returning id into v_payment_id;

  update public.orders
  set status = 'processing'
  where id = v_order_a_id;

  update public.payments
  set status = 'successful'
  where id = v_payment_id;

  insert into public.shipments (
    order_id,
    batch_number,
    shipping_method,
    current_status,
    current_step,
    headline,
    body,
    created_at,
    updated_at
  ) values (
    v_order_a_id,
    'NOTIFTEST-BATCH-A',
    'air',
    'preparing',
    0,
    'Preparing shipment',
    'Shipment prep started.',
    v_old_timestamp,
    v_old_timestamp
  )
  returning id into v_shipment_id;

  insert into public.shipment_events (
    shipment_id,
    status,
    step_index,
    title,
    message,
    location,
    event_at,
    created_at
  ) values (
    v_shipment_id,
    'shipped_from_china',
    1,
    'Items departed',
    'Shipment left the origin port.',
    'China',
    now(),
    now()
  );

  insert into public.shipment_events (
    shipment_id,
    status,
    step_index,
    title,
    message,
    location,
    event_at,
    created_at
  ) values (
    v_shipment_id,
    'shipped_from_china',
    1,
    'Items departed',
    'Shipment left the origin port.',
    'China',
    now(),
    now()
  );

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_customer_a_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.email', v_customer_a_email, true);

  select count(*) into v_count
  from public.notifications
  where user_id = v_customer_a_id;

  if v_count <> 4 then
    raise exception 'Expected customer A to see exactly four notifications.';
  end if;

  select count(*) into v_count
  from public.notifications
  where user_id = v_customer_b_id;

  if v_count <> 0 then
    raise exception 'Expected customer A to be unable to see customer B notifications.';
  end if;

  begin
    update public.notifications
    set is_read = true
    where user_id = v_customer_b_id;
    if found then
      raise exception 'Expected customer A to be blocked from updating customer B notifications.';
    end if;
  exception
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      if v_sqlstate not in ('42501', '23514') and position('row-level security' in lower(v_message)) = 0 then
        raise;
      end if;
  end;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_customer_a_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.email', v_customer_a_email, true);

  update public.notifications
  set is_read = true
  where user_id = v_customer_a_id
    and source_key = v_source_key_a
  returning read_at into v_read_at;

  if v_read_at is null then
    raise exception 'Expected read_at to be set when a notification is marked read.';
  end if;

  update public.notifications
  set is_read = false
  where user_id = v_customer_a_id
    and source_key = v_source_key_a
  returning read_at into v_read_at;

  if v_read_at is not null then
    raise exception 'Expected read_at to clear when a notification is marked unread.';
  end if;

  select count(*) into v_count
  from public.notifications
  where source_key = 'shipment:' || v_shipment_id::text || ':step:1:status:shipped_from_china';

  if v_count <> 1 then
    raise exception 'Expected shipment event retries to remain a single notification row.';
  end if;

  v_order_source_key := 'order:' || v_order_a_id::text || ':status:processing';
  v_payment_source_key := 'payment:' || v_payment_id::text || ':status:successful';
  v_shipment_source_key := 'shipment:' || v_shipment_id::text || ':step:1:status:shipped_from_china';

  select count(*) into v_count
  from public.notifications n
  join public.orders o on o.id = n.order_id
  where n.source_key = v_order_source_key
    and o.id = v_order_a_id;

  if v_count <> 1 then
    raise exception 'Expected order source references to resolve correctly.';
  end if;

  select count(*) into v_count
  from public.notifications n
  join public.payments p on p.id = n.payment_id
  where n.source_key = v_payment_source_key
    and p.id = v_payment_id;

  if v_count <> 1 then
    raise exception 'Expected payment source references to resolve correctly.';
  end if;

  select count(*) into v_count
  from public.notifications n
  join public.shipments s on s.id = n.shipment_id
  where n.source_key = v_shipment_source_key
    and s.id = v_shipment_id;

  if v_count <> 1 then
    raise exception 'Expected shipment source references to resolve correctly.';
  end if;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.email', 'admin@nexus.com', true);

  begin
    delete from public.notifications
    where source_key = v_source_key_a;
    raise exception 'Expected admin delete to be blocked through ordinary table access.';
  exception
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      if v_sqlstate not in ('42501', '23514') and position('row-level security' in lower(v_message)) = 0 then
        raise;
      end if;
  end;

  execute 'reset role';

  delete from public.notifications
  where source_key in (
    v_source_key_a,
    v_source_key_b,
    v_order_source_key,
    v_payment_source_key,
    v_shipment_source_key
  );

  delete from public.shipment_events where shipment_id = v_shipment_id;
  delete from public.shipments where id = v_shipment_id;
  delete from public.payment_events where payment_id = v_payment_id;
  delete from public.payments where id = v_payment_id;
  delete from public.order_items where order_id in (v_order_a_id, v_order_b_id);
  delete from public.orders where id in (v_order_a_id, v_order_b_id);
  delete from auth.users where id in (v_customer_a_id, v_customer_b_id);
end;
$$;

commit;
