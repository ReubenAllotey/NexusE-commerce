begin;

-- Repair only the independently verified legacy item supplied with this
-- migration. No unrelated NULL-status item may be promoted to ready.
create temporary table legacy_shipping_status_orders (
  order_id uuid primary key
) on commit drop;

insert into legacy_shipping_status_orders (order_id)
select distinct oi.order_id
from public.order_items as oi
where oi.shipping_fee_status is null;

do $repair$
declare
  v_item record;
begin
  select
    oi.order_id,
    oi.quantity,
    oi.shipping_fee,
    oi.line_shipping,
    oi.shipping_fee_status,
    o.status as order_status
  into v_item
  from public.order_items as oi
  join public.orders as o on o.id = oi.order_id
  where oi.id = '742c03ee-87a4-4018-b99b-dbfe8e4f916f'::uuid
    and oi.order_id = 'c3f2e4f4-a9bf-479e-8af6-026b1c678ea1'::uuid;

  if not found then
    raise exception 'The independently verified legacy shipping item was not found.';
  end if;

  if lower(coalesce(v_item.order_status, '')) in ('cancelled', 'canceled') then
    raise exception 'The independently verified legacy shipping item belongs to a cancelled order.';
  end if;

  if v_item.shipping_fee_status is null then
    if v_item.quantity <= 0
      or v_item.shipping_fee is null
      or v_item.shipping_fee < 0
      or v_item.line_shipping <= 0
      or abs(v_item.line_shipping - (v_item.shipping_fee * v_item.quantity)) > 0.000001 then
      raise exception 'The verified legacy shipping item evidence is inconsistent.';
    end if;

    update public.order_items
    set shipping_fee_status = 'ready'
    where id = '742c03ee-87a4-4018-b99b-dbfe8e4f916f'::uuid
      and order_id = 'c3f2e4f4-a9bf-479e-8af6-026b1c678ea1'::uuid
      and shipping_fee_status is null;
  elsif v_item.shipping_fee_status <> 'ready' then
    raise exception 'The verified legacy shipping item has an unexpected status.';
  end if;
end;
$repair$;

-- NULL is not a defined payment state. Normalize every remaining legacy NULL
-- to pending so future writes cannot silently bypass fee confirmation.
update public.order_items
set shipping_fee_status = 'pending'
where shipping_fee_status is null;

update public.orders as o
set
  shipping_total = accounting.known_shipping,
  shipping_payment_status = case
    when accounting.has_unconfirmed_shipping then 'pending'
    when accounting.has_pending_shipping and accounting.known_shipping - accounting.paid_shipping > 0
      then 'outstanding'
    when accounting.has_pending_shipping then 'pending'
    when accounting.known_shipping - accounting.paid_shipping > 0 then 'outstanding'
    when accounting.known_shipping > 0 then 'paid'
    else 'not_due'
  end,
  updated_at = now()
from (
  select
    legacy.order_id,
    coalesce(sum(greatest(coalesce(oi.line_shipping, 0), 0)), 0) as known_shipping,
    coalesce(sum(least(
      greatest(coalesce(oi.shipping_paid_amount, 0), 0),
      greatest(coalesce(oi.line_shipping, 0), 0)
    )), 0) as paid_shipping,
    coalesce(bool_or(oi.shipping_fee_status = 'pending'), false) as has_pending_shipping,
    coalesce(bool_or(
      oi.shipping_fee_status = 'pending'
      and greatest(coalesce(oi.line_shipping, 0), 0) > 0
    ), false) as has_unconfirmed_shipping
  from legacy_shipping_status_orders as legacy
  join public.order_items as oi on oi.order_id = legacy.order_id
  group by legacy.order_id
) as accounting
where o.id = accounting.order_id
  and lower(coalesce(o.status, '')) not in ('cancelled', 'canceled');

alter table public.order_items
  alter column shipping_fee_status set default 'pending',
  alter column shipping_fee_status set not null;

do $function$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.order_items'::regclass
      and conname = 'order_items_shipping_fee_status_check'
  ) then
    alter table public.order_items
      add constraint order_items_shipping_fee_status_check
      check (shipping_fee_status in ('pending', 'ready'));
  end if;
end;
$function$;

commit;
