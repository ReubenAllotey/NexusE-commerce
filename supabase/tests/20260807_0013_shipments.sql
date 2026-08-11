-- Shipment tracking verification for the deployed Supabase schema.

begin;

do $$
declare
  v_admin_id uuid;
  v_customer_a_id uuid := '31111111-1111-4111-8111-111111111111';
  v_customer_b_id uuid := '32222222-2222-4222-8222-222222222222';
  v_customer_a_email text := 'shipments-a-31111111111141118111111111111111@example.com';
  v_customer_b_email text := 'shipments-b-32222222222242228222222222222222@example.com';
  v_batch_number text := 'SHIPTEST-BATCH-001';
  v_order_a_id uuid;
  v_order_b_id uuid;
  v_shipment_a_id uuid;
  v_shipment_b_id uuid;
  v_sqlstate text;
  v_message text;
  v_count integer;
  v_shipment_status text;
  v_shipment_step integer;
  v_shipment_shipped_at timestamptz;
  v_shipment_updated_at timestamptz;
  v_old_timestamp timestamptz := timestamptz '2000-01-01 00:00:00+00';
  v_result jsonb;
begin
  select id
    into v_admin_id
  from public.profiles
  where role = 'admin'
    and status = 'active'
  order by created_at asc
  limit 1;

  if v_admin_id is null then
    raise exception 'Expected an active admin profile to exist for shipment tests.';
  end if;

  delete from public.shipment_events
  where shipment_id in (
    select id
    from public.shipments
    where batch_number = v_batch_number
  );

  delete from public.shipments
  where batch_number = v_batch_number;

  delete from public.order_items
  where order_id in (
    select id
    from public.orders
    where order_number like 'SHIPTEST-%'
  );

  delete from public.orders
  where order_number like 'SHIPTEST-%';

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
  ) values (
    v_customer_a_id,
    v_customer_a_email,
    'trusted-fixture-password-hash',
    now(),
    jsonb_build_object('full_name', 'Shipments Customer A'),
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
    v_customer_b_id,
    v_customer_b_email,
    'trusted-fixture-password-hash',
    now(),
    jsonb_build_object('full_name', 'Shipments Customer B'),
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
      'SHIPTEST-ORD-A',
      v_customer_a_id,
      'Shipments Customer A',
      v_customer_a_email,
      'processing',
      'successful',
      'air',
      v_batch_number,
      jsonb_build_object(
        'id', '00000000-0000-4000-8000-000000000001',
        'addressLabel', 'Shipment Test Home A',
        'fullName', 'Shipments Customer A',
        'phoneNumber', '+233540000011',
        'emailAddress', v_customer_a_email,
        'country', 'Ghana',
        'region', 'Greater Accra',
        'city', 'Accra',
        'streetAddress', 'Shipment Test Street A',
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
      'SHIPTEST-ORD-B',
      v_customer_b_id,
      'Shipments Customer B',
      v_customer_b_email,
      'processing',
      'successful',
      'air',
      v_batch_number,
      jsonb_build_object(
        'id', '00000000-0000-4000-8000-000000000002',
        'addressLabel', 'Shipment Test Home B',
        'fullName', 'Shipments Customer B',
        'phoneNumber', '+233540000022',
        'emailAddress', v_customer_b_email,
        'country', 'Ghana',
        'region', 'Central',
        'city', 'Cape Coast',
        'streetAddress', 'Shipment Test Street B',
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

  -- Privilege checks.
  for v_count in
    select 1
  loop
    if has_table_privilege('anon', 'public.shipments', 'select') is distinct from false then
      raise exception 'Expected anon to have no select privilege on public.shipments.';
    end if;

    if has_table_privilege('anon', 'public.shipments', 'insert') is distinct from false then
      raise exception 'Expected anon to have no insert privilege on public.shipments.';
    end if;

    if has_table_privilege('anon', 'public.shipments', 'update') is distinct from false then
      raise exception 'Expected anon to have no update privilege on public.shipments.';
    end if;

    if has_table_privilege('anon', 'public.shipments', 'delete') is distinct from false then
      raise exception 'Expected anon to have no delete privilege on public.shipments.';
    end if;

    if has_table_privilege('authenticated', 'public.shipments', 'select') is distinct from true then
      raise exception 'Expected authenticated to be able to select from public.shipments.';
    end if;

    if has_table_privilege('authenticated', 'public.shipments', 'insert') is distinct from false then
      raise exception 'Expected authenticated to have no insert privilege on public.shipments.';
    end if;

    if has_table_privilege('authenticated', 'public.shipments', 'update') is distinct from false then
      raise exception 'Expected authenticated to have no update privilege on public.shipments.';
    end if;

    if has_table_privilege('authenticated', 'public.shipments', 'delete') is distinct from false then
      raise exception 'Expected authenticated to have no delete privilege on public.shipments.';
    end if;

    if has_table_privilege('anon', 'public.shipment_events', 'select') is distinct from false then
      raise exception 'Expected anon to have no select privilege on public.shipment_events.';
    end if;

    if has_table_privilege('authenticated', 'public.shipment_events', 'select') is distinct from true then
      raise exception 'Expected authenticated to be able to select from public.shipment_events.';
    end if;

    if has_table_privilege('authenticated', 'public.shipment_events', 'insert') is distinct from false then
      raise exception 'Expected authenticated to have no insert privilege on public.shipment_events.';
    end if;

    if has_table_privilege('authenticated', 'public.shipment_events', 'update') is distinct from false then
      raise exception 'Expected authenticated to have no update privilege on public.shipment_events.';
    end if;

    if has_table_privilege('authenticated', 'public.shipment_events', 'delete') is distinct from false then
      raise exception 'Expected authenticated to have no delete privilege on public.shipment_events.';
    end if;
  end loop;

  if has_function_privilege('authenticated', 'public.create_or_update_shipment(jsonb)', 'EXECUTE') is distinct from true then
    raise exception 'Expected authenticated to be able to execute public.create_or_update_shipment(jsonb).';
  end if;

  if has_function_privilege('authenticated', 'public.add_shipment_event(jsonb)', 'EXECUTE') is distinct from true then
    raise exception 'Expected authenticated to be able to execute public.add_shipment_event(jsonb).';
  end if;

  if has_function_privilege('anon', 'public.create_or_update_shipment(jsonb)', 'EXECUTE') is distinct from false then
    raise exception 'Expected anon to be unable to execute public.create_or_update_shipment(jsonb).';
  end if;

  if has_function_privilege('anon', 'public.add_shipment_event(jsonb)', 'EXECUTE') is distinct from false then
    raise exception 'Expected anon to be unable to execute public.add_shipment_event(jsonb).';
  end if;

  -- Customer A should only see their own shipment.
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_customer_a_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.email', v_customer_a_email, true);

  select count(*)
    into v_count
  from public.shipments
  where order_id = v_order_a_id;

  if v_count <> 1 then
    raise exception 'Expected customer A to see exactly one shipment row.';
  end if;

  select count(*)
    into v_count
  from public.shipments
  where order_id = v_order_b_id;

  if v_count <> 0 then
    raise exception 'Expected customer A to be blocked from seeing customer B shipment rows.';
  end if;

  select count(*)
    into v_count
  from public.shipment_events
  where shipment_id in (
    select id
    from public.shipments
    where order_id = v_order_b_id
  );

  if v_count <> 0 then
    raise exception 'Expected customer A to be blocked from reading customer B shipment events.';
  end if;

  begin
    update public.shipments
      set current_status = 'in_transit'
    where order_id = v_order_a_id;

    raise exception 'Expected customer shipment updates to be blocked.';
  exception
    when insufficient_privilege then
      null;
  end;

  -- Admin manages the batch and creates progress history.
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.email', (select email from auth.users where id = v_admin_id), true);

  v_result := public.create_or_update_shipment(
    jsonb_build_object(
      'batch_number', v_batch_number,
      'headline', 'Batch has been confirmed',
      'body', 'Orders are being prepared for shipment.',
      'shipping_method', 'air',
      'current_step', 0,
      'current_status', 'preparing'
    )
  );

  if not (v_result ? 'shipments') then
    raise exception 'Expected shipment creation to return saved shipment rows.';
  end if;

  select id
    into v_shipment_a_id
  from public.shipments
  where order_id = v_order_a_id;

  select id
    into v_shipment_b_id
  from public.shipments
  where order_id = v_order_b_id;

  if v_shipment_a_id is null or v_shipment_b_id is null then
    raise exception 'Expected both batch shipment rows to exist after creation.';
  end if;

  select count(*)
    into v_count
  from public.shipment_events
  where shipment_id = v_shipment_a_id;

  if v_count <> 1 then
    raise exception 'Expected one shipment event after initial shipment creation.';
  end if;

  v_result := public.create_or_update_shipment(
    jsonb_build_object(
      'batch_number', v_batch_number,
      'headline', 'Batch is in transit',
      'body', 'Items have departed the China port.',
      'shipping_method', 'air',
      'current_step', 2
    )
  );

  select current_status, current_step, shipped_at, updated_at
    into strict v_shipment_status, v_shipment_step, v_shipment_shipped_at, v_shipment_updated_at
  from public.shipments
  where order_id = v_order_a_id;

  if v_shipment_status <> 'in_transit' then
    raise exception 'Expected shipment step 2 to map to in_transit.';
  end if;

  if v_shipment_step <> 2 then
    raise exception 'Expected shipment step 2 to map to in_transit.';
  end if;

  select count(*)
    into v_count
  from public.shipment_events
  where shipment_id = v_shipment_a_id;

  if v_count <> 2 then
    raise exception 'Expected shipment history to preserve earlier events after a step update.';
  end if;

  begin
    perform public.create_or_update_shipment(
      jsonb_build_object(
        'batch_number', v_batch_number,
        'headline', 'Attempted backward update',
        'body', 'This should fail.',
        'shipping_method', 'air',
        'current_step', 1
      )
    );

    raise exception 'Expected backward shipment progress to be blocked.';
  exception
    when SQLSTATE 'P0001' then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      if v_message <> 'Backward shipment progress is not allowed.' then
        raise exception 'Unexpected backward progression rejection: [%] %', v_sqlstate, v_message;
      end if;
  end;

  v_result := public.add_shipment_event(
    jsonb_build_object(
      'shipment_id', v_shipment_a_id,
      'status', 'in_transit',
      'step_index', 2,
      'title', 'Midway update',
      'message', 'The shipment remains in transit.',
      'location', 'On the road'
    )
  );

  select count(*)
    into v_count
  from public.shipment_events
  where shipment_id = v_shipment_a_id;

  if v_count <> 3 then
    raise exception 'Expected manual shipment events to append to history.';
  end if;

  select count(*)
    into v_count
  from public.shipments
  where order_id = v_order_a_id
    and current_status = 'in_transit'
    and current_step = 2;

  if v_count <> 1 then
    raise exception 'Expected shipment step progression to reach in_transit.';
  end if;

  v_result := public.create_or_update_shipment(
    jsonb_build_object(
      'batch_number', v_batch_number,
      'headline', 'Batch delivered',
      'body', 'Orders have been delivered.',
      'shipping_method', 'air',
      'current_step', 4,
      'current_status', 'delivered'
    )
  );

  select count(*)
    into v_count
  from public.shipments
  where order_id = v_order_a_id
    and current_status = 'delivered'
    and delivered_at is not null;

  if v_count <> 1 then
    raise exception 'Expected delivered shipments to populate delivered_at.';
  end if;

  select count(*)
    into v_count
  from public.orders
  where id = v_order_a_id
    and status = 'delivered'
    and delivered_at is not null;

  if v_count <> 1 then
    raise exception 'Expected delivered shipments to update the related order status.';
  end if;

  if v_shipment_shipped_at is null then
    raise exception 'Expected shipped_at to be populated after the shipment progressed.';
  end if;

  if v_shipment_updated_at is null then
    raise exception 'Expected updated_at to be returned after the shipment progressed.';
  end if;

  -- Customer B should still only see their own shipment row.
  perform set_config('request.jwt.claim.sub', v_customer_b_id::text, true);
  perform set_config('request.jwt.claim.email', v_customer_b_email, true);

  select count(*)
    into v_count
  from public.shipments
  where order_id = v_order_b_id;

  if v_count <> 1 then
    raise exception 'Expected customer B to see exactly one shipment row.';
  end if;

  select count(*)
    into v_count
  from public.shipments
  where order_id = v_order_a_id;

  if v_count <> 0 then
    raise exception 'Expected customer B to be blocked from seeing customer A shipment rows.';
  end if;

  -- Admin can read the whole batch.
  perform set_config('request.jwt.claim.sub', v_admin_id::text, true);
  perform set_config('request.jwt.claim.email', (select email from auth.users where id = v_admin_id), true);

  select count(*)
    into v_count
  from public.shipments
  where batch_number = v_batch_number;

  if v_count <> 2 then
    raise exception 'Expected admin to read all shipment rows in the batch.';
  end if;

  select count(*)
    into v_count
  from public.shipment_events
  where shipment_id = v_shipment_a_id;

  if v_count <> 4 then
    raise exception 'Expected admin-visible shipment history to keep all appended events.';
  end if;

  -- updated_at trigger test using an explicitly old baseline.
  execute 'reset role';
  update public.shipments
    set headline = 'Timestamp refresh test',
        updated_at = v_old_timestamp
  where order_id = v_order_a_id;

  select count(*)
    into v_count
  from public.shipments
  where order_id = v_order_a_id
    and updated_at > v_old_timestamp;

  if v_count <> 1 then
    raise exception 'Expected updated_at to advance when a shipment row is updated.';
  end if;

  -- Cleanup fixtures.
  delete from public.shipment_events
  where shipment_id in (
    select id
    from public.shipments
    where batch_number = v_batch_number
  );

  delete from public.shipments
  where batch_number = v_batch_number;

  delete from public.order_items
  where order_id in (v_order_a_id, v_order_b_id);

  delete from public.orders
  where id in (v_order_a_id, v_order_b_id);

  delete from auth.users
  where id in (v_customer_a_id, v_customer_b_id);

  select count(*)
    into v_count
  from public.shipments
  where batch_number = v_batch_number;

  if v_count <> 0 then
    raise exception 'Expected all temporary shipment rows to be cleaned up.';
  end if;

  select count(*)
    into v_count
  from public.shipment_events
  where shipment_id in (v_shipment_a_id, v_shipment_b_id);

  if v_count <> 0 then
    raise exception 'Expected all temporary shipment events to be cleaned up.';
  end if;

  select count(*)
    into v_count
  from public.orders
  where id in (v_order_a_id, v_order_b_id);

  if v_count <> 0 then
    raise exception 'Expected all temporary shipment orders to be cleaned up.';
  end if;
end;
$$;

commit;
