begin;

create extension if not exists pgcrypto;

create table if not exists public.product_variation_groups (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  group_name text not null,
  display_order integer not null default 0,
  is_required boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (btrim(group_name) <> ''),
  check (display_order >= 0)
);

create table if not exists public.product_variation_options (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.product_variation_groups(id) on delete cascade,
  option_label text not null,
  option_value text,
  price_delta numeric not null default 0,
  compare_at_delta numeric,
  swatch_color text,
  image_url text,
  display_order integer not null default 0,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (btrim(option_label) <> ''),
  check (display_order >= 0)
);

alter table public.product_variation_groups
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz;

alter table public.product_variation_options
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz;

update public.product_variation_groups
set created_at = coalesce(created_at, now()),
    updated_at = coalesce(updated_at, now());

update public.product_variation_options
set created_at = coalesce(created_at, now()),
    updated_at = coalesce(updated_at, now());

alter table public.product_variation_groups
  alter column created_at set default now(),
  alter column created_at set not null,
  alter column updated_at set default now(),
  alter column updated_at set not null;

alter table public.product_variation_options
  alter column created_at set default now(),
  alter column created_at set not null,
  alter column updated_at set default now(),
  alter column updated_at set not null;

alter table public.cart_items
  add column if not exists variant_key text not null default 'default',
  add column if not exists selected_options jsonb not null default '[]'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

alter table public.order_items
  add column if not exists variant_key text not null default 'default',
  add column if not exists selected_options jsonb not null default '[]'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

update public.cart_items
set variant_key = case
  when coalesce(btrim(selected_color), '') = '' and coalesce(btrim(selected_size), '') = '' then 'default'
  else concat_ws('::', coalesce(nullif(btrim(selected_color), ''), ''), coalesce(nullif(btrim(selected_size), ''), ''))
end
where variant_key is null or btrim(variant_key) = '' or variant_key = 'default';

update public.order_items
set variant_key = case
  when coalesce(btrim(selected_color), '') = '' and coalesce(btrim(selected_size), '') = '' then 'default'
  else concat_ws('::', coalesce(nullif(btrim(selected_color), ''), ''), coalesce(nullif(btrim(selected_size), ''), ''))
end
where variant_key is null or btrim(variant_key) = '' or variant_key = 'default';

create unique index if not exists product_variation_groups_product_name_unique_idx
  on public.product_variation_groups (product_id, lower(group_name));

create index if not exists product_variation_groups_product_id_idx
  on public.product_variation_groups (product_id);

create unique index if not exists product_variation_options_group_label_unique_idx
  on public.product_variation_options (group_id, lower(option_label));

create unique index if not exists product_variation_options_one_default_idx
  on public.product_variation_options (group_id)
  where is_default;

create index if not exists product_variation_options_group_id_idx
  on public.product_variation_options (group_id);

drop index if exists cart_items_one_line_per_variant_idx;
create unique index cart_items_one_line_per_variant_idx
  on public.cart_items (cart_id, product_id, variant_key);

create index if not exists cart_items_variant_key_idx
  on public.cart_items (variant_key);

create index if not exists order_items_variant_key_idx
  on public.order_items (variant_key);

create or replace function private.normalize_variation_text(source text)
returns text
language sql
immutable
set search_path = ''
as $function$
  select nullif(btrim(coalesce(source, '')), '');
$function$;

create or replace function private.get_variation_group_bundle(p_product_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_groups jsonb;
begin
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', g.id,
        'productId', g.product_id,
        'groupName', g.group_name,
        'displayOrder', g.display_order,
        'isRequired', g.is_required,
        'createdAt', g.created_at,
        'updatedAt', g.updated_at,
        'options', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', o.id,
              'groupId', o.group_id,
              'label', o.option_label,
              'value', o.option_value,
              'priceDelta', o.price_delta,
              'compareAtDelta', o.compare_at_delta,
              'swatchColor', o.swatch_color,
              'imageUrl', o.image_url,
              'displayOrder', o.display_order,
              'isDefault', o.is_default,
              'createdAt', o.created_at,
              'updatedAt', o.updated_at
            )
            order by o.display_order asc, o.created_at asc, o.id asc
          )
          from public.product_variation_options as o
          where o.group_id = g.id
        ), '[]'::jsonb)
      )
      order by g.display_order asc, g.created_at asc, g.id asc
    ),
    '[]'::jsonb
  )
    into v_groups
  from public.product_variation_groups as g
  where g.product_id = p_product_id;

  return v_groups;
end;
$function$;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

create trigger product_variation_groups_set_updated_at
before update on public.product_variation_groups
for each row
execute function private.set_updated_at();

create trigger product_variation_options_set_updated_at
before update on public.product_variation_options
for each row
execute function private.set_updated_at();

alter table public.product_variation_groups enable row level security;
alter table public.product_variation_options enable row level security;

drop policy if exists product_variation_groups_select_public on public.product_variation_groups;
create policy product_variation_groups_select_public
on public.product_variation_groups
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.products as p
    where p.id = product_variation_groups.product_id
      and p.deleted_at is null
      and p.status = 'active'
  )
);

drop policy if exists product_variation_groups_select_admin on public.product_variation_groups;
create policy product_variation_groups_select_admin
on public.product_variation_groups
for select
to authenticated
using ((select private.is_admin_user()));

drop policy if exists product_variation_options_select_public on public.product_variation_options;
create policy product_variation_options_select_public
on public.product_variation_options
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.product_variation_groups as g
    join public.products as p
      on p.id = g.product_id
    where g.id = product_variation_options.group_id
      and p.deleted_at is null
      and p.status = 'active'
  )
);

drop policy if exists product_variation_options_select_admin on public.product_variation_options;
create policy product_variation_options_select_admin
on public.product_variation_options
for select
to authenticated
using ((select private.is_admin_user()));

create or replace function private.normalize_variation_group_json(source jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_group jsonb := coalesce(source, '{}'::jsonb);
  v_options jsonb := case
    when jsonb_typeof(coalesce(v_group->'options', '[]'::jsonb)) = 'array' then coalesce(v_group->'options', '[]'::jsonb)
    else '[]'::jsonb
  end;
begin
  return jsonb_build_object(
    'group_name', coalesce(nullif(btrim(v_group->>'group_name'), ''), nullif(btrim(v_group->>'groupName'), '')),
    'display_order', coalesce(nullif(btrim(coalesce(v_group->>'display_order', v_group->>'displayOrder', '')), '')::integer, 0),
    'is_required', coalesce(nullif(btrim(coalesce(v_group->>'is_required', v_group->>'isRequired', '')), '')::boolean, false),
    'options', v_options
  );
end;
$function$;

create or replace function public.save_product_bundle(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_request jsonb := coalesce(payload, '{}'::jsonb);
  v_product_json jsonb;
  v_images_json jsonb;
  v_colors_json jsonb;
  v_sizes_json jsonb;
  v_features_json jsonb;
  v_perks_json jsonb;
  v_variation_groups_json jsonb;
  v_existing public.products%rowtype;
  v_saved public.products%rowtype;
  v_category public.categories%rowtype;
  v_product_id uuid;
  v_category_id uuid;
  v_name text;
  v_slug text;
  v_slug_source text;
  v_subcategory_label text;
  v_series text;
  v_brand text;
  v_sold_by text;
  v_price numeric;
  v_compare_at numeric;
  v_rating numeric;
  v_review_count integer;
  v_badge text;
  v_stock_status text;
  v_description text;
  v_overview text;
  v_primary_image_url text;
  v_shipping_fee numeric;
  v_shipping_fee_status text;
  v_shipping_method text;
  v_source text;
  v_group_item jsonb;
  v_group_id uuid;
  v_group_label text;
  v_group_required boolean;
  v_group_order integer;
  v_group_options jsonb;
  v_option_item jsonb;
  v_option_label text;
  v_option_value text;
  v_price_delta numeric;
  v_compare_at_delta numeric;
  v_swatch_color text;
  v_image_url text;
  v_display_order integer;
  v_is_default boolean;
begin
  if not private.is_admin_user() then
    raise exception 'Only active administrators can save products.';
  end if;

  if jsonb_typeof(v_request) <> 'object' then
    raise exception 'Product bundle payload must be a JSON object.';
  end if;

  v_product_json := coalesce(v_request->'product', '{}'::jsonb);
  v_images_json := case when jsonb_typeof(coalesce(v_request->'images', '[]'::jsonb)) = 'array' then coalesce(v_request->'images', '[]'::jsonb) else '[]'::jsonb end;
  v_colors_json := case when jsonb_typeof(coalesce(v_request->'colors', '[]'::jsonb)) = 'array' then coalesce(v_request->'colors', '[]'::jsonb) else '[]'::jsonb end;
  v_sizes_json := case when jsonb_typeof(coalesce(v_request->'sizes', '[]'::jsonb)) = 'array' then coalesce(v_request->'sizes', '[]'::jsonb) else '[]'::jsonb end;
  v_features_json := case when jsonb_typeof(coalesce(v_request->'features', '[]'::jsonb)) = 'array' then coalesce(v_request->'features', '[]'::jsonb) else '[]'::jsonb end;
  v_perks_json := case when jsonb_typeof(coalesce(v_request->'perks', '[]'::jsonb)) = 'array' then coalesce(v_request->'perks', '[]'::jsonb) else '[]'::jsonb end;
  v_variation_groups_json := case when jsonb_typeof(coalesce(v_request->'variation_groups', v_request->'variationGroups', '[]'::jsonb)) = 'array' then coalesce(v_request->'variation_groups', v_request->'variationGroups', '[]'::jsonb) else '[]'::jsonb end;

  v_product_id := nullif(btrim(coalesce(v_product_json->>'id', '')), '')::uuid;
  if v_product_id is not null then
    select *
      into v_existing
    from public.products
    where id = v_product_id;

    if not found then
      raise exception 'Product id does not exist.';
    end if;
  end if;

  v_name := btrim(coalesce(v_product_json->>'name', ''));
  if v_name = '' then
    raise exception 'Product name is required.';
  end if;

  v_category_id := nullif(btrim(coalesce(v_product_json->>'category_id', v_product_json->>'categoryId', '')), '')::uuid;
  if v_category_id is null then
    raise exception 'Product category is required.';
  end if;

  select *
    into v_category
  from public.categories
  where id = v_category_id;

  if not found then
    raise exception 'Product category must exist.';
  end if;

  if v_category.deleted_at is not null or v_category.status <> 'active' then
    raise exception 'Active products cannot use hidden or deleted categories.';
  end if;

  v_slug_source := nullif(btrim(coalesce(v_product_json->>'slug', '')), '');
  if v_slug_source is null then
    v_slug := case
      when v_existing.id is not null then v_existing.slug
      else private.normalize_product_slug(v_name)
    end;
  else
    v_slug := private.normalize_product_slug(v_slug_source);
  end if;

  if v_slug is null then
    raise exception 'Product slug cannot be empty after normalization.';
  end if;

  if exists (
    select 1
    from public.products p
    where lower(p.slug) = lower(v_slug)
      and (v_existing.id is null or p.id <> v_existing.id)
  ) then
    raise exception 'Product slug must be unique.';
  end if;

  v_subcategory_label := nullif(btrim(coalesce(v_product_json->>'subcategory_label', v_product_json->>'subcategoryLabel', '')), '');
  v_series := nullif(btrim(coalesce(v_product_json->>'series', '')), '');
  v_brand := nullif(btrim(coalesce(v_product_json->>'brand', '')), '');
  v_sold_by := nullif(btrim(coalesce(v_product_json->>'sold_by', v_product_json->>'soldBy', '')), '');
  v_price := nullif(btrim(coalesce(v_product_json->>'price', '')), '')::numeric;
  v_compare_at := nullif(btrim(coalesce(v_product_json->>'compare_at', v_product_json->>'compareAt', '')), '')::numeric;
  v_rating := nullif(btrim(coalesce(v_product_json->>'rating', '')), '')::numeric;
  v_review_count := coalesce(nullif(btrim(coalesce(v_product_json->>'review_count', v_product_json->>'reviews', '')), '')::integer, 0);
  v_badge := nullif(btrim(coalesce(v_product_json->>'badge', '')), '');
  v_stock_status := coalesce(nullif(btrim(coalesce(v_product_json->>'stock_status', v_product_json->>'stockStatus', '')), ''), 'In Stock & Ready to Ship');
  v_description := nullif(btrim(coalesce(v_product_json->>'description', '')), '');
  v_overview := nullif(btrim(coalesce(v_product_json->>'overview', '')), '');
  v_primary_image_url := nullif(btrim(coalesce(v_product_json->>'primary_image_url', v_product_json->>'primaryImageUrl', v_product_json->>'mainImage', '')), '');
  v_shipping_fee := nullif(btrim(coalesce(v_product_json->>'shipping_fee', v_product_json->>'shippingFee', '')), '')::numeric;
  v_shipping_method := lower(btrim(coalesce(v_product_json->>'shipping_method', v_product_json->>'shippingMethod', 'air-freight')));
  v_source := coalesce(nullif(btrim(v_product_json->>'source'), ''), 'custom');
  v_shipping_fee_status := case when v_shipping_fee is null then 'pending' else 'ready' end;

  if v_price is null then
    raise exception 'Product price is required.';
  end if;

  if v_price < 0 then
    raise exception 'Product price cannot be negative.';
  end if;

  if v_compare_at is not null and v_compare_at < v_price then
    raise exception 'Compare-at price must be greater than or equal to the product price.';
  end if;

  if v_rating is not null and (v_rating < 0 or v_rating > 5) then
    raise exception 'Product rating must be between 0 and 5.';
  end if;

  if v_review_count < 0 then
    raise exception 'Review count cannot be negative.';
  end if;

  if v_shipping_fee is not null and v_shipping_fee < 0 then
    raise exception 'Shipping fee cannot be negative.';
  end if;

  if v_shipping_method not in ('air-freight', 'sea-freight') then
    raise exception 'Shipping method must be air-freight or sea-freight.';
  end if;

  if v_stock_status = '' then
    raise exception 'Stock status cannot be blank.';
  end if;

  if v_primary_image_url is null then
    select nullif(btrim(coalesce(elem->>'image_url', elem->>'src', '')), '')
      into v_primary_image_url
    from jsonb_array_elements(v_images_json) with ordinality as image_item(elem, ordinality)
    where nullif(btrim(coalesce(elem->>'image_url', elem->>'src', '')), '') is not null
    order by ordinality
    limit 1;
  end if;

  if v_primary_image_url is null then
    raise exception 'Product image is required.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_images_json) as image_item(elem)
    where btrim(coalesce(elem->>'image_url', elem->>'src', '')) = ''
  ) then
    raise exception 'Image URLs cannot be blank.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_colors_json) as color_item(elem)
    where btrim(coalesce(elem->>'color_name', elem->>'label', elem->>'value', '')) = ''
  ) then
    raise exception 'Color names cannot be blank.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_sizes_json) as size_item(elem)
    where btrim(coalesce(elem->>'size_name', elem->>'label', elem->>'value', '')) = ''
  ) then
    raise exception 'Size names cannot be blank.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_features_json) as feature_item(elem)
    where btrim(coalesce(elem->>'feature_text', elem->>'label', elem->>'value', '')) = ''
  ) then
    raise exception 'Feature text cannot be blank.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_perks_json) as perk_item(elem)
    where btrim(coalesce(elem->>'perk_text', elem->>'label', elem->>'value', '')) = ''
  ) then
    raise exception 'Perk text cannot be blank.';
  end if;

  if v_product_id is null then
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
      v_category_id,
      v_subcategory_label,
      v_slug,
      v_name,
      v_series,
      v_brand,
      v_sold_by,
      v_price,
      v_compare_at,
      v_rating,
      v_review_count,
      v_badge,
      v_stock_status,
      v_description,
      v_overview,
      v_primary_image_url,
      v_shipping_fee,
      v_shipping_fee_status,
      v_shipping_method,
      'active',
      v_source
    )
    returning *
    into v_saved;
  else
    update public.products
    set category_id = v_category_id,
        subcategory_label = v_subcategory_label,
        slug = v_slug,
        name = v_name,
        series = v_series,
        brand = v_brand,
        sold_by = v_sold_by,
        price = v_price,
        compare_at = v_compare_at,
        rating = v_rating,
        review_count = v_review_count,
        badge = v_badge,
        stock_status = v_stock_status,
        description = v_description,
        overview = v_overview,
        primary_image_url = v_primary_image_url,
        shipping_fee = v_shipping_fee,
        shipping_fee_status = v_shipping_fee_status,
        shipping_method = v_shipping_method,
        status = 'active',
        source = v_source
    where id = v_product_id
    returning *
    into v_saved;
  end if;

  delete from public.product_images where product_id = v_saved.id;
  delete from public.product_colors where product_id = v_saved.id;
  delete from public.product_sizes where product_id = v_saved.id;
  delete from public.product_features where product_id = v_saved.id;
  delete from public.product_perks where product_id = v_saved.id;
  delete from public.product_variation_options
  where group_id in (
    select id
    from public.product_variation_groups
    where product_id = v_saved.id
  );
  delete from public.product_variation_groups where product_id = v_saved.id;

  insert into public.product_images (product_id, image_url, display_order)
  select
    v_saved.id,
    normalized.image_url,
    row_number() over (order by normalized.ord)
  from (
    select distinct on (lower(image_url))
      image_url,
      ord
    from (
      select
        nullif(btrim(coalesce(elem->>'image_url', elem->>'src', '')), '') as image_url,
        ordinality as ord
      from jsonb_array_elements(v_images_json) with ordinality as image_item(elem, ordinality)
      where nullif(btrim(coalesce(elem->>'image_url', elem->>'src', '')), '') is not null
    ) as raw_images
    where lower(image_url) <> lower(v_primary_image_url)
    order by lower(image_url), ord
  ) as normalized
  order by normalized.ord;

  insert into public.product_colors (product_id, color_name, display_order)
  select
    v_saved.id,
    normalized.color_name,
    row_number() over (order by normalized.ord)
  from (
    select distinct on (lower(color_name))
      color_name,
      ord
    from (
      select
        nullif(btrim(coalesce(elem->>'color_name', elem->>'label', elem->>'value', '')), '') as color_name,
        ordinality as ord
      from jsonb_array_elements(v_colors_json) with ordinality as color_item(elem, ordinality)
      where nullif(btrim(coalesce(elem->>'color_name', elem->>'label', elem->>'value', '')), '') is not null
    ) as raw_colors
    order by lower(color_name), ord
  ) as normalized
  order by normalized.ord;

  insert into public.product_sizes (product_id, size_name, display_order)
  select
    v_saved.id,
    normalized.size_name,
    row_number() over (order by normalized.ord)
  from (
    select distinct on (lower(size_name))
      size_name,
      ord
    from (
      select
        nullif(btrim(coalesce(elem->>'size_name', elem->>'label', elem->>'value', '')), '') as size_name,
        ordinality as ord
      from jsonb_array_elements(v_sizes_json) with ordinality as size_item(elem, ordinality)
      where nullif(btrim(coalesce(elem->>'size_name', elem->>'label', elem->>'value', '')), '') is not null
    ) as raw_sizes
    order by lower(size_name), ord
  ) as normalized
  order by normalized.ord;

  insert into public.product_features (product_id, feature_text, display_order)
  select
    v_saved.id,
    normalized.feature_text,
    row_number() over (order by normalized.ord)
  from (
    select distinct on (lower(feature_text))
      feature_text,
      ord
    from (
      select
        nullif(btrim(coalesce(elem->>'feature_text', elem->>'label', elem->>'value', '')), '') as feature_text,
        ordinality as ord
      from jsonb_array_elements(v_features_json) with ordinality as feature_item(elem, ordinality)
      where nullif(btrim(coalesce(elem->>'feature_text', elem->>'label', elem->>'value', '')), '') is not null
    ) as raw_features
    order by lower(feature_text), ord
  ) as normalized
  order by normalized.ord;

  insert into public.product_perks (product_id, perk_text, display_order)
  select
    v_saved.id,
    normalized.perk_text,
    row_number() over (order by normalized.ord)
  from (
    select distinct on (lower(perk_text))
      perk_text,
      ord
    from (
      select
        nullif(btrim(coalesce(elem->>'perk_text', elem->>'label', elem->>'value', '')), '') as perk_text,
        ordinality as ord
      from jsonb_array_elements(v_perks_json) with ordinality as perk_item(elem, ordinality)
      where nullif(btrim(coalesce(elem->>'perk_text', elem->>'label', elem->>'value', '')), '') is not null
    ) as raw_perks
    order by lower(perk_text), ord
  ) as normalized
  order by normalized.ord;

  for v_group_item in
    select elem
    from jsonb_array_elements(v_variation_groups_json) with ordinality as group_item(elem, ordinality)
    order by ordinality
  loop
    v_group_label := private.normalize_variation_text(coalesce(v_group_item->>'group_name', v_group_item->>'groupName'));
    if v_group_label is null then
      continue;
    end if;

    v_group_order := coalesce(nullif(btrim(coalesce(v_group_item->>'display_order', v_group_item->>'displayOrder', '')), '')::integer, 0);
    v_group_required := coalesce(nullif(btrim(coalesce(v_group_item->>'is_required', v_group_item->>'isRequired', '')), '')::boolean, false);
    v_group_options := case
      when jsonb_typeof(coalesce(v_group_item->'options', '[]'::jsonb)) = 'array' then coalesce(v_group_item->'options', '[]'::jsonb)
      else '[]'::jsonb
    end;

    insert into public.product_variation_groups (
      product_id,
      group_name,
      display_order,
      is_required
    ) values (
      v_saved.id,
      v_group_label,
      v_group_order,
      v_group_required
    )
    returning id into v_group_id;

    for v_option_item in
      select elem
      from jsonb_array_elements(v_group_options) with ordinality as option_item(elem, ordinality)
      order by ordinality
    loop
      v_option_label := private.normalize_variation_text(coalesce(v_option_item->>'label', v_option_item->>'option_label', v_option_item->>'name'));
      if v_option_label is null then
        continue;
      end if;

      v_option_value := private.normalize_variation_text(coalesce(v_option_item->>'value', v_option_item->>'option_value'));
      v_price_delta := coalesce(nullif(btrim(coalesce(v_option_item->>'price_delta', v_option_item->>'priceDelta', '')), '')::numeric, 0);
      v_compare_at_delta := nullif(btrim(coalesce(v_option_item->>'compare_at_delta', v_option_item->>'compareAtDelta', '')), '')::numeric;
      v_swatch_color := private.normalize_variation_text(coalesce(v_option_item->>'swatch_color', v_option_item->>'swatchColor'));
      v_image_url := private.normalize_variation_text(coalesce(v_option_item->>'image_url', v_option_item->>'imageUrl'));
      v_display_order := coalesce(nullif(btrim(coalesce(v_option_item->>'display_order', v_option_item->>'displayOrder', '')), '')::integer, 0);
      v_is_default := coalesce(nullif(btrim(coalesce(v_option_item->>'is_default', v_option_item->>'isDefault', '')), '')::boolean, false);

      insert into public.product_variation_options (
        group_id,
        option_label,
        option_value,
        price_delta,
        compare_at_delta,
        swatch_color,
        image_url,
        display_order,
        is_default
      ) values (
        v_group_id,
        v_option_label,
        v_option_value,
        v_price_delta,
        v_compare_at_delta,
        v_swatch_color,
        v_image_url,
        v_display_order,
        v_is_default
      );
    end loop;
  end loop;

  select *
    into v_saved
  from public.products
  where id = v_saved.id;

  return jsonb_build_object(
    'product', to_jsonb(v_saved),
    'category', to_jsonb(v_category),
    'images', coalesce((
      select jsonb_agg(to_jsonb(item) order by item.display_order, item.created_at, item.id)
      from public.product_images item
      where item.product_id = v_saved.id
    ), '[]'::jsonb),
    'colors', coalesce((
      select jsonb_agg(to_jsonb(item) order by item.display_order, item.created_at, item.id)
      from public.product_colors item
      where item.product_id = v_saved.id
    ), '[]'::jsonb),
    'sizes', coalesce((
      select jsonb_agg(to_jsonb(item) order by item.display_order, item.created_at, item.id)
      from public.product_sizes item
      where item.product_id = v_saved.id
    ), '[]'::jsonb),
    'features', coalesce((
      select jsonb_agg(to_jsonb(item) order by item.display_order, item.created_at, item.id)
      from public.product_features item
      where item.product_id = v_saved.id
    ), '[]'::jsonb),
    'perks', coalesce((
      select jsonb_agg(to_jsonb(item) order by item.display_order, item.created_at, item.id)
      from public.product_perks item
      where item.product_id = v_saved.id
    ), '[]'::jsonb),
    'variation_groups', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', g.id,
          'productId', g.product_id,
          'groupName', g.group_name,
          'displayOrder', g.display_order,
          'isRequired', g.is_required,
          'createdAt', g.created_at,
          'updatedAt', g.updated_at,
          'options', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', o.id,
                'groupId', o.group_id,
                'label', o.option_label,
                'value', o.option_value,
                'priceDelta', o.price_delta,
                'compareAtDelta', o.compare_at_delta,
                'swatchColor', o.swatch_color,
                'imageUrl', o.image_url,
                'displayOrder', o.display_order,
                'isDefault', o.is_default,
                'createdAt', o.created_at,
                'updatedAt', o.updated_at
              )
              order by o.display_order asc, o.created_at asc, o.id asc
            )
            from public.product_variation_options o
            where o.group_id = g.id
          ), '[]'::jsonb)
        )
        order by g.display_order asc, g.created_at asc, g.id asc
      )
      from public.product_variation_groups g
      where g.product_id = v_saved.id
    ), '[]'::jsonb)
  );
end;
$function$;

drop policy if exists product_variation_groups_select_public on public.product_variation_groups;
create policy product_variation_groups_select_public
on public.product_variation_groups
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.products as p
    where p.id = product_variation_groups.product_id
      and p.deleted_at is null
      and p.status = 'active'
  )
);

drop policy if exists product_variation_groups_select_admin on public.product_variation_groups;
create policy product_variation_groups_select_admin
on public.product_variation_groups
for select
to authenticated
using ((select private.is_admin_user()));

drop policy if exists product_variation_options_select_public on public.product_variation_options;
create policy product_variation_options_select_public
on public.product_variation_options
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.product_variation_groups as g
    join public.products as p
      on p.id = g.product_id
    where g.id = product_variation_options.group_id
      and p.deleted_at is null
      and p.status = 'active'
  )
);

drop policy if exists product_variation_options_select_admin on public.product_variation_options;
create policy product_variation_options_select_admin
on public.product_variation_options
for select
to authenticated
using ((select private.is_admin_user()));

drop trigger if exists product_variation_groups_set_updated_at on public.product_variation_groups;
create trigger product_variation_groups_set_updated_at
before update on public.product_variation_groups
for each row
execute function private.set_updated_at();

drop trigger if exists product_variation_options_set_updated_at on public.product_variation_options;
create trigger product_variation_options_set_updated_at
before update on public.product_variation_options
for each row
execute function private.set_updated_at();

revoke all on function private.normalize_variation_text(text) from public;
revoke all on function private.normalize_variation_text(text) from anon;
revoke all on function private.normalize_variation_text(text) from authenticated;
revoke all on function private.get_variation_group_bundle(uuid) from public;
revoke all on function private.get_variation_group_bundle(uuid) from anon;
revoke all on function private.get_variation_group_bundle(uuid) from authenticated;
revoke all on function private.normalize_variation_group_json(jsonb) from public;
revoke all on function private.normalize_variation_group_json(jsonb) from anon;
revoke all on function private.normalize_variation_group_json(jsonb) from authenticated;
revoke all on function public.save_product_bundle(jsonb) from public;
revoke all on function public.save_product_bundle(jsonb) from anon;
revoke all on function public.save_product_bundle(jsonb) from authenticated;
grant execute on function public.save_product_bundle(jsonb) to authenticated;

revoke all on table public.product_variation_groups from public;
revoke all on table public.product_variation_groups from anon;
revoke all on table public.product_variation_groups from authenticated;
grant select on table public.product_variation_groups to anon;
grant select on table public.product_variation_groups to authenticated;

revoke all on table public.product_variation_options from public;
revoke all on table public.product_variation_options from anon;
revoke all on table public.product_variation_options from authenticated;
grant select on table public.product_variation_options to anon;
grant select on table public.product_variation_options to authenticated;

commit;
