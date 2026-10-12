begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists public.product_variation_combinations (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  combination_key text not null,
  selected_options jsonb not null default '[]'::jsonb,
  price numeric not null,
  compare_at numeric,
  sku text,
  stock_quantity integer,
  image_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_variation_combinations_key_unique unique (product_id, combination_key),
  constraint product_variation_combinations_price_check check (price >= 0),
  constraint product_variation_combinations_compare_at_check check (compare_at is null or compare_at >= price),
  constraint product_variation_combinations_stock_check check (stock_quantity is null or stock_quantity >= 0),
  constraint product_variation_combinations_key_not_blank check (btrim(combination_key) <> ''),
  constraint product_variation_combinations_options_array check (jsonb_typeof(selected_options) = 'array')
);

create index if not exists product_variation_combinations_product_idx
  on public.product_variation_combinations (product_id, is_active, combination_key);

create or replace function private.set_variation_combination_updated_at()
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

drop trigger if exists product_variation_combinations_set_updated_at on public.product_variation_combinations;
create trigger product_variation_combinations_set_updated_at
before update on public.product_variation_combinations
for each row
execute function private.set_variation_combination_updated_at();

alter table public.product_variation_combinations enable row level security;

drop policy if exists product_variation_combinations_select_public on public.product_variation_combinations;
create policy product_variation_combinations_select_public
on public.product_variation_combinations
for select
to anon, authenticated
using (
  is_active
  and exists (
    select 1
    from public.products as p
    where p.id = product_variation_combinations.product_id
      and p.status = 'active'
      and p.deleted_at is null
  )
);

drop policy if exists product_variation_combinations_select_admin on public.product_variation_combinations;
create policy product_variation_combinations_select_admin
on public.product_variation_combinations
for select
to authenticated
using ((select private.is_admin_user()));

revoke all on table public.product_variation_combinations from public, anon, authenticated;
grant select on table public.product_variation_combinations to anon, authenticated;

create or replace function public.save_product_variation_combinations(
  p_product_id uuid,
  p_combinations jsonb default '[]'::jsonb
)
returns setof public.product_variation_combinations
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_item jsonb;
  v_options jsonb;
  v_key text;
  v_price numeric;
  v_compare_at numeric;
  v_sku text;
  v_stock integer;
  v_image text;
  v_active boolean;
  v_seen text[] := '{}'::text[];
  v_group_name text;
  v_value text;
  v_group_count integer;
  v_option_count integer;
  v_canonical_options jsonb;
  v_group_id uuid;
  v_option_id uuid;
  v_canonical_group text;
  v_canonical_value text;
  v_requested_option_id text;
begin
  if not private.is_admin_user() then
    raise exception 'Only active administrators can save variation combinations.';
  end if;

  if p_product_id is null or not exists (select 1 from public.products where id = p_product_id) then
    raise exception 'A valid product is required.';
  end if;

  if jsonb_typeof(coalesce(p_combinations, '[]'::jsonb)) <> 'array' then
    raise exception 'Variation combinations must be an array.';
  end if;

  -- An empty payload is ambiguous: it can mean "deselect all" or a partial
  -- admin submission. Require explicit inactive rows for a deliberate empty
  -- availability set so a broken form cannot deactivate existing inventory.
  if jsonb_array_length(coalesce(p_combinations, '[]'::jsonb)) = 0
     and exists (
       select 1
       from public.product_variation_combinations
       where product_id = p_product_id
         and is_active
     ) then
    raise exception 'A complete combination payload is required; submit inactive rows to intentionally deselect combinations.';
  end if;

  update public.product_variation_combinations
  set is_active = false, updated_at = now()
  where product_id = p_product_id;

  for v_item in select value from jsonb_array_elements(coalesce(p_combinations, '[]'::jsonb)) loop
    v_options := case
      when jsonb_typeof(v_item->'selected_options') = 'array' then v_item->'selected_options'
      when jsonb_typeof(v_item->'selectedOptions') = 'array' then v_item->'selectedOptions'
      else '[]'::jsonb
    end;

    if jsonb_array_length(v_options) < 2 then
      raise exception 'A combination requires at least two selected attributes.';
    end if;

    select count(*), count(distinct lower(btrim(coalesce(option_item->>'group_name', option_item->>'groupName', ''))))
      into v_option_count, v_group_count
    from jsonb_array_elements(v_options) as option_item;
    if v_group_count < 2 then
      raise exception 'A combination must use two or more distinct attributes.';
    end if;
    if v_option_count <> v_group_count then
      raise exception 'A combination cannot contain duplicate attribute groups.';
    end if;

    v_canonical_options := '[]'::jsonb;
    for v_group_name, v_value, v_requested_option_id in
      select lower(btrim(coalesce(option_item->>'group_name', option_item->>'groupName', ''))),
             lower(btrim(coalesce(option_item->>'value', option_item->>'label', ''))),
             nullif(btrim(coalesce(option_item->>'optionId', option_item->>'option_id', '')), '')
      from jsonb_array_elements(v_options) as option_item
    loop
      v_group_id := null;
      v_option_id := null;
      v_canonical_group := null;
      v_canonical_value := null;
      select g.id, o.id, btrim(g.group_name), btrim(coalesce(o.option_value, o.option_label))
        into v_group_id, v_option_id, v_canonical_group, v_canonical_value
      from public.product_variation_groups g
      join public.product_variation_options o on o.group_id = g.id
      where g.product_id = p_product_id
        and lower(btrim(g.group_name)) = v_group_name
        and (
          (v_requested_option_id is not null and o.id::text = v_requested_option_id)
          or (v_requested_option_id is null and lower(btrim(coalesce(o.option_value, o.option_label))) = v_value)
        )
      limit 1;

      if v_group_id is null or v_option_id is null then
        raise exception 'Variation combination contains an invalid option.';
      end if;

      v_canonical_options := v_canonical_options || jsonb_build_array(jsonb_build_object(
        'groupId', v_group_id,
        'groupName', v_canonical_group,
        'optionId', v_option_id,
        'value', v_canonical_value
      ));
    end loop;

    -- Always derive the key from validated database values. Frontend keys are
    -- deliberately ignored so aliases or reordered payloads cannot collide.
    select string_agg(
      lower(btrim(option_item->>'groupName')) || '=' || lower(btrim(option_item->>'value')),
      '::' order by lower(btrim(option_item->>'groupName'))
    ) into v_key
    from jsonb_array_elements(v_canonical_options) as option_item;

    if v_key is null or v_key = '' or v_key = any(v_seen) then
      raise exception 'Variation combination keys must be unique and non-empty.';
    end if;
    v_seen := array_append(v_seen, v_key);
    v_options := v_canonical_options;

    v_price := nullif(btrim(coalesce(v_item->>'price', '')), '')::numeric;
    v_compare_at := nullif(btrim(coalesce(v_item->>'compare_at', v_item->>'compareAt', '')), '')::numeric;
    v_sku := nullif(btrim(coalesce(v_item->>'sku', '')), '');
    v_stock := nullif(btrim(coalesce(v_item->>'stock_quantity', v_item->>'stockQuantity', '')), '')::integer;
    v_image := nullif(btrim(coalesce(v_item->>'image_url', v_item->>'imageUrl', '')), '');
    v_active := coalesce((v_item->>'is_active')::boolean, (v_item->>'isActive')::boolean, true);

    if v_price is null or v_price < 0 then
      raise exception 'Combination price must be zero or greater.';
    end if;
    if v_compare_at is not null and v_compare_at < v_price then
      raise exception 'Combination compare-at price must be greater than or equal to its price.';
    end if;
    if v_stock is not null and v_stock < 0 then
      raise exception 'Combination stock cannot be negative.';
    end if;

    insert into public.product_variation_combinations (
      product_id, combination_key, selected_options, price, compare_at, sku,
      stock_quantity, image_url, is_active
    ) values (
      p_product_id, v_key, v_options, v_price, v_compare_at, v_sku,
      v_stock, v_image, v_active
    )
    on conflict (product_id, combination_key) do update set
      selected_options = excluded.selected_options,
      price = excluded.price,
      compare_at = excluded.compare_at,
      sku = excluded.sku,
      stock_quantity = excluded.stock_quantity,
      image_url = excluded.image_url,
      is_active = excluded.is_active,
      updated_at = now();
  end loop;

  return query
  select * from public.product_variation_combinations
  where product_id = p_product_id and is_active
  order by combination_key;
end;
$function$;

revoke all on function private.set_variation_combination_updated_at() from public, anon, authenticated;
revoke all on function public.save_product_variation_combinations(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_product_variation_combinations(uuid, jsonb) to authenticated;

commit;
