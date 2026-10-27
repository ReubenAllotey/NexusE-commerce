begin;

-- Serialize shipping-payment initialization per order. This prevents two
-- simultaneous reminder clicks from creating separate active Paystack attempts.
create or replace function public.claim_shipping_payment_attempt(
  p_order_id uuid,
  p_user_id uuid,
  p_amount numeric,
  p_provider_reference text
)
returns public.payments
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_payment public.payments%rowtype;
  v_amount numeric := greatest(coalesce(p_amount, 0), 0);
  v_reference text := nullif(btrim(coalesce(p_provider_reference, '')), '');
begin
  if p_order_id is null or v_amount <= 0 or v_reference is null then
    raise exception 'A valid shipping payment attempt is required.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_order_id::text || ':shipping-payment', 0));

  select *
    into v_payment
  from public.payments
  where order_id = p_order_id
    and payment_purpose = 'shipping'
    and status in ('pending', 'processing')
  order by created_at desc, id desc
  limit 1
  for update;

  if found then
    if abs(coalesce(v_payment.amount, 0) - v_amount) > 0.000001
      or upper(coalesce(v_payment.currency, 'GHS')) <> 'GHS' then
      raise exception 'The active shipping payment amount changed; restart checkout.';
    end if;
    return v_payment;
  end if;

  insert into public.payments (
    order_id,
    user_id,
    provider,
    payment_purpose,
    provider_reference,
    status,
    amount,
    currency,
    amount_minor
  ) values (
    p_order_id,
    p_user_id,
    'paystack',
    'shipping',
    v_reference,
    'pending',
    v_amount,
    'GHS',
    round(v_amount * 100)::bigint
  )
  returning * into v_payment;

  return v_payment;
end;
$function$;

revoke all on function public.claim_shipping_payment_attempt(uuid, uuid, numeric, text) from public;
revoke all on function public.claim_shipping_payment_attempt(uuid, uuid, numeric, text) from anon;
revoke all on function public.claim_shipping_payment_attempt(uuid, uuid, numeric, text) from authenticated;
grant execute on function public.claim_shipping_payment_attempt(uuid, uuid, numeric, text) to service_role;

commit;
