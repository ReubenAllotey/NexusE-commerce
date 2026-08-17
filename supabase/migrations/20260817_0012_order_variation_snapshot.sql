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
      nullif(btrim(ci.variant_key), '') as variant_key,
      coalesce(ci.selected_options, '[]'::jsonb) as selected_options,
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
          'variantKey', variant_key,
          'selectedOptions', selected_options,
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
    variant_key,
    selected_options,
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
    variant_key,
    selected_options,
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
