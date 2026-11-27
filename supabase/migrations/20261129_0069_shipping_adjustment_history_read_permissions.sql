begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- The admin history endpoint is server-only and reads these tables through the
-- service-role client after active administrator authorization.
-- Keep direct client access denied and grant no mutation privileges.
revoke select, insert, update, delete, truncate
  on table public.shipping_fee_adjustments
  from public, anon, authenticated;
revoke select, insert, update, delete, truncate
  on table public.shipping_fee_adjustment_orders
  from public, anon, authenticated;

revoke insert, update, delete, truncate
  on table public.shipping_fee_adjustments
  from service_role;
revoke insert, update, delete, truncate
  on table public.shipping_fee_adjustment_orders
  from service_role;

grant select on table public.shipping_fee_adjustments to service_role;
grant select on table public.shipping_fee_adjustment_orders to service_role;

commit;
