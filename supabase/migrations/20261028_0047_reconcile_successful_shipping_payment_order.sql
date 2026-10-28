begin;

-- Reconcile the order-side shipping status for a provider-verified shipping
-- payment that was already persisted as successful before order synchronization
-- completed. This does not allocate money or change payment records.
create or replace function public.reconcile_successful_shipping_payment_order(
  p_payment_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_payment public.payments%rowtype;
  v_order public.orders%rowtype;
  v_known_shipping numeric := 0;
  v_paid_shipping numeric := 0;
  v_outstanding_shipping numeric := 0;
  v_has_pending_shipping boolean := false;
  v_next_status text;
begin
  select * into v_payment
  from public.payments
  where id = p_payment_id
  for update;

  if not found or v_payment.payment_purpose <> 'shipping' then
    raise exception 'The payment is not a persisted shipping payment.';
  end if;

  if v_payment.status <> 'successful' then
    raise exception 'The shipping payment is not verified as successful.';
  end if;

  select * into v_order
  from public.orders
  where id = v_payment.order_id
  for update;

  if not found then
    raise exception 'The shipping payment order was not found.';
  end if;

  perform 1
  from public.order_items as oi
  where oi.order_id = v_order.id
  order by oi.created_at asc, oi.id asc
  for update;

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

  return jsonb_build_object(
    'paymentId', v_payment.id,
    'orderId', v_order.id,
    'status', v_payment.status,
    'shippingPaymentStatus', v_next_status,
    'knownShipping', v_known_shipping,
    'paidShipping', v_paid_shipping,
    'outstandingShipping', v_outstanding_shipping
  );
end;
$function$;

revoke all on function public.reconcile_successful_shipping_payment_order(uuid) from public;
revoke all on function public.reconcile_successful_shipping_payment_order(uuid) from anon;
revoke all on function public.reconcile_successful_shipping_payment_order(uuid) from authenticated;
grant execute on function public.reconcile_successful_shipping_payment_order(uuid) to service_role;

commit;
