begin;

alter table public.product_merchandising
  add column if not exists image_url text;

create or replace function public.save_product_merchandising(payload jsonb)
returns public.product_merchandising
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_admin_id uuid := auth.uid();
  v_product_id uuid := nullif(btrim(coalesce(payload ->> 'productId', payload ->> 'product_id', '')), '')::uuid;
  v_placement text := lower(btrim(coalesce(payload ->> 'placement', payload ->> 'group', 'flashy')));
  v_display_order integer := greatest(coalesce(nullif(btrim(coalesce(payload ->> 'displayOrder', payload ->> 'display_order', '')), '')::integer, 0), 0);
  v_starts_at timestamptz := nullif(btrim(coalesce(payload ->> 'startsAt', payload ->> 'starts_at', '')), '')::timestamptz;
  v_ends_at timestamptz := nullif(btrim(coalesce(payload ->> 'endsAt', payload ->> 'ends_at', '')), '')::timestamptz;
  v_image_url text := nullif(btrim(coalesce(payload ->> 'imageUrl', payload ->> 'image_url', '')), '');
  v_product public.products%rowtype;
  v_row public.product_merchandising%rowtype;
begin
  if v_admin_id is null then
    raise exception 'Please sign in to continue.';
  end if;

  if not private.is_admin_user() then
    raise exception 'Only active administrators can manage merchandising.';
  end if;

  if v_product_id is null then
    raise exception 'A product id is required.';
  end if;

  if v_placement not in ('flashy', 'best-selling') then
    raise exception 'Invalid merchandising placement.';
  end if;

  select p.*
    into v_product
  from public.products as p
  where p.id = v_product_id;

  if not found then
    raise exception 'Product not found.';
  end if;

  if v_product.status <> 'active' or v_product.deleted_at is not null then
    raise exception 'Only active, undeleted products can be assigned to merchandising.';
  end if;

  insert into public.product_merchandising as pm (
    product_id,
    placement,
    display_order,
    starts_at,
    ends_at,
    image_url,
    created_by
  ) values (
    v_product_id,
    v_placement,
    v_display_order,
    v_starts_at,
    v_ends_at,
    v_image_url,
    v_admin_id
  )
  on conflict (product_id, placement) do update
     set display_order = excluded.display_order,
         starts_at = excluded.starts_at,
         ends_at = excluded.ends_at,
         image_url = excluded.image_url,
         updated_at = now()
  returning pm.* into v_row;

  return v_row;
end;
$function$;

commit;
