-- Normal remote verification harness for the categories migration.
-- This file avoids ALTER TABLE ... DISABLE TRIGGER and any table-owner-only operations.
-- Owner-only hierarchy stress tests live in 20260806_0003_categories_owner.sql.

do $$
declare
  v_admin_id uuid;
  v_customer_sub uuid := gen_random_uuid();

  v_visible_category_id uuid;
  v_self_parent_id uuid;
  v_cycle_parent_id uuid;
  v_cycle_child_id uuid;
  v_hidden_parent_id uuid;
  v_deleted_parent_id uuid;
  v_parent_with_child_id uuid;
  v_visible_child_id uuid;
  v_admin_crud_id uuid;

  v_seed_row public.categories%rowtype;
  v_fixture_category_ids uuid[] := '{}'::uuid[];

  v_count integer;
  v_sqlstate text;
  v_message text;
  v_blocked boolean;
  v_old_updated_at timestamptz := timestamptz '2000-01-01 00:00:00+00';
  v_new_updated_at timestamptz;
  v_expected_slug text;
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

  select count(*) into v_count
  from pg_policies
  where schemaname = 'public'
    and tablename = 'categories'
    and policyname in (
      'categories_select_public',
      'categories_select_admin',
      'categories_insert_admin',
      'categories_update_admin'
    );

  if v_count <> 4 then
    raise exception 'Expected all four category policies to exist.';
  end if;

  if not has_table_privilege('anon', 'public.categories', 'SELECT')
     or has_table_privilege('anon', 'public.categories', 'INSERT')
     or has_table_privilege('anon', 'public.categories', 'UPDATE')
     or has_table_privilege('anon', 'public.categories', 'DELETE')
     or has_table_privilege('anon', 'public.categories', 'TRUNCATE')
     or has_table_privilege('anon', 'public.categories', 'REFERENCES')
     or has_table_privilege('anon', 'public.categories', 'TRIGGER') then
    raise exception 'Unexpected anon privilege matrix on public.categories.';
  end if;

  if not has_table_privilege('authenticated', 'public.categories', 'SELECT')
     or not has_table_privilege('authenticated', 'public.categories', 'INSERT')
     or not has_table_privilege('authenticated', 'public.categories', 'UPDATE')
     or has_table_privilege('authenticated', 'public.categories', 'DELETE')
     or has_table_privilege('authenticated', 'public.categories', 'TRUNCATE')
     or has_table_privilege('authenticated', 'public.categories', 'REFERENCES')
     or has_table_privilege('authenticated', 'public.categories', 'TRIGGER') then
    raise exception 'Unexpected authenticated privilege matrix on public.categories.';
  end if;

  if has_function_privilege('anon', 'private.normalize_categories_write()', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.normalize_categories_write()', 'EXECUTE')
     or has_function_privilege('anon', 'private.set_updated_at()', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.set_updated_at()', 'EXECUTE') then
    raise exception 'Expected private category helpers to be non-executable by anon and authenticated.';
  end if;

  select count(*) into v_count
  from public.categories
  where lower(slug) in ('beauty-and-care', 'books', 'electronics', 'fashion', 'home-and-garden');

  if v_count <> 5 then
    raise exception 'Expected exactly five storefront seed categories.';
  end if;

  for v_expected_slug in
    select unnest(array['beauty-and-care', 'books', 'electronics', 'fashion', 'home-and-garden'])
  loop
    select *
      into v_seed_row
    from public.categories
    where lower(slug) = lower(v_expected_slug);

    if not found then
      raise exception 'Expected seed category "%" to exist exactly once.', v_expected_slug;
    end if;

    if v_expected_slug = 'beauty-and-care' then
      if v_seed_row.name is distinct from 'Beauty and Care'
         or v_seed_row.slug is distinct from 'beauty-and-care'
         or v_seed_row.icon is distinct from 'beauty'
         or v_seed_row.description is distinct from 'Skincare, beauty, and self-care essentials.'
         or v_seed_row.status is distinct from 'active'
         or v_seed_row.parent_id is not null
         or v_seed_row.display_order is distinct from 1
         or v_seed_row.show_on_homepage is distinct from true
         or v_seed_row.deleted_at is not null then
        raise exception 'Seed category beauty-and-care does not match expected values.';
      end if;
    elsif v_expected_slug = 'books' then
      if v_seed_row.name is distinct from 'Books'
         or v_seed_row.slug is distinct from 'books'
         or v_seed_row.icon is distinct from 'books'
         or v_seed_row.description is distinct from 'Reading picks, study guides, and inspiration.'
         or v_seed_row.status is distinct from 'active'
         or v_seed_row.parent_id is not null
         or v_seed_row.display_order is distinct from 2
         or v_seed_row.show_on_homepage is distinct from true
         or v_seed_row.deleted_at is not null then
        raise exception 'Seed category books does not match expected values.';
      end if;
    elsif v_expected_slug = 'electronics' then
      if v_seed_row.name is distinct from 'Electronics'
         or v_seed_row.slug is distinct from 'electronics'
         or v_seed_row.icon is distinct from 'electronics'
         or v_seed_row.description is distinct from 'Devices, accessories, and everyday tech.'
         or v_seed_row.status is distinct from 'active'
         or v_seed_row.parent_id is not null
         or v_seed_row.display_order is distinct from 3
         or v_seed_row.show_on_homepage is distinct from true
         or v_seed_row.deleted_at is not null then
        raise exception 'Seed category electronics does not match expected values.';
      end if;
    elsif v_expected_slug = 'fashion' then
      if v_seed_row.name is distinct from 'Fashion'
         or v_seed_row.slug is distinct from 'fashion'
         or v_seed_row.icon is distinct from 'fashion'
         or v_seed_row.description is distinct from 'Wardrobe staples, accessories, and style picks.'
         or v_seed_row.status is distinct from 'active'
         or v_seed_row.parent_id is not null
         or v_seed_row.display_order is distinct from 4
         or v_seed_row.show_on_homepage is distinct from true
         or v_seed_row.deleted_at is not null then
        raise exception 'Seed category fashion does not match expected values.';
      end if;
    elsif v_expected_slug = 'home-and-garden' then
      if v_seed_row.name is distinct from 'Home and Garden'
         or v_seed_row.slug is distinct from 'home-and-garden'
         or v_seed_row.icon is distinct from 'home'
         or v_seed_row.description is distinct from 'Living, organization, and outdoor essentials.'
         or v_seed_row.status is distinct from 'active'
         or v_seed_row.parent_id is not null
         or v_seed_row.display_order is distinct from 5
         or v_seed_row.show_on_homepage is distinct from true
         or v_seed_row.deleted_at is not null then
        raise exception 'Seed category home-and-garden does not match expected values.';
      end if;
    end if;
  end loop;

  execute 'set local role anon';
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000000', true);
  perform set_config('request.jwt.claim.role', 'anon', true);

  select count(*)
    into v_count
  from public.categories
  where status = 'active'
    and deleted_at is null;

  if v_count <> 5 then
    raise exception 'Expected public users to see only the five active undeleted seed categories.';
  end if;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_customer_sub::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  v_blocked := false;
  begin
    insert into public.categories (
      name,
      slug,
      description,
      icon,
      status,
      display_order,
      show_on_homepage
    ) values (
      'Customer Write Block',
      'customer-write-block',
      'Customers must not be able to write categories.',
      'beauty',
      'active',
      30,
      false
    );

    raise exception 'Expected customer category insert to be blocked.';
  exception
    when SQLSTATE '42501' then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      if v_message ilike '%row-level security policy%' or v_message ilike '%permission denied%' then
        v_blocked := true;
      else
        raise exception 'Unexpected rejection for customer insert: [%] %', v_sqlstate, v_message;
      end if;
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      raise exception 'Unexpected SQL error for customer insert: [%] %', v_sqlstate, v_message;
  end;

  if not v_blocked then
    raise exception 'Expected customer category insert to be blocked.';
  end if;

  v_blocked := false;
  begin
    update public.categories
    set display_order = 99
    where lower(slug) = 'beauty-and-care';

    get diagnostics v_count = row_count;
    if v_count = 0 then
      v_blocked := true;
    else
      raise exception 'Expected customer category update to affect zero rows.';
    end if;
  exception
    when SQLSTATE '42501' then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      if v_message ilike '%row-level security policy%' or v_message ilike '%permission denied%' then
        v_blocked := true;
      else
        raise exception 'Unexpected rejection for customer update: [%] %', v_sqlstate, v_message;
      end if;
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      raise exception 'Unexpected SQL error for customer update: [%] %', v_sqlstate, v_message;
  end;

  if not v_blocked then
    raise exception 'Expected customer category update to be blocked.';
  end if;

  v_blocked := false;
  begin
    delete from public.categories
    where lower(slug) = 'beauty-and-care';

    get diagnostics v_count = row_count;
    if v_count = 0 then
      v_blocked := true;
    else
      raise exception 'Expected customer category delete to affect zero rows.';
    end if;
  exception
    when SQLSTATE '42501' then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      if v_message ilike '%permission denied%' or v_message ilike '%row-level security policy%' then
        v_blocked := true;
      else
        raise exception 'Unexpected rejection for customer delete: [%] %', v_sqlstate, v_message;
      end if;
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      raise exception 'Unexpected SQL error for customer delete: [%] %', v_sqlstate, v_message;
  end;

  if not v_blocked then
    raise exception 'Expected customer category delete to be blocked.';
  end if;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  insert into public.categories (
    name,
    slug,
    description,
    icon,
    status,
    display_order,
    show_on_homepage,
    created_at,
    updated_at
  ) values (
    'Visible Category',
    'visible-category',
    'Used for admin manage checks.',
    'fashion',
    'active',
    31,
    false,
    v_old_updated_at,
    v_old_updated_at
  )
  returning id into v_visible_category_id;
  v_fixture_category_ids := array_append(v_fixture_category_ids, v_visible_category_id);

  select updated_at
    into v_new_updated_at
  from public.categories
  where id = v_visible_category_id;

  if v_new_updated_at is distinct from v_old_updated_at then
    raise exception 'Expected inserted admin fixture to preserve the explicit old updated_at timestamp.';
  end if;

  update public.categories
  set description = 'Updated by admin'
  where id = v_visible_category_id;

  select updated_at
    into v_new_updated_at
  from public.categories
  where id = v_visible_category_id;

  if v_new_updated_at <= v_old_updated_at then
    raise exception 'Expected updated_at to advance when the category is updated.';
  end if;

  update public.categories
  set deleted_at = now(),
      status = 'hidden'
  where id = v_visible_category_id;

  select deleted_at
    into v_new_updated_at
  from public.categories
  where id = v_visible_category_id;

  if v_new_updated_at is null then
    raise exception 'Expected the category to be soft-deleted.';
  end if;

  update public.categories
  set deleted_at = null,
      status = 'active'
  where id = v_visible_category_id;

  select deleted_at
    into v_new_updated_at
  from public.categories
  where id = v_visible_category_id;

  if v_new_updated_at is not null then
    raise exception 'Expected the category to be restored.';
  end if;

  v_blocked := false;
  begin
    delete from public.categories
    where id = v_visible_category_id;

    raise exception 'Expected admin hard delete to be blocked.';
  exception
    when SQLSTATE '42501' then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      if v_message ilike '%permission denied%' or v_message ilike '%row-level security policy%' then
        v_blocked := true;
      else
        raise exception 'Unexpected rejection for admin delete: [%] %', v_sqlstate, v_message;
      end if;
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      raise exception 'Unexpected SQL error for admin delete: [%] %', v_sqlstate, v_message;
  end;

  if not v_blocked then
    raise exception 'Expected admin hard delete to be blocked.';
  end if;

  insert into public.categories (
    name,
    slug,
    description,
    icon,
    status,
    display_order,
    show_on_homepage
  ) values (
    'Uppercase Slug',
    '  MIXED Value!!  ',
    'Checks lowercase normalization.',
    'electronics',
    'active',
    10,
    true
  )
  returning id into v_self_parent_id;
  v_fixture_category_ids := array_append(v_fixture_category_ids, v_self_parent_id);

  select slug
    into v_message
  from public.categories
  where id = v_self_parent_id;

  if v_message <> 'mixed-value' then
    raise exception 'Expected category slug normalization to produce mixed-value, got %.', v_message;
  end if;

  v_blocked := false;
  begin
    insert into public.categories (
      name,
      slug,
      description,
      icon,
      status,
      display_order,
      show_on_homepage
    ) values (
      '!!!',
      '!!!',
      'This slug should be rejected.',
      'fashion',
      'active',
      11,
      false
    );

    raise exception 'Expected empty normalized slug insertion to be blocked.';
  exception
    when SQLSTATE 'P0001' then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      if v_message like '%Category slug cannot be empty after normalization.%' then
        v_blocked := true;
      else
        raise exception 'Unexpected rejection for empty slug: [%] %', v_sqlstate, v_message;
      end if;
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      raise exception 'Unexpected SQL error for empty slug: [%] %', v_sqlstate, v_message;
  end;

  if not v_blocked then
    raise exception 'Expected empty normalized slug insertion to be blocked.';
  end if;

  v_blocked := false;
  begin
    insert into public.categories (
      name,
      slug,
      description,
      icon,
      status,
      display_order,
      show_on_homepage
    ) values (
      'Duplicate Slug',
      'MIXED VALUE',
      'This should collide with the normalized slug.',
      'books',
      'active',
      12,
      false
    );

    raise exception 'Expected duplicate normalized slug insertion to be blocked.';
  exception
    when SQLSTATE '23505' then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      if v_message like '%categories_slug_normalized_unique_idx%' then
        v_blocked := true;
      else
        raise exception 'Unexpected unique violation for duplicate slug: [%] %', v_sqlstate, v_message;
      end if;
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      raise exception 'Unexpected SQL error for duplicate slug: [%] %', v_sqlstate, v_message;
  end;

  if not v_blocked then
    raise exception 'Expected duplicate normalized slug insertion to be blocked.';
  end if;

  insert into public.categories (
    name,
    slug,
    description,
    icon,
    status,
    display_order,
    show_on_homepage
  ) values (
    'Self Parent',
    'self-parent',
    'Used to verify self-parent rejection.',
    'home',
    'active',
    13,
    false
  )
  returning id into v_self_parent_id;
  v_fixture_category_ids := array_append(v_fixture_category_ids, v_self_parent_id);

  v_blocked := false;
  begin
    update public.categories
    set parent_id = v_self_parent_id
    where id = v_self_parent_id;

    raise exception 'Expected self-parent update to be blocked.';
  exception
    when SQLSTATE 'P0001' then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      if v_message like '%A category cannot be its own parent.%' then
        v_blocked := true;
      else
        raise exception 'Unexpected rejection for self-parent update: [%] %', v_sqlstate, v_message;
      end if;
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      raise exception 'Unexpected SQL error for self-parent update: [%] %', v_sqlstate, v_message;
  end;

  if not v_blocked then
    raise exception 'Expected self-parent update to be blocked.';
  end if;

  insert into public.categories (
    name,
    slug,
    description,
    icon,
    status,
    display_order,
    show_on_homepage
  ) values (
    'Cycle Parent',
    'cycle-parent',
    'Used to verify indirect cycle rejection.',
    'electronics',
    'active',
    14,
    false
  )
  returning id into v_cycle_parent_id;
  v_fixture_category_ids := array_append(v_fixture_category_ids, v_cycle_parent_id);

  insert into public.categories (
    name,
    slug,
    description,
    icon,
    status,
    parent_id,
    display_order,
    show_on_homepage
  ) values (
    'Cycle Child',
    'cycle-child',
    'Used to verify indirect cycle rejection.',
    'electronics',
    'active',
    v_cycle_parent_id,
    15,
    false
  )
  returning id into v_cycle_child_id;
  v_fixture_category_ids := array_append(v_fixture_category_ids, v_cycle_child_id);

  v_blocked := false;
  begin
    update public.categories
    set parent_id = v_cycle_child_id
    where id = v_cycle_parent_id;

    raise exception 'Expected indirect cycle update to be blocked.';
  exception
    when SQLSTATE 'P0001' then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      if v_message like '%Circular category relationships are not allowed.%' then
        v_blocked := true;
      else
        raise exception 'Unexpected rejection for indirect cycle update: [%] %', v_sqlstate, v_message;
      end if;
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      raise exception 'Unexpected SQL error for indirect cycle update: [%] %', v_sqlstate, v_message;
  end;

  if not v_blocked then
    raise exception 'Expected indirect cycle update to be blocked.';
  end if;

  insert into public.categories (
    name,
    slug,
    description,
    icon,
    status,
    display_order,
    show_on_homepage
  ) values (
    'Hidden Parent',
    'hidden-parent',
    'Used to verify hidden parent rejection.',
    'fashion',
    'hidden',
    16,
    false
  )
  returning id into v_hidden_parent_id;
  v_fixture_category_ids := array_append(v_fixture_category_ids, v_hidden_parent_id);

  v_blocked := false;
  begin
    insert into public.categories (
      name,
      slug,
      description,
      icon,
      status,
      parent_id,
      display_order,
      show_on_homepage
    ) values (
      'Hidden Parent Child',
      'hidden-parent-child',
      'This active child should be rejected.',
      'fashion',
      'active',
      v_hidden_parent_id,
      17,
      false
    );

    raise exception 'Expected active child under hidden parent to be blocked.';
  exception
    when SQLSTATE 'P0001' then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      if v_message like '%Active categories cannot use hidden parents.%' then
        v_blocked := true;
      else
        raise exception 'Unexpected rejection for hidden parent child: [%] %', v_sqlstate, v_message;
      end if;
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      raise exception 'Unexpected SQL error for hidden parent child: [%] %', v_sqlstate, v_message;
  end;

  if not v_blocked then
    raise exception 'Expected active child under hidden parent to be blocked.';
  end if;

  insert into public.categories (
    name,
    slug,
    description,
    icon,
    status,
    display_order,
    show_on_homepage
  ) values (
    'Delete Parent',
    'delete-parent',
    'Used to verify deleted parent rejection.',
    'books',
    'active',
    18,
    false
  )
  returning id into v_deleted_parent_id;
  v_fixture_category_ids := array_append(v_fixture_category_ids, v_deleted_parent_id);

  update public.categories
  set deleted_at = timestamptz '2000-01-01 00:00:00+00',
      status = 'hidden'
  where id = v_deleted_parent_id;

  v_blocked := false;
  begin
    insert into public.categories (
      name,
      slug,
      description,
      icon,
      status,
      parent_id,
      display_order,
      show_on_homepage
    ) values (
      'Deleted Parent Child',
      'deleted-parent-child',
      'This child should be rejected.',
      'books',
      'active',
      v_deleted_parent_id,
      19,
      false
    );

    raise exception 'Expected deleted parent to be blocked.';
  exception
    when SQLSTATE 'P0001' then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      if v_message like '%Deleted categories cannot be used as parents.%' then
        v_blocked := true;
      else
        raise exception 'Unexpected rejection for deleted parent child: [%] %', v_sqlstate, v_message;
      end if;
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      raise exception 'Unexpected SQL error for deleted parent child: [%] %', v_sqlstate, v_message;
  end;

  if not v_blocked then
    raise exception 'Expected deleted parent to be blocked.';
  end if;

  insert into public.categories (
    name,
    slug,
    description,
    icon,
    status,
    display_order,
    show_on_homepage
  ) values (
    'Parent With Child',
    'parent-with-child',
    'Used to verify parent visibility protection.',
    'home',
    'active',
    20,
    false
  )
  returning id into v_parent_with_child_id;
  v_fixture_category_ids := array_append(v_fixture_category_ids, v_parent_with_child_id);

  insert into public.categories (
    name,
    slug,
    description,
    icon,
    status,
    parent_id,
    display_order,
    show_on_homepage
  ) values (
    'Visible Child',
    'visible-child',
    'Used to verify visible child protection.',
    'home',
    'active',
    v_parent_with_child_id,
    21,
    false
  )
  returning id into v_visible_child_id;
  v_fixture_category_ids := array_append(v_fixture_category_ids, v_visible_child_id);

  v_blocked := false;
  begin
    update public.categories
    set status = 'hidden'
    where id = v_parent_with_child_id;

    raise exception 'Expected parent hide with visible children to be blocked.';
  exception
    when SQLSTATE 'P0001' then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      if v_message like '%Move, hide, or delete child categories before hiding or deleting this category.%' then
        v_blocked := true;
      else
        raise exception 'Unexpected rejection for hidden parent with visible child: [%] %', v_sqlstate, v_message;
      end if;
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      raise exception 'Unexpected SQL error for hidden parent with visible child: [%] %', v_sqlstate, v_message;
  end;

  if not v_blocked then
    raise exception 'Expected parent hide with visible children to be blocked.';
  end if;

  v_blocked := false;
  begin
    update public.categories
    set deleted_at = now(),
        status = 'hidden'
    where id = v_parent_with_child_id;

    raise exception 'Expected parent delete with visible children to be blocked.';
  exception
    when SQLSTATE 'P0001' then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      if v_message like '%Move, hide, or delete child categories before hiding or deleting this category.%' then
        v_blocked := true;
      else
        raise exception 'Unexpected rejection for deleted parent with visible child: [%] %', v_sqlstate, v_message;
      end if;
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      raise exception 'Unexpected SQL error for deleted parent with visible child: [%] %', v_sqlstate, v_message;
  end;

  if not v_blocked then
    raise exception 'Expected parent delete with visible children to be blocked.';
  end if;

  execute 'set local role anon';
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000000', true);
  perform set_config('request.jwt.claim.role', 'anon', true);

  select count(*)
    into v_count
  from public.categories
  where lower(slug) in (lower('hidden-parent'), lower('delete-parent'))
    and status = 'active'
    and deleted_at is null;

  if v_count <> 0 then
    raise exception 'Expected hidden or deleted category slugs to stay hidden from storefront lookup.';
  end if;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  insert into public.categories (
    name,
    slug,
    description,
    icon,
    status,
    display_order,
    show_on_homepage,
    created_at,
    updated_at
  ) values (
    'Admin CRUD',
    'admin-crud',
    'Used to verify admin create, update, hide, and restore.',
    'books',
    'active',
    40,
    false,
    v_old_updated_at,
    v_old_updated_at
  )
  returning id into v_admin_crud_id;
  v_fixture_category_ids := array_append(v_fixture_category_ids, v_admin_crud_id);

  update public.categories
  set description = 'Updated by admin'
  where id = v_admin_crud_id;

  select updated_at
    into v_new_updated_at
  from public.categories
  where id = v_admin_crud_id;

  if v_new_updated_at <= v_old_updated_at then
    raise exception 'Expected updated_at to advance when the category is updated.';
  end if;

  update public.categories
  set deleted_at = now(),
      status = 'hidden'
  where id = v_admin_crud_id;

  select deleted_at
    into v_new_updated_at
  from public.categories
  where id = v_admin_crud_id;

  if v_new_updated_at is null then
    raise exception 'Expected the category to be soft-deleted.';
  end if;

  update public.categories
  set deleted_at = null,
      status = 'active'
  where id = v_admin_crud_id;

  select deleted_at
    into v_new_updated_at
  from public.categories
  where id = v_admin_crud_id;

  if v_new_updated_at is not null then
    raise exception 'Expected the category to be restored.';
  end if;

  v_blocked := false;
  begin
    delete from public.categories
    where id = v_admin_crud_id;

    raise exception 'Expected admin hard delete to be blocked.';
  exception
    when SQLSTATE '42501' then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      if v_message ilike '%permission denied%' or v_message ilike '%row-level security policy%' then
        v_blocked := true;
      else
        raise exception 'Unexpected rejection for admin delete: [%] %', v_sqlstate, v_message;
      end if;
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      raise exception 'Unexpected SQL error for admin delete: [%] %', v_sqlstate, v_message;
  end;

  if not v_blocked then
    raise exception 'Expected admin hard delete to be blocked.';
  end if;

  v_blocked := false;
  begin
    insert into public.categories (
      name,
      slug,
      description,
      icon,
      status,
      display_order,
      show_on_homepage
    ) values (
      'Uppercase Slug',
      '  MIXED Value!!  ',
      'Checks lowercase normalization.',
      'electronics',
      'active',
      10,
      true
    )
    returning id into v_self_parent_id;
    v_fixture_category_ids := array_append(v_fixture_category_ids, v_self_parent_id);

    select slug
      into v_message
    from public.categories
    where id = v_self_parent_id;

    if v_message <> 'mixed-value' then
      raise exception 'Expected category slug normalization to produce mixed-value, got %.', v_message;
    end if;
  exception
    when others then
      raise;
  end;

  v_blocked := false;
  begin
    insert into public.categories (
      name,
      slug,
      description,
      icon,
      status,
      display_order,
      show_on_homepage
    ) values (
      '!!!',
      '!!!',
      'This slug should be rejected.',
      'fashion',
      'active',
      11,
      false
    );

    raise exception 'Expected empty normalized slug insertion to be blocked.';
  exception
    when SQLSTATE 'P0001' then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      if v_message like '%Category slug cannot be empty after normalization.%' then
        v_blocked := true;
      else
        raise exception 'Unexpected rejection for empty slug: [%] %', v_sqlstate, v_message;
      end if;
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      raise exception 'Unexpected SQL error for empty slug: [%] %', v_sqlstate, v_message;
  end;

  if not v_blocked then
    raise exception 'Expected empty normalized slug insertion to be blocked.';
  end if;

  v_blocked := false;
  begin
    insert into public.categories (
      name,
      slug,
      description,
      icon,
      status,
      display_order,
      show_on_homepage
    ) values (
      'Duplicate Slug',
      'MIXED VALUE',
      'This should collide with the normalized slug.',
      'books',
      'active',
      12,
      false
    );

    raise exception 'Expected duplicate normalized slug insertion to be blocked.';
  exception
    when SQLSTATE '23505' then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      if v_message like '%categories_slug_normalized_unique_idx%' then
        v_blocked := true;
      else
        raise exception 'Unexpected unique violation for duplicate slug: [%] %', v_sqlstate, v_message;
      end if;
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      raise exception 'Unexpected SQL error for duplicate slug: [%] %', v_sqlstate, v_message;
  end;

  if not v_blocked then
    raise exception 'Expected duplicate normalized slug insertion to be blocked.';
  end if;

  v_blocked := false;
  begin
    insert into public.categories (
      name,
      slug,
      description,
      icon,
      status,
      display_order,
      show_on_homepage
    ) values (
      'Self Parent',
      'self-parent',
      'Used to verify self-parent rejection.',
      'home',
      'active',
      13,
      false
    )
    returning id into v_self_parent_id;
    v_fixture_category_ids := array_append(v_fixture_category_ids, v_self_parent_id);

    update public.categories
    set parent_id = v_self_parent_id
    where id = v_self_parent_id;

    raise exception 'Expected self-parent update to be blocked.';
  exception
    when SQLSTATE 'P0001' then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      if v_message like '%A category cannot be its own parent.%' then
        v_blocked := true;
      else
        raise exception 'Unexpected rejection for self-parent update: [%] %', v_sqlstate, v_message;
      end if;
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      raise exception 'Unexpected SQL error for self-parent update: [%] %', v_sqlstate, v_message;
  end;

  if not v_blocked then
    raise exception 'Expected self-parent update to be blocked.';
  end if;

  v_blocked := false;
  begin
    insert into public.categories (
      name,
      slug,
      description,
      icon,
      status,
      display_order,
      show_on_homepage
    ) values (
      'Cycle Parent',
      'cycle-parent',
      'Used to verify indirect cycle rejection.',
      'electronics',
      'active',
      14,
      false
    )
    returning id into v_cycle_parent_id;
    v_fixture_category_ids := array_append(v_fixture_category_ids, v_cycle_parent_id);

    insert into public.categories (
      name,
      slug,
      description,
      icon,
      status,
      parent_id,
      display_order,
      show_on_homepage
    ) values (
      'Cycle Child',
      'cycle-child',
      'Used to verify indirect cycle rejection.',
      'electronics',
      'active',
      v_cycle_parent_id,
      15,
      false
    )
    returning id into v_cycle_child_id;
    v_fixture_category_ids := array_append(v_fixture_category_ids, v_cycle_child_id);

    update public.categories
    set parent_id = v_cycle_child_id
    where id = v_cycle_parent_id;

    raise exception 'Expected indirect cycle update to be blocked.';
  exception
    when SQLSTATE 'P0001' then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      if v_message like '%Circular category relationships are not allowed.%' then
        v_blocked := true;
      else
        raise exception 'Unexpected rejection for indirect cycle update: [%] %', v_sqlstate, v_message;
      end if;
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      raise exception 'Unexpected SQL error for indirect cycle update: [%] %', v_sqlstate, v_message;
  end;

  if not v_blocked then
    raise exception 'Expected indirect cycle update to be blocked.';
  end if;

  v_blocked := false;
  begin
    insert into public.categories (
      name,
      slug,
      description,
      icon,
      status,
      display_order,
      show_on_homepage
    ) values (
      'Hidden Parent',
      'hidden-parent',
      'Used to verify hidden parent rejection.',
      'fashion',
      'hidden',
      16,
      false
    )
    returning id into v_hidden_parent_id;
    v_fixture_category_ids := array_append(v_fixture_category_ids, v_hidden_parent_id);

    insert into public.categories (
      name,
      slug,
      description,
      icon,
      status,
      parent_id,
      display_order,
      show_on_homepage
    ) values (
      'Hidden Parent Child',
      'hidden-parent-child',
      'This active child should be rejected.',
      'fashion',
      'active',
      v_hidden_parent_id,
      17,
      false
    );

    raise exception 'Expected active child under hidden parent to be blocked.';
  exception
    when SQLSTATE 'P0001' then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      if v_message like '%Active categories cannot use hidden parents.%' then
        v_blocked := true;
      else
        raise exception 'Unexpected rejection for hidden parent child: [%] %', v_sqlstate, v_message;
      end if;
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      raise exception 'Unexpected SQL error for hidden parent child: [%] %', v_sqlstate, v_message;
  end;

  if not v_blocked then
    raise exception 'Expected active child under hidden parent to be blocked.';
  end if;

  v_blocked := false;
  begin
    insert into public.categories (
      name,
      slug,
      description,
      icon,
      status,
      display_order,
      show_on_homepage
    ) values (
      'Delete Parent',
      'delete-parent',
      'Used to verify deleted parent rejection.',
      'books',
      'active',
      18,
      false
    )
    returning id into v_deleted_parent_id;
    v_fixture_category_ids := array_append(v_fixture_category_ids, v_deleted_parent_id);

    update public.categories
    set deleted_at = timestamptz '2000-01-01 00:00:00+00',
        status = 'hidden'
    where id = v_deleted_parent_id;

    insert into public.categories (
      name,
      slug,
      description,
      icon,
      status,
      parent_id,
      display_order,
      show_on_homepage
    ) values (
      'Deleted Parent Child',
      'deleted-parent-child',
      'This child should be rejected.',
      'books',
      'active',
      v_deleted_parent_id,
      19,
      false
    );

    raise exception 'Expected deleted parent to be blocked.';
  exception
    when SQLSTATE 'P0001' then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      if v_message like '%Deleted categories cannot be used as parents.%' then
        v_blocked := true;
      else
        raise exception 'Unexpected rejection for deleted parent child: [%] %', v_sqlstate, v_message;
      end if;
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      raise exception 'Unexpected SQL error for deleted parent child: [%] %', v_sqlstate, v_message;
  end;

  if not v_blocked then
    raise exception 'Expected deleted parent to be blocked.';
  end if;

  insert into public.categories (
    name,
    slug,
    description,
    icon,
    status,
    display_order,
    show_on_homepage
  ) values (
    'Parent With Child',
    'parent-with-child',
    'Used to verify parent visibility protection.',
    'home',
    'active',
    20,
    false
  )
  returning id into v_parent_with_child_id;
  v_fixture_category_ids := array_append(v_fixture_category_ids, v_parent_with_child_id);

  insert into public.categories (
    name,
    slug,
    description,
    icon,
    status,
    parent_id,
    display_order,
    show_on_homepage
  ) values (
    'Visible Child',
    'visible-child',
    'Used to verify visible child protection.',
    'home',
    'active',
    v_parent_with_child_id,
    21,
    false
  )
  returning id into v_visible_child_id;
  v_fixture_category_ids := array_append(v_fixture_category_ids, v_visible_child_id);

  v_blocked := false;
  begin
    update public.categories
    set status = 'hidden'
    where id = v_parent_with_child_id;

    raise exception 'Expected parent hide with visible children to be blocked.';
  exception
    when SQLSTATE 'P0001' then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      if v_message like '%Move, hide, or delete child categories before hiding or deleting this category.%' then
        v_blocked := true;
      else
        raise exception 'Unexpected rejection for hidden parent with visible child: [%] %', v_sqlstate, v_message;
      end if;
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      raise exception 'Unexpected SQL error for hidden parent with visible child: [%] %', v_sqlstate, v_message;
  end;

  if not v_blocked then
    raise exception 'Expected parent hide with visible children to be blocked.';
  end if;

  v_blocked := false;
  begin
    update public.categories
    set deleted_at = now(),
        status = 'hidden'
    where id = v_parent_with_child_id;

    raise exception 'Expected parent delete with visible children to be blocked.';
  exception
    when SQLSTATE 'P0001' then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      if v_message like '%Move, hide, or delete child categories before hiding or deleting this category.%' then
        v_blocked := true;
      else
        raise exception 'Unexpected rejection for deleted parent with visible child: [%] %', v_sqlstate, v_message;
      end if;
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      raise exception 'Unexpected SQL error for deleted parent with visible child: [%] %', v_sqlstate, v_message;
  end;

  if not v_blocked then
    raise exception 'Expected parent delete with visible children to be blocked.';
  end if;

  select count(*)
    into v_count
  from public.categories
  where lower(slug) in (lower('hidden-parent'), lower('delete-parent'))
    and status = 'active'
    and deleted_at is null;

  if v_count <> 0 then
    raise exception 'Expected hidden or deleted category slugs to stay hidden from storefront lookup.';
  end if;

  select pg_get_functiondef('private.normalize_categories_write()'::regprocedure)
    into v_message;

  if position('pg_advisory_xact_lock(20260806, 3)' in v_message) = 0 then
    raise exception 'Expected the hierarchy trigger to use the documented advisory lock key.';
  end if;

  delete from public.categories
  where id = any(v_fixture_category_ids);

  select count(*)
    into v_count
  from public.categories
  where id = any(v_fixture_category_ids);

  if v_count <> 0 then
    raise exception 'Expected temporary category fixtures to be cleaned up.';
  end if;
end;
$$;

