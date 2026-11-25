begin;

create table if not exists public.exchange_rate_settings (
  id text primary key default 'cny-ghs',
  base_currency text not null default 'CNY',
  target_currency text not null default 'GHS',
  active_pricing_mode text not null default 'manual',
  manual_rate numeric(20,8),
  live_rate numeric(20,8),
  live_rate_provider text,
  manual_rate_version uuid,
  provider_data_timestamp timestamptz,
  provider_next_update_at timestamptz,
  last_successful_fetch_at timestamptz,
  live_rate_version uuid,
  settings_version bigint not null default 1,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint exchange_rate_settings_singleton check (id = 'cny-ghs'),
  constraint exchange_rate_settings_currencies check (base_currency = 'CNY' and target_currency = 'GHS'),
  constraint exchange_rate_settings_mode check (active_pricing_mode in ('live', 'manual')),
  constraint exchange_rate_settings_manual_positive check (manual_rate is null or manual_rate > 0),
  constraint exchange_rate_settings_live_positive check (live_rate is null or live_rate > 0)
);

insert into public.exchange_rate_settings (id)
values ('cny-ghs')
on conflict (id) do nothing;

create table if not exists public.exchange_rate_history (
  id uuid primary key default gen_random_uuid(),
  previous_rate numeric(20,8),
  new_rate numeric(20,8),
  rate_source text not null check (rate_source in ('live', 'manual')),
  previous_pricing_mode text,
  new_pricing_mode text,
  provider text,
  provider_data_timestamp timestamptz,
  administrator_id uuid references auth.users(id) on delete set null,
  change_reason text,
  created_at timestamptz not null default now()
);

create table if not exists public.exchange_rate_refresh_leases (
  id text primary key check (id = 'cny-ghs'),
  lease_until timestamptz not null default now(),
  lease_token uuid
);

insert into public.exchange_rate_refresh_leases (id)
values ('cny-ghs')
on conflict (id) do nothing;

create table if not exists public.product_pricing_metadata (
  product_id uuid primary key references public.products(id) on delete cascade,
  pricing_currency text not null check (pricing_currency in ('CNY', 'GHS')),
  original_cny_price numeric(20,8),
  original_cny_compare_at numeric(20,8),
  applied_exchange_rate numeric(20,8),
  applied_rate_source text check (applied_rate_source in ('live', 'manual') or applied_rate_source is null),
  exchange_rate_version uuid,
  variant_cny_prices jsonb not null default '{}'::jsonb,
  last_converted_at timestamptz,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint product_pricing_metadata_currency_values check (
    (pricing_currency = 'GHS'
      and original_cny_price is null
      and original_cny_compare_at is null
      and applied_exchange_rate is null
      and applied_rate_source is null
      and exchange_rate_version is null
      and variant_cny_prices = '{}'::jsonb)
    or (pricing_currency = 'CNY'
      and original_cny_price is not null
      and original_cny_price <> 'NaN'::numeric
      and original_cny_price >= 0
      and original_cny_price <= 1000000000
      and (original_cny_compare_at is null or (original_cny_compare_at <> 'NaN'::numeric and original_cny_compare_at >= original_cny_price and original_cny_compare_at <= 1000000000))
      and applied_exchange_rate is not null
      and applied_exchange_rate <> 'NaN'::numeric
      and applied_exchange_rate > 0
      and applied_exchange_rate <= 1000000
      and applied_rate_source in ('live', 'manual')
      and exchange_rate_version is not null
      and jsonb_typeof(variant_cny_prices) = 'object')
  )
);

create table if not exists public.product_repricing_history (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete restrict,
  previous_ghs_price numeric(20,2) not null,
  new_ghs_price numeric(20,2) not null,
  original_cny_price numeric(20,8) not null,
  previous_applied_rate numeric(20,8),
  new_applied_rate numeric(20,8) not null,
  rate_source text not null check (rate_source in ('live', 'manual')),
  administrator_id uuid references auth.users(id) on delete set null,
  repricing_operation_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.product_repricing_operations (
  id uuid primary key default gen_random_uuid(),
  rate numeric(20,8) not null check (rate > 0),
  rate_source text not null check (rate_source in ('live', 'manual')),
  status text not null default 'processing' check (status in ('processing', 'completed', 'partial', 'failed')),
  administrator_id uuid not null references auth.users(id) on delete restrict,
  exchange_rate_version uuid not null,
  product_ids uuid[] not null,
  expected_product_versions jsonb not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.product_repricing_history
  add constraint product_repricing_history_operation_fk
  foreign key (repricing_operation_id)
  references public.product_repricing_operations(id)
  on delete set null;

create unique index if not exists product_repricing_history_operation_product_unique_idx
  on public.product_repricing_history (repricing_operation_id, product_id)
  where repricing_operation_id is not null;

create index if not exists exchange_rate_history_created_at_idx
  on public.exchange_rate_history (created_at desc);
create index if not exists exchange_rate_history_source_idx
  on public.exchange_rate_history (rate_source, created_at desc);
create index if not exists product_repricing_history_product_idx
  on public.product_repricing_history (product_id, created_at desc);

alter table public.exchange_rate_settings enable row level security;
alter table public.exchange_rate_history enable row level security;
alter table public.exchange_rate_refresh_leases enable row level security;
alter table public.product_pricing_metadata enable row level security;
alter table public.product_repricing_history enable row level security;
alter table public.product_repricing_operations enable row level security;

revoke all on table public.exchange_rate_settings from public, anon, authenticated;
revoke all on table public.exchange_rate_history from public, anon, authenticated;
revoke all on table public.exchange_rate_refresh_leases from public, anon, authenticated;
revoke all on table public.product_pricing_metadata from public, anon, authenticated;
revoke all on table public.product_repricing_history from public, anon, authenticated;
revoke all on table public.product_repricing_operations from public, anon, authenticated;
grant all on table public.exchange_rate_settings to service_role;
revoke all on table public.exchange_rate_history from service_role;
grant select on table public.exchange_rate_history to service_role;
grant all on table public.exchange_rate_refresh_leases to service_role;
grant all on table public.product_pricing_metadata to service_role;
revoke all on table public.product_repricing_history from service_role;
grant select on table public.product_repricing_history to service_role;
grant all on table public.product_repricing_operations to service_role;

create or replace function public.prevent_untracked_cny_pricing_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('nexus.currency_pricing_write', true), '') = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_table_name = 'products'
     and tg_op = 'UPDATE'
     and (new.price is distinct from old.price or new.compare_at is distinct from old.compare_at)
     and exists (
       select 1 from public.product_pricing_metadata m
       where m.product_id = old.id and m.pricing_currency = 'CNY'
     ) then
    raise exception 'CNY-managed product prices must be changed through the currency pricing workflow.' using errcode = '42501';
  end if;

  if tg_table_name = 'product_variation_combinations' then
    if exists (
      select 1 from public.product_pricing_metadata m
      where m.product_id = coalesce(new.product_id, old.product_id)
        and m.pricing_currency = 'CNY'
    ) then
      raise exception 'CNY-managed variation prices must be changed through the currency pricing workflow.' using errcode = '42501';
    end if;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists prevent_untracked_cny_product_pricing on public.products;
create trigger prevent_untracked_cny_product_pricing
before update on public.products
for each row execute function public.prevent_untracked_cny_pricing_mutation();

drop trigger if exists prevent_untracked_cny_variation_pricing on public.product_variation_combinations;
create trigger prevent_untracked_cny_variation_pricing
before insert or update or delete on public.product_variation_combinations
for each row execute function public.prevent_untracked_cny_pricing_mutation();

create or replace function public.save_priced_product_bundle(
  payload jsonb,
  pricing_metadata jsonb,
  p_administrator_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_saved jsonb;
  v_product_id uuid;
  v_metadata public.product_pricing_metadata%rowtype;
  v_existing public.product_pricing_metadata%rowtype;
  v_admin public.profiles%rowtype;
  v_variant jsonb;
  v_combination record;
  v_expected_variation_count integer;
  v_actual_variation_count integer;
begin
  if (select coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role') then
    raise exception 'Service role is required.' using errcode = '42501';
  end if;
  if p_administrator_id is null then
    raise exception 'An administrator identity is required.' using errcode = '42501';
  end if;
  select * into v_admin from public.profiles where id = p_administrator_id for share;
  if not found or coalesce(v_admin.role, '') <> 'admin' or coalesce(v_admin.status, '') <> 'active' then
    raise exception 'Only active administrators can save priced products.' using errcode = '42501';
  end if;
  if auth.uid() is not null and auth.uid() <> p_administrator_id then
    raise exception 'The authenticated administrator does not match the request.' using errcode = '42501';
  end if;

  v_product_id := nullif(pricing_metadata->>'product_id', '')::uuid;
  if v_product_id is not null then
    perform 1 from public.products where id = v_product_id for update;
    select * into v_existing
    from public.product_pricing_metadata
    where product_id = v_product_id
    for update;
    if found and v_existing.pricing_currency = 'CNY'
       and v_existing.exchange_rate_version is distinct from nullif(pricing_metadata->>'exchange_rate_version', '')::uuid then
      raise exception 'The product pricing changed after it was loaded.' using errcode = '40001';
    end if;
  end if;

  perform set_config('request.jwt.claim.sub', p_administrator_id::text, true);
  perform set_config('nexus.currency_pricing_write', 'on', true);
  v_saved := public.save_product_bundle(coalesce(payload, '{}'::jsonb));
  v_product_id := nullif(v_saved #>> '{product,id}', '')::uuid;
  if v_product_id is null or (nullif(pricing_metadata->>'product_id', '') is not null and nullif(pricing_metadata->>'product_id', '')::uuid is distinct from v_product_id) then
    raise exception 'Product pricing metadata does not match the saved product.';
  end if;

  if upper(coalesce(nullif(pricing_metadata->>'pricing_currency', ''), 'CNY')) = 'CNY'
     and (nullif(pricing_metadata->>'applied_exchange_rate', '')::numeric is null
       or nullif(pricing_metadata->>'exchange_rate_version', '')::uuid is null
       or nullif(pricing_metadata->>'applied_rate_source', '') not in ('live', 'manual')) then
    raise exception 'Complete CNY pricing metadata is required.' using errcode = '22023';
  end if;

  if jsonb_typeof(coalesce(pricing_metadata->'variant_cny_prices', '{}'::jsonb)) <> 'object' then
    raise exception 'Variation pricing metadata must be a JSON object.' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(payload->'variation_combinations', payload->'variationCombinations', '[]'::jsonb)) = 'array'
     and jsonb_array_length(coalesce(payload->'variation_combinations', payload->'variationCombinations', '[]'::jsonb)) > 0 then
    perform public.save_product_variation_combinations(
      v_product_id,
      coalesce(payload->'variation_combinations', payload->'variationCombinations')
    );
  end if;
  select count(*) into v_actual_variation_count
  from public.product_variation_combinations
  where product_id = v_product_id and is_active;
  select count(*) into v_expected_variation_count
  from jsonb_object_keys(coalesce(pricing_metadata->'variant_cny_prices', '{}'::jsonb));
  if v_actual_variation_count <> v_expected_variation_count then
    raise exception 'Complete variation pricing metadata is required.' using errcode = '22023';
  end if;
  for v_combination in
    select c.combination_key
    from public.product_variation_combinations c
    where c.product_id = v_product_id and c.is_active
  loop
    v_variant := pricing_metadata->'variant_cny_prices' -> v_combination.combination_key;
    if v_variant is null or jsonb_typeof(v_variant) <> 'object'
       or not (v_variant ? 'price') or v_variant->>'price' is null
       or (v_variant->>'price')::numeric = 'NaN'::numeric
       or (v_variant->>'price')::numeric < 0
       or (v_variant->>'price')::numeric > 1000000000
       or (v_variant ? 'compareAt' and nullif(v_variant->>'compareAt', '') is not null
           and ((v_variant->>'compareAt')::numeric = 'NaN'::numeric
             or (v_variant->>'compareAt')::numeric < (v_variant->>'price')::numeric
             or (v_variant->>'compareAt')::numeric > 1000000000)) then
      raise exception 'Variation pricing metadata is incomplete or invalid.' using errcode = '22023';
    end if;
  end loop;

  insert into public.product_pricing_metadata (
    product_id, pricing_currency, original_cny_price, original_cny_compare_at,
    applied_exchange_rate, applied_rate_source, exchange_rate_version,
    variant_cny_prices, last_converted_at, updated_by, updated_at
  ) values (
    v_product_id,
    coalesce(nullif(pricing_metadata->>'pricing_currency', ''), 'CNY'),
    (pricing_metadata->>'original_cny_price')::numeric,
    nullif(pricing_metadata->>'original_cny_compare_at', '')::numeric,
    (pricing_metadata->>'applied_exchange_rate')::numeric,
    nullif(pricing_metadata->>'applied_rate_source', ''),
    nullif(pricing_metadata->>'exchange_rate_version', '')::uuid,
    coalesce(pricing_metadata->'variant_cny_prices', '{}'::jsonb),
    nullif(pricing_metadata->>'last_converted_at', '')::timestamptz,
    nullif(pricing_metadata->>'updated_by', '')::uuid,
    coalesce(nullif(pricing_metadata->>'updated_at', '')::timestamptz, now())
  )
  on conflict (product_id) do update set
    pricing_currency = excluded.pricing_currency,
    original_cny_price = excluded.original_cny_price,
    original_cny_compare_at = excluded.original_cny_compare_at,
    applied_exchange_rate = excluded.applied_exchange_rate,
    applied_rate_source = excluded.applied_rate_source,
    exchange_rate_version = excluded.exchange_rate_version,
    variant_cny_prices = excluded.variant_cny_prices,
    last_converted_at = excluded.last_converted_at,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at
  returning * into v_metadata;

  return jsonb_set(v_saved, '{pricingMetadata}', to_jsonb(v_metadata), true);
end;
$$;

create or replace function public.apply_product_currency_repricing(
  p_operation_id uuid,
  p_administrator_id uuid,
  p_rate numeric,
  p_rate_source text,
  p_exchange_rate_version uuid,
  p_product_ids uuid[],
  p_expected_product_versions jsonb,
  p_max_live_age_seconds integer default 86400
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.profiles%rowtype;
  v_operation public.product_repricing_operations%rowtype;
  v_product public.products%rowtype;
  v_metadata public.product_pricing_metadata%rowtype;
  v_combination record;
  v_variant jsonb;
  v_product_id uuid;
  v_previous_price numeric;
  v_new_price numeric;
  v_new_compare_at numeric;
  v_sorted_product_ids uuid[];
  v_expected jsonb;
  v_variation record;
  v_expected_variation text;
  v_settings public.exchange_rate_settings%rowtype;
  v_snapshot_rate numeric;
  v_snapshot_version uuid;
  v_expected_variation_count integer;
  v_actual_variation_count integer;
  v_count integer := 0;
begin
  if (select coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role') then
    raise exception 'Service role is required.' using errcode = '42501';
  end if;
  if p_operation_id is null or p_administrator_id is null or p_rate is null or p_rate <= 0
     or lower(coalesce(p_rate_source, '')) not in ('live', 'manual')
     or p_exchange_rate_version is null
     or coalesce(array_length(p_product_ids, 1), 0) = 0 then
    raise exception 'Incomplete repricing operation.' using errcode = '22023';
  end if;
  if p_max_live_age_seconds is null or p_max_live_age_seconds < 300 or p_max_live_age_seconds > 604800 then
    raise exception 'The live-rate freshness policy is invalid.' using errcode = '22023';
  end if;
  select array_agg(item order by item) into v_sorted_product_ids
  from unnest(p_product_ids) as item;
  select * into v_admin from public.profiles where id = p_administrator_id for share;
  if not found or coalesce(v_admin.role, '') <> 'admin' or coalesce(v_admin.status, '') <> 'active' then
    raise exception 'Only active administrators can reprice products.' using errcode = '42501';
  end if;
  if auth.uid() is not null and auth.uid() <> p_administrator_id then
    raise exception 'The authenticated administrator does not match the request.' using errcode = '42501';
  end if;
  if (select count(*) from unnest(p_product_ids)) <> (select count(distinct item) from unnest(p_product_ids) as item) then
    raise exception 'Duplicate products are not allowed in a repricing operation.' using errcode = '22023';
  end if;

  select * into v_operation from public.product_repricing_operations where id = p_operation_id for update;
  if found then
    if v_operation.administrator_id <> p_administrator_id
       or v_operation.rate <> p_rate
       or v_operation.rate_source <> lower(p_rate_source)
       or v_operation.exchange_rate_version <> p_exchange_rate_version
       or v_operation.product_ids <> v_sorted_product_ids
       or v_operation.expected_product_versions <> coalesce(p_expected_product_versions, '{}'::jsonb) then
      raise exception 'The repricing operation does not match its approved snapshot.' using errcode = '40001';
    end if;
    if v_operation.status = 'completed' then
      return jsonb_build_object('status', 'already_applied', 'operation_id', p_operation_id);
    end if;
    raise exception 'The repricing operation is already in progress.' using errcode = '40001';
  end if;

  if jsonb_typeof(coalesce(p_expected_product_versions, 'null'::jsonb)) <> 'object' then
    raise exception 'The approved product snapshot must be a JSON object.' using errcode = '22023';
  end if;
  if (select count(*) from unnest(v_sorted_product_ids)) <> (select count(*) from jsonb_object_keys(p_expected_product_versions)) then
    raise exception 'Every selected product requires an approved snapshot.' using errcode = '22023';
  end if;

  insert into public.product_repricing_operations (
    id, rate, rate_source, administrator_id, exchange_rate_version,
    product_ids, expected_product_versions
  ) values (
    p_operation_id, p_rate, lower(p_rate_source), p_administrator_id,
    p_exchange_rate_version, v_sorted_product_ids, coalesce(p_expected_product_versions, '{}'::jsonb)
  );

  for v_product_id in select item from unnest(p_product_ids) as item order by item loop
    select p.* into v_product from public.products p where p.id = v_product_id for update;
    if not found then raise exception 'A selected product no longer exists.' using errcode = '40001'; end if;
    select m.* into v_metadata from public.product_pricing_metadata m where m.product_id = v_product_id for update;
    if not found or v_metadata.pricing_currency <> 'CNY' then
      raise exception 'Selected products must have private CNY pricing metadata.' using errcode = '40001';
    end if;
    v_expected := p_expected_product_versions -> v_product_id::text;
    if v_expected is null or jsonb_typeof(v_expected) <> 'object'
       or (v_expected ->> 'productUpdatedAt')::timestamptz is distinct from v_product.updated_at then
      raise exception 'A selected product changed after preview.' using errcode = '40001';
    end if;
    if (v_expected ->> 'metadataUpdatedAt')::timestamptz is distinct from v_metadata.updated_at then
      raise exception 'A selected product pricing snapshot changed after preview.' using errcode = '40001';
    end if;
    if jsonb_typeof(v_expected -> 'variations') <> 'object' then
      raise exception 'The approved variation snapshot is invalid.' using errcode = '22023';
    end if;
    select count(*) into v_actual_variation_count
    from public.product_variation_combinations
    where product_id = v_product_id;
    select count(*) into v_expected_variation_count
    from jsonb_object_keys(v_expected -> 'variations');
    if v_actual_variation_count <> v_expected_variation_count then
      raise exception 'The product variations changed after preview.' using errcode = '40001';
    end if;
    select * into v_settings
    from public.exchange_rate_settings
    where id = 'cny-ghs'
    for share;
    v_snapshot_rate := case when lower(p_rate_source) = 'live' then v_settings.live_rate else v_settings.manual_rate end;
    v_snapshot_version := case when lower(p_rate_source) = 'live' then v_settings.live_rate_version else v_settings.manual_rate_version end;
    if v_snapshot_version is distinct from p_exchange_rate_version or v_snapshot_rate is distinct from p_rate then
      raise exception 'The approved exchange-rate snapshot is no longer current.' using errcode = '40001';
    end if;
    if lower(p_rate_source) = 'live'
       and (v_settings.provider_data_timestamp is null or v_settings.provider_data_timestamp < clock_timestamp() - make_interval(secs => p_max_live_age_seconds)) then
      raise exception 'The approved live exchange rate is stale.' using errcode = '40001';
    end if;
    v_previous_price := v_product.price;
    v_new_price := round(v_metadata.original_cny_price * p_rate, 2);
    v_new_compare_at := case when v_metadata.original_cny_compare_at is null then null else round(v_metadata.original_cny_compare_at * p_rate, 2) end;
    if v_new_compare_at is not null and v_new_compare_at < v_new_price then
      raise exception 'The approved compare-at price is below the selling price.' using errcode = '40001';
    end if;
    update public.products set price = v_new_price, compare_at = v_new_compare_at, updated_at = now() where id = v_product_id;

    for v_combination in
      select c.id, c.combination_key, c.updated_at
      from public.product_variation_combinations c
      where c.product_id = v_product_id
      order by c.id
      for update
    loop
      v_variant := v_metadata.variant_cny_prices -> v_combination.combination_key;
      if v_variant is null or jsonb_typeof(v_variant) <> 'object' or not (v_variant ? 'price')
         or v_variant->>'price' is null
         or (v_variant->>'price')::numeric = 'NaN'::numeric
         or (v_variant->>'price')::numeric < 0
         or (v_variant->>'price')::numeric > 1000000000
         or (v_variant ? 'compareAt' and nullif(v_variant->>'compareAt', '') is not null and ((v_variant->>'compareAt')::numeric = 'NaN'::numeric or (v_variant->>'compareAt')::numeric < (v_variant->>'price')::numeric or (v_variant->>'compareAt')::numeric > 1000000000)) then
        raise exception 'Variation pricing metadata is incomplete or invalid.' using errcode = '40001';
      end if;
      v_expected_variation := v_expected -> 'variations' ->> v_combination.id::text;
      if v_expected_variation is null or v_combination.id::text is null then
        raise exception 'A selected variation pricing snapshot is missing.' using errcode = '40001';
      end if;
      if v_combination.updated_at::timestamptz is distinct from v_expected_variation::timestamptz then
        raise exception 'A selected variation changed after preview.' using errcode = '40001';
      end if;
      update public.product_variation_combinations
      set price = round((v_variant->>'price')::numeric * p_rate, 2),
          compare_at = case when nullif(v_variant->>'compareAt', '') is null then null else round((v_variant->>'compareAt')::numeric * p_rate, 2) end,
          updated_at = now()
      where id = v_combination.id;
    end loop;

    update public.product_pricing_metadata
    set applied_exchange_rate = p_rate,
        applied_rate_source = lower(p_rate_source),
        exchange_rate_version = p_exchange_rate_version,
        last_converted_at = now(),
        updated_by = p_administrator_id,
        updated_at = now()
    where product_id = v_product_id;

    insert into public.product_repricing_history (
      product_id, previous_ghs_price, new_ghs_price, original_cny_price,
      previous_applied_rate, new_applied_rate, rate_source, administrator_id, repricing_operation_id
    ) values (
      v_product_id, v_previous_price, v_new_price, v_metadata.original_cny_price,
      v_metadata.applied_exchange_rate, p_rate, lower(p_rate_source), p_administrator_id, p_operation_id
    );
    v_count := v_count + 1;
  end loop;

  update public.product_repricing_operations
  set status = 'completed', completed_at = now()
  where id = p_operation_id;
  return jsonb_build_object('status', 'completed', 'operation_id', p_operation_id, 'updated_count', v_count);
end;
$$;

create or replace function public.get_exchange_rate_settings()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.exchange_rate_settings%rowtype;
  v_cny_products bigint;
begin
  if (select coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role') then
    raise exception 'Service role is required.' using errcode = '42501';
  end if;

  select * into v_settings
  from public.exchange_rate_settings
  where id = 'cny-ghs';

  select count(*) into v_cny_products
  from public.product_pricing_metadata
  where pricing_currency = 'CNY';

  return jsonb_build_object(
    'id', v_settings.id,
    'base_currency', v_settings.base_currency,
    'target_currency', v_settings.target_currency,
    'active_pricing_mode', v_settings.active_pricing_mode,
    'manual_rate', v_settings.manual_rate,
    'manual_rate_version', v_settings.manual_rate_version,
    'live_rate', v_settings.live_rate,
    'live_rate_provider', v_settings.live_rate_provider,
    'provider_data_timestamp', v_settings.provider_data_timestamp,
    'provider_next_update_at', v_settings.provider_next_update_at,
    'last_successful_fetch_at', v_settings.last_successful_fetch_at,
    'live_rate_version', v_settings.live_rate_version,
    'settings_version', v_settings.settings_version,
    'updated_by', v_settings.updated_by,
    'updated_at', v_settings.updated_at,
    'cny_product_count', v_cny_products
  );
end;
$$;

create or replace function public.claim_exchange_rate_refresh(p_lease_seconds integer default 300)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token uuid;
begin
  if (select coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role') then
    raise exception 'Service role is required.' using errcode = '42501';
  end if;
  update public.exchange_rate_refresh_leases
  set lease_until = clock_timestamp() + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 300), 900))),
      lease_token = pg_catalog.gen_random_uuid()
  where id = 'cny-ghs' and lease_until <= clock_timestamp();
  if not found then return null; end if;
  select lease_token into v_token from public.exchange_rate_refresh_leases where id = 'cny-ghs';
  return v_token;
end;
$$;

create or replace function public.release_exchange_rate_refresh(p_lease_token uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role') then
    raise exception 'Service role is required.' using errcode = '42501';
  end if;
  if p_lease_token is null then
    raise exception 'A refresh lease token is required.' using errcode = '22023';
  end if;
  update public.exchange_rate_refresh_leases
  set lease_until = clock_timestamp(), lease_token = null
  where id = 'cny-ghs'
    and lease_token = p_lease_token
    and lease_until > clock_timestamp();
  return found;
end;
$$;

create or replace function public.update_exchange_rate_settings(
  p_active_pricing_mode text default null,
  p_manual_rate numeric default null,
  p_live_rate numeric default null,
  p_live_rate_provider text default null,
  p_provider_data_timestamp timestamptz default null,
  p_provider_next_update_at timestamptz default null,
  p_last_successful_fetch_at timestamptz default null,
  p_live_rate_version uuid default null,
  p_manual_rate_version uuid default null,
  p_refresh_lease_token uuid default null,
  p_administrator_id uuid default null,
  p_change_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.exchange_rate_settings%rowtype;
  v_new public.exchange_rate_settings%rowtype;
  v_mode text;
  v_rate numeric;
  v_manual_version uuid;
  v_live_version uuid;
begin
  if (select coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role') then
    raise exception 'Service role is required.' using errcode = '42501';
  end if;

  if p_administrator_id is null then
    raise exception 'An administrator identity is required.';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = p_administrator_id
      and role = 'admin'
      and status = 'active'
  ) then
    raise exception 'Only an active administrator can update exchange-rate settings.' using errcode = '42501';
  end if;

  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('nexus:cny-ghs:exchange-rate-update', 0)) then
    raise exception 'Another exchange-rate update is already in progress.' using errcode = '55P03';
  end if;

  select * into v_old from public.exchange_rate_settings where id = 'cny-ghs' for update;
  v_mode := coalesce(nullif(lower(btrim(p_active_pricing_mode)), ''), v_old.active_pricing_mode);
  if v_mode not in ('live', 'manual') then
    raise exception 'Unsupported pricing mode.';
  end if;

  if p_manual_rate is not null and (p_manual_rate = 'NaN'::numeric or p_manual_rate <= 0 or p_manual_rate > 1000000) then
    raise exception 'Manual exchange rate must be greater than zero and within the supported range.';
  end if;
  if p_live_rate is not null and (p_live_rate = 'NaN'::numeric or p_live_rate <= 0 or p_live_rate > 1000000) then
    raise exception 'Live exchange rate must be greater than zero and within the supported range.';
  end if;

  if p_live_rate is not null then
    if p_refresh_lease_token is null or not exists (
      select 1 from public.exchange_rate_refresh_leases
      where id = 'cny-ghs' and lease_token = p_refresh_lease_token and lease_until > clock_timestamp()
      for update
    ) then
      raise exception 'The live-rate refresh lease is expired or superseded.' using errcode = '40001';
    end if;
    if p_provider_data_timestamp is null then
      raise exception 'A provider observation timestamp is required.' using errcode = '22023';
    end if;
    if v_old.provider_data_timestamp is not null and p_provider_data_timestamp < v_old.provider_data_timestamp then
      raise exception 'An older provider observation cannot replace a newer rate.' using errcode = '40001';
    end if;
    if p_provider_data_timestamp > clock_timestamp() + interval '5 minutes' then
      raise exception 'A future provider observation is not valid.' using errcode = '22023';
    end if;
  end if;

  v_rate := case when v_mode = 'live' then coalesce(p_live_rate, v_old.live_rate) else coalesce(p_manual_rate, v_old.manual_rate) end;
  if p_active_pricing_mode is not null and v_mode = 'live' and v_rate is null then
    raise exception 'A successful live rate is required before live pricing can be enabled.';
  end if;
  if p_active_pricing_mode is not null and v_mode = 'manual' and v_rate is null then
    raise exception 'A manual exchange rate is required before manual pricing can be enabled.';
  end if;

  v_manual_version := case
    when p_manual_rate is not null and p_manual_rate is distinct from v_old.manual_rate
      then coalesce(p_manual_rate_version, pg_catalog.gen_random_uuid())
    else v_old.manual_rate_version
  end;

  v_live_version := case
    when p_live_rate is not null
      and (p_live_rate is distinct from v_old.live_rate
        or p_provider_data_timestamp is distinct from v_old.provider_data_timestamp
        or nullif(btrim(p_live_rate_provider), '') is distinct from v_old.live_rate_provider)
      then coalesce(p_live_rate_version, pg_catalog.gen_random_uuid())
    else v_old.live_rate_version
  end;

  update public.exchange_rate_settings
  set active_pricing_mode = v_mode,
      manual_rate = coalesce(p_manual_rate, manual_rate),
      manual_rate_version = v_manual_version,
      live_rate = coalesce(p_live_rate, live_rate),
      live_rate_provider = coalesce(nullif(btrim(p_live_rate_provider), ''), live_rate_provider),
      provider_data_timestamp = coalesce(p_provider_data_timestamp, provider_data_timestamp),
      provider_next_update_at = coalesce(p_provider_next_update_at, provider_next_update_at),
      last_successful_fetch_at = coalesce(p_last_successful_fetch_at, last_successful_fetch_at),
      live_rate_version = v_live_version,
      settings_version = settings_version + 1,
      updated_by = p_administrator_id,
      updated_at = now()
  where id = 'cny-ghs'
  returning * into v_new;

  if v_old.manual_rate is distinct from v_new.manual_rate then
    insert into public.exchange_rate_history (
      previous_rate, new_rate, rate_source, previous_pricing_mode, new_pricing_mode,
      provider, provider_data_timestamp, administrator_id, change_reason
    ) values (
      v_old.manual_rate,
      v_new.manual_rate,
      'manual',
      v_old.active_pricing_mode,
      v_new.active_pricing_mode,
      v_new.live_rate_provider,
      v_new.provider_data_timestamp,
      p_administrator_id,
      nullif(btrim(p_change_reason), '')
    );
  end if;

  if v_old.live_rate is distinct from v_new.live_rate then
    insert into public.exchange_rate_history (
      previous_rate, new_rate, rate_source, previous_pricing_mode, new_pricing_mode,
      provider, provider_data_timestamp, administrator_id, change_reason
    ) values (
      v_old.live_rate, v_new.live_rate, 'live', v_old.active_pricing_mode, v_new.active_pricing_mode,
      v_new.live_rate_provider, v_new.provider_data_timestamp, p_administrator_id, nullif(btrim(p_change_reason), '')
    );
  end if;

  if v_old.active_pricing_mode is distinct from v_new.active_pricing_mode then
    insert into public.exchange_rate_history (
      previous_rate, new_rate, rate_source, previous_pricing_mode, new_pricing_mode,
      provider, provider_data_timestamp, administrator_id, change_reason
    ) values (
      case when v_old.active_pricing_mode = 'live' then v_old.live_rate else v_old.manual_rate end,
      case when v_new.active_pricing_mode = 'live' then v_new.live_rate else v_new.manual_rate end,
      v_new.active_pricing_mode, v_old.active_pricing_mode, v_new.active_pricing_mode,
      v_new.live_rate_provider, v_new.provider_data_timestamp, p_administrator_id, nullif(btrim(p_change_reason), '')
    );
  end if;

  return public.get_exchange_rate_settings();
end;
$$;

revoke all on function public.get_exchange_rate_settings() from public, anon, authenticated;
revoke all on function public.prevent_untracked_cny_pricing_mutation() from public, anon, authenticated, service_role;
revoke all on function public.update_exchange_rate_settings(text, numeric, numeric, text, timestamptz, timestamptz, timestamptz, uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.get_exchange_rate_settings() to service_role;
revoke all on function public.claim_exchange_rate_refresh(integer) from public, anon, authenticated;
revoke all on function public.release_exchange_rate_refresh(uuid) from public, anon, authenticated;
grant execute on function public.claim_exchange_rate_refresh(integer) to service_role;
grant execute on function public.release_exchange_rate_refresh(uuid) to service_role;
grant execute on function public.update_exchange_rate_settings(text, numeric, numeric, text, timestamptz, timestamptz, timestamptz, uuid, uuid, uuid, uuid, text) to service_role;
revoke all on function public.save_priced_product_bundle(jsonb, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.save_priced_product_bundle(jsonb, jsonb, uuid) to service_role;
revoke all on function public.apply_product_currency_repricing(uuid, uuid, numeric, text, uuid, uuid[], jsonb, integer) from public, anon, authenticated;
grant execute on function public.apply_product_currency_repricing(uuid, uuid, numeric, text, uuid, uuid[], jsonb, integer) to service_role;

do $$
begin
  if to_regprocedure('public.update_exchange_rate_settings(text,numeric,numeric,text,timestamptz,timestamptz,timestamptz,uuid,uuid,text)') is not null then
    execute 'revoke all on function public.update_exchange_rate_settings(text,numeric,numeric,text,timestamptz,timestamptz,timestamptz,uuid,uuid,text) from public, anon, authenticated';
  end if;
  if to_regprocedure('public.release_exchange_rate_refresh()') is not null then
    execute 'revoke all on function public.release_exchange_rate_refresh() from public, anon, authenticated';
  end if;
  if to_regprocedure('public.save_priced_product_bundle(jsonb,jsonb)') is not null then
    execute 'revoke all on function public.save_priced_product_bundle(jsonb,jsonb) from public, anon, authenticated';
  end if;
end;
$$;

commit;
