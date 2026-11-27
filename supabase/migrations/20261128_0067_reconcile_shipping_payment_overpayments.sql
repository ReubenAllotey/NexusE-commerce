begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

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
  v_existing_allocation public.shipping_payment_allocations%rowtype;
  v_verified_amount numeric := greatest(coalesce(p_verified_amount, 0), 0);
  v_currency text := upper(nullif(btrim(coalesce(p_verified_currency, '')), ''));
  v_remaining numeric := 0;
  v_line_due numeric;
  v_allocation numeric;
  v_known_shipping numeric := 0;
  v_paid_shipping numeric := 0;
  v_outstanding_shipping numeric := 0;
  v_has_pending_shipping boolean := false;
  v_next_status text;
  v_has_allocation boolean := false;
  v_verified_amount_minor bigint;
  v_untracked_successful_payment_id uuid;
  v_provider_verified boolean := false;
  v_excess_minor bigint := 0;
  v_credit_source_key text;
  v_credit_email text;
  v_credit_name text;
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

  if nullif(btrim(coalesce(v_payment.provider_reference, '')), '') is null then
    raise exception 'The shipping payment has no provider reference.';
  end if;

  if v_payment.payment_purpose <> 'shipping' then
    raise exception 'The payment is not a shipping-balance payment.';
  end if;

  select exists (
    select 1 from public.payment_events pe
    where pe.payment_id = v_payment.id
      and pe.provider_reference = v_payment.provider_reference
      and lower(coalesce(pe.status, '')) = 'successful'
  ) into v_provider_verified;

  v_verified_amount_minor := round(v_verified_amount * 100)::bigint;

  if v_verified_amount <= 0
    or abs((v_verified_amount * 100) - v_verified_amount_minor) > 0.000001 then
    raise exception 'Verified shipping payment amount must be a positive minor-unit amount.';
  end if;

  if upper(coalesce(v_payment.currency, 'GHS')) <> v_currency
    or v_payment.amount_minor <> v_verified_amount_minor
    or abs((coalesce(v_payment.amount, 0) * 100) - v_payment.amount_minor) > 0.000001
    or abs(coalesce(v_payment.amount, 0) - v_verified_amount) > 0.000001 then
    raise exception 'The verified shipping payment does not match the payment record.';
  end if;

  -- Lock the payment-specific ledger row, when present, before locking the
  -- order and items. This makes retries for one payment deterministic while
  -- preserving the existing payment -> order -> item lock order.
  select * into v_existing_allocation
  from public.shipping_payment_allocations
  where payment_id = v_payment.id
  for update;
  v_has_allocation := found;

  if v_has_allocation then
    if v_existing_allocation.order_id <> v_payment.order_id
      or v_existing_allocation.amount_minor <> v_verified_amount_minor
      or upper(v_existing_allocation.currency) <> v_currency then
      raise exception 'The shipping payment allocation ledger does not match the verified payment.';
    end if;

    if v_payment.status <> 'successful' then
      raise exception 'The shipping payment allocation ledger is inconsistent with payment status.';
    end if;
  elsif v_payment.status = 'successful' and not v_provider_verified then
    raise exception 'Shipping payment allocation history requires manual reconciliation.';
  end if;

  select * into v_order
  from public.orders
  where id = v_payment.order_id
  for update;

  if not found then
    raise exception 'The shipping payment order was not found.';
  end if;
  if v_payment.user_id is distinct from v_order.user_id and (v_payment.user_id is not null or v_order.user_id is not null) then
    raise exception 'The shipping payment ownership does not match the order.';
  end if;

  -- Aggregate item balances cannot prove that a particular historical
  -- successful payment was allocated. Block new allocation until those rows
  -- have been independently audited and represented in the ledger.
  select p.id into v_untracked_successful_payment_id
  from public.payments p
  where p.order_id = v_order.id
    and p.payment_purpose = 'shipping'
    and p.status = 'successful'
    and p.id <> v_payment.id
    and not exists (
      select 1
      from public.shipping_payment_allocations a
      where a.payment_id = p.id
    )
  order by p.paid_at asc nulls first, p.id asc
  limit 1;

  if v_untracked_successful_payment_id is not null then
    raise exception 'A historical successful shipping payment requires manual reconciliation before this order can be finalized.';
  end if;

  if auth.uid() is not null
    and auth.uid() <> v_order.user_id
    and not private.is_admin_user() then
    raise exception 'You do not have permission to finalize this shipping payment.';
  end if;

  -- Lock every line before calculating the authoritative balance. This keeps
  -- recovery and normal finalization on the same lock order.
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

  if v_has_allocation then
    v_remaining := 0;
  else
    if v_outstanding_shipping <= 0 and not v_provider_verified then
      raise exception 'No shipping balance is currently due.';
    end if;

    if v_verified_amount > v_outstanding_shipping + 0.000001 and not v_provider_verified then
      raise exception 'The shipping balance changed before this payment was finalized.';
    end if;

    v_remaining := v_verified_amount;

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
      if not v_provider_verified then
        raise exception 'The shipping payment could not be fully allocated.';
      end if;
      v_excess_minor := round(v_remaining * 100)::bigint;
      v_credit_source_key := 'shipping-credit:payment:' || v_payment.id::text;
      insert into public.shipping_credit_ledger (
        order_id, user_id, entry_type, amount_minor, source_adjustment_order_id, source_key, metadata
      ) values (
        v_order.id, v_order.user_id, 'issue', v_excess_minor, null, v_credit_source_key,
        jsonb_build_object('paymentId', v_payment.id, 'providerReference', v_payment.provider_reference, 'verifiedAmountMinor', v_verified_amount_minor, 'allocatedAmountMinor', v_verified_amount_minor - v_excess_minor)
      ) on conflict (source_key) do nothing;
      v_remaining := 0;
    end if;

    insert into public.shipping_payment_allocations (
      payment_id,
      order_id,
      amount_minor,
      currency
    ) values (
      v_payment.id,
      v_payment.order_id,
      v_verified_amount_minor,
      v_currency
    );
  end if;

  if v_excess_minor > 0 then
    v_credit_email := lower(nullif(btrim(coalesce(v_order.customer_email, '')), ''));
    if v_credit_email is null then
      v_credit_email := lower(nullif(btrim(coalesce(v_order.guest_email, '')), ''));
    end if;
    v_credit_name := coalesce(nullif(btrim(v_order.customer_name), ''), 'Customer');
    insert into public.notifications (
      user_id, recipient_email, recipient_name, category, title, message, order_id, payment_id,
      action_url, action_label, action_description, source_type, source_key, is_read, read_at
    ) values (
      v_order.user_id, case when v_order.user_id is null then v_credit_email else null end, v_credit_name, 'shipping',
      'Shipping credit available',
      format('A shipping credit of GHS %s is available from payment %s.', to_char(v_excess_minor / 100.0, 'FM999999990.00'), v_payment.provider_reference),
      v_order.id, v_payment.id, '/profile/orders', 'View shipping credit', 'Open your account to view available shipping credit.',
      'payment_status', v_credit_source_key || ':notification', false, null
    ) on conflict do nothing;
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
    'orderId', v_payment.order_id,
    'status', 'successful',
    'alreadyFinalized', v_has_allocation,
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

revoke all on function public.finalize_shipping_payment(uuid, numeric, text) from public, anon, authenticated;
grant execute on function public.finalize_shipping_payment(uuid, numeric, text) to service_role;
commit;
