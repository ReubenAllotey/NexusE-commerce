-- Read-only pre-migration audit. This query intentionally does not reference
-- shipping_payment_allocations or modify any records.
select
  o.id as order_id,
  o.order_number,
  o.status as order_status,
  o.shipping_payment_mode,
  oi.id as order_item_id,
  oi.product_name,
  oi.quantity,
  oi.shipping_fee,
  oi.line_shipping,
  oi.shipping_paid_amount,
  oi.shipping_fee_status,
  case
    when oi.shipping_fee_status is not null
      and lower(oi.shipping_fee_status) not in ('pending', 'ready') then 'invalid_status_manual_review'
    when oi.shipping_fee_status is not null then 'already_classified'
    when lower(coalesce(o.status, '')) in ('cancelled', 'canceled') then 'cancelled_order_review'
    when oi.quantity > 0
      and oi.shipping_fee is not null
      and oi.shipping_fee >= 0
      and oi.line_shipping > 0
      and abs(oi.line_shipping - (oi.shipping_fee * oi.quantity)) <= 0.000001
      then 'unambiguous_ready_candidate'
    else 'ambiguous_ineligible_candidate'
  end as classification
from public.order_items as oi
join public.orders as o on o.id = oi.order_id
where oi.shipping_fee_status is null
   or lower(oi.shipping_fee_status) not in ('pending', 'ready')
order by o.created_at asc, o.id asc, oi.created_at asc, oi.id asc;

select
  case
    when oi.shipping_fee_status is not null
      and lower(oi.shipping_fee_status) not in ('pending', 'ready') then 'invalid_status_manual_review'
    when oi.shipping_fee_status is not null then 'already_classified'
    when lower(coalesce(o.status, '')) in ('cancelled', 'canceled') then 'cancelled_order_review'
    when oi.quantity > 0
      and oi.shipping_fee is not null
      and oi.shipping_fee >= 0
      and oi.line_shipping > 0
      and abs(oi.line_shipping - (oi.shipping_fee * oi.quantity)) <= 0.000001
      then 'unambiguous_ready_candidate'
    else 'ambiguous_ineligible_candidate'
  end as classification,
  count(*) as item_count
from public.order_items as oi
join public.orders as o on o.id = oi.order_id
where oi.shipping_fee_status is null
   or lower(oi.shipping_fee_status) not in ('pending', 'ready')
group by 1
order by 1;
