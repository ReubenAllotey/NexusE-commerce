begin;

create extension if not exists pgcrypto;
create schema if not exists private;

create table public.products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories(id) on delete restrict,
  subcategory_label text,
  slug text not null,
  name text not null,
  series text,
  brand text,
  sold_by text,
  price numeric not null,
  compare_at numeric,
  rating numeric,
  review_count integer not null default 0,
  badge text,
  stock_status text not null default 'In Stock & Ready to Ship',
  description text,
  overview text,
  primary_image_url text,
  shipping_fee numeric,
  shipping_fee_status text not null default 'pending',
  shipping_method text not null default 'air-freight',
  status text not null default 'active',
  source text not null default 'custom',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (btrim(name) <> ''),
  check (btrim(slug) <> ''),
  check (price >= 0),
  check (compare_at is null or compare_at >= price),
  check (rating is null or (rating >= 0 and rating <= 5)),
  check (review_count >= 0),
  check (shipping_fee is null or shipping_fee >= 0),
  -- Draft and hidden product states can be introduced later through a dedicated migration
  -- once the actual workflow is defined for this catalog.
  check (status = 'active'),
  check (stock_status in ('In Stock & Ready to Ship')),
  check (shipping_fee_status in ('pending', 'ready')),
  check (shipping_method in ('air-freight', 'sea-freight')),
  check (source in ('custom', 'seed'))
);

create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  image_url text not null,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  check (btrim(image_url) <> ''),
  check (display_order >= 0)
);

create table public.product_colors (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  color_name text not null,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  check (btrim(color_name) <> ''),
  check (display_order >= 0)
);

create table public.product_sizes (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  size_name text not null,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  check (btrim(size_name) <> ''),
  check (display_order >= 0)
);

create table public.product_features (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  feature_text text not null,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  check (btrim(feature_text) <> ''),
  check (display_order >= 0)
);

create table public.product_perks (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  perk_text text not null,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  check (btrim(perk_text) <> ''),
  check (display_order >= 0)
);

create unique index products_slug_normalized_unique_idx
  on public.products (lower(slug));

create index products_category_id_idx
  on public.products (category_id);

create index products_status_idx
  on public.products (status);

create index products_created_at_idx
  on public.products (created_at);

create index products_deleted_at_idx
  on public.products (deleted_at);

create index products_price_idx
  on public.products (price);

create index products_brand_idx
  on public.products (brand);

create index product_images_product_id_idx
  on public.product_images (product_id);

create index product_colors_product_id_idx
  on public.product_colors (product_id);

create index product_sizes_product_id_idx
  on public.product_sizes (product_id);

create index product_features_product_id_idx
  on public.product_features (product_id);

create index product_perks_product_id_idx
  on public.product_perks (product_id);

alter table public.products enable row level security;
alter table public.product_images enable row level security;
alter table public.product_colors enable row level security;
alter table public.product_sizes enable row level security;
alter table public.product_features enable row level security;
alter table public.product_perks enable row level security;

revoke all on schema private from public;
revoke all on schema private from anon;
revoke all on schema private from authenticated;
grant usage on schema private to authenticated;

create or replace function private.normalize_product_slug(source text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(
    trim(
      both '-'
      from regexp_replace(lower(btrim(coalesce(source, ''))), '[^a-z0-9]+', '-', 'g')
    ),
    ''
  );
$$;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_products_updated_at
before update on public.products
for each row execute function private.set_updated_at();

create or replace function public.save_product_bundle(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request jsonb := coalesce(payload, '{}'::jsonb);
  v_product_json jsonb;
  v_images_json jsonb;
  v_colors_json jsonb;
  v_sizes_json jsonb;
  v_features_json jsonb;
  v_perks_json jsonb;
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
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.set_product_deleted_at(product_id uuid, deleted_at timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_saved public.products%rowtype;
begin
  if not private.is_admin_user() then
    raise exception 'Only active administrators can update product visibility.';
  end if;

  update public.products
  set deleted_at = coalesce(deleted_at, now())
  where id = product_id
  returning *
  into v_saved;

  if not found then
    raise exception 'Product id does not exist.';
  end if;

  return jsonb_build_object('product', to_jsonb(v_saved));
end;
$$;

create or replace function public.restore_product(product_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_saved public.products%rowtype;
begin
  if not private.is_admin_user() then
    raise exception 'Only active administrators can update product visibility.';
  end if;

  update public.products
  set deleted_at = null
  where id = product_id
  returning *
  into v_saved;

  if not found then
    raise exception 'Product id does not exist.';
  end if;

  return jsonb_build_object('product', to_jsonb(v_saved));
end;
$$;

drop policy if exists products_select_public on public.products;
create policy products_select_public
on public.products
for select
to anon, authenticated
using (deleted_at is null and status = 'active');

drop policy if exists products_select_admin on public.products;
create policy products_select_admin
on public.products
for select
to authenticated
using ((select private.is_admin_user()));

drop policy if exists product_images_select_public on public.product_images;
create policy product_images_select_public
on public.product_images
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.products p
    where p.id = product_images.product_id
      and p.deleted_at is null
      and p.status = 'active'
  )
);

drop policy if exists product_images_select_admin on public.product_images;
create policy product_images_select_admin
on public.product_images
for select
to authenticated
using ((select private.is_admin_user()));

drop policy if exists product_colors_select_public on public.product_colors;
create policy product_colors_select_public
on public.product_colors
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.products p
    where p.id = product_colors.product_id
      and p.deleted_at is null
      and p.status = 'active'
  )
);

drop policy if exists product_colors_select_admin on public.product_colors;
create policy product_colors_select_admin
on public.product_colors
for select
to authenticated
using ((select private.is_admin_user()));

drop policy if exists product_sizes_select_public on public.product_sizes;
create policy product_sizes_select_public
on public.product_sizes
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.products p
    where p.id = product_sizes.product_id
      and p.deleted_at is null
      and p.status = 'active'
  )
);

drop policy if exists product_sizes_select_admin on public.product_sizes;
create policy product_sizes_select_admin
on public.product_sizes
for select
to authenticated
using ((select private.is_admin_user()));

drop policy if exists product_features_select_public on public.product_features;
create policy product_features_select_public
on public.product_features
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.products p
    where p.id = product_features.product_id
      and p.deleted_at is null
      and p.status = 'active'
  )
);

drop policy if exists product_features_select_admin on public.product_features;
create policy product_features_select_admin
on public.product_features
for select
to authenticated
using ((select private.is_admin_user()));

drop policy if exists product_perks_select_public on public.product_perks;
create policy product_perks_select_public
on public.product_perks
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.products p
    where p.id = product_perks.product_id
      and p.deleted_at is null
      and p.status = 'active'
  )
);

drop policy if exists product_perks_select_admin on public.product_perks;
create policy product_perks_select_admin
on public.product_perks
for select
to authenticated
using ((select private.is_admin_user()));

revoke all on function private.normalize_product_slug(text) from public;
revoke all on function private.normalize_product_slug(text) from anon;
revoke all on function private.normalize_product_slug(text) from authenticated;

revoke all on function private.set_updated_at() from public;
revoke all on function private.set_updated_at() from anon;
revoke all on function private.set_updated_at() from authenticated;

revoke all on function private.is_admin_user() from public;
revoke all on function private.is_admin_user() from anon;
revoke all on function private.is_admin_user() from authenticated;
grant execute on function private.is_admin_user() to authenticated;

revoke all on function public.save_product_bundle(jsonb) from public;
revoke all on function public.save_product_bundle(jsonb) from anon;
revoke all on function public.save_product_bundle(jsonb) from authenticated;
grant execute on function public.save_product_bundle(jsonb) to authenticated;

revoke all on function public.set_product_deleted_at(uuid, timestamptz) from public;
revoke all on function public.set_product_deleted_at(uuid, timestamptz) from anon;
revoke all on function public.set_product_deleted_at(uuid, timestamptz) from authenticated;
grant execute on function public.set_product_deleted_at(uuid, timestamptz) to authenticated;

revoke all on function public.restore_product(uuid) from public;
revoke all on function public.restore_product(uuid) from anon;
revoke all on function public.restore_product(uuid) from authenticated;
grant execute on function public.restore_product(uuid) to authenticated;

revoke all on public.products from public;
revoke all on public.products from anon;
revoke all on public.products from authenticated;
grant select on public.products to anon;
grant select on public.products to authenticated;

revoke all on public.product_images from public;
revoke all on public.product_images from anon;
revoke all on public.product_images from authenticated;
grant select on public.product_images to anon;
grant select on public.product_images to authenticated;

revoke all on public.product_colors from public;
revoke all on public.product_colors from anon;
revoke all on public.product_colors from authenticated;
grant select on public.product_colors to anon;
grant select on public.product_colors to authenticated;

revoke all on public.product_sizes from public;
revoke all on public.product_sizes from anon;
revoke all on public.product_sizes from authenticated;
grant select on public.product_sizes to anon;
grant select on public.product_sizes to authenticated;

revoke all on public.product_features from public;
revoke all on public.product_features from anon;
revoke all on public.product_features from authenticated;
grant select on public.product_features to anon;
grant select on public.product_features to authenticated;

revoke all on public.product_perks from public;
revoke all on public.product_perks from anon;
revoke all on public.product_perks from authenticated;
grant select on public.product_perks to anon;
grant select on public.product_perks to authenticated;

commit;
