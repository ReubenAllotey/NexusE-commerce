begin;

do $$
declare
  v_seed record;
  v_existing public.categories%rowtype;
  v_count integer;
  v_expected_slug text;
  v_expected_count integer := 5;
begin
  for v_seed in
    select *
    from (
      values
        (
          'Beauty and Care',
          'beauty-and-care',
          'Skincare, beauty, and self-care essentials.',
          'beauty',
          1,
          true
        ),
        (
          'Books',
          'books',
          'Reading picks, study guides, and inspiration.',
          'books',
          2,
          true
        ),
        (
          'Electronics',
          'electronics',
          'Devices, accessories, and everyday tech.',
          'electronics',
          3,
          true
        ),
        (
          'Fashion',
          'fashion',
          'Wardrobe staples, accessories, and style picks.',
          'fashion',
          4,
          true
        ),
        (
          'Home and Garden',
          'home-and-garden',
          'Living, organization, and outdoor essentials.',
          'home',
          5,
          true
        )
    ) as seed(
      name,
      slug,
      description,
      icon,
      display_order,
      show_on_homepage
    )
  loop
    select *
      into v_existing
    from public.categories c
    where lower(c.slug) = lower(v_seed.slug);

    if not found then
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
        v_seed.name,
        v_seed.slug,
        v_seed.description,
        v_seed.icon,
        'active',
        null,
        v_seed.display_order,
        v_seed.show_on_homepage,
        null
      );
    else
      if v_existing.name is distinct from v_seed.name
         or v_existing.slug is distinct from v_seed.slug
         or v_existing.description is distinct from v_seed.description
         or v_existing.icon is distinct from v_seed.icon
         or v_existing.status is distinct from 'active'
         or v_existing.parent_id is not null
         or v_existing.display_order is distinct from v_seed.display_order
         or v_existing.show_on_homepage is distinct from v_seed.show_on_homepage
         or v_existing.deleted_at is not null then
        raise exception 'Seed category "%" conflicts with the expected storefront seed values.', v_seed.slug;
      end if;
    end if;

    select count(*)
      into v_count
    from public.categories
    where lower(slug) = lower(v_seed.slug);

    if v_count <> 1 then
      raise exception 'Expected seed category "%" to exist exactly once.', v_seed.slug;
    end if;
  end loop;

  select count(*)
    into v_count
  from public.categories
  where lower(slug) = any (
    array[
      'beauty-and-care',
      'books',
      'electronics',
      'fashion',
      'home-and-garden'
    ]
  );

  if v_count <> v_expected_count then
    raise exception 'Expected exactly % storefront seed categories.', v_expected_count;
  end if;

  for v_expected_slug in
    select unnest(array[
      'beauty-and-care',
      'books',
      'electronics',
      'fashion',
      'home-and-garden'
    ])
  loop
    select count(*)
      into v_count
    from public.categories
    where lower(slug) = lower(v_expected_slug);

    if v_count <> 1 then
      raise exception 'Expected storefront seed category "%" to exist exactly once.', v_expected_slug;
    end if;
  end loop;
end;
$$;

commit;
