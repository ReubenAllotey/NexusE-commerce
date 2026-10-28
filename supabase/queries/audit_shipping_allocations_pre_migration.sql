-- READ-ONLY pre-migration audit.
-- This query intentionally uses only pre-ledger tables, so it can run before
-- migration 0048 is applied.
with item_totals as (
  select
    oi.order_id,
    coalesce(sum(greatest(coalesce(oi.line_shipping, 0), 0)), 0) as known_shipping,
    coalesce(sum(least(
      greatest(coalesce(oi.shipping_paid_amount, 0), 0),
      greatest(coalesce(oi.line_shipping, 0), 0)
    )), 0) as paid_shipping
  from public.order_items oi
  group by oi.order_id
),
successful_payments as (
  select
    p.order_id,
    count(*) as successful_payment_count,
    coalesce(sum(p.amount_minor), 0)::bigint as successful_amount_minor
  from public.payments p
  where lower(coalesce(p.payment_purpose, '')) = 'shipping'
    and lower(coalesce(p.status, '')) = 'successful'
  group by p.order_id
)
select
  o.id as order_id,
  o.order_number,
  coalesce(i.known_shipping, 0) as known_shipping,
  coalesce(i.paid_shipping, 0) as paid_shipping,
  greatest(coalesce(i.known_shipping, 0) - coalesce(i.paid_shipping, 0), 0) as outstanding_shipping,
  coalesce(sp.successful_payment_count, 0) as successful_payment_count,
  coalesce(sp.successful_amount_minor, 0) as successful_amount_minor,
  case
    when coalesce(sp.successful_payment_count, 0) = 0 then 'no_successful_shipping_payment'
    when coalesce(sp.successful_amount_minor, 0) = round(coalesce(i.paid_shipping, 0) * 100)::bigint
      then 'aggregate_matches_but_payment_mapping_unproven'
    when coalesce(i.paid_shipping, 0) = 0
      then 'successful_payment_not_reflected_in_items'
    when coalesce(sp.successful_amount_minor, 0) > round(coalesce(i.paid_shipping, 0) * 100)::bigint
      then 'successful_payments_exceed_item_allocation'
    else 'partial_or_ambiguous_manual_review'
  end as pre_migration_classification
from public.orders o
left join item_totals i on i.order_id = o.id
left join successful_payments sp on sp.order_id = o.id
where coalesce(sp.successful_payment_count, 0) > 0
order by o.created_at asc, o.id asc;
