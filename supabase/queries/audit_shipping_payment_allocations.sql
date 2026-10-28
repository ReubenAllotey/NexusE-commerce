-- Read-only audit for successful shipping payments and item-level shipping
-- allocation totals. Run only after migration 0048 has created the ledger.
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
),
ledger_totals as (
  select
    a.order_id,
    count(*) as ledger_count,
    coalesce(sum(a.amount_minor), 0)::bigint as ledger_amount_minor
  from public.shipping_payment_allocations a
  group by a.order_id
)
select
  o.id as order_id,
  o.order_number,
  coalesce(i.known_shipping, 0) as known_shipping,
  coalesce(i.paid_shipping, 0) as paid_shipping,
  greatest(coalesce(i.known_shipping, 0) - coalesce(i.paid_shipping, 0), 0) as outstanding_shipping,
  coalesce(sp.successful_payment_count, 0) as successful_payment_count,
  coalesce(sp.successful_amount_minor, 0) as successful_amount_minor,
  coalesce(lt.ledger_count, 0) as ledger_count,
  coalesce(lt.ledger_amount_minor, 0) as ledger_amount_minor,
  case
    when coalesce(sp.successful_payment_count, 0) = 0 then 'no_successful_shipping_payment'
    when coalesce(lt.ledger_count, 0) = coalesce(sp.successful_payment_count, 0)
      and coalesce(lt.ledger_amount_minor, 0) = coalesce(sp.successful_amount_minor, 0)
      then 'ledger_complete'
    when coalesce(sp.successful_amount_minor, 0) = round(coalesce(i.paid_shipping, 0) * 100)::bigint
      and coalesce(lt.ledger_count, 0) = 0
      then 'unambiguous_backfill_candidate'
    else 'manual_review_required'
  end as allocation_classification
from public.orders o
left join item_totals i on i.order_id = o.id
left join successful_payments sp on sp.order_id = o.id
left join ledger_totals lt on lt.order_id = o.id
where coalesce(sp.successful_payment_count, 0) > 0
order by o.created_at asc, o.id asc;

-- Read-only preview of payment rows that may be backfilled when the aggregate
-- totals prove that every successful shipping payment was already allocated.
with item_totals as (
  select
    oi.order_id,
    coalesce(sum(least(
      greatest(coalesce(oi.shipping_paid_amount, 0), 0),
      greatest(coalesce(oi.line_shipping, 0), 0)
    )), 0) as paid_shipping
  from public.order_items oi
  group by oi.order_id
),
payment_totals as (
  select
    p.order_id,
    coalesce(sum(p.amount_minor), 0)::bigint as successful_amount_minor
  from public.payments p
  where lower(coalesce(p.payment_purpose, '')) = 'shipping'
    and lower(coalesce(p.status, '')) = 'successful'
  group by p.order_id
)
select
  p.id as payment_id,
  p.order_id,
  o.order_number,
  p.provider_reference,
  p.amount_minor,
  p.currency,
  p.status,
  p.paid_at
from public.payments p
join public.orders o on o.id = p.order_id
join item_totals i on i.order_id = p.order_id
join payment_totals pt on pt.order_id = p.order_id
where lower(coalesce(p.payment_purpose, '')) = 'shipping'
  and lower(coalesce(p.status, '')) = 'successful'
  and pt.successful_amount_minor = round(i.paid_shipping * 100)::bigint
  and not exists (
    select 1
    from public.shipping_payment_allocations a
    where a.payment_id = p.id
  )
order by p.paid_at asc nulls first, p.id asc;
