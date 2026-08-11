begin;

create extension if not exists pgcrypto;

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  user_id uuid not null references auth.users(id) on delete restrict,
  customer_name text not null,
  customer_email text not null,
  status text not null default 'pending_payment'
    check (status in ('pending', 'pending_payment', 'processing', 'in_transit', 'delivered', 'cancelled')),
  payment_status text not null default 'pending'
    check (payment_status in ('pending', 'paid', 'failed', 'successful')),
  shipment_type text
    check (shipment_type is null or shipment_type in ('air', 'sea', 'both')),
  batch_number text,
  shipping_address_id uuid references public.addresses(id) on delete set null,
  shipping_address_snapshot jsonb not null,
  subtotal numeric not null
    check (subtotal >= 0),
  shipping_total numeric not null
    check (shipping_total >= 0),
  total numeric not null
    check (total >= 0),
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_customer_name_not_blank check (btrim(customer_name) <> ''),
  constraint orders_customer_email_not_blank check (btrim(customer_email) <> '')
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  product_name text not null,
  product_slug text not null,
  brand text,
  image_url text,
  unit_price numeric not null
    check (unit_price >= 0),
  quantity integer not null
    check (quantity > 0),
  selected_color text,
  selected_size text,
  shipping_fee numeric not null default 0
    check (shipping_fee >= 0),
  line_subtotal numeric not null
    check (line_subtotal >= 0),
  line_shipping numeric not null
    check (line_shipping >= 0),
  created_at timestamptz not null default now(),
  constraint order_items_product_name_not_blank check (btrim(product_name) <> ''),
  constraint order_items_product_slug_not_blank check (btrim(product_slug) <> '')
);

create unique index orders_order_number_idx
  on public.orders (order_number);

create index orders_user_id_idx
  on public.orders (user_id);

create index orders_status_idx
  on public.orders (status);

create index orders_payment_status_idx
  on public.orders (payment_status);

create index orders_created_at_idx
  on public.orders (created_at);

create index orders_batch_number_idx
  on public.orders (batch_number);

create index orders_shipping_address_id_idx
  on public.orders (shipping_address_id);

create index order_items_order_id_idx
  on public.order_items (order_id);

create index order_items_product_id_idx
  on public.order_items (product_id);

create or replace function private.generate_order_number()
returns text
language plpgsql
stable
set search_path = ''
as $function$
begin
  return 'ORD-'
    || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS')
    || '-'
    || upper(substr(md5(clock_timestamp()::text || txid_current()::text || random()::text), 1, 8));
end;
$function$;

create or replace function private.get_order_bundle(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_order public.orders%rowtype;
  v_items jsonb;
begin
  select *
    into v_order
  from public.orders as o
  where o.id = p_order_id;

  if not found then
    return null;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', oi.id,
        'orderId', oi.order_id,
        'productId', oi.product_id,
        'productName', oi.product_name,
        'productSlug', oi.product_slug,
        'brand', oi.brand,
        'imageUrl', oi.image_url,
        'unitPrice', oi.unit_price,
        'quantity', oi.quantity,
        'selectedColor', oi.selected_color,
        'selectedSize', oi.selected_size,
        'shippingFee', oi.shipping_fee,
        'lineSubtotal', oi.line_subtotal,
        'lineShipping', oi.line_shipping,
        'createdAt', oi.created_at
      )
      order by oi.created_at asc, oi.id asc
    ),
    '[]'::jsonb
  )
    into v_items
  from public.order_items as oi
  where oi.order_id = p_order_id;

  return jsonb_build_object(
    'order', jsonb_build_object(
      'id', v_order.id,
      'orderNumber', v_order.order_number,
      'customerId', v_order.user_id,
      'customerName', v_order.customer_name,
      'customerEmail', v_order.customer_email,
      'status', v_order.status,
      'paymentStatus', v_order.payment_status,
      'shipmentType', v_order.shipment_type,
      'batchNumber', v_order.batch_number,
      'shippingAddressId', v_order.shipping_address_id,
      'shippingAddress', v_order.shipping_address_snapshot,
      'subtotal', v_order.subtotal,
      'shippingTotal', v_order.shipping_total,
      'total', v_order.total,
      'deliveredAt', v_order.delivered_at,
      'createdAt', v_order.created_at,
      'updatedAt', v_order.updated_at,
      'items', v_items
    ),
    'items', v_items,
    'shippingAddress', v_order.shipping_address_snapshot
  );
end;
$function$;

create or replace function public.create_order_from_cart(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_payload jsonb := coalesce(payload, '{}'::jsonb);
  v_cart public.carts%rowtype;
  v_address public.addresses%rowtype;
  v_order public.orders%rowtype;
  v_items_json jsonb := '[]'::jsonb;
  v_subtotal numeric := 0;
  v_shipping_total numeric := 0;
  v_total numeric := 0;
  v_shipment_type text := null;
  v_invalid_count integer := 0;
  v_cart_item_count integer := 0;
  v_shipping_address_id uuid;
  v_batch_number text := null;
begin
  if v_user_id is null then
    raise exception 'Please sign in to create an order.';
  end if;

  select *
    into v_profile
  from public.profiles as p
  where p.id = v_user_id;

  if not found then
    raise exception 'Your profile could not be found.';
  end if;

  if v_profile.role <> 'customer' or v_profile.status <> 'active' then
    raise exception 'Only active customer accounts can create orders.';
  end if;

  v_shipping_address_id := nullif(btrim(v_payload ->> 'shipping_address_id'), '')::uuid;
  v_batch_number := nullif(btrim(v_payload ->> 'batch_number'), '');

  if v_shipping_address_id is null then
    raise exception 'A saved shipping address is required to create an order.';
  end if;

  select *
    into v_address
  from public.addresses as a
  where a.id = v_shipping_address_id
    and a.user_id = v_user_id;

  if not found then
    raise exception 'The selected shipping address does not belong to your account.';
  end if;

  select *
    into v_cart
  from public.carts as c
  where c.user_id = v_user_id;

  if not found then
    raise exception 'Your cart is empty.';
  end if;

  select count(*)
    into v_cart_item_count
  from public.cart_items as ci
  where ci.cart_id = v_cart.id;

  if v_cart_item_count = 0 then
    raise exception 'Your cart is empty.';
  end if;

  select count(*)
    into v_invalid_count
  from public.cart_items as ci
  left join public.products as p
    on p.id = ci.product_id
  where ci.cart_id = v_cart.id
    and (
      p.id is null
      or p.status <> 'active'
      or p.deleted_at is not null
      or ci.quantity <= 0
    );

  if v_invalid_count > 0 then
    raise exception 'Your cart contains an inactive, deleted, or invalid product.';
  end if;

  with normalized_rows as (
    select
      ci.id as cart_item_id,
      ci.product_id,
      ci.quantity,
      nullif(btrim(ci.selected_color), '') as selected_color,
      nullif(btrim(ci.selected_size), '') as selected_size,
      p.slug as product_slug,
      p.name as product_name,
      p.brand,
      p.primary_image_url,
      p.price as unit_price,
      coalesce(p.shipping_fee, 0) as shipping_fee,
      case
        when lower(coalesce(p.shipping_method, '')) like '%sea%' then 'sea'
        when lower(coalesce(p.shipping_method, '')) like '%both%' then 'both'
        else 'air'
      end as normalized_shipping_method,
      p.created_at
    from public.cart_items as ci
    join public.products as p
      on p.id = ci.product_id
    where ci.cart_id = v_cart.id
    order by ci.created_at asc, ci.id asc
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', cart_item_id,
          'orderId', null,
          'productId', product_id,
          'productName', product_name,
          'productSlug', product_slug,
          'brand', brand,
          'imageUrl', primary_image_url,
          'unitPrice', unit_price,
          'quantity', quantity,
          'selectedColor', selected_color,
          'selectedSize', selected_size,
          'shippingFee', shipping_fee,
          'lineSubtotal', unit_price * quantity,
          'lineShipping', shipping_fee * quantity,
          'createdAt', created_at
        )
        order by created_at asc, cart_item_id asc
      ),
      '[]'::jsonb
    ),
    coalesce(sum(unit_price * quantity), 0),
    coalesce(sum(shipping_fee * quantity), 0),
    case
      when count(distinct normalized_shipping_method) = 0 then null
      when count(distinct normalized_shipping_method) = 1 then max(normalized_shipping_method)
      else 'both'
    end
    into v_items_json, v_subtotal, v_shipping_total, v_shipment_type
  from normalized_rows;

  v_total := v_subtotal + v_shipping_total;

  insert into public.orders (
    order_number,
    user_id,
    customer_name,
    customer_email,
    status,
    payment_status,
    shipment_type,
    batch_number,
    shipping_address_id,
    shipping_address_snapshot,
    subtotal,
    shipping_total,
    total,
    created_at,
    updated_at
  ) values (
    private.generate_order_number(),
    v_user_id,
    v_profile.full_name,
    v_profile.email,
    'pending_payment',
    'pending',
    v_shipment_type,
    v_batch_number,
    v_address.id,
    jsonb_build_object(
      'id', v_address.id,
      'addressLabel', v_address.address_label,
      'fullName', v_address.full_name,
      'phoneNumber', v_address.phone_number,
      'emailAddress', v_address.email_address,
      'country', v_address.country,
      'region', v_address.region,
      'city', v_address.city,
      'streetAddress', v_address.street_address,
      'houseNumber', v_address.house_number,
      'landmark', v_address.landmark,
      'postalCode', v_address.postal_code,
      'isDefault', v_address.is_default
    ),
    v_subtotal,
    v_shipping_total,
    v_total,
    now(),
    now()
  )
    returning *
    into v_order;

  insert into public.order_items (
    order_id,
    product_id,
    product_name,
    product_slug,
    brand,
    image_url,
    unit_price,
    quantity,
    selected_color,
    selected_size,
    shipping_fee,
    line_subtotal,
    line_shipping,
    created_at
  )
  select
    v_order.id,
    product_id,
    product_name,
    product_slug,
    brand,
    primary_image_url,
    unit_price,
    quantity,
    selected_color,
    selected_size,
    shipping_fee,
    unit_price * quantity,
    shipping_fee * quantity,
    created_at
  from normalized_rows;

  delete from public.cart_items as ci
  where ci.cart_id = v_cart.id;

  update public.carts as c
  set updated_at = now()
  where c.id = v_cart.id;

  return private.get_order_bundle(v_order.id);
end;
$function$;

create or replace function public.update_order_status(p_order_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_order_id uuid;
begin
  if v_user_id is null then
    raise exception 'Please sign in to continue.';
  end if;

  select *
    into v_profile
  from public.profiles as p
  where p.id = v_user_id;

  if not found then
    raise exception 'Your profile could not be found.';
  end if;

  if v_profile.role <> 'admin' or v_profile.status <> 'active' then
    raise exception 'Only active administrators can update order status.';
  end if;

  if v_status not in ('pending', 'pending_payment', 'processing', 'in_transit', 'delivered', 'cancelled') then
    raise exception 'Unsupported order status.';
  end if;

  update public.orders as o
  set status = v_status,
      delivered_at = case
        when v_status = 'delivered' then coalesce(o.delivered_at, now())
        when v_status = 'cancelled' then null
        else o.delivered_at
      end,
      updated_at = now()
  where o.id = p_order_id
  returning o.id into v_order_id;

  if not found then
    raise exception 'Order not found.';
  end if;

  return private.get_order_bundle(v_order_id);
end;
$function$;

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
before update on public.orders
for each row
execute function private.set_updated_at();

drop trigger if exists order_items_set_updated_at on public.order_items;
create trigger order_items_set_updated_at
before update on public.order_items
for each row
execute function private.set_updated_at();

alter table public.orders enable row level security;
alter table public.order_items enable row level security;

drop policy if exists orders_select_own on public.orders;
create policy orders_select_own
  on public.orders
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists orders_select_admin on public.orders;
create policy orders_select_admin
  on public.orders
  for select
  to authenticated
  using (private.is_admin_user());

drop policy if exists order_items_select_own on public.order_items;
create policy order_items_select_own
  on public.order_items
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.orders as o
      where o.id = order_items.order_id
        and o.user_id = auth.uid()
    )
  );

drop policy if exists order_items_select_admin on public.order_items;
create policy order_items_select_admin
  on public.order_items
  for select
  to authenticated
  using (private.is_admin_user());

revoke all on function private.generate_order_number() from public;
revoke all on function private.generate_order_number() from anon;
revoke all on function private.generate_order_number() from authenticated;

revoke all on function private.get_order_bundle(uuid) from public;
revoke all on function private.get_order_bundle(uuid) from anon;
revoke all on function private.get_order_bundle(uuid) from authenticated;

revoke all on function public.create_order_from_cart(jsonb) from public;
revoke all on function public.create_order_from_cart(jsonb) from anon;
revoke all on function public.create_order_from_cart(jsonb) from authenticated;
grant execute on function public.create_order_from_cart(jsonb) to authenticated;

revoke all on function public.update_order_status(uuid, text) from public;
revoke all on function public.update_order_status(uuid, text) from anon;
revoke all on function public.update_order_status(uuid, text) from authenticated;
grant execute on function public.update_order_status(uuid, text) to authenticated;

revoke all on table public.orders from public;
revoke all on table public.orders from anon;
revoke all on table public.orders from authenticated;
grant select on table public.orders to authenticated;

revoke all on table public.order_items from public;
revoke all on table public.order_items from anon;
revoke all on table public.order_items from authenticated;
grant select on table public.order_items to authenticated;

commit;
