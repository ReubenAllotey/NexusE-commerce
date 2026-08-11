begin;

do $$
declare
  v_announcement_id uuid := 'a1111111-1111-4111-8111-111111111111';
  v_banner_id uuid := 'b1111111-1111-4111-8111-111111111111';
  v_announcement_row public.announcements%rowtype;
  v_banner_row public.site_banners%rowtype;
  v_existing public.product_merchandising%rowtype;
  v_product public.products%rowtype;
  v_count integer;
  v_now timestamptz := timestamptz '2026-08-07 00:00:00+00';
  v_merch_seed record;
  v_expected_merch_count integer := 10;
  v_seed_product_slugs text[] := array[
    'premium-wireless-headphones',
    'studio-sound-bluetooth-speaker',
    'ultra-hd-smart-tv',
    'compact-digital-camera',
    'ultra-slim-smartphone',
    'revive-vitamin-c-serum',
    'daily-glow-face-cleanser',
    'hydrating-body-lotion',
    'study-skills-book-pack',
    'business-growth-books'
  ];
begin
  select *
    into v_announcement_row
  from public.announcements
  where id = v_announcement_id;

  if found then
    if v_announcement_row.title is distinct from 'August Shipping Update'
       or v_announcement_row.message is distinct from 'Orders in the current batch are being prepared for shipment.'
       or v_announcement_row.category is distinct from 'shipping-update'
       or v_announcement_row.status is distinct from 'active'
       or v_announcement_row.starts_at is distinct from v_now
       or v_announcement_row.ends_at is distinct from timestamptz '2026-08-31 23:59:59+00'
       or v_announcement_row.deleted_at is not null
       or v_announcement_row.created_by is not null then
      raise exception 'Announcement seed "%" conflicts with the expected values.', v_announcement_id;
    end if;
  else
    insert into public.announcements (
      id,
      title,
      message,
      category,
      status,
      starts_at,
      ends_at,
      created_by
    ) values (
      v_announcement_id,
      'August Shipping Update',
      'Orders in the current batch are being prepared for shipment.',
      'shipping-update',
      'active',
      v_now,
      timestamptz '2026-08-31 23:59:59+00',
      null
    );
  end if;

  select *
    into v_banner_row
  from public.site_banners
  where banner_key = 'homepage';

  if found then
    if v_banner_row.id is distinct from v_banner_id
       or v_banner_row.announcement_label is distinct from 'Announcement'
       or v_banner_row.announcement_batch_number is distinct from 'SEA-08'
       or v_banner_row.announcement_headline is distinct from 'Batch Number-08 is open for orders'
       or v_banner_row.announcement_body is distinct from 'Orders placed within this batch window will move together on the next shipping cycle.'
       or v_banner_row.announcement_batch_window_start is distinct from date '2026-08-10'
       or v_banner_row.announcement_batch_window_end is distinct from date '2026-08-20'
       or v_banner_row.announcement_shipping_mode is distinct from 'sea'
       or v_banner_row.announcement_air_transit_days is distinct from 16
       or v_banner_row.announcement_sea_transit_days is distinct from 30
       or v_banner_row.announcement_cta_label is distinct from 'View Details'
       or v_banner_row.announcement_cta_href is distinct from '/products'
       or v_banner_row.reflection_label is distinct from 'Daily Reflection'
       or v_banner_row.reflection_headline is distinct from 'Commit to the Lord whatever you do, and He will establish your plans.'
       or v_banner_row.reflection_verse is distinct from 'Proverbs 16:3'
       or coalesce(v_banner_row.reflection_body, '') is distinct from ''
       or v_banner_row.status is distinct from 'active'
       or v_banner_row.display_order is distinct from 0
       or v_banner_row.deleted_at is not null
       or v_banner_row.created_by is not null then
      raise exception 'Site banner seed "%" conflicts with the expected values.', 'homepage';
    end if;
  else
    insert into public.site_banners (
      id,
      banner_key,
      announcement_label,
      announcement_batch_number,
      announcement_headline,
      announcement_body,
      announcement_batch_window_start,
      announcement_batch_window_end,
      announcement_shipping_mode,
      announcement_air_transit_days,
      announcement_sea_transit_days,
      announcement_cta_label,
      announcement_cta_href,
      reflection_label,
      reflection_headline,
      reflection_verse,
      reflection_body,
      status,
      display_order,
      created_by
    ) values (
      v_banner_id,
      'homepage',
      'Announcement',
      'SEA-08',
      'Batch Number-08 is open for orders',
      'Orders placed within this batch window will move together on the next shipping cycle.',
      date '2026-08-10',
      date '2026-08-20',
      'sea',
      16,
      30,
      'View Details',
      '/products',
      'Daily Reflection',
      'Commit to the Lord whatever you do, and He will establish your plans.',
      'Proverbs 16:3',
      null,
      'active',
      0,
      null
    );
  end if;

  for v_merch_seed in
    select *
    from (
      values
        ('premium-wireless-headphones', 'flashy', 1),
        ('studio-sound-bluetooth-speaker', 'flashy', 2),
        ('ultra-hd-smart-tv', 'flashy', 3),
        ('compact-digital-camera', 'flashy', 4),
        ('ultra-slim-smartphone', 'flashy', 5),
        ('revive-vitamin-c-serum', 'best-selling', 1),
        ('daily-glow-face-cleanser', 'best-selling', 2),
        ('hydrating-body-lotion', 'best-selling', 3),
        ('study-skills-book-pack', 'best-selling', 4),
        ('business-growth-books', 'best-selling', 5)
    ) as seed(product_slug, placement, display_order)
  loop
    select p.*
      into v_product
    from public.products as p
    where lower(p.slug) = lower(v_merch_seed.product_slug);

    if not found then
      raise exception 'Required merchandising seed product "%" is missing.', v_merch_seed.product_slug;
    end if;

    if v_product.status <> 'active' or v_product.deleted_at is not null then
      raise exception 'Required merchandising seed product "%" must be active and undeleted.', v_merch_seed.product_slug;
    end if;

    select *
      into v_existing
    from public.product_merchandising as pm
    where pm.product_id = v_product.id
      and pm.placement = v_merch_seed.placement;

    if found then
      if v_existing.display_order is distinct from v_merch_seed.display_order
         or v_existing.starts_at is not null
         or v_existing.ends_at is not null
         or v_existing.created_by is not null then
        raise exception 'Merchandising seed "%" conflicts with the expected values.', v_merch_seed.product_slug;
      end if;
    else
      insert into public.product_merchandising (
        product_id,
        placement,
        display_order,
        starts_at,
        ends_at,
        created_by
      ) values (
        v_product.id,
        v_merch_seed.placement,
        v_merch_seed.display_order,
        null,
        null,
        null
      );
    end if;
  end loop;

  select count(*)
    into v_count
  from public.product_merchandising as pm
  where lower(pm.placement) in ('flashy', 'best-selling')
    and exists (
      select 1
      from unnest(v_seed_product_slugs) as seed_slug
      join public.products as p
        on lower(p.slug) = lower(seed_slug)
      where p.id = pm.product_id
    );

  if v_count <> v_expected_merch_count then
    raise exception 'Expected % merchandising seed rows to exist, found %.', v_expected_merch_count, v_count;
  end if;
end;
$$;

commit;
