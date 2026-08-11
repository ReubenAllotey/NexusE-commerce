-- Payments + payment events verification for the deployed Supabase schema.

begin;

do $$
declare
  v_admin_id uuid;
  v_customer_a_id uuid := '11111111-1111-4111-8111-111111111111';
  v_customer_b_id uuid := '22222222-2222-4222-8222-222222222222';
  v_customer_a_email text := 'payments-a-11111111111141118111111111111111@example.com';
  v_customer_b_email text := 'payments-b-22222222222242228222222222222222@example.com';
  v_product_id uuid;
  v_product_slug text;
  v_product_name text;
  v_product_brand text;
  v_product_image text;
  v_product_price numeric;
  v_shipping_fee numeric;
  v_address_a_id uuid;
  v_address_b_id uuid;
  v_order_a_id uuid;
  v_order_b_id uuid;
  v_payment_a_id uuid;
  v_payment_b_id uuid;
  v_reference_a text := 'PAY-TEST-A-001';
  v_reference_b text := 'PAY-TEST-B-001';
  v_count integer;
  v_sqlstate text;
  v_message text;
  v_before_update timestamptz;
  v_after_update timestamptz;
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
    raise exception 'Expected an active admin profile to exist for payment tests.';
  end if;

  select id, slug, name, brand, primary_image_url, price, coalesce(shipping_fee, 0)
    into v_product_id, v_product_slug, v_product_name, v_product_brand, v_product_image, v_product_price, v_shipping_fee
  from public.products
  where status = 'active'
    and deleted_at is null
  order by created_at asc, name asc
  limit 1;

  if v_product_id is null then
    raise exception 'Expected at least one active storefront product for payment tests.';
  end if;

  delete from public.payment_events
  where provider_reference in (v_reference_a, v_reference_b);

  delete from public.payments
  where provider_reference in (v_reference_a, v_reference_b);

  delete from public.order_items
  where order_id in (
    select id
    from public.orders
    where user_id in (v_customer_a_id, v_customer_b_id)
      and order_number like 'PAYTEST-%'
  );

  delete from public.orders
  where user_id in (v_customer_a_id, v_customer_b_id)
    and order_number like 'PAYTEST-%';

  delete from public.addresses
  where user_id in (v_customer_a_id, v_customer_b_id)
    and address_label like 'Payment Test %';

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
      jsonb_build_object('full_name', 'Payments Customer A'),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      'authenticated',
      'authenticated'
    ),
    (
      v_customer_b_id,
      v_customer_b_email,
      'trusted-fixture-password-hash',
      now(),
      jsonb_build_object('full_name', 'Payments Customer B'),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      'authenticated',
      'authenticated'
    );

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_customer_a_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.email', v_customer_a_email, true);

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
    created_at,
    updated_at
  ) values (
      v_customer_a_id,
      'Payment Test Home',
      'Payments Customer A',
      '+233540000011',
      v_customer_a_email,
      'Ghana',
      'Greater Accra',
      'Accra',
      'Payment Test Street A',
      '1',
      'Near the market',
      'GA-100-001',
      true,
      v_old_timestamp,
      v_old_timestamp
    )
  returning id into v_address_a_id;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_customer_b_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.email', v_customer_b_email, true);

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
    created_at,
    updated_at
  ) values (
      v_customer_b_id,
      'Payment Test Home',
      'Payments Customer B',
      '+233540000022',
      v_customer_b_email,
      'Ghana',
      'Central',
      'Cape Coast',
      'Payment Test Street B',
      '2',
      'Near the school',
      'CC-200-002',
      true,
      v_old_timestamp,
      v_old_timestamp
    )
  returning id into v_address_b_id;

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
    shipping_address_id,
    shipping_address_snapshot,
    subtotal,
    shipping_total,
    total,
    created_at,
    updated_at
  ) values (
      'PAYTEST-ORD-A',
      v_customer_a_id,
      'Payments Customer A',
      v_customer_a_email,
      'pending_payment',
      'pending',
      'air',
      'PAYTEST-BATCH-A',
      v_address_a_id,
      jsonb_build_object(
        'id', v_address_a_id,
        'addressLabel', 'Payment Test Home',
        'fullName', 'Payments Customer A',
        'phoneNumber', '+233540000011',
        'emailAddress', v_customer_a_email,
        'country', 'Ghana',
        'region', 'Greater Accra',
        'city', 'Accra',
        'streetAddress', 'Payment Test Street A',
        'houseNumber', '1',
        'landmark', 'Near the market',
        'postalCode', 'GA-100-001',
        'isDefault', true
      ),
      v_product_price,
      v_shipping_fee,
      v_product_price + v_shipping_fee,
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
    shipping_address_id,
    shipping_address_snapshot,
    subtotal,
    shipping_total,
    total,
    created_at,
    updated_at
  ) values (
      'PAYTEST-ORD-B',
      v_customer_b_id,
      'Payments Customer B',
      v_customer_b_email,
      'pending_payment',
      'pending',
      'air',
      'PAYTEST-BATCH-B',
      v_address_b_id,
      jsonb_build_object(
        'id', v_address_b_id,
        'addressLabel', 'Payment Test Home',
        'fullName', 'Payments Customer B',
        'phoneNumber', '+233540000022',
        'emailAddress', v_customer_b_email,
        'country', 'Ghana',
        'region', 'Central',
        'city', 'Cape Coast',
        'streetAddress', 'Payment Test Street B',
        'houseNumber', '2',
        'landmark', 'Near the school',
        'postalCode', 'CC-200-002',
        'isDefault', true
      ),
      v_product_price,
      v_shipping_fee,
      v_product_price + v_shipping_fee,
      v_old_timestamp,
      v_old_timestamp
    )
  returning id into v_order_b_id;

  insert into public.order_items (
    order_id,
    product_id,
    product_name,
    product_slug,
    brand,
    image_url,
    unit_price,
    quantity,
    selected_color,
    selected_size,
    shipping_fee,
    line_subtotal,
    line_shipping,
    created_at
  ) values
    (
      v_order_a_id,
      v_product_id,
      v_product_name,
      v_product_slug,
      v_product_brand,
      v_product_image,
      v_product_price,
      1,
      'Black',
      'M',
      v_shipping_fee,
      v_product_price,
      v_shipping_fee,
      v_old_timestamp
    ),
    (
      v_order_b_id,
      v_product_id,
      v_product_name,
      v_product_slug,
      v_product_brand,
      v_product_image,
      v_product_price,
      1,
      'Black',
      'M',
      v_shipping_fee,
      v_product_price,
      v_shipping_fee,
      v_old_timestamp
    );

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
    authorization_url,
    access_code,
    created_at,
    updated_at
  ) values (
      v_order_a_id,
      v_customer_a_id,
      'paystack',
      'mobile-money',
      'mtn',
      '+233540000011',
      v_reference_a,
      'pending',
      v_product_price + v_shipping_fee,
      'GHS',
      round((v_product_price + v_shipping_fee) * 100)::bigint,
      'https://example.com/payment-a',
      'access-code-a',
      v_old_timestamp,
      v_old_timestamp
    )
  returning id into v_payment_a_id;

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
    authorization_url,
    access_code,
    created_at,
    updated_at
  ) values (
      v_order_b_id,
      v_customer_b_id,
      'paystack',
      'card',
      null,
      null,
      v_reference_b,
      'pending',
      v_product_price + v_shipping_fee,
      'GHS',
      round((v_product_price + v_shipping_fee) * 100)::bigint,
      'https://example.com/payment-b',
      'access-code-b',
      v_old_timestamp,
      v_old_timestamp
    )
  returning id into v_payment_b_id;

  if v_payment_a_id is null or v_payment_b_id is null then
    raise exception 'Expected the temporary payment fixtures to be created.';
  end if;

  -- Table privilege matrix.
  if has_table_privilege('anon', 'public.payments', 'SELECT') is distinct from true
     or has_table_privilege('anon', 'public.payments', 'INSERT') is distinct from false
     or has_table_privilege('anon', 'public.payments', 'UPDATE') is distinct from false
     or has_table_privilege('anon', 'public.payments', 'DELETE') is distinct from false
     or has_table_privilege('anon', 'public.payments', 'TRUNCATE') is distinct from false
     or has_table_privilege('anon', 'public.payments', 'REFERENCES') is distinct from false
     or has_table_privilege('anon', 'public.payments', 'TRIGGER') is distinct from false then
    raise exception 'Unexpected anon privilege matrix for public.payments.';
  end if;

  if has_table_privilege('authenticated', 'public.payments', 'SELECT') is distinct from true
     or has_table_privilege('authenticated', 'public.payments', 'INSERT') is distinct from false
     or has_table_privilege('authenticated', 'public.payments', 'UPDATE') is distinct from false
     or has_table_privilege('authenticated', 'public.payments', 'DELETE') is distinct from false
     or has_table_privilege('authenticated', 'public.payments', 'TRUNCATE') is distinct from false
     or has_table_privilege('authenticated', 'public.payments', 'REFERENCES') is distinct from false
     or has_table_privilege('authenticated', 'public.payments', 'TRIGGER') is distinct from false then
    raise exception 'Unexpected authenticated privilege matrix for public.payments.';
  end if;

  if has_table_privilege('anon', 'public.payment_events', 'SELECT') is distinct from false
     or has_table_privilege('anon', 'public.payment_events', 'INSERT') is distinct from false
     or has_table_privilege('anon', 'public.payment_events', 'UPDATE') is distinct from false
     or has_table_privilege('anon', 'public.payment_events', 'DELETE') is distinct from false then
    raise exception 'Unexpected anon privilege matrix for public.payment_events.';
  end if;

  if has_table_privilege('authenticated', 'public.payment_events', 'SELECT') is distinct from false
     or has_table_privilege('authenticated', 'public.payment_events', 'INSERT') is distinct from false
     or has_table_privilege('authenticated', 'public.payment_events', 'UPDATE') is distinct from false
     or has_table_privilege('authenticated', 'public.payment_events', 'DELETE') is distinct from false then
    raise exception 'Unexpected authenticated privilege matrix for public.payment_events.';
  end if;

  -- RLS visibility and write blocking.
  execute 'set local role anon';
  perform set_config('request.jwt.claim.role', 'anon', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.email', '', true);

  select count(*)
    into v_count
  from public.payments
  where id = v_payment_a_id;

  if v_count <> 0 then
    raise exception 'Expected anon to be unable to read payment rows.';
  end if;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_customer_a_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.email', v_customer_a_email, true);

  select count(*)
    into v_count
  from public.payments
  where id = v_payment_a_id;

  if v_count <> 1 then
    raise exception 'Expected customer A to read their own payment row.';
  end if;

  select count(*)
    into v_count
  from public.payments
  where id = v_payment_b_id;

  if v_count <> 0 then
    raise exception 'Expected customer A to be unable to read customer B payment rows.';
  end if;

  begin
    update public.payments
      set status = 'successful'
    where id = v_payment_a_id;

    raise exception 'Expected customer A to be blocked from updating payment rows.';
  exception
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      if v_message not ilike '%permission denied%'
         and v_message not ilike '%row-level security%'
         and v_sqlstate <> '42501' then
        raise exception 'Unexpected customer payment update error: [%] %', v_sqlstate, v_message;
      end if;
  end;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_customer_b_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.email', v_customer_b_email, true);

  select count(*)
    into v_count
  from public.payments
  where id = v_payment_a_id;

  if v_count <> 0 then
    raise exception 'Expected customer B to be unable to read customer A payment rows.';
  end if;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.email', 'admin@nexus.com', true);

  select count(*)
    into v_count
  from public.payments;

  if v_count <> 2 then
    raise exception 'Expected the active admin to read all payment rows.';
  end if;

  execute 'reset role';

  begin
    insert into public.payments (
      order_id,
      user_id,
      provider,
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
      v_reference_a,
      'pending',
      v_product_price + v_shipping_fee,
      'GHS',
      round((v_product_price + v_shipping_fee) * 100)::bigint,
      v_old_timestamp,
      v_old_timestamp
    );

    raise exception 'Expected duplicate provider references to be rejected.';
  exception
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      if v_sqlstate <> '23505' then
        raise exception 'Unexpected duplicate provider reference error: [%] %', v_sqlstate, v_message;
      end if;
  end;

  select updated_at
    into v_before_update
  from public.payments
  where id = v_payment_a_id;

  if v_before_update is null then
    raise exception 'Expected a payment updated_at value before the admin update test.';
  end if;

  update public.payments
    set status = 'processing'
  where id = v_payment_a_id;

  select updated_at
    into v_after_update
  from public.payments
  where id = v_payment_a_id;

  if v_after_update <= v_before_update then
    raise exception 'Expected payment updated_at to advance after the admin update.';
  end if;

  execute 'reset role';

  -- Cleanup.
  delete from public.payment_events
  where provider_reference in (v_reference_a, v_reference_b);

  delete from public.payments
  where id in (v_payment_a_id, v_payment_b_id)
     or provider_reference in (v_reference_a, v_reference_b);

  delete from public.order_items
  where order_id in (v_order_a_id, v_order_b_id);

  delete from public.orders
  where id in (v_order_a_id, v_order_b_id);

  delete from public.addresses
  where id in (v_address_a_id, v_address_b_id);

  delete from auth.users
  where id in (v_customer_a_id, v_customer_b_id)
     or email in (v_customer_a_email, v_customer_b_email);

  select count(*)
    into v_count
  from auth.users
  where id in (v_customer_a_id, v_customer_b_id)
     or email in (v_customer_a_email, v_customer_b_email);

  if v_count <> 0 then
    raise exception 'Expected payment test auth users to be fully cleaned up.';
  end if;

  select count(*)
    into v_count
  from public.orders
  where id in (v_order_a_id, v_order_b_id);

  if v_count <> 0 then
    raise exception 'Expected payment test orders to be fully cleaned up.';
  end if;

  select count(*)
    into v_count
  from public.order_items
  where order_id in (v_order_a_id, v_order_b_id);

  if v_count <> 0 then
    raise exception 'Expected payment test order items to be fully cleaned up.';
  end if;

  select count(*)
    into v_count
  from public.payments
  where id in (v_payment_a_id, v_payment_b_id)
     or provider_reference in (v_reference_a, v_reference_b);

  if v_count <> 0 then
    raise exception 'Expected payment rows to be fully cleaned up.';
  end if;

  select count(*)
    into v_count
  from public.addresses
  where id in (v_address_a_id, v_address_b_id);

  if v_count <> 0 then
    raise exception 'Expected payment test addresses to be fully cleaned up.';
  end if;
end;
$$;

commit;
