begin;

-- Atomically finalize one verified shipping-balance payment. The server must
-- authenticate the caller, verify Paystack, and pass the payment row id. This
-- function protects the financial allocation itself from duplicate/concurrent
-- verification requests.
create or replace function public.finalize_shipping_payment(
  p_payment_id uuid,
  p_verified_amount numeric,
  p_verified_currency text default 'GHS'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_payment public.payments%rowtype;
  v_order public.orders%rowtype;
  v_item record;
  v_verified_amount numeric := greatest(coalesce(p_verified_amount, 0), 0);
  v_currency text := upper(nullif(btrim(coalesce(p_verified_currency, '')), ''));
  v_remaining numeric;
  v_line_due numeric;
  v_allocation numeric;
  v_known_shipping numeric := 0;
  v_paid_shipping numeric := 0;
  v_outstanding_shipping numeric := 0;
  v_has_pending_shipping boolean := false;
  v_next_status text;
begin
  if v_currency is null then
    v_currency := 'GHS';
  end if;

  select * into v_payment
  from public.payments
  where id = p_payment_id
  for update;

  if not found then
    raise exception 'Shipping payment record was not found.';
  end if;

  if v_payment.payment_purpose <> 'shipping' then
    raise exception 'The payment is not a shipping-balance payment.';
  end if;

  if v_verified_amount <= 0 then
    raise exception 'Verified shipping payment amount must be greater than zero.';
  end if;

  if v_payment.status = 'successful' then
    return jsonb_build_object(
      'paymentId', v_payment.id,
      'orderId', v_payment.order_id,
      'status', 'successful',
      'alreadyFinalized', true,
      'amount', v_payment.amount
    );
  end if;

  if upper(coalesce(v_payment.currency, 'GHS')) <> v_currency
    or abs(coalesce(v_payment.amount, 0) - v_verified_amount) > 0.000001 then
    raise exception 'The verified shipping payment does not match the payment record.';
  end if;

  select * into v_order
  from public.orders
  where id = v_payment.order_id
  for update;

  if not found then
    raise exception 'The shipping payment order was not found.';
  end if;

  if auth.uid() is not null
    and auth.uid() <> v_order.user_id
    and not private.is_admin_user() then
    raise exception 'You do not have permission to finalize this shipping payment.';
  end if;

  -- Lock every line before calculating the authoritative balance. The order
  -- and line locks make concurrent shipping finalizers serialize on the same
  -- financial state while preserving deterministic row ordering.
  for v_item in
    select oi.id
    from public.order_items as oi
    where oi.order_id = v_order.id
    order by oi.created_at asc, oi.id asc
    for update
  loop
    null;
  end loop;

  select
    coalesce(sum(greatest(coalesce(oi.line_shipping, 0), 0)), 0),
    coalesce(sum(least(
      greatest(coalesce(oi.shipping_paid_amount, 0), 0),
      greatest(coalesce(oi.line_shipping, 0), 0)
    )), 0),
    coalesce(bool_or(oi.shipping_fee_status = 'pending'), false)
  into v_known_shipping, v_paid_shipping, v_has_pending_shipping
  from public.order_items as oi
  where oi.order_id = v_order.id;

  v_outstanding_shipping := greatest(v_known_shipping - v_paid_shipping, 0);

  if v_outstanding_shipping <= 0 then
    raise exception 'No shipping balance is currently due.';
  end if;

  if v_verified_amount > v_outstanding_shipping + 0.000001 then
    raise exception 'The shipping balance changed before this payment was finalized.';
  end if;

  v_remaining := v_verified_amount;

  -- Lock and allocate each line in deterministic order. Any exception rolls
  -- back the complete allocation and payment update as one transaction.
  for v_item in
    select
      oi.id,
      greatest(coalesce(oi.line_shipping, 0), 0) as line_shipping,
      least(
        greatest(coalesce(oi.shipping_paid_amount, 0), 0),
        greatest(coalesce(oi.line_shipping, 0), 0)
      ) as paid_shipping
    from public.order_items as oi
    where oi.order_id = v_order.id
      and oi.shipping_fee_status = 'ready'
      and greatest(coalesce(oi.line_shipping, 0), 0) > least(
        greatest(coalesce(oi.shipping_paid_amount, 0), 0),
        greatest(coalesce(oi.line_shipping, 0), 0)
      )
    order by oi.created_at asc, oi.id asc
    for update
  loop
    exit when v_remaining <= 0;

    v_line_due := greatest(v_item.line_shipping - v_item.paid_shipping, 0);
    v_allocation := least(v_line_due, v_remaining);

    if v_allocation > 0 then
      update public.order_items
      set shipping_paid_amount = least(
        v_item.line_shipping,
        v_item.paid_shipping + v_allocation
      )
      where id = v_item.id;

      v_remaining := v_remaining - v_allocation;
    end if;
  end loop;

  if v_remaining > 0.000001 then
    raise exception 'The shipping payment could not be fully allocated.';
  end if;

  select
    coalesce(sum(greatest(coalesce(oi.line_shipping, 0), 0)), 0),
    coalesce(sum(least(
      greatest(coalesce(oi.shipping_paid_amount, 0), 0),
      greatest(coalesce(oi.line_shipping, 0), 0)
    )), 0),
    coalesce(bool_or(oi.shipping_fee_status = 'pending'), false)
  into v_known_shipping, v_paid_shipping, v_has_pending_shipping
  from public.order_items as oi
  where oi.order_id = v_order.id;

  v_outstanding_shipping := greatest(v_known_shipping - v_paid_shipping, 0);
  v_next_status := case
    when v_has_pending_shipping and v_outstanding_shipping > 0 then 'outstanding'
    when v_has_pending_shipping then 'pending'
    when v_outstanding_shipping > 0 then 'outstanding'
    when v_known_shipping > 0 then 'paid'
    else 'not_due'
  end;

  update public.orders
  set shipping_total = v_known_shipping,
      shipping_payment_status = v_next_status,
      updated_at = now()
  where id = v_order.id;

  update public.payments
  set status = 'successful',
      paid_at = coalesce(v_payment.paid_at, now()),
      amount = v_verified_amount,
      amount_minor = round(v_verified_amount * 100)::bigint,
      currency = v_currency,
      updated_at = now()
  where id = v_payment.id;

  return jsonb_build_object(
    'paymentId', v_payment.id,
    'orderId', v_order.id,
    'status', 'successful',
    'alreadyFinalized', false,
    'amount', v_verified_amount,
    'knownShipping', v_known_shipping,
    'paidShipping', v_paid_shipping,
    'outstandingShipping', v_outstanding_shipping,
    'shippingPaymentStatus', v_next_status
  );
end;
$function$;

revoke all on function public.finalize_shipping_payment(uuid, numeric, text) from public;
revoke all on function public.finalize_shipping_payment(uuid, numeric, text) from anon;
revoke all on function public.finalize_shipping_payment(uuid, numeric, text) from authenticated;
grant execute on function public.finalize_shipping_payment(uuid, numeric, text) to service_role;

commit;
