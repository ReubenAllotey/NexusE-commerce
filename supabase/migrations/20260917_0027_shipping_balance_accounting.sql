begin;

-- Reconcile active order-item shipping snapshots when an admin makes a product
-- fee known or changes a known fee. Historical/finalized orders retain their
-- original commercial snapshots.
create or replace function private.handle_product_shipping_fee_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_order record;
  v_new_fee numeric;
  v_new_status text;
  v_balance_due numeric;
  v_known_shipping numeric;
  v_paid_shipping numeric;
  v_has_pending boolean;
  v_next_status text;
  v_source_key text;
  v_message text;
  v_action_url text;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if new.shipping_fee is not distinct from old.shipping_fee
    and new.shipping_fee_status is not distinct from old.shipping_fee_status then
    return new;
  end if;

  v_new_status := case
    when lower(coalesce(new.shipping_fee_status, 'pending')) = 'ready'
      and new.shipping_fee is not null then 'ready'
    else 'pending'
  end;
  v_new_fee := case
    when v_new_status = 'ready' then greatest(coalesce(new.shipping_fee, 0), 0)
    else 0
  end;

  -- Update every eligible line once. The explicit status allow-list protects
  -- completed, delivered, cancelled, and unknown historical states.
  update public.order_items as oi
  set
    shipping_fee = v_new_fee,
    shipping_fee_status = v_new_status,
    line_shipping = v_new_fee * oi.quantity,
    shipping_paid_amount = least(
      greatest(coalesce(oi.shipping_paid_amount, 0), 0),
      v_new_fee * oi.quantity
    )
  from public.orders as o
  where oi.order_id = o.id
    and oi.product_id = new.id
    and lower(coalesce(o.status, '')) in (
      'pending',
      'pending_payment',
      'preorder_received',
      'processing',
      'shipped',
      'in_transit',
      'arrived_in_ghana',
      'shipping_fee_pending',
      'ready_for_delivery'
    );

  -- Recalculate each affected order once, even when it contains multiple
  -- lines or variations of this product.
  for v_order in
    select
      o.id as order_id,
      o.order_number,
      o.user_id,
      o.customer_name,
      o.customer_email,
      string_agg(distinct p.name, ', ' order by p.name) as product_name
    from public.order_items as oi
    join public.orders as o on o.id = oi.order_id
    join public.products as p on p.id = oi.product_id
    where oi.product_id = new.id
      and lower(coalesce(o.status, '')) in (
        'pending',
        'pending_payment',
        'preorder_received',
        'processing',
        'shipped',
        'in_transit',
        'arrived_in_ghana',
        'shipping_fee_pending',
        'ready_for_delivery'
      )
    group by o.id, o.order_number, o.user_id, o.customer_name, o.customer_email
  loop
    select
      coalesce(sum(greatest(oi.line_shipping - coalesce(oi.shipping_paid_amount, 0), 0)), 0),
      coalesce(sum(oi.line_shipping), 0),
      coalesce(sum(coalesce(oi.shipping_paid_amount, 0)), 0),
      coalesce(bool_or(oi.shipping_fee_status = 'pending'), false)
    into v_balance_due, v_known_shipping, v_paid_shipping, v_has_pending
    from public.order_items as oi
    where oi.order_id = v_order.order_id;

    v_next_status := case
      when v_has_pending and v_balance_due > 0 then 'outstanding'
      when v_has_pending then 'pending'
      when v_balance_due > 0 then 'outstanding'
      when v_known_shipping > 0 and v_paid_shipping >= v_known_shipping then 'paid'
      else 'not_due'
    end;

    update public.orders
    set
      shipping_total = v_known_shipping,
      total = subtotal + v_known_shipping,
      shipping_payment_status = v_next_status,
      updated_at = now()
    where id = v_order.order_id;

    if v_balance_due <= 0 or v_order.user_id is null then
      continue;
    end if;

    -- updated_at identifies this product update event while keeping retries of
    -- the same trigger invocation idempotent for upsert_notification().
    v_source_key := format(
      'shipping-fee-update:%s:%s:%s',
      v_order.order_id,
      new.id,
      to_char(new.updated_at, 'YYYYMMDDHH24MISS.US')
    );
    v_action_url := format(
      '/payment?purpose=shipping-balance&orderId=%s&orderNumber=%s&amount=%s',
      v_order.order_id,
      coalesce(v_order.order_number, ''),
      to_char(v_balance_due, 'FM999999999990.00')
    );
    v_message := format(
      '%s, the shipping fee for %s on order %s is now GHS %s. Please pay GHS %s to continue delivery.',
      coalesce(nullif(btrim(v_order.customer_name), ''), 'Customer'),
      coalesce(nullif(btrim(v_order.product_name), ''), 'this product'),
      coalesce(nullif(btrim(v_order.order_number), ''), 'your order'),
      to_char(v_new_fee, 'FM999999999990.00'),
      to_char(v_balance_due, 'FM999999999990.00')
    );

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
  end loop;

  return new;
end;
$function$;

drop trigger if exists products_shipping_fee_change on public.products;
create trigger products_shipping_fee_change
after update of shipping_fee, shipping_fee_status on public.products
for each row
execute function private.handle_product_shipping_fee_change();

revoke all on function private.handle_product_shipping_fee_change() from public;
revoke all on function private.handle_product_shipping_fee_change() from anon;
revoke all on function private.handle_product_shipping_fee_change() from authenticated;

commit;
