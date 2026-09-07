begin;

alter table public.orders
  add column if not exists checkout_group_id uuid;

create index if not exists orders_checkout_group_id_idx
  on public.orders (checkout_group_id);

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
  v_ready_order jsonb := null;
  v_preorder_order jsonb := null;
  v_orders jsonb := '[]'::jsonb;
  v_checkout_group_id uuid := gen_random_uuid();
  v_shipping_address_id uuid;
  v_batch_number text := null;
  v_cart_item_count integer := 0;
  v_invalid_count integer := 0;
  v_has_ready_stock boolean := false;
  v_has_preorder boolean := false;
  v_has_coming_soon boolean := false;
  v_ready_subtotal numeric := 0;
  v_ready_shipping numeric := 0;
  v_preorder_subtotal numeric := 0;
  v_preorder_shipping numeric := 0;
  v_shipment_type text := null;
  v_estimated_arrival text := null;
  v_preorder_terms text := null;
  v_shipping_address_snapshot jsonb;
begin
  if v_user_id is null then
    raise exception 'Please sign in to create an order.';
  end if;

  select * into v_profile
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

  select * into v_address
  from public.addresses as a
  where a.id = v_shipping_address_id
    and a.user_id = v_user_id;

  if not found then
    raise exception 'The selected shipping address does not belong to your account.';
  end if;

  v_shipping_address_snapshot := jsonb_build_object(
    'id', v_address.id, 'addressLabel', v_address.address_label,
    'fullName', v_address.full_name, 'phoneNumber', v_address.phone_number,
    'emailAddress', v_address.email_address, 'country', v_address.country,
    'region', v_address.region, 'city', v_address.city,
    'streetAddress', v_address.street_address, 'houseNumber', v_address.house_number,
    'landmark', v_address.landmark, 'postalCode', v_address.postal_code,
    'isDefault', v_address.is_default
  );

  select * into v_cart
  from public.carts as c
  where c.user_id = v_user_id;

  if not found then
    raise exception 'Your cart is empty.';
  end if;

  select count(*) into v_cart_item_count
  from public.cart_items as ci
  where ci.cart_id = v_cart.id;

  if v_cart_item_count = 0 then
    raise exception 'Your cart is empty.';
  end if;

  select count(*) into v_invalid_count
  from public.cart_items as ci
  left join public.products as p on p.id = ci.product_id
  where ci.cart_id = v_cart.id
    and (
      p.id is null
      or p.status <> 'active'
      or p.deleted_at is not null
      or ci.quantity <= 0
      or lower(coalesce(p.stock_status, '')) in ('out of stock', 'out_of_stock')
    );

  if v_invalid_count > 0 then
    raise exception 'Your cart contains an inactive, deleted, out-of-stock, or invalid product.';
  end if;

  drop table if exists pg_temp.nexus_checkout_rows;

  create temporary table nexus_checkout_rows on commit drop as
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
    coalesce(selected_option.price_delta, p.price) as unit_price,
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
      when lower(coalesce(p.availability_type, 'ready_stock')) in ('ready_stock', 'preorder', 'coming_soon')
        then lower(coalesce(p.availability_type, 'ready_stock'))
      else 'ready_stock'
    end as availability_type,
    nullif(btrim(coalesce(p.estimated_arrival, '')), '') as estimated_arrival,
    nullif(btrim(coalesce(p.preorder_terms, '')), '') as preorder_terms,
    p.created_at
  from public.cart_items as ci
  join public.products as p on p.id = ci.product_id
  left join lateral (
    select
      o.id as option_id,
      o.price_delta
    from jsonb_array_elements(coalesce(ci.selected_options, '[]'::jsonb)) as selected(value)
    join public.product_variation_options as o
      on true
    join public.product_variation_groups as g
      on g.id = o.group_id
     and g.product_id = p.id
    where (
      (
        o.id = nullif(selected.value ->> 'optionId', '')::uuid
        or o.id = nullif(selected.value ->> 'option_id', '')::uuid
      )
      or (
        nullif(selected.value ->> 'optionId', '') is null
        and nullif(selected.value ->> 'option_id', '') is null
        and (
          nullif(selected.value ->> 'groupId', '') is null
          or g.id = nullif(selected.value ->> 'groupId', '')::uuid
        )
        and (
          nullif(selected.value ->> 'group_id', '') is null
          or g.id = nullif(selected.value ->> 'group_id', '')::uuid
        )
        and (
          nullif(selected.value ->> 'groupName', '') is null
          or lower(g.group_name) = lower(nullif(selected.value ->> 'groupName', ''))
        )
        and (
          nullif(selected.value ->> 'group_name', '') is null
          or lower(g.group_name) = lower(nullif(selected.value ->> 'group_name', ''))
        )
        and (
          (
            coalesce(
              nullif(selected.value ->> 'label', ''),
              nullif(selected.value ->> 'option_label', '')
            ) is not null
            and lower(o.option_label) = lower(coalesce(
              nullif(selected.value ->> 'label', ''),
              nullif(selected.value ->> 'option_label', '')
            ))
          )
          or (
            coalesce(
              nullif(selected.value ->> 'value', ''),
              nullif(selected.value ->> 'option_value', '')
            ) is not null
            and lower(coalesce(o.option_value, '')) = lower(coalesce(
              nullif(selected.value ->> 'value', ''),
              nullif(selected.value ->> 'option_value', '')
            ))
          )
        )
      )
    )
    order by
      case
        when o.id = nullif(selected.value ->> 'optionId', '')::uuid
          or o.id = nullif(selected.value ->> 'option_id', '')::uuid then 0
        else 1
      end,
      g.display_order asc, o.display_order asc, o.created_at asc, o.id asc
    limit 1
  ) as selected_option on true
  where ci.cart_id = v_cart.id
  order by ci.created_at asc, ci.id asc;

  select
    coalesce(bool_or(availability_type = 'ready_stock'), false),
    coalesce(bool_or(availability_type = 'preorder'), false),
    coalesce(bool_or(availability_type = 'coming_soon'), false)
  into v_has_ready_stock, v_has_preorder, v_has_coming_soon
  from pg_temp.nexus_checkout_rows;

  if v_has_coming_soon then
    raise exception 'Coming soon products cannot be checked out yet.';
  end if;

  select
    coalesce(sum(unit_price * quantity) filter (where availability_type = 'ready_stock'), 0),
    coalesce(sum(shipping_fee * quantity) filter (where availability_type = 'ready_stock'), 0),
    coalesce(sum(unit_price * quantity) filter (where availability_type = 'preorder'), 0)
  into v_ready_subtotal, v_ready_shipping, v_preorder_subtotal
  from pg_temp.nexus_checkout_rows;

  v_preorder_shipping := 0;

  if v_has_ready_stock then
    select
      case
        when count(distinct normalized_shipping_method) = 0 then null
        when count(distinct normalized_shipping_method) = 1 then max(normalized_shipping_method)
        else 'both'
      end
    into v_shipment_type
    from pg_temp.nexus_checkout_rows
    where availability_type = 'ready_stock';

    insert into public.orders (
      order_number, user_id, customer_name, customer_email, order_type, status,
      payment_status, shipment_type, batch_number, checkout_group_id,
      shipping_address_id, shipping_address_snapshot, subtotal, shipping_total,
      total, estimated_arrival, preorder_terms, created_at, updated_at
    ) values (
      private.generate_order_number(), v_user_id, v_profile.full_name, v_profile.email,
      'ready_stock', 'pending_payment', 'pending', v_shipment_type, v_batch_number,
      v_checkout_group_id, v_address.id,
      v_shipping_address_snapshot,
      v_ready_subtotal, v_ready_shipping, v_ready_subtotal + v_ready_shipping,
      null, null, now(), now()
    ) returning * into v_order;

    insert into public.order_items (
      order_id, product_id, product_name, product_slug, brand, image_url, unit_price,
      quantity, selected_color, selected_size, variant_key, selected_options,
      shipping_fee, availability_type, estimated_arrival, preorder_terms,
      line_subtotal, line_shipping, created_at
    )
    select
      v_order.id, product_id, product_name, product_slug, brand, primary_image_url,
      unit_price, quantity, selected_color, selected_size, variant_key, selected_options,
      shipping_fee, availability_type, null, null,
      unit_price * quantity, shipping_fee * quantity, created_at
    from pg_temp.nexus_checkout_rows
    where availability_type = 'ready_stock';

    v_ready_order := jsonb_set(
      private.get_order_bundle(v_order.id),
      '{order,checkoutGroupId}',
      to_jsonb(v_checkout_group_id),
      true
    );
    v_orders := v_orders || jsonb_build_array(v_ready_order);
  end if;

  if v_has_preorder then
    select
      case
        when count(*) filter (where estimated_arrival is not null) = 0 then null
        else (array_agg(estimated_arrival order by created_at asc, cart_item_id asc)
          filter (where estimated_arrival is not null))[1]
      end,
      case
        when count(*) filter (where preorder_terms is not null) = 0 then null
        else (array_agg(preorder_terms order by created_at asc, cart_item_id asc)
          filter (where preorder_terms is not null))[1]
      end
    into v_estimated_arrival, v_preorder_terms
    from pg_temp.nexus_checkout_rows
    where availability_type = 'preorder';

    select
      case
        when count(distinct normalized_shipping_method) = 0 then null
        when count(distinct normalized_shipping_method) = 1 then max(normalized_shipping_method)
        else 'both'
      end
    into v_shipment_type
    from pg_temp.nexus_checkout_rows
    where availability_type = 'preorder';

    insert into public.orders (
      order_number, user_id, customer_name, customer_email, order_type, status,
      payment_status, shipment_type, batch_number, checkout_group_id,
      shipping_address_id, shipping_address_snapshot, subtotal, shipping_total,
      total, estimated_arrival, preorder_terms, created_at, updated_at
    ) values (
      private.generate_order_number(), v_user_id, v_profile.full_name, v_profile.email,
      'preorder', 'preorder_received', 'pending', v_shipment_type, v_batch_number,
      v_checkout_group_id, v_address.id,
      v_shipping_address_snapshot,
      v_preorder_subtotal, 0, v_preorder_subtotal,
      v_estimated_arrival, v_preorder_terms, now(), now()
    ) returning * into v_order;

    insert into public.order_items (
      order_id, product_id, product_name, product_slug, brand, image_url, unit_price,
      quantity, selected_color, selected_size, variant_key, selected_options,
      shipping_fee, availability_type, estimated_arrival, preorder_terms,
      line_subtotal, line_shipping, created_at
    )
    select
      v_order.id, product_id, product_name, product_slug, brand, primary_image_url,
      unit_price, quantity, selected_color, selected_size, variant_key, selected_options,
      0, availability_type, estimated_arrival, preorder_terms,
      unit_price * quantity, 0, created_at
    from pg_temp.nexus_checkout_rows
    where availability_type = 'preorder';

    v_preorder_order := jsonb_set(
      private.get_order_bundle(v_order.id),
      '{order,checkoutGroupId}',
      to_jsonb(v_checkout_group_id),
      true
    );
    v_orders := v_orders || jsonb_build_array(v_preorder_order);
  end if;

  delete from public.cart_items as ci
  where ci.cart_id = v_cart.id;

  update public.carts as c
  set updated_at = now()
  where c.id = v_cart.id;

  return jsonb_build_object(
    'checkoutGroupId', v_checkout_group_id,
    'orders', v_orders,
    'combined', jsonb_build_object(
      'subtotal', v_ready_subtotal + v_preorder_subtotal,
      'shippingTotal', v_ready_shipping + v_preorder_shipping,
      'total', v_ready_subtotal + v_ready_shipping + v_preorder_subtotal
    ),
    'order', coalesce(v_orders -> 0 -> 'order', '{}'::jsonb),
    'items', coalesce(v_orders -> 0 -> 'items', '[]'::jsonb),
    'shippingAddress', v_shipping_address_snapshot
  );
end;
$function$;

revoke all on function public.create_order_from_cart(jsonb) from public;
revoke all on function public.create_order_from_cart(jsonb) from anon;
revoke all on function public.create_order_from_cart(jsonb) from authenticated;
grant execute on function public.create_order_from_cart(jsonb) to authenticated;

commit;
