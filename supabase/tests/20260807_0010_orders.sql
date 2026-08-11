-- Orders + order items verification for the deployed Supabase schema.

begin;

do $$
declare
  v_admin_id uuid;
  v_customer_a_id uuid := 'e1111111-1111-4111-8111-111111111111';
  v_customer_b_id uuid := 'f2222222-2222-4222-8222-222222222222';
  v_customer_a_email text := 'orders-a-e11111111111411181111111111111111@example.com';
  v_customer_b_email text := 'orders-b-f22222222222422282222222222222222@example.com';
  v_product_category_id uuid;
  v_temp_product_id uuid;
  v_temp_product_slug text := 'orders-test-temp-product';
  v_temp_product_name text := 'Orders Test Temporary Product';
  v_temp_product_brand text := 'Orders Test Brand';
  v_temp_product_image text := 'https://example.com/orders-test-product.jpg';
  v_temp_product_price numeric := 125.50;
  v_temp_product_shipping_fee numeric := 12.75;
  v_temp_product_updated_name text := 'Orders Test Temporary Product Updated';
  v_temp_product_updated_image text := 'https://example.com/orders-test-product-updated.jpg';
  v_address_a_id uuid;
  v_address_b_id uuid;
  v_cart_a_id uuid;
  v_cart_b_id uuid;
  v_order_a jsonb;
  v_order_b jsonb;
  v_order_a_id uuid;
  v_order_a_number text;
  v_order_b_id uuid;
  v_order_b_number text;
  v_expected_subtotal numeric;
  v_expected_shipping numeric;
  v_expected_total numeric;
  v_count integer;
  v_quantity_failure_count integer;
  v_sqlstate text;
  v_message text;
  v_snapshot jsonb;
  v_order_updated_at timestamptz;
  v_old_timestamp timestamptz := timestamptz '2000-01-01 00:00:00+00';
begin
  create temporary table if not exists orders_test_state (
    admin_id uuid,
    customer_a_id uuid,
    customer_b_id uuid,
    customer_a_email text,
    customer_b_email text,
    order_a_id uuid,
    order_a_number text,
    order_b_id uuid,
    order_b_number text,
    cart_a_id uuid,
    cart_b_id uuid,
    address_a_id uuid,
    address_b_id uuid,
    product_id uuid,
    product_slug text,
    product_name text,
    product_brand text,
    product_image text,
    product_price numeric,
    product_shipping_fee numeric,
    old_timestamp timestamptz
  ) on commit preserve rows;

  grant select, insert on orders_test_state to authenticated;

  truncate table orders_test_state;

  select id
    into v_admin_id
  from public.profiles
  where role = 'admin'
    and status = 'active'
  order by created_at asc
  limit 1;

  if v_admin_id is null then
    raise exception 'Expected an active admin profile to exist for order tests.';
  end if;

  select id
    into v_product_category_id
  from public.categories
  where lower(slug) = 'electronics'
    and status = 'active'
    and deleted_at is null;

  if v_product_category_id is null then
    raise exception 'Expected the electronics category to exist for order tests.';
  end if;

  delete from auth.users
  where id in (v_customer_a_id, v_customer_b_id)
     or email in (v_customer_a_email, v_customer_b_email);

  delete from public.order_items
  where order_id in (
    select id
    from public.orders
    where user_id in (v_customer_a_id, v_customer_b_id)
  );

  delete from public.orders
  where user_id in (v_customer_a_id, v_customer_b_id);

  delete from public.cart_items
  where cart_id in (
    select id
    from public.carts
    where user_id in (v_customer_a_id, v_customer_b_id)
  );

  delete from public.carts
  where user_id in (v_customer_a_id, v_customer_b_id);

  delete from public.addresses
  where user_id in (v_customer_a_id, v_customer_b_id);

  delete from public.product_perks
  where product_id in (
    select id
    from public.products
    where slug = v_temp_product_slug
  );

  delete from public.product_features
  where product_id in (
    select id
    from public.products
    where slug = v_temp_product_slug
  );

  delete from public.product_sizes
  where product_id in (
    select id
    from public.products
    where slug = v_temp_product_slug
  );

  delete from public.product_colors
  where product_id in (
    select id
    from public.products
    where slug = v_temp_product_slug
  );

  delete from public.product_images
  where product_id in (
    select id
    from public.products
    where slug = v_temp_product_slug
  );

  delete from public.products
  where slug = v_temp_product_slug;

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
      jsonb_build_object('full_name', 'Orders Customer A'),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      'authenticated',
      'authenticated'
    ),
    (
      v_customer_b_id,
      v_customer_b_email,
      'trusted-fixture-password-hash',
      now(),
      jsonb_build_object('full_name', 'Orders Customer B'),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      'authenticated',
      'authenticated'
    );

  insert into public.products (
    id,
    category_id,
    slug,
    name,
    brand,
    price,
    primary_image_url,
    shipping_fee,
    shipping_method,
    status,
    source,
    created_at,
    updated_at
  ) values (
    gen_random_uuid(),
    v_product_category_id,
    v_temp_product_slug,
    v_temp_product_name,
    v_temp_product_brand,
    v_temp_product_price,
    v_temp_product_image,
    v_temp_product_shipping_fee,
    'air-freight',
    'active',
    'custom',
    v_old_timestamp,
    v_old_timestamp
  )
  returning id into v_temp_product_id;

  if v_temp_product_id is null then
    raise exception 'Expected the temporary product fixture to be created.';
  end if;

  select count(*)
    into v_count
  from public.profiles
  where id in (v_customer_a_id, v_customer_b_id)
    and role = 'customer'
    and status = 'active'
    and account_type = 'member';

  if v_count <> 2 then
    raise exception 'Expected signup triggers to create two active customer profiles.';
  end if;

  -- Table privilege matrix.
  if has_table_privilege('anon', 'public.orders', 'SELECT') is distinct from false
     or has_table_privilege('anon', 'public.orders', 'INSERT') is distinct from false
     or has_table_privilege('anon', 'public.orders', 'UPDATE') is distinct from false
     or has_table_privilege('anon', 'public.orders', 'DELETE') is distinct from false then
    raise exception 'Unexpected anon privilege matrix for public.orders.';
  end if;

  if has_table_privilege('authenticated', 'public.orders', 'SELECT') is distinct from true
     or has_table_privilege('authenticated', 'public.orders', 'INSERT') is distinct from false
     or has_table_privilege('authenticated', 'public.orders', 'UPDATE') is distinct from false
     or has_table_privilege('authenticated', 'public.orders', 'DELETE') is distinct from false then
    raise exception 'Unexpected authenticated privilege matrix for public.orders.';
  end if;

  if has_table_privilege('anon', 'public.order_items', 'SELECT') is distinct from false
     or has_table_privilege('anon', 'public.order_items', 'INSERT') is distinct from false
     or has_table_privilege('anon', 'public.order_items', 'UPDATE') is distinct from false
     or has_table_privilege('anon', 'public.order_items', 'DELETE') is distinct from false then
    raise exception 'Unexpected anon privilege matrix for public.order_items.';
  end if;

  if has_table_privilege('authenticated', 'public.order_items', 'SELECT') is distinct from true
     or has_table_privilege('authenticated', 'public.order_items', 'INSERT') is distinct from false
     or has_table_privilege('authenticated', 'public.order_items', 'UPDATE') is distinct from false
     or has_table_privilege('authenticated', 'public.order_items', 'DELETE') is distinct from false then
    raise exception 'Unexpected authenticated privilege matrix for public.order_items.';
  end if;

  if has_function_privilege('anon', 'public.create_order_from_cart(jsonb)', 'EXECUTE') is distinct from false then
    raise exception 'Expected anon to be unable to execute public.create_order_from_cart(jsonb).';
  end if;

  if has_function_privilege('authenticated', 'public.create_order_from_cart(jsonb)', 'EXECUTE') is distinct from true then
    raise exception 'Expected authenticated to be able to execute public.create_order_from_cart(jsonb).';
  end if;

  if has_function_privilege('anon', 'public.update_order_status(uuid, text)', 'EXECUTE') is distinct from false then
    raise exception 'Expected anon to be unable to execute public.update_order_status(uuid, text).';
  end if;

  if has_function_privilege('authenticated', 'public.update_order_status(uuid, text)', 'EXECUTE') is distinct from true then
    raise exception 'Expected authenticated to be able to execute public.update_order_status(uuid, text).';
  end if;

  -- Customer A saved address and cart.
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
    'Home',
    'Orders Customer A',
    '+233540000001',
    v_customer_a_email,
    'Ghana',
    'Greater Accra',
    'Accra',
    'First Test Street',
    '10',
    'Near the main gate',
    'GA-123-4567',
    true,
    v_old_timestamp,
    v_old_timestamp
  )
  returning id into v_address_a_id;

  insert into public.carts (
    user_id,
    created_at,
    updated_at
  ) values (
    v_customer_a_id,
    v_old_timestamp,
    v_old_timestamp
  )
  returning id into v_cart_a_id;

  insert into public.cart_items (
    cart_id,
    product_id,
    quantity,
    selected_color,
    selected_size,
    created_at,
    updated_at
  ) values (
    v_cart_a_id,
    v_temp_product_id,
    2,
    'Black',
    'M',
    v_old_timestamp,
    v_old_timestamp
  );

  select public.create_order_from_cart(
    jsonb_build_object(
      'shipping_address_id', v_address_a_id::text,
      'batch_number', 'BATCH-001'
    )
  )
    into v_order_a;

  v_order_a_id := (v_order_a -> 'order' ->> 'id')::uuid;
  v_order_a_number := v_order_a -> 'order' ->> 'orderNumber';
  v_expected_subtotal := v_temp_product_price * 2;
  v_expected_shipping := v_temp_product_shipping_fee * 2;
  v_expected_total := v_expected_subtotal + v_expected_shipping;

  if v_order_a_id is null or v_order_a_number is null then
    raise exception 'Expected customer A order creation to return a saved order bundle.';
  end if;

  if (v_order_a -> 'order' ->> 'subtotal')::numeric <> v_expected_subtotal
     or (v_order_a -> 'order' ->> 'shippingTotal')::numeric <> v_expected_shipping
     or (v_order_a -> 'order' ->> 'total')::numeric <> v_expected_total then
    raise exception 'Expected customer A totals to be calculated from database prices.';
  end if;

  if jsonb_array_length(coalesce(v_order_a -> 'items', '[]'::jsonb)) <> 1 then
    raise exception 'Expected customer A order to contain one item.';
  end if;

  select count(*)
    into v_count
  from public.cart_items
  where cart_id = v_cart_a_id;

  if v_count <> 0 then
    raise exception 'Expected customer A cart items to be cleared after a successful order.';
  end if;

  select count(*)
    into v_count
  from public.orders
  where user_id = v_customer_a_id;

  if v_count <> 1 then
    raise exception 'Expected customer A to see exactly one own order after the first checkout.';
  end if;

  select count(*)
    into v_count
  from public.order_items
  where order_id = v_order_a_id;

  if v_count <> 1 then
    raise exception 'Expected one order item to be stored for customer A.';
  end if;

  select jsonb_build_object(
    'productName', product_name,
    'productSlug', product_slug,
    'brand', brand,
    'imageUrl', image_url,
    'unitPrice', unit_price,
    'shippingFee', shipping_fee,
    'lineSubtotal', line_subtotal,
    'lineShipping', line_shipping
  )
    into v_snapshot
  from public.order_items
  where order_id = v_order_a_id
  limit 1;

  if v_snapshot ->> 'productName' <> v_temp_product_name
     or (v_snapshot ->> 'unitPrice')::numeric <> v_temp_product_price
     or (v_snapshot ->> 'shippingFee')::numeric <> v_temp_product_shipping_fee
     or (v_snapshot ->> 'lineSubtotal')::numeric <> v_expected_subtotal
     or (v_snapshot ->> 'lineShipping')::numeric <> v_expected_shipping then
    raise exception 'Expected order item snapshot values to match the original product data.';
  end if;

  select shipping_address_snapshot
    into v_snapshot
  from public.orders
  where id = v_order_a_id;

  if v_snapshot ->> 'fullName' <> 'Orders Customer A'
     or v_snapshot ->> 'streetAddress' <> 'First Test Street'
     or v_snapshot ->> 'phoneNumber' <> '+233540000001' then
    raise exception 'Expected shipping address snapshot to preserve the original address data.';
  end if;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.email', 'admin@nexus.com', true);

  -- Preserve snapshots after later product and address changes.
  perform public.save_product_bundle(
    jsonb_build_object(
      'product', jsonb_build_object(
        'id', v_temp_product_id::text,
        'category_id', v_product_category_id::text,
        'slug', v_temp_product_slug,
        'name', v_temp_product_updated_name,
        'brand', v_temp_product_brand,
        'price', v_temp_product_price + 20,
        'primary_image_url', v_temp_product_updated_image,
        'shipping_fee', v_temp_product_shipping_fee,
        'shipping_method', 'air-freight',
        'status', 'active',
        'source', 'custom'
      ),
      'images', jsonb_build_array(
        jsonb_build_object('image_url', v_temp_product_updated_image)
      ),
      'colors', '[]'::jsonb,
      'sizes', '[]'::jsonb,
      'features', '[]'::jsonb,
      'perks', '[]'::jsonb
    )
  );

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_customer_a_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.email', v_customer_a_email, true);

  update public.addresses
    set full_name = 'Orders Customer A Updated',
        street_address = 'Updated Test Street',
        updated_at = now()
  where id = v_address_a_id;

  select jsonb_build_object(
    'productName', product_name,
    'productSlug', product_slug,
    'brand', brand,
    'imageUrl', image_url,
    'unitPrice', unit_price
  )
    into v_snapshot
  from public.order_items
  where order_id = v_order_a_id
  limit 1;

  if v_snapshot ->> 'productName' <> v_temp_product_name
     or (v_snapshot ->> 'unitPrice')::numeric <> v_temp_product_price
     or v_snapshot ->> 'imageUrl' <> v_temp_product_image then
    raise exception 'Expected the first order snapshot to remain unchanged after product edits.';
  end if;

  select shipping_address_snapshot
    into v_snapshot
  from public.orders
  where id = v_order_a_id;

  if v_snapshot ->> 'fullName' <> 'Orders Customer A'
     or v_snapshot ->> 'streetAddress' <> 'First Test Street' then
    raise exception 'Expected the first order shipping snapshot to remain unchanged after address edits.';
  end if;

  -- Create a second order for customer A to verify unique order numbers.
  insert into public.cart_items (
    cart_id,
    product_id,
    quantity,
    selected_color,
    selected_size,
    created_at,
    updated_at
  ) values (
    v_cart_a_id,
    v_temp_product_id,
    1,
    'Black',
    'M',
    v_old_timestamp,
    v_old_timestamp
  );

  select public.create_order_from_cart(
    jsonb_build_object(
      'shipping_address_id', v_address_a_id::text,
      'batch_number', 'BATCH-002'
    )
  )
    into v_order_b;

  v_order_b_id := (v_order_b -> 'order' ->> 'id')::uuid;
  v_order_b_number := v_order_b -> 'order' ->> 'orderNumber';

  if v_order_b_id is null or v_order_b_number is null then
    raise exception 'Expected customer A second order creation to return a saved order bundle.';
  end if;

  if (v_order_b -> 'order' ->> 'subtotal')::numeric <> (v_temp_product_price + 20)
     or (v_order_b -> 'order' ->> 'shippingTotal')::numeric <> v_temp_product_shipping_fee
     or (v_order_b -> 'order' ->> 'total')::numeric <> (v_temp_product_price + 20 + v_temp_product_shipping_fee) then
    raise exception 'Expected the second order totals to reflect the updated product snapshot.';
  end if;

  if v_order_b_number = v_order_a_number then
    raise exception 'Expected unique order numbers for each checkout.';
  end if;

  select count(*)
    into v_count
  from public.orders
  where user_id = v_customer_a_id;

  if v_count <> 2 then
    raise exception 'Expected customer A to see both of their own orders.';
  end if;

  -- Customer B saved address and cart for cross-user checks.
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
    'Home',
    'Orders Customer B',
    '+233540000002',
    v_customer_b_email,
    'Ghana',
    'Central',
    'Cape Coast',
    'Second Test Street',
    '20',
    'Near the sea',
    'CC-987-6543',
    true,
    v_old_timestamp,
    v_old_timestamp
  )
  returning id into v_address_b_id;

  insert into public.carts (
    user_id,
    created_at,
    updated_at
  ) values (
    v_customer_b_id,
    v_old_timestamp,
    v_old_timestamp
  )
  returning id into v_cart_b_id;

  insert into public.cart_items (
    cart_id,
    product_id,
    quantity,
    selected_color,
    selected_size,
    created_at,
    updated_at
  ) values (
    v_cart_b_id,
    v_temp_product_id,
    1,
    'Black',
    'M',
    v_old_timestamp,
    v_old_timestamp
  );

  -- Cross-user reads must be blocked.
  select count(*)
    into v_count
  from public.carts
  where id = v_cart_a_id;

  if v_count <> 0 then
    raise exception 'Expected customer B to be unable to read customer A cart rows.';
  end if;

  select count(*)
    into v_count
  from public.addresses
  where id = v_address_a_id;

  if v_count <> 0 then
    raise exception 'Expected customer B to be unable to read customer A address rows.';
  end if;

  -- Prevent invalid quantity.
  begin
    insert into public.cart_items (
      cart_id,
      product_id,
      quantity,
      selected_color,
      selected_size,
      created_at,
      updated_at
    ) values (
      v_cart_b_id,
      v_temp_product_id,
      0,
      'Black',
      'M',
      v_old_timestamp,
      v_old_timestamp
    );

    raise exception 'Expected zero-quantity cart items to be rejected.';
  exception
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      if v_sqlstate is null then
        raise exception 'Unexpected failure while testing zero-quantity cart validation.';
      end if;
      if v_message not ilike '%greater than 0%' and v_message not ilike '%quantity%' then
        raise exception 'Unexpected zero-quantity cart validation error: [%] %', v_sqlstate, v_message;
      end if;
  end;

  -- Soft-delete the temporary product to force order creation failure.
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_state.admin_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.email', 'admin@nexus.com', true);

  perform public.set_product_deleted_at(v_temp_product_id);

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_state.customer_b_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.email', v_state.customer_b_email, true);

  begin
    perform public.create_order_from_cart(
      jsonb_build_object(
        'shipping_address_id', v_address_b_id::text,
        'batch_number', 'BATCH-FAIL'
      )
    );

    raise exception 'Expected order creation to fail when the cart contains a deleted product.';
  exception
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      if v_message not ilike '%inactive, deleted, or invalid product%' then
        raise exception 'Unexpected order creation failure message: [%] %', v_sqlstate, v_message;
      end if;
  end;

  select count(*)
    into v_count
  from public.cart_items
  where cart_id = v_cart_b_id;

  if v_count <> 1 then
    raise exception 'Expected failed order creation to leave customer B cart items intact.';
  end if;

  insert into orders_test_state (
    admin_id,
    customer_a_id,
    customer_b_id,
    customer_a_email,
    customer_b_email,
    order_a_id,
    order_a_number,
    order_b_id,
    order_b_number,
    cart_a_id,
    cart_b_id,
    address_a_id,
    address_b_id,
    product_id,
    product_slug,
    product_name,
    product_brand,
    product_image,
    product_price,
    product_shipping_fee,
    old_timestamp
  ) values (
    v_admin_id,
    v_customer_a_id,
    v_customer_b_id,
    v_customer_a_email,
    v_customer_b_email,
    v_order_a_id,
    v_order_a_number,
    v_order_b_id,
    v_order_b_number,
    v_cart_a_id,
    v_cart_b_id,
    v_address_a_id,
    v_address_b_id,
    v_temp_product_id,
    v_temp_product_slug,
    v_temp_product_name,
    v_temp_product_brand,
    v_temp_product_image,
    v_temp_product_price,
    v_temp_product_shipping_fee,
    v_old_timestamp
  );
end;
$$;

commit;

begin;

do $$
declare
  v_state record;
  v_count integer;
  v_sqlstate text;
  v_message text;
  v_before_update timestamptz;
  v_order_bundle jsonb;
begin
  select *
    into v_state
  from orders_test_state
  limit 1;

  if not found then
    raise exception 'Expected staged order test state to exist.';
  end if;

  alter table public.orders disable trigger orders_set_updated_at;
  update public.orders
    set updated_at = v_state.old_timestamp
  where id = v_state.order_a_id;
  alter table public.orders enable trigger orders_set_updated_at;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_state.admin_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.email', 'admin@nexus.com', true);

  select count(*)
    into v_count
  from public.orders;

  if v_count <> 2 then
    raise exception 'Expected the active admin to see all orders.';
  end if;

  select count(*)
    into v_count
  from public.order_items;

  if v_count <> 2 then
    raise exception 'Expected the active admin to see all order items.';
  end if;

  select updated_at
    into v_before_update
  from public.orders
  where id = v_state.order_a_id;

  if v_before_update is null then
    raise exception 'Expected to read the first order updated_at before the admin update.';
  end if;

  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claim.sub', v_state.customer_a_id::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    perform set_config('request.jwt.claim.email', v_state.customer_a_email, true);

    perform public.update_order_status(v_state.order_a_id, 'delivered');
    raise exception 'Expected a customer to be blocked from changing order status.';
  exception
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      if v_message not ilike '%Only active administrators can update order status.%' then
        raise exception 'Unexpected customer status-update error: [%] %', v_sqlstate, v_message;
      end if;
  end;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_state.customer_b_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.email', v_state.customer_b_email, true);

  select count(*)
    into v_count
  from public.orders
  where id = v_state.order_a_id;

  if v_count <> 0 then
    raise exception 'Expected customer B to be unable to read customer A order rows.';
  end if;

  select count(*)
    into v_count
  from public.order_items
  where order_id = v_state.order_a_id;

  if v_count <> 0 then
    raise exception 'Expected customer B to be unable to read customer A order items.';
  end if;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_state.customer_a_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.email', v_state.customer_a_email, true);

  if has_function_privilege('anon', 'public.update_order_status(uuid, text)', 'EXECUTE') is distinct from false then
    raise exception 'Expected anon to be unable to execute the order status RPC.';
  end if;

  execute 'set local role anon';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'anon', true);
  perform set_config('request.jwt.claim.email', '', true);

  begin
    perform public.create_order_from_cart(
      jsonb_build_object(
        'shipping_address_id', v_state.address_b_id::text,
        'batch_number', 'BATCH-ANON'
      )
    );
    raise exception 'Expected anon to be blocked from creating orders.';
  exception
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      if v_message not ilike '%permission denied%'
         and v_message not ilike '%sign in to create an order%'
         and v_message not ilike '%Only active customer accounts can create orders.%' then
        raise exception 'Unexpected anon order-creation error: [%] %', v_sqlstate, v_message;
      end if;
  end;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_state.admin_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.email', 'admin@nexus.com', true);

  select public.update_order_status(v_state.order_a_id, 'delivered')
    into v_order_bundle;

  if (v_order_bundle -> 'order' ->> 'status') <> 'delivered' then
    raise exception 'Expected the admin status update to deliver the order.';
  end if;

  if (v_order_bundle -> 'order' ->> 'updatedAt')::timestamptz <= v_before_update then
    raise exception 'Expected updated_at to advance after the admin status update.';
  end if;

  if (v_order_bundle -> 'order' ->> 'deliveredAt') is null then
    raise exception 'Expected delivered_at to be set when the order is delivered.';
  end if;

  execute 'reset role';

  delete from public.order_items
  where order_id in (v_state.order_a_id, v_state.order_b_id);

  delete from public.orders
  where id in (v_state.order_a_id, v_state.order_b_id);

  delete from public.cart_items
  where cart_id in (v_state.cart_a_id, v_state.cart_b_id);

  delete from public.carts
  where id in (v_state.cart_a_id, v_state.cart_b_id);

  delete from public.addresses
  where id in (v_state.address_a_id, v_state.address_b_id);

  delete from public.products
  where id = v_state.product_id;

  delete from auth.users
  where id in (v_state.customer_a_id, v_state.customer_b_id);

  select count(*)
    into v_count
  from auth.users
  where id in (v_state.customer_a_id, v_state.customer_b_id)
     or email in (v_state.customer_a_email, v_state.customer_b_email);

  if v_count <> 0 then
    raise exception 'Expected test auth users to be fully cleaned up.';
  end if;

  select count(*)
    into v_count
  from public.orders
  where id in (v_state.order_a_id, v_state.order_b_id);

  if v_count <> 0 then
    raise exception 'Expected test orders to be fully cleaned up.';
  end if;

  select count(*)
    into v_count
  from public.order_items
  where order_id in (v_state.order_a_id, v_state.order_b_id);

  if v_count <> 0 then
    raise exception 'Expected test order items to be fully cleaned up.';
  end if;

  select count(*)
    into v_count
  from public.cart_items
  where cart_id in (v_state.cart_a_id, v_state.cart_b_id);

  if v_count <> 0 then
    raise exception 'Expected test cart items to be fully cleaned up.';
  end if;

  select count(*)
    into v_count
  from public.carts
  where id in (v_state.cart_a_id, v_state.cart_b_id);

  if v_count <> 0 then
    raise exception 'Expected test carts to be fully cleaned up.';
  end if;

  select count(*)
    into v_count
  from public.addresses
  where id in (v_state.address_a_id, v_state.address_b_id);

  if v_count <> 0 then
    raise exception 'Expected test addresses to be fully cleaned up.';
  end if;

  select count(*)
    into v_count
  from public.products
  where id = v_state.product_id;

  if v_count <> 0 then
    raise exception 'Expected the temporary product fixture to be fully cleaned up.';
  end if;

  select count(*)
    into v_count
  from orders_test_state;

  if v_count <> 1 then
    raise exception 'Expected the staged order test state to remain visible for the second transaction.';
  end if;
end;
$$;

commit;
