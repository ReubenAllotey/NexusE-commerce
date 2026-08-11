-- Trusted test harness for the product migration.
-- Run in a trusted SQL session that can impersonate authenticated/anon JWT claims
-- and create temporary auth.users fixtures.

begin;

do $$
declare
  v_admin_id uuid;
  v_customer_id uuid := 'a1111111-1111-4111-8111-111111111111';
  v_customer_email text := 'products-customer-a11111111111411181111111111111111@example.com';
  v_electronics_category_id uuid;
  v_fashion_category_id uuid;
  v_hidden_category_id uuid;
  v_result jsonb;
  v_created_product_id uuid;
  v_slug_text text;
  v_count integer;
  v_sqlstate text;
  v_message text;
  v_updated_at_created timestamptz;
  v_updated_at_updated timestamptz;
  v_expected text[];
  v_actual text[];
  v_payload jsonb;
  v_valid_product jsonb;
  v_valid_colors jsonb;
  v_valid_sizes jsonb;
  v_valid_features jsonb;
  v_valid_perks jsonb;
  v_update_product jsonb;
  v_update_colors jsonb;
  v_update_sizes jsonb;
  v_update_features jsonb;
  v_update_perks jsonb;
  v_rollback_payload jsonb;
  v_hidden_payload jsonb;
  v_case record;
  v_hidden_seed_row record;
  v_updated_at_product_id uuid;
  v_updated_at_old timestamptz := timestamptz '2000-01-01 00:00:00+00';
begin
  select id
    into v_admin_id
  from public.profiles
  where role = 'admin'
    and status = 'active'
  order by created_at asc
  limit 1;

  if v_admin_id is null then
    raise exception 'Expected an active admin profile to exist for product tests.';
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
    v_customer_id,
    v_customer_email,
    'trusted-fixture-password-hash',
    now(),
    jsonb_build_object('full_name', 'Products Customer A'),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    'authenticated',
    'authenticated'
  );

  select id
    into v_electronics_category_id
  from public.categories
  where lower(slug) = 'electronics'
    and status = 'active'
    and deleted_at is null;

  if v_electronics_category_id is null then
    raise exception 'Expected the electronics seed category to exist for product tests.';
  end if;

  select id
    into v_fashion_category_id
  from public.categories
  where lower(slug) = 'fashion'
    and status = 'active'
    and deleted_at is null;

  if v_fashion_category_id is null then
    raise exception 'Expected the fashion seed category to exist for product tests.';
  end if;

  -- Permission and RPC exposure checks.
  for v_case in
    select *
    from (
      values
        ('products', 'select', true),
        ('products', 'insert', false),
        ('products', 'update', false),
        ('products', 'delete', false),
        ('products', 'truncate', false),
        ('products', 'references', false),
        ('products', 'trigger', false),
        ('product_images', 'select', true),
        ('product_images', 'insert', false),
        ('product_images', 'update', false),
        ('product_images', 'delete', false),
        ('product_images', 'truncate', false),
        ('product_images', 'references', false),
        ('product_images', 'trigger', false),
        ('product_colors', 'select', true),
        ('product_colors', 'insert', false),
        ('product_colors', 'update', false),
        ('product_colors', 'delete', false),
        ('product_colors', 'truncate', false),
        ('product_colors', 'references', false),
        ('product_colors', 'trigger', false),
        ('product_sizes', 'select', true),
        ('product_sizes', 'insert', false),
        ('product_sizes', 'update', false),
        ('product_sizes', 'delete', false),
        ('product_sizes', 'truncate', false),
        ('product_sizes', 'references', false),
        ('product_sizes', 'trigger', false),
        ('product_features', 'select', true),
        ('product_features', 'insert', false),
        ('product_features', 'update', false),
        ('product_features', 'delete', false),
        ('product_features', 'truncate', false),
        ('product_features', 'references', false),
        ('product_features', 'trigger', false),
        ('product_perks', 'select', true),
        ('product_perks', 'insert', false),
        ('product_perks', 'update', false),
        ('product_perks', 'delete', false)
        ,('product_perks', 'truncate', false),
        ('product_perks', 'references', false),
        ('product_perks', 'trigger', false)
    ) as permissions(table_name, privilege, expected_value)
  loop
    if has_table_privilege('anon', format('public.%I', v_case.table_name), v_case.privilege) is distinct from v_case.expected_value then
      raise exception 'Unexpected anon privilege % on public.%: expected %, got %.',
        v_case.privilege,
        v_case.table_name,
        v_case.expected_value,
        has_table_privilege('anon', format('public.%I', v_case.table_name), v_case.privilege);
    end if;

    if has_table_privilege('authenticated', format('public.%I', v_case.table_name), v_case.privilege) is distinct from v_case.expected_value then
      raise exception 'Unexpected authenticated privilege % on public.%: expected %, got %.',
        v_case.privilege,
        v_case.table_name,
        v_case.expected_value,
        has_table_privilege('authenticated', format('public.%I', v_case.table_name), v_case.privilege);
    end if;
  end loop;

  if has_function_privilege('authenticated', 'public.save_product_bundle(jsonb)', 'EXECUTE') is distinct from true then
    raise exception 'Expected authenticated to be able to execute public.save_product_bundle(jsonb).';
  end if;

  if has_function_privilege('anon', 'public.save_product_bundle(jsonb)', 'EXECUTE') is distinct from false then
    raise exception 'Expected anon to be unable to execute public.save_product_bundle(jsonb).';
  end if;

  if has_function_privilege('authenticated', 'public.set_product_deleted_at(uuid, timestamptz)', 'EXECUTE') is distinct from true then
    raise exception 'Expected authenticated to be able to execute public.set_product_deleted_at(uuid, timestamptz).';
  end if;

  if has_function_privilege('authenticated', 'public.restore_product(uuid)', 'EXECUTE') is distinct from true then
    raise exception 'Expected authenticated to be able to execute public.restore_product(uuid).';
  end if;

  -- Public visibility for the seeded products.
  execute 'set local role anon';
  perform set_config('request.jwt.claim.role', 'anon', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.email', '', true);

  select count(*)
    into v_count
  from public.products
  where lower(slug) = any (array[
    'revive-vitamin-c-serum',
    'daily-glow-face-cleanser',
    'hydrating-body-lotion',
    'study-skills-book-pack',
    'business-growth-books',
    'premium-wireless-headphones',
    'studio-sound-bluetooth-speaker',
    'ultra-hd-smart-tv',
    'compact-digital-camera',
    'ultra-slim-smartphone',
    'laurel-wrath-signature-shirt',
    'classic-unisex-tee',
    'ergonomic-office-chair',
    'samsung-double-door-fridge',
    'electric-kettle-pro',
    'washing-machine-pro'
  ]);

  if v_count <> 16 then
    raise exception 'Expected the seeded storefront products to be visible to anon.';
  end if;

  -- Customer RPC rejection.
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_customer_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.email', v_customer_email, true);

  v_valid_product := jsonb_build_object(
    'category_id', v_electronics_category_id::text,
    'slug', 'product-test-rpc-valid',
    'name', 'Product Test RPC Valid',
    'series', 'Test Series',
    'brand', 'TechPro',
    'sold_by', 'Nexus Store',
    'price', 250,
    'compare_at', 300,
    'rating', 4.6,
    'review_count', 12,
    'badge', 'New',
    'stock_status', 'In Stock & Ready to Ship',
    'description', 'Base product for Supabase tests.',
    'overview', 'Used to validate product bundle writes.',
    'primary_image_url', 'camera.jpg',
    'shipping_fee', 25,
    'shipping_fee_status', 'ready',
    'shipping_method', 'air-freight',
    'status', 'active',
    'source', 'custom',
    'subcategory_label', 'Test'
  );
  v_valid_colors := jsonb_build_array('Black', 'White');
  v_valid_sizes := '[]'::jsonb;
  v_valid_features := jsonb_build_array('Feature one', 'Feature two');
  v_valid_perks := jsonb_build_array('Perk one', 'Perk two');
  v_payload := jsonb_build_object(
    'product', v_valid_product,
    'images', '[]'::jsonb,
    'colors', v_valid_colors,
    'sizes', v_valid_sizes,
    'features', v_valid_features,
    'perks', v_valid_perks
  );

  begin
    perform public.save_product_bundle(v_payload);
    raise exception 'Expected customer RPC access to be blocked.';
  exception
    when SQLSTATE 'P0001' then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      if v_message not like '%Only active administrators can save products.%' then
        raise exception 'Unexpected customer RPC rejection: [%] %', v_sqlstate, v_message;
      end if;
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      raise exception 'Unexpected SQL error for customer RPC rejection: [%] %', v_sqlstate, v_message;
  end;

  -- Anon RPC rejection.
  execute 'set local role anon';
  perform set_config('request.jwt.claim.role', 'anon', true);
  perform set_config('request.jwt.claim.sub', '', true);

  begin
    perform public.save_product_bundle(v_payload);
    raise exception 'Expected anon RPC access to be blocked.';
  exception
    when SQLSTATE '42501' then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      if v_message not like '%permission denied%' then
        raise exception 'Unexpected anon RPC rejection: [%] %', v_sqlstate, v_message;
      end if;
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      raise exception 'Unexpected SQL error for anon RPC rejection: [%] %', v_sqlstate, v_message;
  end;

  -- Switch back to admin for all write tests.
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.email', 'reubenallotey434@gmail.com', true);

  -- Admin can create a complete bundle.
  v_valid_product := jsonb_build_object(
    'category_id', v_electronics_category_id::text,
    'slug', 'product-test-base',
    'name', 'Product Test Base',
    'series', 'Test Series',
    'brand', 'TechPro',
    'sold_by', 'Nexus Store',
    'price', 250,
    'compare_at', 300,
    'rating', 4.6,
    'review_count', 12,
    'badge', 'New',
    'stock_status', 'In Stock & Ready to Ship',
    'description', 'Base product for Supabase tests.',
    'overview', 'Used to validate product bundle writes.',
    'primary_image_url', 'camera.jpg',
    'shipping_fee', 25,
    'shipping_fee_status', 'ready',
    'shipping_method', 'air-freight',
    'status', 'active',
    'source', 'custom',
    'subcategory_label', 'Test'
  );
  v_result := public.save_product_bundle(jsonb_build_object(
    'product', v_valid_product,
    'images', '[]'::jsonb,
    'colors', jsonb_build_array('Black', 'White'),
    'sizes', '[]'::jsonb,
    'features', jsonb_build_array('Feature one', 'Feature two'),
    'perks', jsonb_build_array('Perk one', 'Perk two')
  ));

  v_created_product_id := (v_result->'product'->>'id')::uuid;
  v_slug_text := v_result->'product'->>'slug';
  v_updated_at_created := (v_result->'product'->>'updated_at')::timestamptz;

  if v_slug_text <> 'product-test-base' then
    raise exception 'Expected the saved product slug to remain normalized and stable.';
  end if;

  -- Use a fixed old timestamp so this check is independent of transaction-stable now().
  insert into public.products (
    category_id,
    subcategory_label,
    slug,
    name,
    series,
    brand,
    sold_by,
    price,
    compare_at,
    rating,
    review_count,
    badge,
    stock_status,
    description,
    overview,
    primary_image_url,
    shipping_fee,
    shipping_fee_status,
    shipping_method,
    status,
    source,
    created_at,
    updated_at
  ) values (
    v_fashion_category_id,
    'Streetwear',
    'product-test-updated-at',
    'Product Test Updated At',
    'Test Series',
    'Nexus',
    'Nexus Store',
    180,
    220,
    4.1,
    7,
    'New',
    'In Stock & Ready to Ship',
    'Fixture for updated_at verification.',
    'Fixture for updated_at verification.',
    'laurel wrath shirt.png',
    20,
    'ready',
    'air-freight',
    'active',
    'custom',
    v_updated_at_old,
    v_updated_at_old
  )
  returning id
    into v_updated_at_product_id;

  select updated_at
    into v_updated_at_created
  from public.products
  where id = v_updated_at_product_id;

  if v_updated_at_created <> v_updated_at_old then
    raise exception 'Expected the updated_at fixture to start at the fixed timestamp.';
  end if;

  v_result := public.save_product_bundle(jsonb_build_object(
    'product', jsonb_build_object(
      'id', v_updated_at_product_id::text,
      'category_id', v_fashion_category_id::text,
      'name', 'Product Test Updated At Revised',
      'price', 185,
      'compare_at', 225,
      'rating', 4.2,
      'review_count', 8,
      'badge', 'Top Pick',
      'stock_status', 'In Stock & Ready to Ship',
      'description', 'Fixture for updated_at verification.',
      'overview', 'Fixture for updated_at verification.',
      'primary_image_url', 'laurel wrath shirt.png',
      'shipping_fee', 21,
      'shipping_fee_status', 'ready',
      'shipping_method', 'air-freight',
      'status', 'active',
      'source', 'custom',
      'subcategory_label', 'Streetwear'
    ),
    'images', '[]'::jsonb,
    'colors', jsonb_build_array('Black'),
    'sizes', jsonb_build_array('M'),
    'features', jsonb_build_array('Updated feature one'),
    'perks', jsonb_build_array('Updated perk one')
  ));

  v_updated_at_updated := (v_result->'product'->>'updated_at')::timestamptz;

  if v_updated_at_updated <= v_updated_at_old then
    raise exception 'Expected updated_at to advance after the product update.';
  end if;

  select count(*)
    into v_count
  from public.product_colors
  where product_id = v_created_product_id;

  if v_count <> 2 then
    raise exception 'Expected exactly two product color rows to be saved.';
  end if;

  select count(*)
    into v_count
  from public.product_sizes
  where product_id = v_created_product_id;

  if v_count <> 0 then
    raise exception 'Expected zero product size rows for the base bundle.';
  end if;

  select count(*)
    into v_count
  from public.product_features
  where product_id = v_created_product_id;

  if v_count <> 2 then
    raise exception 'Expected exactly two product feature rows to be saved.';
  end if;

  select count(*)
    into v_count
  from public.product_perks
  where product_id = v_created_product_id;

  if v_count <> 2 then
    raise exception 'Expected exactly two product perk rows to be saved.';
  end if;

  -- Public and child-table visibility for the created product.
  execute 'set local role anon';
  perform set_config('request.jwt.claim.role', 'anon', true);
  perform set_config('request.jwt.claim.sub', '', true);

  select count(*)
    into v_count
  from public.products
  where id = v_created_product_id;

  if v_count <> 1 then
    raise exception 'Expected anon to see the active product row.';
  end if;

  select count(*)
    into v_count
  from public.product_colors
  where product_id = v_created_product_id;

  if v_count <> 2 then
    raise exception 'Expected anon to see child rows while the parent product is active.';
  end if;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_customer_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.email', v_customer_email, true);

  select count(*)
    into v_count
  from public.products
  where id = v_created_product_id;

  if v_count <> 1 then
    raise exception 'Expected authenticated customers to see the active product row.';
  end if;

  -- Slug normalization and stability.
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.email', 'reubenallotey434@gmail.com', true);

  v_result := public.save_product_bundle(jsonb_build_object(
    'product', jsonb_build_object(
      'category_id', v_electronics_category_id::text,
      'slug', '  Product TEST -- Normalized !!  ',
      'name', 'Slug Normalize Product',
      'series', 'Test Series',
      'brand', 'TechPro',
      'sold_by', 'Nexus Store',
      'price', 300,
      'compare_at', 360,
      'rating', 4.4,
      'review_count', 10,
      'badge', 'New',
      'stock_status', 'In Stock & Ready to Ship',
      'description', 'Used to verify slug normalization.',
      'overview', 'The slug should normalize once and remain stable on update.',
      'primary_image_url', 'hero-phone.png',
      'shipping_fee', 20,
      'shipping_fee_status', 'ready',
      'shipping_method', 'air-freight',
      'status', 'active',
      'source', 'custom',
      'subcategory_label', 'Phones'
    ),
    'images', '[]'::jsonb,
    'colors', jsonb_build_array('Black'),
    'sizes', '[]'::jsonb,
    'features', jsonb_build_array('One feature', 'Another feature'),
    'perks', jsonb_build_array('Perk one')
  ));

  v_slug_text := v_result->'product'->>'slug';
  if v_slug_text <> 'product-test-normalized' then
    raise exception 'Expected slug normalization to lower-case and trim punctuation.';
  end if;

  v_created_product_id := (v_result->'product'->>'id')::uuid;

  v_result := public.save_product_bundle(jsonb_build_object(
    'product', jsonb_build_object(
      'id', v_created_product_id::text,
      'category_id', v_electronics_category_id::text,
      'name', 'Slug Normalize Product Updated',
      'price', 310,
      'compare_at', 360,
      'rating', 4.5,
      'review_count', 11,
      'badge', 'New',
      'stock_status', 'In Stock & Ready to Ship',
      'description', 'Updated name without changing slug.',
      'overview', 'Slug should stay stable when no new slug is submitted.',
      'primary_image_url', 'hero-phone.png',
      'shipping_fee', 20,
      'shipping_fee_status', 'ready',
      'shipping_method', 'air-freight',
      'status', 'active',
      'source', 'custom',
      'subcategory_label', 'Phones'
    ),
    'images', '[]'::jsonb,
    'colors', jsonb_build_array('Black'),
    'sizes', '[]'::jsonb,
    'features', jsonb_build_array('One feature', 'Another feature'),
    'perks', jsonb_build_array('Perk one')
  ));

  if (v_result->'product'->>'slug') <> 'product-test-normalized' then
    raise exception 'Expected the existing product slug to remain stable on update.';
  end if;

  -- Duplicate slug rejection.
  begin
    perform public.save_product_bundle(jsonb_build_object(
      'product', jsonb_build_object(
        'category_id', v_electronics_category_id::text,
        'slug', 'product-test-base',
        'name', 'Duplicate Slug Product',
        'price', 120,
        'compare_at', 150,
        'rating', 4.1,
        'review_count', 4,
        'badge', 'New',
        'stock_status', 'In Stock & Ready to Ship',
        'description', 'Duplicate slug attempt.',
        'overview', 'This should fail.',
        'primary_image_url', 'camera.jpg',
        'shipping_fee', 12,
        'shipping_fee_status', 'ready',
        'shipping_method', 'air-freight',
        'status', 'active',
        'source', 'custom'
      ),
      'images', '[]'::jsonb,
      'colors', '[]'::jsonb,
      'sizes', '[]'::jsonb,
      'features', '[]'::jsonb,
      'perks', '[]'::jsonb
    ));

    raise exception 'Expected duplicate slug creation to be blocked.';
  exception
    when SQLSTATE 'P0001' then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      if v_message not like '%Product slug must be unique.%' then
        raise exception 'Unexpected duplicate slug rejection: [%] %', v_sqlstate, v_message;
      end if;
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      raise exception 'Unexpected SQL error for duplicate slug rejection: [%] %', v_sqlstate, v_message;
  end;

  -- Numeric constraints.
  for v_case in
    select *
    from (
      values
        (jsonb_build_object('price', '-1'), 'Product price cannot be negative.'),
        (jsonb_build_object('compare_at', '200'), 'Compare-at price must be greater than or equal to the product price.'),
        (jsonb_build_object('rating', '6'), 'Product rating must be between 0 and 5.'),
        (jsonb_build_object('review_count', '-1'), 'Review count cannot be negative.'),
        (jsonb_build_object('shipping_fee', '-5'), 'Shipping fee cannot be negative.')
    ) as cases(overrides, expected_message)
  loop
    begin
      v_payload := jsonb_build_object(
        'product', (
          jsonb_build_object(
            'category_id', v_electronics_category_id::text,
            'slug', 'product-test-numeric-' || replace(lower(v_case.expected_message), ' ', '-'),
            'name', 'Numeric Constraint Test',
            'series', 'Test Series',
            'brand', 'TechPro',
            'sold_by', 'Nexus Store',
            'price', 250,
            'compare_at', 300,
            'rating', 4.6,
            'review_count', 12,
            'badge', 'New',
            'stock_status', 'In Stock & Ready to Ship',
            'description', 'Numeric validation test.',
            'overview', 'Should fail one numeric constraint.',
            'primary_image_url', 'camera.jpg',
            'shipping_fee', 25,
            'shipping_fee_status', 'ready',
            'shipping_method', 'air-freight',
            'status', 'active',
            'source', 'custom',
            'subcategory_label', 'Test'
          ) || v_case.overrides
        ),
        'images', '[]'::jsonb,
        'colors', '[]'::jsonb,
        'sizes', '[]'::jsonb,
        'features', '[]'::jsonb,
        'perks', '[]'::jsonb
      );

      perform public.save_product_bundle(v_payload);
      raise exception 'Expected numeric validation to be blocked.';
    exception
      when SQLSTATE 'P0001' then
        get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
        if v_message not like ('%' || v_case.expected_message || '%') then
          raise exception 'Unexpected numeric validation rejection: [%] %', v_sqlstate, v_message;
        end if;
      when others then
        get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
        raise exception 'Unexpected SQL error for numeric validation: [%] %', v_sqlstate, v_message;
    end;
  end loop;

  -- Invalid category rejection.
  begin
    perform public.save_product_bundle(jsonb_build_object(
      'product', jsonb_build_object(
        'category_id', '00000000-0000-4000-8000-000000000001',
        'slug', 'product-test-invalid-category',
        'name', 'Invalid Category Product',
        'price', 100,
        'compare_at', 120,
        'rating', 4.0,
        'review_count', 2,
        'badge', 'New',
        'stock_status', 'In Stock & Ready to Ship',
        'description', 'Invalid category test.',
        'overview', 'Should fail because the category does not exist.',
        'primary_image_url', 'camera.jpg',
        'shipping_fee', 15,
        'shipping_fee_status', 'ready',
        'shipping_method', 'air-freight',
        'status', 'active',
        'source', 'custom'
      ),
      'images', '[]'::jsonb,
      'colors', '[]'::jsonb,
      'sizes', '[]'::jsonb,
      'features', '[]'::jsonb,
      'perks', '[]'::jsonb
    ));

    raise exception 'Expected invalid category creation to be blocked.';
  exception
    when SQLSTATE 'P0001' then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      if v_message not like '%Product category must exist.%' then
        raise exception 'Unexpected invalid category rejection: [%] %', v_sqlstate, v_message;
      end if;
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      raise exception 'Unexpected SQL error for invalid category rejection: [%] %', v_sqlstate, v_message;
  end;

  -- Hidden/deleted category publish rejection.
  insert into public.categories (
    name,
    slug,
    description,
    icon,
    status,
    parent_id,
    display_order,
    show_on_homepage,
    deleted_at
  ) values (
    'Product Test Hidden Category',
    'product-test-hidden-category',
    'Hidden category used for product validation.',
    'electronics',
    'hidden',
    null,
    99,
    false,
    now()
  )
  returning id into v_hidden_category_id;

  begin
    perform public.save_product_bundle(jsonb_build_object(
      'product', jsonb_build_object(
        'category_id', v_hidden_category_id::text,
        'slug', 'product-test-hidden-category-product',
        'name', 'Hidden Category Product',
        'price', 100,
        'compare_at', 120,
        'rating', 4.0,
        'review_count', 2,
        'badge', 'New',
        'stock_status', 'In Stock & Ready to Ship',
        'description', 'Hidden category publish test.',
        'overview', 'Should fail because the category is hidden.',
        'primary_image_url', 'camera.jpg',
        'shipping_fee', 15,
        'shipping_fee_status', 'ready',
        'shipping_method', 'air-freight',
        'status', 'active',
        'source', 'custom'
      ),
      'images', '[]'::jsonb,
      'colors', '[]'::jsonb,
      'sizes', '[]'::jsonb,
      'features', '[]'::jsonb,
      'perks', '[]'::jsonb
    ));

    raise exception 'Expected hidden category product creation to be blocked.';
  exception
    when SQLSTATE 'P0001' then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      if v_message not like '%Active products cannot use hidden or deleted categories.%' then
        raise exception 'Unexpected hidden category rejection: [%] %', v_sqlstate, v_message;
      end if;
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      raise exception 'Unexpected SQL error for hidden category rejection: [%] %', v_sqlstate, v_message;
  end;

  -- Complete update bundle and child replacement.
  v_update_product := jsonb_build_object(
    'category_id', v_fashion_category_id::text,
    'slug', 'product-test-update-bundle',
    'name', 'Product Test Update Bundle',
    'series', 'Fashion Test',
    'brand', 'NBG',
    'sold_by', 'NBG Fashion',
    'price', 190,
    'compare_at', 240,
    'rating', 4.2,
    'review_count', 8,
    'badge', 'New',
    'stock_status', 'In Stock & Ready to Ship',
    'description', 'Update bundle test product.',
    'overview', 'Initial bundle with colors and sizes.',
    'primary_image_url', 'laurel wrath shirt.png',
    'shipping_fee', 22,
    'shipping_fee_status', 'ready',
    'shipping_method', 'air-freight',
    'status', 'active',
    'source', 'custom',
    'subcategory_label', 'Streetwear'
  );
  v_result := public.save_product_bundle(jsonb_build_object(
    'product', v_update_product,
    'images', '[]'::jsonb,
    'colors', jsonb_build_array('Black', 'White'),
    'sizes', jsonb_build_array('S', 'M', 'L'),
    'features', jsonb_build_array('Original feature one', 'Original feature two'),
    'perks', jsonb_build_array('Original perk one', 'Original perk two')
  ));
  v_created_product_id := (v_result->'product'->>'id')::uuid;

  v_result := public.save_product_bundle(jsonb_build_object(
    'product', jsonb_build_object(
      'id', v_created_product_id::text,
      'category_id', v_fashion_category_id::text,
      'name', 'Product Test Update Bundle Revised',
      'price', 195,
      'compare_at', 250,
      'rating', 4.3,
      'review_count', 9,
      'badge', 'Top Pick',
      'stock_status', 'In Stock & Ready to Ship',
      'description', 'Revised bundle for replacement checks.',
      'overview', 'This update should replace the old child rows.',
      'primary_image_url', 'laurel wrath shirt.png',
      'shipping_fee', 24,
      'shipping_fee_status', 'ready',
      'shipping_method', 'air-freight',
      'status', 'active',
      'source', 'custom',
      'subcategory_label', 'Streetwear'
    ),
    'images', '[]'::jsonb,
    'colors', jsonb_build_array('Blue', 'Gray'),
    'sizes', jsonb_build_array('XL'),
    'features', jsonb_build_array('Updated feature one'),
    'perks', jsonb_build_array('Updated perk one')
  ));

  select count(*)
    into v_count
  from public.product_colors
  where product_id = v_created_product_id;

  if v_count <> 2 then
    raise exception 'Expected the updated product colors to be replaced, not accumulated.';
  end if;

  select coalesce(array_agg(color_name order by display_order, created_at, id), '{}'::text[])
    into v_actual
  from public.product_colors
  where product_id = v_created_product_id;

  if v_actual is distinct from array['Blue', 'Gray']::text[] then
    raise exception 'Expected the updated product colors to match the replacement payload.';
  end if;

  select count(*)
    into v_count
  from public.product_sizes
  where product_id = v_created_product_id;

  if v_count <> 1 then
    raise exception 'Expected the updated product sizes to be replaced, not accumulated.';
  end if;

  select coalesce(array_agg(size_name order by display_order, created_at, id), '{}'::text[])
    into v_actual
  from public.product_sizes
  where product_id = v_created_product_id;

  if v_actual is distinct from array['XL']::text[] then
    raise exception 'Expected the updated product sizes to match the replacement payload.';
  end if;

  select count(*)
    into v_count
  from public.product_features
  where product_id = v_created_product_id;

  if v_count <> 1 then
    raise exception 'Expected the updated product features to be replaced, not accumulated.';
  end if;

  select coalesce(array_agg(feature_text order by display_order, created_at, id), '{}'::text[])
    into v_actual
  from public.product_features
  where product_id = v_created_product_id;

  if v_actual is distinct from array['Updated feature one']::text[] then
    raise exception 'Expected the updated product features to match the replacement payload.';
  end if;

  select count(*)
    into v_count
  from public.product_perks
  where product_id = v_created_product_id;

  if v_count <> 1 then
    raise exception 'Expected the updated product perks to be replaced, not accumulated.';
  end if;

  select coalesce(array_agg(perk_text order by display_order, created_at, id), '{}'::text[])
    into v_actual
  from public.product_perks
  where product_id = v_created_product_id;

  if v_actual is distinct from array['Updated perk one']::text[] then
    raise exception 'Expected the updated product perks to match the replacement payload.';
  end if;

  -- Child visibility based on parent.
  execute 'set local role anon';
  perform set_config('request.jwt.claim.role', 'anon', true);
  perform set_config('request.jwt.claim.sub', '', true);

  select count(*)
    into v_count
  from public.product_colors
  where product_id = v_created_product_id;

  if v_count <> 2 then
    raise exception 'Expected anon to see child rows for an active product.';
  end if;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.email', 'reubenallotey434@gmail.com', true);

  v_result := public.set_product_deleted_at(v_created_product_id, now());

  if (v_result->'product'->>'deleted_at') is null then
    raise exception 'Expected the soft-delete RPC to set deleted_at.';
  end if;

  execute 'set local role anon';
  perform set_config('request.jwt.claim.role', 'anon', true);
  perform set_config('request.jwt.claim.sub', '', true);

  select count(*)
    into v_count
  from public.products
  where id = v_created_product_id;

  if v_count <> 0 then
    raise exception 'Expected deleted products to be hidden from public users.';
  end if;

  select count(*)
    into v_count
  from public.product_colors
  where product_id = v_created_product_id;

  if v_count <> 0 then
    raise exception 'Expected child rows to be hidden when the parent product is deleted.';
  end if;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.email', 'reubenallotey434@gmail.com', true);

  select count(*)
    into v_count
  from public.products
  where id = v_created_product_id;

  if v_count <> 1 then
    raise exception 'Expected admins to retain read access to deleted products.';
  end if;

  select count(*)
    into v_count
  from public.product_colors
  where product_id = v_created_product_id;

  if v_count <> 2 then
    raise exception 'Expected admins to retain read access to deleted child rows.';
  end if;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_customer_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.email', v_customer_email, true);

  begin
    perform public.set_product_deleted_at(v_created_product_id, now());
    raise exception 'Expected customers to be blocked from soft-deleting products.';
  exception
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      if v_message not like '%Only active administrators can update product visibility.%' then
        raise exception 'Unexpected customer soft-delete rejection: [%] %', v_sqlstate, v_message;
      end if;
  end;

  begin
    perform public.restore_product(v_created_product_id);
    raise exception 'Expected customers to be blocked from restoring products.';
  exception
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      if v_message not like '%Only active administrators can update product visibility.%' then
        raise exception 'Unexpected customer restore rejection: [%] %', v_sqlstate, v_message;
      end if;
  end;

  execute 'set local role anon';
  perform set_config('request.jwt.claim.role', 'anon', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.email', '', true);

  begin
    perform public.set_product_deleted_at(v_created_product_id, now());
    raise exception 'Expected anon to be blocked from soft-deleting products.';
  exception
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      if v_message not like '%permission denied%' then
        raise exception 'Unexpected anon soft-delete rejection: [%] %', v_sqlstate, v_message;
      end if;
  end;

  begin
    perform public.restore_product(v_created_product_id);
    raise exception 'Expected anon to be blocked from restoring products.';
  exception
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      if v_message not like '%permission denied%' then
        raise exception 'Unexpected anon restore rejection: [%] %', v_sqlstate, v_message;
      end if;
  end;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.email', 'reubenallotey434@gmail.com', true);

  v_result := public.restore_product(v_created_product_id);

  if (v_result->'product'->>'deleted_at') is not null then
    raise exception 'Expected the restore RPC to clear deleted_at.';
  end if;

  execute 'set local role anon';
  perform set_config('request.jwt.claim.role', 'anon', true);
  perform set_config('request.jwt.claim.sub', '', true);

  select count(*)
    into v_count
  from public.products
  where id = v_created_product_id;

  if v_count <> 1 then
    raise exception 'Expected restored products to become publicly visible again.';
  end if;

  select count(*)
    into v_count
  from public.product_colors
  where product_id = v_created_product_id;

  if v_count <> 2 then
    raise exception 'Expected restored child rows to become publicly visible again.';
  end if;

  -- Atomic rollback after an invalid child.
  begin
    perform public.save_product_bundle(jsonb_build_object(
      'product', jsonb_build_object(
        'category_id', v_electronics_category_id::text,
        'slug', 'product-test-rollback-invalid-child',
        'name', 'Product Test Rollback Invalid Child',
        'series', 'Test Series',
        'brand', 'TechPro',
        'sold_by', 'Nexus Store',
        'price', 100,
        'compare_at', 120,
        'rating', 4.0,
        'review_count', 4,
        'badge', 'New',
        'stock_status', 'In Stock & Ready to Ship',
        'description', 'Should fail because of a blank child image.',
        'overview', 'The transaction should roll back completely.',
        'primary_image_url', 'camera.jpg',
        'shipping_fee', 10,
        'shipping_fee_status', 'ready',
        'shipping_method', 'air-freight',
        'status', 'active',
        'source', 'custom'
      ),
      'images', jsonb_build_array(jsonb_build_object('image_url', '   ', 'display_order', 1)),
      'colors', '[]'::jsonb,
      'sizes', '[]'::jsonb,
      'features', '[]'::jsonb,
      'perks', '[]'::jsonb
    ));

    raise exception 'Expected the invalid child payload to be rejected.';
  exception
    when SQLSTATE 'P0001' then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      if v_message not like '%Image URLs cannot be blank.%' then
        raise exception 'Unexpected invalid child rejection: [%] %', v_sqlstate, v_message;
      end if;
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      raise exception 'Unexpected SQL error for invalid child rollback: [%] %', v_sqlstate, v_message;
  end;

  select count(*)
    into v_count
  from public.products
  where slug = 'product-test-rollback-invalid-child';

  if v_count <> 0 then
    raise exception 'Expected no product row to remain after the invalid child rollback test.';
  end if;

  -- Seed category mapping and exact seed conflict check.
  for v_seed in
    select *
    from (
      values
        ('revive-vitamin-c-serum', 'beauty-and-care'),
        ('daily-glow-face-cleanser', 'beauty-and-care'),
        ('hydrating-body-lotion', 'beauty-and-care'),
        ('study-skills-book-pack', 'books'),
        ('business-growth-books', 'books'),
        ('premium-wireless-headphones', 'electronics'),
        ('studio-sound-bluetooth-speaker', 'electronics'),
        ('ultra-hd-smart-tv', 'electronics'),
        ('compact-digital-camera', 'electronics'),
        ('ultra-slim-smartphone', 'electronics'),
        ('laurel-wrath-signature-shirt', 'fashion'),
        ('classic-unisex-tee', 'fashion'),
        ('ergonomic-office-chair', 'home-and-garden'),
        ('samsung-double-door-fridge', 'home-and-garden'),
        ('electric-kettle-pro', 'home-and-garden'),
        ('washing-machine-pro', 'home-and-garden')
    ) as seed(slug, category_slug)
  loop
    select count(*)
      into v_count
    from public.products p
    join public.categories c
      on c.id = p.category_id
    where p.slug = v_seed.slug
      and lower(c.slug) = v_seed.category_slug;

    if v_count <> 1 then
      raise exception 'Expected seed product "%" to map to category "%".', v_seed.slug, v_seed.category_slug;
    end if;
  end loop;

  select *
    into v_hidden_seed_row
  from (
    select
      p.slug,
      p.name,
      p.brand,
      p.price,
      p.compare_at,
      p.rating,
      p.review_count,
      p.badge,
      p.stock_status,
      p.shipping_fee,
      p.shipping_fee_status,
      p.shipping_method,
      p.source,
      c.slug as category_slug
    from public.products p
    join public.categories c
      on c.id = p.category_id
    where p.slug = 'premium-wireless-headphones'
  ) as seed_row;

  if not found then
    raise exception 'Expected the premium-wireless-headphones seed product to exist.';
  end if;

  if v_hidden_seed_row.name <> 'Premium Wireless Headphones'
     or v_hidden_seed_row.brand <> 'TechPro'
     or v_hidden_seed_row.price <> 260
     or v_hidden_seed_row.compare_at <> 320
     or v_hidden_seed_row.rating <> 4.8
     or v_hidden_seed_row.review_count <> 112
     or v_hidden_seed_row.badge <> 'Flash Deal'
     or v_hidden_seed_row.stock_status <> 'In Stock & Ready to Ship'
     or v_hidden_seed_row.shipping_fee <> 35
     or v_hidden_seed_row.shipping_fee_status <> 'ready'
     or v_hidden_seed_row.shipping_method <> 'air-freight'
     or v_hidden_seed_row.source <> 'seed'
     or lower(v_hidden_seed_row.slug) <> 'premium-wireless-headphones'
     or lower(cast(v_hidden_seed_row.category_slug as text)) <> 'electronics' then
    raise exception 'Expected the premium-wireless-headphones seed row to match the committed seed values.';
  end if;

  select count(*)
    into v_count
  from public.products
  where lower(slug) = any (array[
    'revive-vitamin-c-serum',
    'daily-glow-face-cleanser',
    'hydrating-body-lotion',
    'study-skills-book-pack',
    'business-growth-books',
    'premium-wireless-headphones',
    'studio-sound-bluetooth-speaker',
    'ultra-hd-smart-tv',
    'compact-digital-camera',
    'ultra-slim-smartphone',
    'laurel-wrath-signature-shirt',
    'classic-unisex-tee',
    'ergonomic-office-chair',
    'samsung-double-door-fridge',
    'electric-kettle-pro',
    'washing-machine-pro'
  ]);

  if v_count <> 16 then
    raise exception 'Expected exactly sixteen seed products.';
  end if;

  -- No orphan child rows for the temporary fixtures.
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.email', 'reubenallotey434@gmail.com', true);

exception
  when others then
    delete from public.product_perks
    where product_id in (
      select id
      from public.products
      where slug like 'product-test-%'
    );

    delete from public.product_features
    where product_id in (
      select id
      from public.products
      where slug like 'product-test-%'
    );

    delete from public.product_sizes
    where product_id in (
      select id
      from public.products
      where slug like 'product-test-%'
    );

    delete from public.product_colors
    where product_id in (
      select id
      from public.products
      where slug like 'product-test-%'
    );

    delete from public.product_images
    where product_id in (
      select id
      from public.products
      where slug like 'product-test-%'
    );

    delete from public.products
    where slug like 'product-test-%';

    delete from public.categories
    where slug = 'product-test-hidden-category';

    delete from auth.users
    where id = v_customer_id
       or email like 'products-customer-%@example.com';

    raise;
end;
$$;

commit;
