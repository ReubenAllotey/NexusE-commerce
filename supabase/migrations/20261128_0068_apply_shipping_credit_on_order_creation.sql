begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Apply customer shipping credit during order creation. The immediate trigger
-- keeps the returned order bundle authoritative while using the same payment
-- advisory lock as shipping initialization/finalization.
create or replace function private.apply_shipping_credit_to_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_order public.orders%rowtype;
  v_item record;
  v_credit_available bigint := 0;
  v_credit_to_apply bigint;
  v_due numeric;
  v_known_shipping numeric := 0;
  v_paid_shipping numeric := 0;
  v_outstanding_shipping numeric := 0;
  v_has_pending_shipping boolean := false;
  v_recipient_email text;
  v_source_key text;
begin
  select * into v_order
  from public.orders
  where id = new.order_id
  for update;

  if not found or v_order.user_id is null then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_order.id::text || ':shipping-payment', 0)
  );

  for v_item in
    select oi.id, greatest(coalesce(oi.line_shipping, 0), 0) as line_shipping,
           least(greatest(coalesce(oi.shipping_paid_amount, 0), 0), greatest(coalesce(oi.line_shipping, 0), 0)) as paid_shipping
    from public.order_items oi
    where oi.order_id = v_order.id
    order by oi.created_at, oi.id
    for update
  loop
    null;
  end loop;

  for v_item in
    select l.entry_type, l.amount_minor
    from public.shipping_credit_ledger l
    where l.user_id = v_order.user_id
    order by l.created_at, l.id
    for update
  loop
    v_credit_available := v_credit_available + case when v_item.entry_type = 'issue' then v_item.amount_minor else -v_item.amount_minor end;
  end loop;
  v_credit_available := greatest(v_credit_available, 0);
  if v_credit_available <= 0 then
    return new;
  end if;

  for v_item in
    select oi.id,
           greatest(coalesce(oi.line_shipping, 0), 0) as line_shipping,
           least(greatest(coalesce(oi.shipping_paid_amount, 0), 0), greatest(coalesce(oi.line_shipping, 0), 0)) as paid_shipping
    from public.order_items oi
    where oi.order_id = v_order.id
      and lower(coalesce(oi.shipping_fee_status, '')) = 'ready'
      and greatest(coalesce(oi.line_shipping, 0), 0) > least(greatest(coalesce(oi.shipping_paid_amount, 0), 0), greatest(coalesce(oi.line_shipping, 0), 0))
    order by oi.created_at, oi.id
    for update
  loop
    exit when v_credit_available <= 0;
    v_due := greatest(v_item.line_shipping - v_item.paid_shipping, 0);
    v_credit_to_apply := least(v_credit_available, greatest(round(v_due * 100), 0)::bigint);
    if v_credit_to_apply <= 0 then
      continue;
    end if;

    update public.order_items
    set shipping_paid_amount = least(v_item.line_shipping, v_item.paid_shipping + v_credit_to_apply / 100.0)
    where id = v_item.id;

    v_source_key := 'shipping-credit:order:' || v_order.id::text || ':item:' || v_item.id::text;
    insert into public.shipping_credit_ledger (
      order_id, user_id, entry_type, amount_minor, source_adjustment_order_id, source_key, metadata
    ) values (
      v_order.id, v_order.user_id, 'consume', v_credit_to_apply, null, v_source_key,
      jsonb_build_object('orderId', v_order.id, 'orderItemId', v_item.id, 'automatic', true)
    ) on conflict (source_key) do nothing;
    v_credit_available := v_credit_available - v_credit_to_apply;
  end loop;

  select coalesce(sum(greatest(coalesce(oi.line_shipping, 0), 0)), 0),
         coalesce(sum(least(greatest(coalesce(oi.shipping_paid_amount, 0), 0), greatest(coalesce(oi.line_shipping, 0), 0))), 0),
         coalesce(bool_or(lower(coalesce(oi.shipping_fee_status, '')) = 'pending'), false)
  into v_known_shipping, v_paid_shipping, v_has_pending_shipping
  from public.order_items oi
  where oi.order_id = v_order.id;
  v_outstanding_shipping := greatest(v_known_shipping - v_paid_shipping, 0);

  update public.orders
  set shipping_payment_status = case
        when v_has_pending_shipping then 'pending'
        when v_outstanding_shipping > 0 then case when v_paid_shipping > 0 then 'partial' else 'outstanding' end
        when v_known_shipping > 0 then 'paid'
        else 'not_due'
      end,
      amount_due_now = case
        when lower(coalesce(v_order.shipping_payment_mode, '')) = 'pay_now'
          then v_order.subtotal + v_outstanding_shipping
        else v_order.amount_due_now
      end,
      updated_at = now()
  where id = v_order.id;

  if v_outstanding_shipping > 0
    and not v_has_pending_shipping
    and v_known_shipping >= greatest(coalesce(v_order.shipping_total, 0), 0)
    and lower(coalesce(v_order.shipping_payment_mode, '')) = 'pay_later' then
    v_recipient_email := lower(nullif(btrim(v_order.customer_email), ''));
    if v_recipient_email is null then
      v_recipient_email := lower(nullif(btrim(v_order.guest_email), ''));
    end if;
    if v_recipient_email is not null and position('@' in v_recipient_email) >= 2 then
      insert into public.notifications (
        user_id, recipient_email, recipient_name, category, title, message, order_id,
        action_url, action_label, action_description, source_type, source_key, is_read, read_at
      ) values (
        v_order.user_id,
        case when v_order.user_id is null then v_recipient_email else null end,
        coalesce(nullif(btrim(v_order.customer_name), ''), 'Customer'),
        'shipping', 'Shipping payment required',
        format('Your remaining shipping balance for order %s is GHS %s.', v_order.order_number, to_char(v_outstanding_shipping, 'FM999999990.00')),
        v_order.id, '/payment?purpose=shipping-balance&orderId=' || v_order.id::text,
        'Pay Shipping Balance', 'Open the secure shipping payment page.',
        'payment_status', 'shipping-payment-request:' || v_order.id::text, false, null
      ) on conflict do nothing;
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists order_items_apply_shipping_credit on public.order_items;
create constraint trigger order_items_apply_shipping_credit
after insert on public.order_items
for each row execute function private.apply_shipping_credit_to_order();

revoke all on function private.apply_shipping_credit_to_order() from public, anon, authenticated, service_role;

commit;
