begin;

alter table public.products
  add column if not exists availability_type text not null default 'ready_stock',
  add column if not exists estimated_arrival text,
  add column if not exists preorder_terms text;

update public.products
set availability_type = coalesce(nullif(btrim(availability_type), ''), 'ready_stock')
where availability_type is null
   or btrim(availability_type) = '';

alter table public.products
  alter column availability_type set default 'ready_stock';

alter table public.products
  alter column availability_type set not null;

alter table public.products
  drop constraint if exists products_availability_type_check;

alter table public.products
  add constraint products_availability_type_check
  check (availability_type in ('ready_stock', 'preorder', 'coming_soon'));

create index if not exists products_availability_type_idx
  on public.products (availability_type);

alter table public.orders
  add column if not exists order_type text not null default 'ready_stock',
  add column if not exists estimated_arrival text,
  add column if not exists preorder_terms text;

update public.orders
set order_type = coalesce(nullif(btrim(order_type), ''), 'ready_stock')
where order_type is null
   or btrim(order_type) = '';

alter table public.orders
  alter column order_type set default 'ready_stock';

alter table public.orders
  alter column order_type set not null;

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select conname
    from pg_constraint
    where conrelid = 'public.orders'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status in%'
      and pg_get_constraintdef(oid) ilike '%pending_payment%'
      and pg_get_constraintdef(oid) ilike '%processing%'
      and pg_get_constraintdef(oid) ilike '%in_transit%'
      and pg_get_constraintdef(oid) ilike '%delivered%'
      and pg_get_constraintdef(oid) ilike '%cancelled%'
  loop
    execute format('alter table public.orders drop constraint if exists %I', constraint_name);
  end loop;
end;
$$;

alter table public.orders
  drop constraint if exists orders_status_check_v2;

alter table public.orders
  add constraint orders_status_check_v2
  check (
    status in (
      'pending',
      'pending_payment',
      'preorder_received',
      'processing',
      'shipped',
      'in_transit',
      'arrived_in_ghana',
      'shipping_fee_pending',
      'ready_for_delivery',
      'completed',
      'delivered',
      'cancelled'
    )
  );

create index if not exists orders_order_type_idx
  on public.orders (order_type);

alter table public.order_items
  add column if not exists availability_type text not null default 'ready_stock',
  add column if not exists estimated_arrival text,
  add column if not exists preorder_terms text;

update public.order_items
set availability_type = coalesce(nullif(btrim(availability_type), ''), 'ready_stock')
where availability_type is null
   or btrim(availability_type) = '';

alter table public.order_items
  alter column availability_type set default 'ready_stock';

alter table public.order_items
  alter column availability_type set not null;

alter table public.order_items
  drop constraint if exists order_items_availability_type_check;

alter table public.order_items
  add constraint order_items_availability_type_check
  check (availability_type in ('ready_stock', 'preorder', 'coming_soon'));

create index if not exists order_items_availability_type_idx
  on public.order_items (availability_type);

create or replace function public.set_product_availability(
  p_product_id uuid,
  p_availability_type text,
  p_estimated_arrival text default null,
  p_preorder_terms text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_product public.products%rowtype;
  v_availability_type text := lower(btrim(coalesce(p_availability_type, 'ready_stock')));
begin
  if not private.is_admin_user() then
    raise exception 'Only active administrators can update products.';
  end if;

  if p_product_id is null then
    raise exception 'Product id is required.';
  end if;

  if v_availability_type not in ('ready_stock', 'preorder', 'coming_soon') then
    raise exception 'Unsupported availability type.';
  end if;

  update public.products as p
  set availability_type = v_availability_type,
      estimated_arrival = case
        when v_availability_type = 'preorder' then nullif(btrim(coalesce(p_estimated_arrival, '')), '')
        else null
      end,
      preorder_terms = case
        when v_availability_type = 'preorder' then nullif(btrim(coalesce(p_preorder_terms, '')), '')
        else null
      end
  where p.id = p_product_id
  returning * into v_product;

  if not found then
    raise exception 'Product not found.';
  end if;

  return jsonb_build_object('product', to_jsonb(v_product));
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
        'variantKey', oi.variant_key,
        'selectedOptions', oi.selected_options,
        'shippingFee', oi.shipping_fee,
        'availabilityType', oi.availability_type,
        'estimatedArrival', oi.estimated_arrival,
        'preorderTerms', oi.preorder_terms,
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
      'orderType', v_order.order_type,
      'status', v_order.status,
      'paymentStatus', v_order.payment_status,
      'shipmentType', v_order.shipment_type,
      'batchNumber', v_order.batch_number,
      'shippingAddressId', v_order.shipping_address_id,
      'shippingAddress', v_order.shipping_address_snapshot,
      'subtotal', v_order.subtotal,
      'shippingTotal', v_order.shipping_total,
      'total', v_order.total,
      'estimatedArrival', v_order.estimated_arrival,
      'preorderTerms', v_order.preorder_terms,
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
  v_order_type text := 'ready_stock';
  v_estimated_arrival text := null;
  v_preorder_terms text := null;
  v_has_preorder boolean := false;
  v_has_ready_stock boolean := false;
  v_has_coming_soon boolean := false;
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
      nullif(btrim(ci.variant_key), '') as variant_key,
      coalesce(ci.selected_options, '[]'::jsonb) as selected_options,
      p.slug as product_slug,
      p.name as product_name,
      p.brand,
      p.primary_image_url,
      p.price as unit_price,
      case
        when lower(coalesce(p.availability_type, 'ready_stock')) = 'preorder' then 0
        else coalesce(p.shipping_fee, 0)
      end as shipping_fee,
      case
        when lower(coalesce(p.shipping_method, '')) like '%sea%' then 'sea'
        when lower(coalesce(p.shipping_method, '')) like '%both%' then 'both'
        else 'air'
      end as normalized_shipping_method,
      case
        when lower(coalesce(p.availability_type, 'ready_stock')) in ('ready_stock', 'preorder', 'coming_soon') then lower(coalesce(p.availability_type, 'ready_stock'))
        else 'ready_stock'
      end as availability_type,
      nullif(btrim(coalesce(p.estimated_arrival, '')), '') as estimated_arrival,
      nullif(btrim(coalesce(p.preorder_terms, '')), '') as preorder_terms,
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
          'variantKey', variant_key,
          'selectedOptions', selected_options,
          'shippingFee', shipping_fee,
          'availabilityType', availability_type,
          'estimatedArrival', estimated_arrival,
          'preorderTerms', preorder_terms,
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
    end,
    coalesce(bool_or(availability_type = 'preorder'), false),
    coalesce(bool_or(availability_type = 'ready_stock'), false),
    coalesce(bool_or(availability_type = 'coming_soon'), false),
    (array_agg(estimated_arrival order by created_at asc, cart_item_id asc) filter (where availability_type = 'preorder' and estimated_arrival is not null))[1],
    (array_agg(preorder_terms order by created_at asc, cart_item_id asc) filter (where availability_type = 'preorder' and preorder_terms is not null))[1]
    into v_items_json, v_subtotal, v_shipping_total, v_shipment_type, v_has_preorder, v_has_ready_stock, v_has_coming_soon, v_estimated_arrival, v_preorder_terms
  from normalized_rows;

  if v_has_coming_soon then
    raise exception 'Coming soon products cannot be checked out yet.';
  end if;

  if v_has_preorder and v_has_ready_stock then
    raise exception 'Pre-order and ready-stock products must be checked out separately.';
  end if;

  v_order_type := case when v_has_preorder then 'preorder' else 'ready_stock' end;

  if v_order_type = 'preorder' then
    v_shipping_total := 0;
  end if;

  v_total := v_subtotal + v_shipping_total;

  insert into public.orders (
    order_number,
    user_id,
    customer_name,
    customer_email,
    order_type,
    status,
    payment_status,
    shipment_type,
    batch_number,
    shipping_address_id,
    shipping_address_snapshot,
    subtotal,
    shipping_total,
    total,
    estimated_arrival,
    preorder_terms,
    created_at,
    updated_at
  ) values (
    private.generate_order_number(),
    v_user_id,
    v_profile.full_name,
    v_profile.email,
    v_order_type,
    case when v_order_type = 'preorder' then 'preorder_received' else 'pending_payment' end,
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
    case when v_order_type = 'preorder' then v_estimated_arrival else null end,
    case when v_order_type = 'preorder' then v_preorder_terms else null end,
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
    variant_key,
    selected_options,
    shipping_fee,
    availability_type,
    estimated_arrival,
    preorder_terms,
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
    variant_key,
    selected_options,
    case when availability_type = 'preorder' then 0 else shipping_fee end,
    availability_type,
    case when availability_type = 'preorder' then estimated_arrival else null end,
    case when availability_type = 'preorder' then preorder_terms else null end,
    unit_price * quantity,
    case when availability_type = 'preorder' then 0 else shipping_fee * quantity end,
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

  if v_status not in (
    'pending',
    'pending_payment',
    'preorder_received',
    'processing',
    'shipped',
    'in_transit',
    'arrived_in_ghana',
    'shipping_fee_pending',
    'ready_for_delivery',
    'completed',
    'delivered',
    'cancelled'
  ) then
    raise exception 'Unsupported order status.';
  end if;

  update public.orders as o
  set status = v_status,
      delivered_at = case
        when v_status in ('delivered', 'completed') then coalesce(o.delivered_at, now())
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

create or replace function private.handle_product_shipping_fee_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_new_fee numeric := coalesce(new.shipping_fee, 0);
  v_old_fee numeric := coalesce(old.shipping_fee, 0);
  v_order record;
  v_balance_due numeric;
  v_source_key text;
  v_message text;
  v_action_url text;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if new.shipping_fee is not distinct from old.shipping_fee then
    return new;
  end if;

  if v_new_fee < 0 then
    raise exception 'Shipping fee cannot be negative.';
  end if;

  for v_order in
    select
      o.id as order_id,
      o.order_number,
      o.user_id,
      o.customer_name,
      o.customer_email,
      sum(
        greatest(round((v_new_fee - coalesce(oi.shipping_fee, 0)) * oi.quantity, 2), 0)
      ) as balance_due
    from public.orders as o
    join public.order_items as oi
      on oi.order_id = o.id
    where oi.product_id = new.id
      and coalesce(lower(o.order_type), 'ready_stock') = 'ready_stock'
    group by
      o.id,
      o.order_number,
      o.user_id,
      o.customer_name,
      o.customer_email
  loop
    v_balance_due := coalesce(v_order.balance_due, 0);

    if v_balance_due <= 0 then
      continue;
    end if;

    update public.orders as o
      set payment_status = 'pending'
      where o.id = v_order.order_id
        and o.payment_status is distinct from 'pending';

    v_source_key := format(
      'shipping-fee-update:%s:%s:%s',
      v_order.order_id,
      new.id,
      to_char(v_new_fee, 'FM999999999990.00')
    );

    v_action_url := format(
      '/payment?purpose=shipping-balance&orderId=%s&orderNumber=%s&amount=%s',
      v_order.order_id,
      coalesce(v_order.order_number, ''),
      to_char(v_balance_due, 'FM999999999990.00')
    );

    v_message := format(
      '%s, the shipping fee for %s on order %s changed from GHS %s to GHS %s. Please pay GHS %s to continue delivery.',
      coalesce(nullif(btrim(v_order.customer_name), ''), 'Customer'),
      coalesce(nullif(btrim(new.name), ''), 'this product'),
      coalesce(nullif(btrim(v_order.order_number), ''), 'your order'),
      to_char(v_old_fee, 'FM999999999990.00'),
      to_char(v_new_fee, 'FM999999999990.00'),
      to_char(v_balance_due, 'FM999999999990.00')
    );

    if v_order.user_id is not null then
      perform private.upsert_notification(
        v_order.user_id,
        'orders',
        'Shipping fee updated',
        v_message,
        'payment_status',
        v_source_key,
        v_order.order_id,
        null,
        null,
        v_action_url,
        'Pay shipping balance',
        'Open the secure payment page to settle the remaining shipping fee.'
      );
    end if;
  end loop;

  return new;
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

revoke all on function public.set_product_availability(uuid, text, text, text) from public;
revoke all on function public.set_product_availability(uuid, text, text, text) from anon;
revoke all on function public.set_product_availability(uuid, text, text, text) from authenticated;
grant execute on function public.set_product_availability(uuid, text, text, text) to authenticated;

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
