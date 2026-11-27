-- Synthetic fixtures for the isolated shipping-adjustment HTTP validation.
-- This file must only be executed against the Supabase local database.
\set ON_ERROR_STOP on
begin;

do $fixture$
declare
  v_category_id uuid;
begin
  select id into v_category_id
  from public.categories
  where deleted_at is null
  order by created_at, id
  limit 1;
  if v_category_id is null then
    raise exception 'A seeded category is required for the synthetic product.';
  end if;

  insert into public.products (
    id, category_id, slug, name, price, shipping_fee, shipping_fee_status,
    shipping_method, status, source
  ) values (
    :'product_id'::uuid, v_category_id, 'ci-shipping-adjustment-test-2',
    'Synthetic Test 2', 100, 0.05, 'ready', 'air-freight', 'active', 'custom'
  );
end;
$fixture$;

insert into public.orders (
  id, order_number, user_id, customer_name, customer_email, guest_email,
  status, payment_status, order_type, shipping_address_snapshot,
  subtotal, shipping_total, total, shipping_payment_mode,
  shipping_payment_status, amount_due_now
)
select
  format('72000000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid,
  format('CI-SHIP-%02s', n),
  case when n <= 9 then :'registered_user_id'::uuid else null end,
  case when n <= 9 then format('Registered Synthetic %s', n) else format('Guest Synthetic %s', n) end,
  case when n <= 9 then format('registered-%s@example.invalid', n) else format('guest-%s@example.invalid', n) end,
  case when n <= 9 then null else format('guest-%s@example.invalid', n) end,
  'pending_payment', 'pending', 'ready_stock', '{"country":"Ghana","region":"Greater Accra","town":"Accra"}'::jsonb,
  100, 0.05, 100.05, 'pay_later', 'outstanding', 100.05
from generate_series(1, 12) as series(n);

insert into public.order_items (
  id, order_id, product_id, product_name, product_slug, unit_price,
  quantity, shipping_fee, line_subtotal, line_shipping, shipping_fee_status,
  shipping_paid_amount, variant_key, selected_options
)
select
  format('73000000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid,
  format('72000000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid,
  :'product_id'::uuid, 'Synthetic Test 2', 'ci-shipping-adjustment-test-2',
  100, 1, case when n <= 3 then 0.04 else 0.05 end,
  100, case when n <= 3 then 0.04 else 0.05 end, 'confirmed', 0,
  'default', '[]'::jsonb
from generate_series(1, 12) as series(n);

insert into public.shipping_fee_adjustments (
  id, operation_id, product_id, old_shipping_fee, new_shipping_fee,
  administrator_id, status, result
) values (
  :'adjustment_id'::uuid, :'adjustment_id'::uuid, :'product_id'::uuid,
  0.03, 0.05, :'admin_user_id'::uuid, 'applied', '{"source":"ci"}'::jsonb
);

insert into public.shipping_fee_adjustment_orders (
  adjustment_id, order_id, order_item_id, old_line_shipping, new_line_shipping,
  cash_paid_before, credit_applied, additional_due, credit_issued_minor,
  result_code
)
select
  :'adjustment_id'::uuid,
  format('72000000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid,
  format('73000000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid,
  0.03,
  case when n <= 3 then 0.04 else 0.05 end,
  0, 0,
  case when n <= 3 then 0.04 else 0.05 end,
  0,
  'increased'
from generate_series(1, 12) as series(n);

commit;
