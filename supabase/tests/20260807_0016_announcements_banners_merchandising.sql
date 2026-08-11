-- Announcements, site banner, and merchandising verification for the deployed Supabase schema.

begin;

create temp table if not exists merch_phase_summary (
  passed integer not null,
  failed integer not null
);

do $$
declare
  v_admin_id uuid;
  v_admin_email text;
  v_customer_id uuid := '61111111-1111-4111-8111-111111111111';
  v_customer_email text := 'merch-phase-customer-61111111111141118111111111111111@example.com';
  v_temp_announcement_id uuid := 'a1111111-1111-4111-8111-111111111111';
  v_banner_seed_row public.site_banners%rowtype;
  v_banner_before public.site_banners%rowtype;
  v_announcement_row public.announcements%rowtype;
  v_product_row public.products%rowtype;
  v_merch_row public.product_merchandising%rowtype;
  v_public_count integer;
  v_admin_count integer;
  v_count integer;
  v_passed integer := 0;
  v_failed integer := 0;
  v_sqlstate text;
  v_message text;
  v_expected_message text;
  v_old_timestamp timestamptz := timestamptz '2000-01-01 00:00:00+00';
  v_visible_slug text := 'premium-wireless-headphones';
  v_banner_original jsonb;
  v_announcement_original jsonb;
begin
  select id, email
    into v_admin_id, v_admin_email
  from public.profiles
  where role = 'admin'
    and status = 'active'
  order by created_at asc
  limit 1;

  if v_admin_id is null then
    raise exception 'Expected an active admin profile for announcements/banner/merchandising tests.';
  end if;

  delete from public.announcements
  where id = v_temp_announcement_id
     or title like 'ANNOUNCETEST-%';

  delete from auth.users
  where id = v_customer_id
     or email = v_customer_email;

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
    jsonb_build_object('full_name', 'Merch Customer'),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    'authenticated',
    'authenticated'
  );

  select count(*)
    into v_count
  from public.profiles
  where id = v_customer_id
    and role = 'customer'
    and status = 'active';

  if v_count <> 1 then
    raise exception 'Signup trigger did not create the expected active customer profile.';
  end if;

  v_passed := v_passed + 1;

  execute 'set local role anon';
  perform set_config('request.jwt.claim.role', 'anon', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.email', '', true);

  select count(*)
    into v_public_count
  from public.announcements
  where id = 'a1111111-1111-4111-8111-111111111111'
    and deleted_at is null
    and status = 'active'
    and (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at >= now());

  if v_public_count < 1 then
    raise exception 'Expected at least one active public announcement.';
  end if;

  v_passed := v_passed + 1;

  select count(*)
    into v_public_count
  from public.site_banners
  where banner_key = 'homepage'
    and deleted_at is null
    and status = 'active';

  if v_public_count <> 1 then
    raise exception 'Expected the public homepage banner to be visible.';
  end if;

  v_passed := v_passed + 1;

  select count(*)
    into v_public_count
  from public.product_merchandising as pm
  join public.products as p
    on p.id = pm.product_id
  where pm.placement in ('flashy', 'best-selling')
    and p.status = 'active'
    and p.deleted_at is null;

  if v_public_count < 1 then
    raise exception 'Expected at least one visible merchandising assignment.';
  end if;

  v_passed := v_passed + 1;

  begin
    perform public.save_announcement(
      jsonb_build_object(
        'title', 'ANNOUNCETEST-Customer',
        'message', 'ANNOUNCETEST customer message',
        'category', 'promotion',
        'startsAt', timestamptz '2026-08-07 00:00:00+00',
        'endsAt', timestamptz '2026-08-20 23:59:59+00'
      )
    );
    raise exception 'Expected customer announcement creation to fail.';
  exception
    when others then
      v_sqlstate := sqlstate;
      v_message := lower(sqlerrm);
      if position('only active administrators can save announcements' in v_message) = 0
         and position('please sign in to continue' in v_message) = 0 then
        raise exception 'Unexpected announcement customer block error: %', sqlerrm;
      end if;
      v_passed := v_passed + 1;
  end;

  begin
    perform public.soft_delete_announcement(v_temp_announcement_id);
    raise exception 'Expected customer announcement delete to fail.';
  exception
    when others then
      v_message := lower(sqlerrm);
      if position('only active administrators can delete announcements' in v_message) = 0
         and position('please sign in to continue' in v_message) = 0 then
        raise exception 'Unexpected announcement customer delete block error: %', sqlerrm;
      end if;
      v_passed := v_passed + 1;
  end;

  execute 'reset role';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', v_admin_id::text, true);
  perform set_config('request.jwt.claim.email', v_admin_email, true);

  v_announcement_original := jsonb_build_object(
    'title', 'ANNOUNCETEST-Admin-Announcement',
    'message', 'ANNOUNCETEST announcement body',
    'category', 'shipping-update',
    'status', 'active',
    'startsAt', timestamptz '2026-08-07 00:00:00+00',
    'endsAt', timestamptz '2026-08-20 23:59:59+00'
  );

  v_announcement_row := public.save_announcement(v_announcement_original);

  v_temp_announcement_id := v_announcement_row.id;

  select *
    into v_announcement_row
  from public.announcements
  where id = v_temp_announcement_id;

  if v_announcement_row.id is null then
    raise exception 'Expected the admin announcement to be created.';
  end if;

  select count(*)
    into v_count
  from public.announcements
  where id = v_temp_announcement_id;

  if v_count <> 1 then
    raise exception 'Expected exactly one admin announcement row after creation.';
  end if;

  update public.announcements
     set updated_at = v_old_timestamp
   where id = v_temp_announcement_id;

  perform public.save_announcement(
    jsonb_build_object(
      'id', v_temp_announcement_id,
      'title', 'ANNOUNCETEST-Admin-Announcement',
      'message', 'ANNOUNCETEST announcement body updated',
      'category', 'shipping-update',
      'status', 'active',
      'startsAt', timestamptz '2026-08-07 00:00:00+00',
      'endsAt', timestamptz '2026-08-20 23:59:59+00'
    )
  );

  select *
    into v_announcement_row
  from public.announcements
  where id = v_temp_announcement_id;

  if v_announcement_row.updated_at <= v_old_timestamp then
    raise exception 'Expected the announcement updated_at column to advance on save.';
  end if;

  v_passed := v_passed + 1;

  perform public.soft_delete_announcement(v_temp_announcement_id);

  execute 'reset role';
  execute 'set local role anon';
  perform set_config('request.jwt.claim.role', 'anon', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.email', '', true);

  select count(*)
    into v_public_count
  from public.announcements
  where id = v_temp_announcement_id
    and deleted_at is null
    and status = 'active'
    and (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at >= now());

  if v_public_count <> 0 then
    raise exception 'Expected the soft-deleted announcement to disappear from public visibility.';
  end if;

  v_passed := v_passed + 1;

  execute 'reset role';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', v_admin_id::text, true);
  perform set_config('request.jwt.claim.email', v_admin_email, true);

  v_banner_original := jsonb_build_object(
    'banner_key', 'homepage',
    'announcement_label', 'Announcement',
    'announcement_batch_number', 'SEA-08',
    'announcement_headline', 'Batch Number-08 is open for orders',
    'announcement_body', 'Orders placed within this batch window will move together on the next shipping cycle.',
    'announcement_batch_window_start', '2026-08-10',
    'announcement_batch_window_end', '2026-08-20',
    'announcement_shipping_mode', 'sea',
    'announcement_air_transit_days', 16,
    'announcement_sea_transit_days', 30,
    'announcement_cta_label', 'View Details',
    'announcement_cta_href', '/products',
    'reflection_label', 'Daily Reflection',
    'reflection_headline', 'Commit to the Lord whatever you do, and He will establish your plans.',
    'reflection_verse', 'Proverbs 16:3',
    'reflection_body', '',
    'status', 'active',
    'display_order', 0
  );

  select *
    into v_banner_seed_row
  from public.site_banners
  where banner_key = 'homepage';

  if v_banner_seed_row.id is null then
    raise exception 'Expected a seeded homepage banner row to exist.';
  end if;

  update public.site_banners
     set updated_at = v_old_timestamp
   where id = v_banner_seed_row.id;

  v_banner_before := (select * from public.site_banners where id = v_banner_seed_row.id);

  perform public.save_site_banner(v_banner_original);

  select *
    into v_banner_seed_row
  from public.site_banners
  where banner_key = 'homepage';

  if v_banner_seed_row.updated_at <= v_old_timestamp then
    raise exception 'Expected the site banner updated_at column to advance on save.';
  end if;

  v_passed := v_passed + 1;

  perform public.save_site_banner(
    jsonb_build_object(
      'banner_key', 'homepage',
      'announcement_label', v_banner_seed_row.announcement_label,
      'announcement_batch_number', v_banner_seed_row.announcement_batch_number,
      'announcement_headline', v_banner_seed_row.announcement_headline,
      'announcement_body', v_banner_seed_row.announcement_body,
      'announcement_batch_window_start', v_banner_seed_row.announcement_batch_window_start,
      'announcement_batch_window_end', v_banner_seed_row.announcement_batch_window_end,
      'announcement_shipping_mode', v_banner_seed_row.announcement_shipping_mode,
      'announcement_air_transit_days', v_banner_seed_row.announcement_air_transit_days,
      'announcement_sea_transit_days', v_banner_seed_row.announcement_sea_transit_days,
      'announcement_cta_label', v_banner_seed_row.announcement_cta_label,
      'announcement_cta_href', v_banner_seed_row.announcement_cta_href,
      'reflection_label', v_banner_seed_row.reflection_label,
      'reflection_headline', v_banner_seed_row.reflection_headline,
      'reflection_verse', v_banner_seed_row.reflection_verse,
      'reflection_body', v_banner_seed_row.reflection_body,
      'status', 'inactive',
      'display_order', v_banner_seed_row.display_order
    )
  );

  select count(*)
    into v_public_count
  from public.site_banners
  where banner_key = 'homepage'
    and deleted_at is null
    and status = 'active';

  if v_public_count <> 0 then
    raise exception 'Expected the inactive site banner to be hidden from the public.';
  end if;

  v_passed := v_passed + 1;

  perform public.save_site_banner(v_banner_original);

  begin
    perform public.save_site_banner(
      jsonb_build_object(
        'banner_key', 'homepage',
        'announcement_label', 'Announcement',
        'announcement_batch_number', 'SEA-08',
        'announcement_headline', 'Batch Number-08 is open for orders',
        'announcement_body', 'Orders placed within this batch window will move together on the next shipping cycle.',
        'announcement_batch_window_start', '2026-08-10',
        'announcement_batch_window_end', '2026-08-20',
        'announcement_shipping_mode', 'sea',
        'announcement_air_transit_days', 16,
        'announcement_sea_transit_days', 30,
        'announcement_cta_label', 'View Details',
        'announcement_cta_href', '/products',
        'reflection_label', 'Daily Reflection',
        'reflection_headline', 'A restored reflection banner.',
        'reflection_verse', 'Proverbs 16:3',
        'reflection_body', '',
        'status', 'active',
        'display_order', 0
      )
    );
  end;

  select *
    into v_banner_seed_row
  from public.site_banners
  where banner_key = 'homepage';

  if v_banner_seed_row.updated_at <= v_old_timestamp then
    raise exception 'Expected the restored site banner updated_at column to advance on save.';
  end if;

  v_passed := v_passed + 1;

  select *
    into v_product_row
  from public.products
  where lower(slug) = lower(v_visible_slug);

  if v_product_row.id is null then
    raise exception 'Expected the merchandising test product "%" to exist.', v_visible_slug;
  end if;

  update public.product_merchandising
     set updated_at = v_old_timestamp
   where product_id = v_product_row.id
     and placement = 'flashy';

  perform public.save_product_merchandising(
    jsonb_build_object(
      'productId', v_product_row.id,
      'placement', 'flashy',
      'displayOrder', 11,
      'startsAt', null,
      'endsAt', null
    )
  );

  select *
    into v_merch_row
  from public.product_merchandising
  where product_id = v_product_row.id
    and placement = 'flashy';

  if v_merch_row.display_order <> 11 then
    raise exception 'Expected the merchandising assignment to update in place.';
  end if;

  if v_merch_row.updated_at <= v_old_timestamp then
    raise exception 'Expected the merchandising updated_at column to advance on save.';
  end if;

  v_passed := v_passed + 1;

  select count(*)
    into v_count
  from public.product_merchandising
  where product_id = v_product_row.id
    and placement = 'flashy';

  if v_count <> 1 then
    raise exception 'Expected exactly one merchandising row for the product placement.';
  end if;

  v_passed := v_passed + 1;

  execute 'reset role';
  execute 'set local role anon';
  perform set_config('request.jwt.claim.role', 'anon', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.email', '', true);

  select count(*)
    into v_public_count
  from public.product_merchandising as pm
  join public.products as p
    on p.id = pm.product_id
  where p.slug = v_visible_slug
    and pm.placement = 'flashy'
    and p.status = 'active'
    and p.deleted_at is null;

  if v_public_count <> 1 then
    raise exception 'Expected the merchandising row to be publicly visible before the product is hidden.';
  end if;

  v_passed := v_passed + 1;

  execute 'reset role';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', v_admin_id::text, true);
  perform set_config('request.jwt.claim.email', v_admin_email, true);

  perform public.set_product_deleted_at(v_product_row.id);

  execute 'reset role';
  execute 'set local role anon';
  perform set_config('request.jwt.claim.role', 'anon', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.email', '', true);

  select count(*)
    into v_public_count
  from public.product_merchandising as pm
  join public.products as p
    on p.id = pm.product_id
  where p.slug = v_visible_slug
    and pm.placement = 'flashy'
    and p.status = 'active'
    and p.deleted_at is null;

  if v_public_count <> 0 then
    raise exception 'Expected hidden/deleted products to disappear from public merchandising.';
  end if;

  v_passed := v_passed + 1;

  execute 'reset role';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', v_admin_id::text, true);
  perform set_config('request.jwt.claim.email', v_admin_email, true);

  perform public.restore_product(v_product_row.id);

  execute 'reset role';
  execute 'set local role anon';
  perform set_config('request.jwt.claim.role', 'anon', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.email', '', true);

  select count(*)
    into v_public_count
  from public.product_merchandising as pm
  join public.products as p
    on p.id = pm.product_id
  where p.slug = v_visible_slug
    and pm.placement = 'flashy'
    and p.status = 'active'
    and p.deleted_at is null;

  if v_public_count <> 1 then
    raise exception 'Expected the restored product to become visible again in merchandising.';
  end if;

  v_passed := v_passed + 1;

  execute 'reset role';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', v_customer_id::text, true);
  perform set_config('request.jwt.claim.email', v_customer_email, true);

  begin
    perform public.save_site_banner(v_banner_original);
    raise exception 'Expected customer site banner save to fail.';
  exception
    when others then
      v_message := lower(sqlerrm);
      if position('only active administrators can save the site banner' in v_message) = 0 then
        raise exception 'Unexpected customer banner block error: %', sqlerrm;
      end if;
      v_passed := v_passed + 1;
  end;

  begin
    perform public.save_product_merchandising(
      jsonb_build_object(
        'productId', v_product_row.id,
        'placement', 'flashy',
        'displayOrder', 7
      )
    );
    raise exception 'Expected customer merchandising save to fail.';
  exception
    when others then
      v_message := lower(sqlerrm);
      if position('only active administrators can manage merchandising' in v_message) = 0
         and position('please sign in to continue' in v_message) = 0 then
        raise exception 'Unexpected customer merchandising block error: %', sqlerrm;
      end if;
      v_passed := v_passed + 1;
  end;

  execute 'reset role';
  execute 'set local role anon';
  perform set_config('request.jwt.claim.role', 'anon', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.email', '', true);

  begin
    perform public.save_announcement(
      jsonb_build_object(
        'title', 'ANNOUNCETEST-Anon',
        'message', 'ANNOUNCETEST anonymous message',
        'category', 'promotion'
      )
    );
    raise exception 'Expected anonymous announcement save to fail.';
  exception
    when others then
      v_message := lower(sqlerrm);
      if position('only active administrators can save announcements' in v_message) = 0
         and position('please sign in to continue' in v_message) = 0 then
        raise exception 'Unexpected anonymous announcement block error: %', sqlerrm;
      end if;
      v_passed := v_passed + 1;
  end;

  begin
    perform public.save_product_merchandising(
      jsonb_build_object(
        'productId', v_product_row.id,
        'placement', 'best-selling',
        'displayOrder', 3
      )
    );
    raise exception 'Expected anonymous merchandising save to fail.';
  exception
    when others then
      v_message := lower(sqlerrm);
      if position('permission denied' in v_message) = 0
         and position('only active administrators can manage merchandising' in v_message) = 0
         and position('please sign in to continue' in v_message) = 0 then
        raise exception 'Unexpected anonymous merchandising block error: %', sqlerrm;
      end if;
      v_passed := v_passed + 1;
  end;

  execute 'reset role';

  select *
    into v_banner_seed_row
  from public.site_banners
  where banner_key = 'homepage';

  if v_banner_seed_row.banner_key <> 'homepage'
     or v_banner_seed_row.status <> 'active'
     or v_banner_seed_row.deleted_at is not null then
    raise exception 'Expected the homepage banner to remain active after testing.';
  end if;

  v_passed := v_passed + 1;

  delete from public.announcements
  where id = v_temp_announcement_id;

  delete from auth.users
  where id = v_customer_id;

  insert into merch_phase_summary (passed, failed)
  values (v_passed, v_failed);
end;
$$;

select * from merch_phase_summary;

commit;
