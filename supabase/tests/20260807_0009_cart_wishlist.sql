-- Cart + wishlist verification for the deployed Supabase schema.

begin;

do $$
declare
  v_admin_id uuid;
  v_user_a_id uuid := 'c4444444-4444-4444-8444-444444444444';
  v_user_b_id uuid := 'd5555555-5555-4555-8555-555555555555';
  v_user_a_email text := 'cart-wishlist-a-c44444444444444484444444444444444@example.com';
  v_user_b_email text := 'cart-wishlist-b-d55555555555455585555555555555555@example.com';
  v_user_a_profile record;
  v_user_b_profile record;
  v_cart_id uuid;
  v_wishlist_id uuid;
  v_cart_item_id uuid;
  v_wishlist_item_id uuid;
  v_cart_product_id uuid;
  v_wishlist_product_id uuid;
  v_other_product_id uuid;
  v_count integer;
  v_sqlstate text;
  v_message text;
  v_updated_at_old timestamptz := timestamptz '2000-01-01 00:00:00+00';
  v_updated_at_new timestamptz;
  v_product_was_soft_deleted boolean := false;
begin
  select id
    into v_admin_id
  from public.profiles
  where role = 'admin'
    and status = 'active'
  order by created_at asc
  limit 1;

  if v_admin_id is null then
    raise exception 'Expected an active admin profile to exist for cart and wishlist tests.';
  end if;

  delete from auth.users
  where id in (v_user_a_id, v_user_b_id)
     or email in (v_user_a_email, v_user_b_email);

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
      v_user_a_id,
      v_user_a_email,
      'trusted-fixture-password-hash',
      now(),
      jsonb_build_object('full_name', 'Cart Wishlist User A'),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      'authenticated',
      'authenticated'
    ),
    (
      v_user_b_id,
      v_user_b_email,
      'trusted-fixture-password-hash',
      now(),
      jsonb_build_object('full_name', 'Cart Wishlist User B'),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      'authenticated',
      'authenticated'
    );

  select id, email, role, status, account_type
    into v_user_a_profile
  from public.profiles
  where id = v_user_a_id;

  if not found or v_user_a_profile.role <> 'customer' or v_user_a_profile.status <> 'active' or v_user_a_profile.account_type <> 'member' then
    raise exception 'Expected signup trigger to create a customer profile for user A.';
  end if;

  select id, email, role, status, account_type
    into v_user_b_profile
  from public.profiles
  where id = v_user_b_id;

  if not found or v_user_b_profile.role <> 'customer' or v_user_b_profile.status <> 'active' or v_user_b_profile.account_type <> 'member' then
    raise exception 'Expected signup trigger to create a customer profile for user B.';
  end if;

  select id
    into v_cart_product_id
  from public.products
  where slug = 'classic-unisex-tee'
    and status = 'active'
    and deleted_at is null;

  if v_cart_product_id is null then
    raise exception 'Expected the classic-unisex-tee seed product to exist for cart tests.';
  end if;

  select id
    into v_wishlist_product_id
  from public.products
  where slug = 'premium-wireless-headphones'
    and status = 'active'
    and deleted_at is null;

  if v_wishlist_product_id is null then
    raise exception 'Expected the premium-wireless-headphones seed product to exist for wishlist tests.';
  end if;

  select id
    into v_other_product_id
  from public.products
  where slug = 'classic-unisex-tee'
    and status = 'active'
    and deleted_at is null;

  -- Table privilege matrix.
  for v_count in
    select 1
  loop
    if has_table_privilege('authenticated', 'public.carts', 'SELECT') is distinct from true
       or has_table_privilege('authenticated', 'public.carts', 'INSERT') is distinct from true
       or has_table_privilege('authenticated', 'public.carts', 'UPDATE') is distinct from true
       or has_table_privilege('authenticated', 'public.carts', 'DELETE') is distinct from true then
      raise exception 'Unexpected authenticated privilege matrix for public.carts.';
    end if;

    if has_table_privilege('anon', 'public.carts', 'SELECT') is distinct from false
       or has_table_privilege('anon', 'public.carts', 'INSERT') is distinct from false
       or has_table_privilege('anon', 'public.carts', 'UPDATE') is distinct from false
       or has_table_privilege('anon', 'public.carts', 'DELETE') is distinct from false then
      raise exception 'Unexpected anon privilege matrix for public.carts.';
    end if;

    if has_table_privilege('authenticated', 'public.cart_items', 'SELECT') is distinct from true
       or has_table_privilege('authenticated', 'public.cart_items', 'INSERT') is distinct from true
       or has_table_privilege('authenticated', 'public.cart_items', 'UPDATE') is distinct from true
       or has_table_privilege('authenticated', 'public.cart_items', 'DELETE') is distinct from true then
      raise exception 'Unexpected authenticated privilege matrix for public.cart_items.';
    end if;

    if has_table_privilege('anon', 'public.cart_items', 'SELECT') is distinct from false
       or has_table_privilege('anon', 'public.cart_items', 'INSERT') is distinct from false
       or has_table_privilege('anon', 'public.cart_items', 'UPDATE') is distinct from false
       or has_table_privilege('anon', 'public.cart_items', 'DELETE') is distinct from false then
      raise exception 'Unexpected anon privilege matrix for public.cart_items.';
    end if;

    if has_table_privilege('authenticated', 'public.wishlists', 'SELECT') is distinct from true
       or has_table_privilege('authenticated', 'public.wishlists', 'INSERT') is distinct from true
       or has_table_privilege('authenticated', 'public.wishlists', 'UPDATE') is distinct from true
       or has_table_privilege('authenticated', 'public.wishlists', 'DELETE') is distinct from true then
      raise exception 'Unexpected authenticated privilege matrix for public.wishlists.';
    end if;

    if has_table_privilege('anon', 'public.wishlists', 'SELECT') is distinct from false
       or has_table_privilege('anon', 'public.wishlists', 'INSERT') is distinct from false
       or has_table_privilege('anon', 'public.wishlists', 'UPDATE') is distinct from false
       or has_table_privilege('anon', 'public.wishlists', 'DELETE') is distinct from false then
      raise exception 'Unexpected anon privilege matrix for public.wishlists.';
    end if;

    if has_table_privilege('authenticated', 'public.wishlist_items', 'SELECT') is distinct from true
       or has_table_privilege('authenticated', 'public.wishlist_items', 'INSERT') is distinct from true
       or has_table_privilege('authenticated', 'public.wishlist_items', 'UPDATE') is distinct from true
       or has_table_privilege('authenticated', 'public.wishlist_items', 'DELETE') is distinct from true then
      raise exception 'Unexpected authenticated privilege matrix for public.wishlist_items.';
    end if;

    if has_table_privilege('anon', 'public.wishlist_items', 'SELECT') is distinct from false
       or has_table_privilege('anon', 'public.wishlist_items', 'INSERT') is distinct from false
       or has_table_privilege('anon', 'public.wishlist_items', 'UPDATE') is distinct from false
       or has_table_privilege('anon', 'public.wishlist_items', 'DELETE') is distinct from false then
      raise exception 'Unexpected anon privilege matrix for public.wishlist_items.';
    end if;
  end loop;

  -- Create and verify cart rows as user A.
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_user_a_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.email', v_user_a_email, true);

  insert into public.carts (
    user_id,
    created_at,
    updated_at
  )
  values (
    v_user_a_id,
    v_updated_at_old,
    v_updated_at_old
  )
  returning id into v_cart_id;

  if v_cart_id is null then
    raise exception 'Expected the cart row to be created for user A.';
  end if;

  insert into public.cart_items (
    cart_id,
    product_id,
    quantity,
    selected_color,
    selected_size,
    created_at,
    updated_at
  ) values (
    v_cart_id,
    v_cart_product_id,
    1,
    'Black',
    'M',
    v_updated_at_old,
    v_updated_at_old
  )
  returning id into v_cart_item_id;

  if v_cart_item_id is null then
    raise exception 'Expected the cart item to be created for user A.';
  end if;

  select count(*)
    into v_count
  from public.carts
  where user_id = v_user_a_id;

  if v_count <> 1 then
    raise exception 'Expected user A to see exactly one own cart row.';
  end if;

  select count(*)
    into v_count
  from public.cart_items
  where cart_id = v_cart_id;

  if v_count <> 1 then
    raise exception 'Expected user A to see exactly one own cart line.';
  end if;

  update public.carts
    set user_id = v_user_a_id
  where id = v_cart_id;

  select updated_at
    into v_updated_at_new
  from public.carts
  where id = v_cart_id;

  if v_updated_at_new <= v_updated_at_old then
    raise exception 'Expected cart updated_at to advance after a real update.';
  end if;

  update public.cart_items
    set quantity = 2
  where id = v_cart_item_id;

  select updated_at
    into v_updated_at_new
  from public.cart_items
  where id = v_cart_item_id;

  if v_updated_at_new <= v_updated_at_old then
    raise exception 'Expected cart item updated_at to advance after a real update.';
  end if;

  begin
    insert into public.cart_items (
      cart_id,
      product_id,
      quantity,
      selected_color,
      selected_size
    ) values (
      v_cart_id,
      v_cart_product_id,
      1,
      'Black',
      'M'
    );
    raise exception 'Expected duplicate cart line insertion to fail.';
  exception
    when SQLSTATE '23505' then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      if v_message not like '%cart_items_one_line_per_variant_idx%' then
        raise exception 'Unexpected cart duplicate-line rejection: [%] %', v_sqlstate, v_message;
      end if;
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      raise exception 'Unexpected SQL error for duplicate cart line rejection: [%] %', v_sqlstate, v_message;
  end;

  -- Create and verify wishlist rows as user A.
  insert into public.wishlists (
    user_id,
    created_at,
    updated_at
  )
  values (
    v_user_a_id,
    v_updated_at_old,
    v_updated_at_old
  )
  returning id into v_wishlist_id;

  if v_wishlist_id is null then
    raise exception 'Expected the wishlist row to be created for user A.';
  end if;

  insert into public.wishlist_items (
    wishlist_id,
    product_id,
    created_at
  ) values (
    v_wishlist_id,
    v_wishlist_product_id,
    v_updated_at_old
  )
  returning id into v_wishlist_item_id;

  if v_wishlist_item_id is null then
    raise exception 'Expected the wishlist item to be created for user A.';
  end if;

  select count(*)
    into v_count
  from public.wishlists
  where user_id = v_user_a_id;

  if v_count <> 1 then
    raise exception 'Expected user A to see exactly one own wishlist row.';
  end if;

  select count(*)
    into v_count
  from public.wishlist_items
  where wishlist_id = v_wishlist_id;

  if v_count <> 1 then
    raise exception 'Expected user A to see exactly one own wishlist item.';
  end if;

  begin
    insert into public.wishlist_items (
      wishlist_id,
      product_id
    ) values (
      v_wishlist_id,
      v_wishlist_product_id
    );
    raise exception 'Expected duplicate wishlist item insertion to fail.';
  exception
    when SQLSTATE '23505' then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      if v_message not like '%wishlist_items_one_product_per_wishlist_idx%' then
        raise exception 'Unexpected wishlist duplicate-line rejection: [%] %', v_sqlstate, v_message;
      end if;
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      raise exception 'Unexpected SQL error for duplicate wishlist item rejection: [%] %', v_sqlstate, v_message;
  end;

  update public.wishlists
    set user_id = v_user_a_id
  where id = v_wishlist_id;

  select updated_at
    into v_updated_at_new
  from public.wishlists
  where id = v_wishlist_id;

  if v_updated_at_new <= v_updated_at_old then
    raise exception 'Expected wishlist updated_at to advance after a real update.';
  end if;

  -- Cross-user blocking while impersonating user B.
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_user_b_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.email', v_user_b_email, true);

  select count(*)
    into v_count
  from public.carts
  where user_id = v_user_a_id;

  if v_count <> 0 then
    raise exception 'Expected user B to be blocked from reading user A cart rows.';
  end if;

  select count(*)
    into v_count
  from public.cart_items
  where cart_id = v_cart_id;

  if v_count <> 0 then
    raise exception 'Expected user B to be blocked from reading user A cart items.';
  end if;

  select count(*)
    into v_count
  from public.wishlists
  where user_id = v_user_a_id;

  if v_count <> 0 then
    raise exception 'Expected user B to be blocked from reading user A wishlist rows.';
  end if;

  select count(*)
    into v_count
  from public.wishlist_items
  where wishlist_id = v_wishlist_id;

  if v_count <> 0 then
    raise exception 'Expected user B to be blocked from reading user A wishlist items.';
  end if;

  begin
    update public.carts
      set user_id = v_user_b_id
    where id = v_cart_id;

    get diagnostics v_count = row_count;

    if v_count <> 0 then
      raise exception 'Expected user B to be blocked from updating user A cart rows.';
    end if;
  exception
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      if v_message not like '%row-level security policy%' and v_message not like '%permission denied%' then
        raise exception 'Unexpected cart update rejection for user B: [%] %', v_sqlstate, v_message;
      end if;
  end;

  begin
    delete from public.cart_items
    where id = v_cart_item_id;

    get diagnostics v_count = row_count;

    if v_count <> 0 then
      raise exception 'Expected user B to be blocked from deleting user A cart rows.';
    end if;
  exception
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      if v_message not like '%row-level security policy%' and v_message not like '%permission denied%' then
        raise exception 'Unexpected cart delete rejection for user B: [%] %', v_sqlstate, v_message;
      end if;
  end;

  begin
    insert into public.wishlist_items (
      wishlist_id,
      product_id
    ) values (
      v_wishlist_id,
      v_wishlist_product_id
    );

    get diagnostics v_count = row_count;

    if v_count <> 0 then
      raise exception 'Expected user B to be blocked from inserting into user A wishlist rows.';
    end if;
  exception
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      if v_message not like '%row-level security policy%' and v_message not like '%permission denied%' and v_sqlstate <> '23505' then
        raise exception 'Unexpected wishlist insert rejection for user B: [%] %', v_sqlstate, v_message;
      end if;
  end;

  -- Product deletion behavior: soft-delete the product while it is referenced.
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.email', 'reubenallotey434@gmail.com', true);

  perform public.set_product_deleted_at(v_cart_product_id, now());
  v_product_was_soft_deleted := true;

  execute 'set local role anon';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'anon', true);
  perform set_config('request.jwt.claim.email', '', true);

  select count(*)
    into v_count
  from public.products
  where id = v_cart_product_id;

  if v_count <> 0 then
    raise exception 'Expected soft-deleted products to be hidden from public reads.';
  end if;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_user_a_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.email', v_user_a_email, true);

  select count(*)
    into v_count
  from public.cart_items
  where cart_id = v_cart_id
    and product_id = v_cart_product_id;

  if v_count <> 1 then
    raise exception 'Expected user A cart rows to remain addressable after product soft-delete.';
  end if;

  select count(*)
    into v_count
  from public.wishlist_items
  where wishlist_id = v_wishlist_id
    and product_id = v_wishlist_product_id;

  if v_count <> 1 then
    raise exception 'Expected user A wishlist rows to remain addressable after product soft-delete.';
  end if;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.email', 'reubenallotey434@gmail.com', true);

  perform public.restore_product(v_cart_product_id);

  execute 'set local role anon';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'anon', true);
  perform set_config('request.jwt.claim.email', '', true);

  select count(*)
    into v_count
  from public.products
  where id = v_cart_product_id;

  if v_count <> 1 then
    raise exception 'Expected restored products to be visible to public reads again.';
  end if;

  -- Verify the remaining seeded product counts were not disturbed.
  select count(*) into v_count from public.products;
  if v_count <> 16 then
    raise exception 'Expected the seeded product count to remain 16.';
  end if;

  select count(*) into v_count from public.product_images;
  if v_count <> 0 then
    raise exception 'Expected the seeded product_images count to remain 0.';
  end if;

  select count(*) into v_count from public.product_colors;
  if v_count <> 18 then
    raise exception 'Expected the seeded product_colors count to remain 18.';
  end if;

  select count(*) into v_count from public.product_sizes;
  if v_count <> 9 then
    raise exception 'Expected the seeded product_sizes count to remain 9.';
  end if;

  select count(*) into v_count from public.product_features;
  if v_count <> 35 then
    raise exception 'Expected the seeded product_features count to remain 35.';
  end if;

  select count(*) into v_count from public.product_perks;
  if v_count <> 32 then
    raise exception 'Expected the seeded product_perks count to remain 32.';
  end if;

  -- Return to the trusted default session role before cleanup.
  execute 'set local role postgres';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claim.email', '', true);

  delete from auth.users
  where id in (v_user_a_id, v_user_b_id)
     or email in (v_user_a_email, v_user_b_email);

exception
  when others then
    execute 'set local role postgres';
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claim.role', '', true);
    perform set_config('request.jwt.claim.email', '', true);

    if v_product_was_soft_deleted then
      execute 'set local role authenticated';
      perform set_config('request.jwt.claim.sub', v_admin_id::text, true);
      perform set_config('request.jwt.claim.role', 'authenticated', true);
      perform set_config('request.jwt.claim.email', 'reubenallotey434@gmail.com', true);

      begin
        perform public.restore_product(v_cart_product_id);
      exception
        when others then
          null;
      end;

      execute 'set local role postgres';
      perform set_config('request.jwt.claim.sub', '', true);
      perform set_config('request.jwt.claim.role', '', true);
      perform set_config('request.jwt.claim.email', '', true);
    end if;

    delete from public.cart_items
    where id = v_cart_item_id
       or cart_id = v_cart_id;

    delete from public.cart_items
    where cart_id in (
      select id from public.carts where user_id in (v_user_a_id, v_user_b_id)
    );

    delete from public.wishlist_items
    where id = v_wishlist_item_id
       or wishlist_id = v_wishlist_id;

    delete from public.wishlist_items
    where wishlist_id in (
      select id from public.wishlists where user_id in (v_user_a_id, v_user_b_id)
    );

    delete from public.carts
    where id = v_cart_id
       or user_id in (v_user_a_id, v_user_b_id);

    delete from public.wishlists
    where id = v_wishlist_id
       or user_id in (v_user_a_id, v_user_b_id);

    delete from auth.users
    where id in (v_user_a_id, v_user_b_id)
       or email in (v_user_a_email, v_user_b_email);

    raise;
end;
$$;

commit;
