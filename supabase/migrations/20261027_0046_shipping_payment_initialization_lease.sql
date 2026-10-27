begin;

-- A lease prevents duplicate provider initialization without holding a
-- database transaction open across the Paystack network request.
alter table public.payments
  add column if not exists initialization_lease_id uuid,
  add column if not exists initialization_lease_expires_at timestamptz;

create index if not exists payments_initialization_lease_idx
  on public.payments (initialization_lease_expires_at)
  where payment_purpose = 'shipping'
    and initialization_lease_id is not null;

create or replace function public.acquire_shipping_payment_initialization_lease(
  p_payment_id uuid,
  p_lease_id uuid,
  p_lease_seconds integer default 120
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_payment public.payments%rowtype;
  v_seconds integer := greatest(30, least(coalesce(p_lease_seconds, 120), 600));
  v_recovery_required boolean := false;
begin
  if p_payment_id is null or p_lease_id is null then
    raise exception 'A valid shipping payment initialization lease is required.';
  end if;

  select * into v_payment
  from public.payments
  where id = p_payment_id
  for update;

  if not found then
    raise exception 'The shipping payment record was not found.';
  end if;

  if v_payment.payment_purpose <> 'shipping' then
    raise exception 'The payment is not a shipping payment.';
  end if;

  if v_payment.status = 'successful' then
    return jsonb_build_object('state', 'settled', 'paymentId', v_payment.id);
  end if;

  v_recovery_required := v_payment.status = 'processing'
    or v_payment.initialization_lease_id is not null;

  if v_payment.authorization_url is not null
    and v_payment.access_code is not null
    and btrim(v_payment.authorization_url) <> ''
    and btrim(v_payment.access_code) <> '' then
    return jsonb_build_object(
      'state', 'ready',
      'paymentId', v_payment.id,
      'providerReference', v_payment.provider_reference,
      'authorizationUrl', v_payment.authorization_url,
      'accessCode', v_payment.access_code
    );
  end if;

  if v_payment.initialization_lease_id is not null
    and v_payment.initialization_lease_id <> p_lease_id
    and v_payment.initialization_lease_expires_at > now() then
    return jsonb_build_object('state', 'busy', 'paymentId', v_payment.id);
  end if;

  update public.payments
  set initialization_lease_id = p_lease_id,
      initialization_lease_expires_at = now() + make_interval(secs => v_seconds),
      status = 'processing',
      updated_at = now()
  where id = v_payment.id;

  return jsonb_build_object(
    'state', 'acquired',
    'paymentId', v_payment.id,
    'providerReference', v_payment.provider_reference,
    'recoveryRequired', v_recovery_required
  );
end;
$function$;

create or replace function public.complete_shipping_payment_initialization(
  p_payment_id uuid,
  p_lease_id uuid,
  p_provider_reference text,
  p_authorization_url text,
  p_access_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_payment public.payments%rowtype;
  v_reference text := nullif(btrim(coalesce(p_provider_reference, '')), '');
  v_authorization_url text := nullif(btrim(coalesce(p_authorization_url, '')), '');
  v_access_code text := nullif(btrim(coalesce(p_access_code, '')), '');
begin
  if p_payment_id is null or p_lease_id is null
    or v_reference is null or v_authorization_url is null or v_access_code is null then
    raise exception 'Complete Paystack checkout credentials are required.';
  end if;

  select * into v_payment
  from public.payments
  where id = p_payment_id
  for update;

  if not found then
    raise exception 'The shipping payment record was not found.';
  end if;

  if v_payment.status = 'successful' then
    return jsonb_build_object('state', 'settled', 'paymentId', v_payment.id);
  end if;

  if v_payment.initialization_lease_id is distinct from p_lease_id
    or v_payment.initialization_lease_expires_at is null
    or v_payment.initialization_lease_expires_at <= now() then
    raise exception 'The shipping payment initialization lease expired or is not owned by this request.';
  end if;

  update public.payments
  set provider_reference = v_reference,
      authorization_url = v_authorization_url,
      access_code = v_access_code,
      status = 'pending',
      initialization_lease_id = null,
      initialization_lease_expires_at = null,
      updated_at = now()
  where id = v_payment.id;

  return jsonb_build_object('state', 'ready', 'paymentId', v_payment.id, 'providerReference', v_reference);
end;
$function$;

create or replace function public.release_shipping_payment_initialization(
  p_payment_id uuid,
  p_lease_id uuid,
  p_mark_failed boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_payment public.payments%rowtype;
begin
  select * into v_payment
  from public.payments
  where id = p_payment_id
  for update;

  if not found then
    raise exception 'The shipping payment record was not found.';
  end if;

  if v_payment.status = 'successful' then
    return jsonb_build_object('state', 'settled', 'paymentId', v_payment.id);
  end if;

  if v_payment.initialization_lease_id is distinct from p_lease_id then
    raise exception 'The shipping payment initialization lease is not owned by this request.';
  end if;

  update public.payments
  set status = case when p_mark_failed then 'failed' else v_payment.status end,
      initialization_lease_id = null,
      initialization_lease_expires_at = null,
      updated_at = now()
  where id = v_payment.id;

  return jsonb_build_object('state', 'released', 'paymentId', v_payment.id);
end;
$function$;

revoke all on function public.acquire_shipping_payment_initialization_lease(uuid, uuid, integer) from public;
revoke all on function public.acquire_shipping_payment_initialization_lease(uuid, uuid, integer) from anon;
revoke all on function public.acquire_shipping_payment_initialization_lease(uuid, uuid, integer) from authenticated;
grant execute on function public.acquire_shipping_payment_initialization_lease(uuid, uuid, integer) to service_role;

revoke all on function public.complete_shipping_payment_initialization(uuid, uuid, text, text, text) from public;
revoke all on function public.complete_shipping_payment_initialization(uuid, uuid, text, text, text) from anon;
revoke all on function public.complete_shipping_payment_initialization(uuid, uuid, text, text, text) from authenticated;
grant execute on function public.complete_shipping_payment_initialization(uuid, uuid, text, text, text) to service_role;

revoke all on function public.release_shipping_payment_initialization(uuid, uuid, boolean) from public;
revoke all on function public.release_shipping_payment_initialization(uuid, uuid, boolean) from anon;
revoke all on function public.release_shipping_payment_initialization(uuid, uuid, boolean) from authenticated;
grant execute on function public.release_shipping_payment_initialization(uuid, uuid, boolean) to service_role;

commit;
