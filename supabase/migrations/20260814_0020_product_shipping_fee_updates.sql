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

drop trigger if exists products_shipping_fee_change on public.products;
create trigger products_shipping_fee_change
after update of shipping_fee on public.products
for each row
execute function private.handle_product_shipping_fee_change();

revoke all on function private.handle_product_shipping_fee_change() from public;
revoke all on function private.handle_product_shipping_fee_change() from anon;
revoke all on function private.handle_product_shipping_fee_change() from authenticated;
