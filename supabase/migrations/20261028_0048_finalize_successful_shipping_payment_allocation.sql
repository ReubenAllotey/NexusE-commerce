begin;

create table public.shipping_payment_allocations (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete restrict,
  order_id uuid not null references public.orders(id) on delete restrict,
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null default 'GHS' check (upper(currency) = 'GHS'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shipping_payment_allocations_payment_unique unique (payment_id)
);

create index shipping_payment_allocations_order_idx
  on public.shipping_payment_allocations(order_id);

alter table public.shipping_payment_allocations enable row level security;
revoke all on table public.shipping_payment_allocations from public, anon, authenticated, service_role;

-- Extend the existing allocator with payment-specific idempotency. The item
-- allocation loop remains the only allocation mechanism.
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
  elsif v_payment.status = 'successful' then
    raise exception 'Shipping payment allocation history requires manual reconciliation.';
  end if;

  select * into v_order
  from public.orders
  where id = v_payment.order_id
  for update;

  if not found then
    raise exception 'The shipping payment order was not found.';
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
    if v_outstanding_shipping <= 0 then
      raise exception 'No shipping balance is currently due.';
    end if;

    if v_verified_amount > v_outstanding_shipping + 0.000001 then
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
      raise exception 'The shipping payment could not be fully allocated.';
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

commit;
