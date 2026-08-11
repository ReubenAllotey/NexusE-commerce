begin;

do $$
declare
  v_seed record;
  v_category public.categories%rowtype;
  v_existing public.products%rowtype;
  v_inserted boolean := false;
  v_expected_text_array text[];
  v_actual_text_array text[];
  v_product_slugs text[] := array[
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
  ];
  v_expected_product_count integer := 16;
  v_expected_product_images integer := 0;
  v_expected_product_colors integer := 18;
  v_expected_product_sizes integer := 9;
  v_expected_product_features integer := 35;
  v_expected_product_perks integer := 32;
  v_total integer;
begin
  for v_seed in
    select *
    from (
      values
        (
          'revive-vitamin-c-serum',
          'beauty-and-care',
          'Skincare',
          'Revive Vitamin C Serum',
          'Revive',
          'Nexus',
          'Nexus Store',
          145::numeric,
          180::numeric,
          4.8::numeric,
          86,
          'New',
          'In Stock & Ready to Ship',
          'Brightening serum for a healthy everyday glow.',
          'A lightweight vitamin C serum that helps freshen tired skin and support a brighter complexion.',
          'beauty-placeholder.svg',
          null::numeric,
          'pending',
          'air-freight',
          'seed',
          '[]'::jsonb,
          '[]'::jsonb,
          jsonb_build_array('Vitamin C boost', 'Lightweight serum'),
          jsonb_build_array('Free delivery offers', 'Suitable for daily use')
        ),
        (
          'daily-glow-face-cleanser',
          'beauty-and-care',
          'Skincare',
          'Daily Glow Face Cleanser',
          'Daily Glow',
          'Nexus',
          'Nexus Store',
          88::numeric,
          110::numeric,
          4.6::numeric,
          58,
          'Top Pick',
          'In Stock & Ready to Ship',
          'A gentle cleanser for fresh, clean skin every day.',
          'A soft foaming cleanser that removes buildup without leaving the skin dry.',
          'beauty-placeholder.svg',
          18::numeric,
          'ready',
          'sea-freight',
          'seed',
          '[]'::jsonb,
          '[]'::jsonb,
          jsonb_build_array('Gentle cleanse', 'Hydrating formula'),
          jsonb_build_array('Daily use', 'Travel friendly')
        ),
        (
          'hydrating-body-lotion',
          'beauty-and-care',
          'Body Care',
          'Hydrating Body Lotion',
          'Hydra Care',
          'Nexus',
          'Nexus Store',
          76::numeric,
          95::numeric,
          4.5::numeric,
          41,
          'New',
          'In Stock & Ready to Ship',
          'Smooth body lotion designed for long-lasting comfort.',
          'A rich lotion that supports soft, moisturized skin throughout the day.',
          'beauty-placeholder.svg',
          15::numeric,
          'ready',
          'air-freight',
          'seed',
          '[]'::jsonb,
          '[]'::jsonb,
          jsonb_build_array('Fast-absorbing texture', 'Non-greasy finish'),
          jsonb_build_array('Everyday moisture', 'Easy to carry')
        ),
        (
          'study-skills-book-pack',
          'books',
          'Education',
          'Study Skills Book Pack',
          'Study Smart',
          'NBG',
          'Nexus Store',
          120::numeric,
          150::numeric,
          4.7::numeric,
          33,
          'New',
          'In Stock & Ready to Ship',
          'Helpful reading for better revision and study habits.',
          'A focused collection of study guides that help readers build better learning routines.',
          'books-placeholder.svg',
          null::numeric,
          'pending',
          'air-freight',
          'seed',
          '[]'::jsonb,
          '[]'::jsonb,
          jsonb_build_array('Revision notes', 'Exam strategies'),
          jsonb_build_array('Great for students', 'Easy to read')
        ),
        (
          'business-growth-books',
          'books',
          'Business',
          'Business Growth Books',
          'Growth Series',
          'NBG',
          'Nexus Store',
          160::numeric,
          200::numeric,
          4.8::numeric,
          51,
          'Best Seller',
          'In Stock & Ready to Ship',
          'Practical reading for entrepreneurs and managers.',
          'Business books with simple lessons for leadership, planning, and growth.',
          'books-placeholder.svg',
          20::numeric,
          'ready',
          'sea-freight',
          'seed',
          '[]'::jsonb,
          '[]'::jsonb,
          jsonb_build_array('Entrepreneurship guidance', 'Practical examples'),
          jsonb_build_array('Giftable set', 'Paperback edition')
        ),
        (
          'premium-wireless-headphones',
          'electronics',
          'Audio',
          'Premium Wireless Headphones',
          'Sound Pro',
          'TechPro',
          'Nexus Store',
          260::numeric,
          320::numeric,
          4.8::numeric,
          112,
          'Flash Deal',
          'In Stock & Ready to Ship',
          'Comfortable headphones with clear wireless audio.',
          'A compact audio companion for music, calls, and everyday listening.',
          'headphones-placeholder.svg',
          35::numeric,
          'ready',
          'air-freight',
          'seed',
          jsonb_build_array('Black', 'White'),
          '[]'::jsonb,
          jsonb_build_array('Noise isolation', 'Bluetooth connection'),
          jsonb_build_array('Long battery life', 'Foldable design')
        ),
        (
          'studio-sound-bluetooth-speaker',
          'electronics',
          'Audio',
          'Studio Sound Bluetooth Speaker',
          'Studio Sound',
          'Omni',
          'Nexus Store',
          420::numeric,
          500::numeric,
          4.7::numeric,
          75,
          'Flash Deal',
          'In Stock & Ready to Ship',
          'Portable speaker built for full, room-filling sound.',
          'A compact speaker that balances clear audio with easy wireless connection.',
          'Speaker.png',
          55::numeric,
          'ready',
          'sea-freight',
          'seed',
          jsonb_build_array('Black', 'Blue'),
          '[]'::jsonb,
          jsonb_build_array('Room-filling sound', 'Portable design'),
          jsonb_build_array('USB charging', 'Deep bass')
        ),
        (
          'ultra-hd-smart-tv',
          'electronics',
          'Television',
          'Ultra HD Smart TV',
          'Vision 4K',
          'Samsung',
          'Nexus Store',
          4200::numeric,
          4800::numeric,
          4.9::numeric,
          64,
          'Top Rated',
          'In Stock & Ready to Ship',
          'A large smart television for modern living rooms.',
          'A vivid 4K display with built-in smart features for streaming and entertainment.',
          'hero-tv.png',
          250::numeric,
          'ready',
          'sea-freight',
          'seed',
          jsonb_build_array('Black'),
          '[]'::jsonb,
          jsonb_build_array('4K display', 'Smart apps', 'Voice remote'),
          jsonb_build_array('Wall mount ready', 'Energy efficient')
        ),
        (
          'compact-digital-camera',
          'electronics',
          'Photography',
          'Compact Digital Camera',
          'Capture Pro',
          'Canon',
          'Nexus Store',
          1150::numeric,
          1380::numeric,
          4.7::numeric,
          27,
          'New',
          'In Stock & Ready to Ship',
          'A small camera that is easy to carry for quick shots.',
          'A simple digital camera made for travel, events, and everyday memories.',
          'camera.jpg',
          120::numeric,
          'ready',
          'air-freight',
          'seed',
          jsonb_build_array('Black'),
          '[]'::jsonb,
          jsonb_build_array('High resolution', 'Lightweight body'),
          jsonb_build_array('Tripod friendly', 'Memory card support')
        ),
        (
          'ultra-slim-smartphone',
          'electronics',
          'Phones',
          'Ultra Slim Smartphone',
          'Nova Line',
          'TechPro',
          'Nexus Store',
          3800::numeric,
          4200::numeric,
          4.8::numeric,
          90,
          'New',
          'In Stock & Ready to Ship',
          'A slim smartphone with a premium everyday feel.',
          'A modern phone with a large display, fast charging, and reliable everyday performance.',
          'hero-phone.png',
          90::numeric,
          'ready',
          'air-freight',
          'seed',
          jsonb_build_array('Black', 'White', 'Blue'),
          '[]'::jsonb,
          jsonb_build_array('Large display', 'Fast charging', 'Dual SIM'),
          jsonb_build_array('Premium finish', 'Fingerprint unlock')
        ),
        (
          'laurel-wrath-signature-shirt',
          'fashion',
          'Streetwear',
          'Laurel Wrath Signature Shirt',
          'Laurel Wrath',
          'NBG',
          'NBG Fashion',
          260::numeric,
          320::numeric,
          4.6::numeric,
          39,
          'Best Seller',
          'In Stock & Ready to Ship',
          'A relaxed shirt for streetwear and casual outfits.',
          'Soft fabric and a clean fit for easy everyday styling.',
          'laurel wrath shirt.png',
          20::numeric,
          'ready',
          'air-freight',
          'seed',
          jsonb_build_array('Black', 'White', 'Gray'),
          jsonb_build_array('S', 'M', 'L', 'XL'),
          jsonb_build_array('Soft cotton blend', 'Relaxed fit'),
          jsonb_build_array('Daily wear', 'Easy to style')
        ),
        (
          'classic-unisex-tee',
          'fashion',
          'Basics',
          'Classic Unisex Tee',
          'Essential Line',
          'Nexus',
          'NBG Fashion',
          180::numeric,
          220::numeric,
          4.5::numeric,
          28,
          'New',
          'In Stock & Ready to Ship',
          'A simple tee for everyday outfits.',
          'A lightweight unisex shirt designed to fit into any casual wardrobe.',
          'laurel wrath shirt.png',
          18::numeric,
          'ready',
          'air-freight',
          'seed',
          jsonb_build_array('Black', 'White'),
          jsonb_build_array('S', 'M', 'L', 'XL', '2XL'),
          jsonb_build_array('Breathable fabric', 'Unisex cut'),
          jsonb_build_array('Everyday essential', 'Pair with anything')
        ),
        (
          'ergonomic-office-chair',
          'home-and-garden',
          'Workspace',
          'Ergonomic Office Chair',
          'Workspace Pro',
          'Omni',
          'Nexus Store',
          950::numeric,
          1100::numeric,
          4.7::numeric,
          58,
          'Top Pick',
          'In Stock & Ready to Ship',
          'A supportive chair for long work sessions.',
          'An office chair with comfort-focused support for home and work setups.',
          'office chair.jpg',
          85::numeric,
          'ready',
          'sea-freight',
          'seed',
          jsonb_build_array('Black'),
          '[]'::jsonb,
          jsonb_build_array('Lumbar support', 'Adjustable height'),
          jsonb_build_array('Office comfort', 'Durable build')
        ),
        (
          'samsung-double-door-fridge',
          'home-and-garden',
          'Kitchen',
          'Samsung Double Door Fridge',
          'Cool Pro',
          'Samsung',
          'Nexus Store',
          6800::numeric,
          7600::numeric,
          4.8::numeric,
          22,
          'Best Seller',
          'In Stock & Ready to Ship',
          'A spacious fridge for everyday family storage.',
          'A reliable refrigerator with a wide storage layout and efficient cooling.',
          'frige2.jpeg',
          450::numeric,
          'ready',
          'sea-freight',
          'seed',
          jsonb_build_array('Gray'),
          '[]'::jsonb,
          jsonb_build_array('Large capacity', 'Fast cooling', 'Energy saving'),
          jsonb_build_array('Family size', 'Warranty ready')
        ),
        (
          'electric-kettle-pro',
          'home-and-garden',
          'Kitchen',
          'Electric Kettle Pro',
          'Kitchen Pro',
          'Omni',
          'Nexus Store',
          280::numeric,
          340::numeric,
          4.5::numeric,
          61,
          'New',
          'In Stock & Ready to Ship',
          'A compact kettle for quick boiling water.',
          'A practical kettle for tea, coffee, and kitchen convenience.',
          'kettle.jpg',
          30::numeric,
          'ready',
          'air-freight',
          'seed',
          jsonb_build_array('Black'),
          '[]'::jsonb,
          jsonb_build_array('Fast boil', 'Auto shut-off'),
          jsonb_build_array('Compact size', 'Easy pour')
        ),
        (
          'washing-machine-pro',
          'home-and-garden',
          'Laundry',
          'Washing Machine Pro',
          'Laundry Pro',
          'TechPro',
          'Nexus Store',
          2100::numeric,
          2450::numeric,
          4.7::numeric,
          18,
          'Top Pick',
          'In Stock & Ready to Ship',
          'A reliable washing machine for busy homes.',
          'A family-friendly washer designed for dependable laundry day performance.',
          'washingmachine1.png',
          180::numeric,
          'ready',
          'sea-freight',
          'seed',
          jsonb_build_array('White'),
          '[]'::jsonb,
          jsonb_build_array('Large drum', 'Multiple wash modes'),
          jsonb_build_array('Family-friendly', 'Low noise')
        )
    ) as seed(
      slug,
      category_slug,
      subcategory_label,
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
      source,
      colors,
      sizes,
      features,
      perks
    )
  loop
    v_inserted := false;

    select *
      into v_category
    from public.categories
    where lower(slug) = lower(v_seed.category_slug);

    if not found then
      raise exception 'Required seed category "%" is missing.', v_seed.category_slug;
    end if;

    if v_category.status <> 'active' or v_category.deleted_at is not null then
      raise exception 'Required seed category "%" must be active and undeleted.', v_seed.category_slug;
    end if;

    select *
      into v_existing
    from public.products
    where lower(slug) = lower(v_seed.slug)
    limit 1;

    if found then
      if v_existing.category_id is distinct from v_category.id
         or v_existing.subcategory_label is distinct from nullif(btrim(v_seed.subcategory_label), '')
         or v_existing.slug is distinct from v_seed.slug
         or v_existing.name is distinct from v_seed.name
         or v_existing.series is distinct from nullif(btrim(v_seed.series), '')
         or v_existing.brand is distinct from nullif(btrim(v_seed.brand), '')
         or v_existing.sold_by is distinct from nullif(btrim(v_seed.sold_by), '')
         or v_existing.price is distinct from v_seed.price
         or v_existing.compare_at is distinct from v_seed.compare_at
         or v_existing.rating is distinct from v_seed.rating
         or v_existing.review_count is distinct from v_seed.review_count
         or v_existing.badge is distinct from nullif(btrim(v_seed.badge), '')
         or v_existing.stock_status is distinct from v_seed.stock_status
         or v_existing.description is distinct from nullif(btrim(v_seed.description), '')
         or v_existing.overview is distinct from nullif(btrim(v_seed.overview), '')
         or v_existing.primary_image_url is distinct from nullif(btrim(v_seed.primary_image_url), '')
         or v_existing.shipping_fee is distinct from v_seed.shipping_fee
         or v_existing.shipping_fee_status is distinct from v_seed.shipping_fee_status
         or v_existing.shipping_method is distinct from v_seed.shipping_method
         or v_existing.status is distinct from 'active'
         or v_existing.source is distinct from v_seed.source
         or v_existing.deleted_at is not null then
        raise exception 'Seed product "%" conflicts with the expected storefront seed values.', v_seed.slug;
      end if;
    else
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
        source
      ) values (
        v_category.id,
        nullif(btrim(v_seed.subcategory_label), ''),
        v_seed.slug,
        v_seed.name,
        nullif(btrim(v_seed.series), ''),
        nullif(btrim(v_seed.brand), ''),
        nullif(btrim(v_seed.sold_by), ''),
        v_seed.price,
        v_seed.compare_at,
        v_seed.rating,
        v_seed.review_count,
        nullif(btrim(v_seed.badge), ''),
        v_seed.stock_status,
        nullif(btrim(v_seed.description), ''),
        nullif(btrim(v_seed.overview), ''),
        nullif(btrim(v_seed.primary_image_url), ''),
        v_seed.shipping_fee,
        v_seed.shipping_fee_status,
        v_seed.shipping_method,
        'active',
        v_seed.source
      )
      returning *
      into v_existing;
      v_inserted := true;
    end if;

    if v_inserted then
      insert into public.product_colors (product_id, color_name, display_order)
      select
        v_existing.id,
        value,
        ordinality
      from jsonb_array_elements_text(v_seed.colors) with ordinality as item(value, ordinality);

      insert into public.product_sizes (product_id, size_name, display_order)
      select
        v_existing.id,
        value,
        ordinality
      from jsonb_array_elements_text(v_seed.sizes) with ordinality as item(value, ordinality);

      insert into public.product_features (product_id, feature_text, display_order)
      select
        v_existing.id,
        value,
        ordinality
      from jsonb_array_elements_text(v_seed.features) with ordinality as item(value, ordinality);

      insert into public.product_perks (product_id, perk_text, display_order)
      select
        v_existing.id,
        value,
        ordinality
      from jsonb_array_elements_text(v_seed.perks) with ordinality as item(value, ordinality);
    end if;

    select coalesce(array_agg(value order by ordinality), '{}'::text[])
      into v_expected_text_array
    from jsonb_array_elements_text(v_seed.colors) with ordinality as item(value, ordinality);

    select coalesce(array_agg(color_name order by display_order, created_at, id), '{}'::text[])
      into v_actual_text_array
    from public.product_colors
    where product_id = v_existing.id;

    if v_actual_text_array is distinct from v_expected_text_array then
      raise exception 'Seed product "%" has unexpected color rows.', v_seed.slug;
    end if;

    select coalesce(array_agg(value order by ordinality), '{}'::text[])
      into v_expected_text_array
    from jsonb_array_elements_text(v_seed.sizes) with ordinality as item(value, ordinality);

    select coalesce(array_agg(size_name order by display_order, created_at, id), '{}'::text[])
      into v_actual_text_array
    from public.product_sizes
    where product_id = v_existing.id;

    if v_actual_text_array is distinct from v_expected_text_array then
      raise exception 'Seed product "%" has unexpected size rows.', v_seed.slug;
    end if;

    select coalesce(array_agg(value order by ordinality), '{}'::text[])
      into v_expected_text_array
    from jsonb_array_elements_text(v_seed.features) with ordinality as item(value, ordinality);

    select coalesce(array_agg(feature_text order by display_order, created_at, id), '{}'::text[])
      into v_actual_text_array
    from public.product_features
    where product_id = v_existing.id;

    if v_actual_text_array is distinct from v_expected_text_array then
      raise exception 'Seed product "%" has unexpected feature rows.', v_seed.slug;
    end if;

    select coalesce(array_agg(value order by ordinality), '{}'::text[])
      into v_expected_text_array
    from jsonb_array_elements_text(v_seed.perks) with ordinality as item(value, ordinality);

    select coalesce(array_agg(perk_text order by display_order, created_at, id), '{}'::text[])
      into v_actual_text_array
    from public.product_perks
    where product_id = v_existing.id;

    if v_actual_text_array is distinct from v_expected_text_array then
      raise exception 'Seed product "%" has unexpected perk rows.', v_seed.slug;
    end if;
  end loop;

  select count(*)
    into v_total
  from public.products
  where lower(slug) = any (v_product_slugs);

  if v_total <> v_expected_product_count then
    raise exception 'Expected exactly % seed products, found %.', v_expected_product_count, v_total;
  end if;

  select count(*)
    into v_total
  from public.products
  where lower(slug) = any (v_product_slugs)
    and status = 'active'
    and deleted_at is null;

  if v_total <> v_expected_product_count then
    raise exception 'Expected all seed products to remain active and undeleted.';
  end if;

  select count(*)
    into v_total
  from public.product_images
  where product_id in (
    select id
    from public.products
    where lower(slug) = any (v_product_slugs)
  );

  if v_total <> v_expected_product_images then
    raise exception 'Expected exactly % seed product images, found %.', v_expected_product_images, v_total;
  end if;

  select count(*)
    into v_total
  from public.product_colors
  where product_id in (
    select id
    from public.products
    where lower(slug) = any (v_product_slugs)
  );

  if v_total <> v_expected_product_colors then
    raise exception 'Expected exactly % seed product color rows, found %.', v_expected_product_colors, v_total;
  end if;

  select count(*)
    into v_total
  from public.product_sizes
  where product_id in (
    select id
    from public.products
    where lower(slug) = any (v_product_slugs)
  );

  if v_total <> v_expected_product_sizes then
    raise exception 'Expected exactly % seed product size rows, found %.', v_expected_product_sizes, v_total;
  end if;

  select count(*)
    into v_total
  from public.product_features
  where product_id in (
    select id
    from public.products
    where lower(slug) = any (v_product_slugs)
  );

  if v_total <> v_expected_product_features then
    raise exception 'Expected exactly % seed product feature rows, found %.', v_expected_product_features, v_total;
  end if;

  select count(*)
    into v_total
  from public.product_perks
  where product_id in (
    select id
    from public.products
    where lower(slug) = any (v_product_slugs)
  );

  if v_total <> v_expected_product_perks then
    raise exception 'Expected exactly % seed product perk rows, found %.', v_expected_product_perks, v_total;
  end if;

  for v_seed in
    select unnest(v_product_slugs) as slug
  loop
    select count(*)
      into v_total
    from public.products
    where lower(slug) = lower(v_seed.slug);

    if v_total <> 1 then
      raise exception 'Expected seed product "%" to exist exactly once.', v_seed.slug;
    end if;
  end loop;
end;
$$;

commit;
