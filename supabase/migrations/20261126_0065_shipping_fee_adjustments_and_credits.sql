begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.orders drop constraint if exists orders_shipping_payment_status_check;
alter table public.orders add constraint orders_shipping_payment_status_check
  check (shipping_payment_status in ('not_due', 'pending', 'outstanding', 'partial', 'paid', 'overpaid'));

create table if not exists public.shipping_fee_adjustments (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique,
  product_id uuid not null references public.products(id) on delete restrict,
  old_shipping_fee numeric,
  new_shipping_fee numeric not null check (new_shipping_fee >= 0),
  administrator_id uuid not null references auth.users(id) on delete restrict,
  status text not null default 'applied' check (status in ('applied', 'noop', 'failed')),
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists shipping_fee_adjustments_product_idx
  on public.shipping_fee_adjustments(product_id, created_at desc);

create table if not exists public.shipping_fee_adjustment_orders (
  id uuid primary key default gen_random_uuid(),
  adjustment_id uuid not null references public.shipping_fee_adjustments(id) on delete restrict,
  order_id uuid not null references public.orders(id) on delete restrict,
  order_item_id uuid not null references public.order_items(id) on delete restrict,
  old_line_shipping numeric not null default 0,
  new_line_shipping numeric not null default 0,
  cash_paid_before numeric not null default 0,
  credit_applied numeric not null default 0,
  additional_due numeric not null default 0,
  credit_issued_minor bigint not null default 0 check (credit_issued_minor >= 0),
  result_code text not null check (result_code in ('increased', 'decreased', 'unchanged', 'credit_issued', 'credit_applied')),
  created_at timestamptz not null default now(),
  unique (adjustment_id, order_item_id)
);

create index if not exists shipping_fee_adjustment_orders_order_idx
  on public.shipping_fee_adjustment_orders(order_id, created_at desc);

create table if not exists public.shipping_credit_ledger (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  user_id uuid references auth.users(id) on delete restrict,
  entry_type text not null check (entry_type in ('issue', 'consume', 'reversal')),
  amount_minor bigint not null check (amount_minor > 0),
  source_adjustment_order_id uuid references public.shipping_fee_adjustment_orders(id) on delete restrict,
  source_key text not null unique,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists shipping_credit_ledger_order_idx
  on public.shipping_credit_ledger(order_id, created_at, id);
create index if not exists shipping_credit_ledger_user_idx
  on public.shipping_credit_ledger(user_id, created_at, id)
  where user_id is not null;

alter table public.shipping_fee_adjustments enable row level security;
alter table public.shipping_fee_adjustment_orders enable row level security;
alter table public.shipping_credit_ledger enable row level security;
revoke all on table public.shipping_fee_adjustments from public, anon, authenticated, service_role;
revoke all on table public.shipping_fee_adjustment_orders from public, anon, authenticated, service_role;
revoke all on table public.shipping_credit_ledger from public, anon, authenticated, service_role;

create or replace function private.handle_product_shipping_fee_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op <> 'UPDATE' or new.shipping_fee is not distinct from old.shipping_fee
    and new.shipping_fee_status is not distinct from old.shipping_fee_status then
    return new;
  end if;

  if new.shipping_fee is not null and new.shipping_fee < 0 then
    raise exception 'Shipping fee cannot be negative.' using errcode = '22023';
  end if;

  -- Existing obligations must be changed through the audited adjustment RPC.
  if current_setting('nexus.shipping_fee_adjustment_write', true) is distinct from 'on'
    and exists (
      select 1
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
      left join public.import_batches ib
        on lower(btrim(ib.batch_number)) = lower(btrim(o.batch_number))
      where oi.product_id = new.id
        and lower(coalesce(o.status, '')) not in ('cancelled', 'completed', 'delivered')
        and ib.status = 'open'
    ) then
    raise exception 'Existing shipping obligations require an audited shipping fee adjustment.' using errcode = '42501';
  end if;

  return new;
end;
$function$;

drop trigger if exists products_shipping_fee_change on public.products;
create trigger products_shipping_fee_change
after update of shipping_fee, shipping_fee_status on public.products
for each row execute function private.handle_product_shipping_fee_change();

create or replace function public.preview_shipping_fee_adjustment(
  p_product_id uuid,
  p_new_shipping_fee numeric,
  p_administrator_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_product public.products%rowtype;
  v_rows jsonb;
begin
  if p_new_shipping_fee is null or p_new_shipping_fee < 0 then
    raise exception 'Shipping fee must be a non-negative amount.' using errcode = '22023';
  end if;
  if p_administrator_id is null or not exists (
    select 1 from public.profiles p
    where p.id = p_administrator_id
      and lower(coalesce(p.role, '')) = 'admin'
      and lower(coalesce(p.status, '')) = 'active'
  ) then
    raise exception 'Only active administrators can preview shipping fee adjustments.' using errcode = '42501';
  end if;
  select * into v_product from public.products where id = p_product_id;
  if not found then raise exception 'Product not found.' using errcode = 'P0002'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'orderId', x.order_id,
    'orderItemId', x.order_item_id,
    'orderNumber', x.order_number,
    'batchNumber', x.batch_number,
    'oldLineShipping', x.old_line_shipping,
    'newLineShipping', x.new_line_shipping,
    'cashPaid', x.cash_paid,
    'additionalDue', greatest(x.new_line_shipping - x.cash_paid, 0),
    'creditIssuedMinor', greatest(round((x.cash_paid - x.new_line_shipping) * 100), 0)
  ) order by x.order_id, x.order_item_id), '[]'::jsonb)
  into v_rows
  from (
    select o.id order_id, oi.id order_item_id, o.order_number, o.batch_number,
      greatest(coalesce(oi.line_shipping, 0), 0) old_line_shipping,
      greatest(coalesce(p_new_shipping_fee, 0) * coalesce(oi.quantity, 0), 0) new_line_shipping,
      greatest(coalesce(oi.shipping_paid_amount, 0), 0) cash_paid
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    join public.import_batches ib on lower(btrim(ib.batch_number)) = lower(btrim(o.batch_number))
    where oi.product_id = p_product_id
      and ib.status = 'open'
      and lower(coalesce(o.status, '')) not in ('cancelled', 'completed', 'delivered')
  ) x;

  return jsonb_build_object(
    'productId', v_product.id,
    'productName', v_product.name,
    'currentShippingFee', v_product.shipping_fee,
    'newShippingFee', p_new_shipping_fee,
    'orders', v_rows
  );
end;
$function$;

create or replace function public.apply_shipping_fee_adjustment(
  p_operation_id uuid,
  p_product_id uuid,
  p_new_shipping_fee numeric,
  p_administrator_id uuid,
  p_expected_old_shipping_fee numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_existing public.shipping_fee_adjustments%rowtype;
  v_product public.products%rowtype;
  v_order public.orders%rowtype;
  v_batch public.import_batches%rowtype;
  v_order_id uuid;
  v_item public.order_items%rowtype;
  v_adjustment public.shipping_fee_adjustments%rowtype;
  v_old_line numeric;
  v_new_line numeric;
  v_cash_paid numeric;
  v_credit_available bigint;
  v_credit_to_apply bigint;
  v_credit_issued bigint;
  v_order_credit_issued bigint;
  v_due numeric;
  v_has_pending boolean;
  v_ledger record;
  v_rows jsonb := '[]'::jsonb;
  v_adjustment_order_id uuid;
begin
  if p_operation_id is null or p_product_id is null or p_new_shipping_fee is null or p_new_shipping_fee < 0 then
    raise exception 'A valid adjustment operation, product and shipping fee are required.' using errcode = '22023';
  end if;
  if p_administrator_id is null or not exists (
    select 1 from public.profiles p
    where p.id = p_administrator_id
      and lower(coalesce(p.role, '')) = 'admin'
      and lower(coalesce(p.status, '')) = 'active'
  ) then
    raise exception 'Only active administrators can apply shipping fee adjustments.' using errcode = '42501';
  end if;

  select * into v_existing from public.shipping_fee_adjustments where operation_id = p_operation_id for update;
  if found then return v_existing.result || jsonb_build_object('alreadyApplied', true); end if;

  select * into v_product from public.products where id = p_product_id for update;
  if not found then raise exception 'Product not found.' using errcode = 'P0002'; end if;
  if p_expected_old_shipping_fee = -1 and v_product.shipping_fee is not null then
    raise exception 'The product shipping fee changed after preview.' using errcode = '40001';
  elsif p_expected_old_shipping_fee is not null
    and p_expected_old_shipping_fee <> -1
    and v_product.shipping_fee is distinct from p_expected_old_shipping_fee then
    raise exception 'The product shipping fee changed after preview.' using errcode = '40001';
  end if;

  insert into public.shipping_fee_adjustments(operation_id, product_id, old_shipping_fee, new_shipping_fee, administrator_id, status)
  values (p_operation_id, p_product_id, v_product.shipping_fee, p_new_shipping_fee,
    p_administrator_id, case when v_product.shipping_fee is not distinct from p_new_shipping_fee then 'noop' else 'applied' end)
  returning * into v_adjustment;

  if v_product.shipping_fee is not distinct from p_new_shipping_fee then
    update public.shipping_fee_adjustments set result = jsonb_build_object('status', 'noop', 'adjustmentId', v_adjustment.id, 'affectedOrders', 0), completed_at = now() where id = v_adjustment.id;
    return jsonb_build_object('status', 'noop', 'adjustmentId', v_adjustment.id, 'affectedOrders', 0);
  end if;

  perform set_config('nexus.shipping_fee_adjustment_write', 'on', true);
  update public.products set shipping_fee = p_new_shipping_fee, shipping_fee_status = 'ready', updated_at = now() where id = v_product.id;

  for v_order_id in
    select o.id
    from public.orders o
    join public.order_items oi on oi.order_id = o.id
    join public.import_batches ib on lower(btrim(ib.batch_number)) = lower(btrim(o.batch_number))
    where oi.product_id = v_product.id
      and ib.status = 'open'
      and lower(coalesce(o.status, '')) not in ('cancelled', 'completed', 'delivered')
    group by o.id
    order by o.id
  loop
    select * into v_order from public.orders where id = v_order_id for update;
    -- Recheck the batch after waiting for the order lock so closure cannot race the adjustment.
    select * into v_batch
    from public.import_batches
    where lower(btrim(batch_number)) = lower(btrim(v_order.batch_number))
    for update;
    if not found or lower(coalesce(v_batch.status, '')) <> 'open' then
      continue;
    end if;
    v_order_credit_issued := 0;
    for v_item in
      select oi.*
      from public.order_items oi
      where oi.order_id = v_order.id
        and oi.product_id = v_product.id
      order by oi.id
      for update
    loop
      v_old_line := greatest(coalesce(v_item.line_shipping, 0), 0);
      v_new_line := greatest(p_new_shipping_fee * coalesce(v_item.quantity, 0), 0);
      v_cash_paid := greatest(coalesce(v_item.shipping_paid_amount, 0), 0);
      v_credit_issued := greatest(round((v_cash_paid - v_new_line) * 100), 0)::bigint;
      v_order_credit_issued := v_order_credit_issued + v_credit_issued;
      v_credit_available := 0;

    if v_credit_issued > 0 then
      update public.order_items set shipping_paid_amount = v_new_line where id = v_item.id;
    end if;

    v_credit_available := 0;
    for v_ledger in
      select l.entry_type, l.amount_minor
      from public.shipping_credit_ledger l
      where (l.order_id = v_order.id or (l.user_id is not null and l.user_id = v_order.user_id))
      order by l.created_at, l.id
      for update
    loop
      v_credit_available := v_credit_available + case when v_ledger.entry_type = 'issue' then v_ledger.amount_minor else -v_ledger.amount_minor end;
    end loop;
    v_credit_available := greatest(v_credit_available, 0);
    v_credit_to_apply := least(v_credit_available, greatest(round((v_new_line - least(v_cash_paid, v_new_line)) * 100), 0)::bigint);
    v_due := greatest(v_new_line - least(v_cash_paid, v_new_line) - (v_credit_to_apply / 100.0), 0);

    insert into public.shipping_fee_adjustment_orders(adjustment_id, order_id, order_item_id, old_line_shipping, new_line_shipping, cash_paid_before, credit_applied, additional_due, credit_issued_minor, result_code)
    values (v_adjustment.id, v_order.id, v_item.id, v_old_line, v_new_line, v_cash_paid, v_credit_to_apply / 100.0, v_due, v_credit_issued,
      case when v_credit_issued > 0 then 'credit_issued' when v_credit_to_apply > 0 then 'credit_applied' when v_new_line > v_old_line then 'increased' else 'decreased' end)
    returning id into v_adjustment_order_id;

    if v_credit_issued > 0 then
      insert into public.shipping_credit_ledger(order_id, user_id, entry_type, amount_minor, source_adjustment_order_id, source_key, metadata)
      values (v_order.id, v_order.user_id, 'issue', v_credit_issued, v_adjustment_order_id, 'shipping-adjustment:issue:' || v_adjustment_order_id::text, jsonb_build_object('productId', v_product.id));
    end if;
    if v_credit_to_apply > 0 then
      insert into public.shipping_credit_ledger(order_id, user_id, entry_type, amount_minor, source_adjustment_order_id, source_key, metadata)
      values (v_order.id, v_order.user_id, 'consume', v_credit_to_apply, v_adjustment_order_id, 'shipping-adjustment:consume:' || v_adjustment_order_id::text, jsonb_build_object('productId', v_product.id));
      update public.order_items
      set shipping_paid_amount = least(v_new_line, coalesce(shipping_paid_amount, 0) + v_credit_to_apply / 100.0)
      where id = v_item.id;
    end if;

    update public.order_items set shipping_fee = p_new_shipping_fee, shipping_fee_status = 'ready', line_shipping = v_new_line where id = v_item.id;
    select coalesce(sum(greatest(coalesce(oi.line_shipping, 0), 0)), 0),
      coalesce(sum(least(greatest(coalesce(oi.shipping_paid_amount, 0), 0), greatest(coalesce(oi.line_shipping, 0), 0))), 0),
      coalesce(bool_or(oi.shipping_fee_status = 'pending'), false)
    into v_old_line, v_cash_paid, v_has_pending
    from public.order_items oi where oi.order_id = v_order.id;
    update public.orders set shipping_total = v_old_line, total = subtotal + v_old_line,
      shipping_payment_status = case when v_order_credit_issued > 0 and v_cash_paid >= v_old_line then 'overpaid' when v_cash_paid >= v_old_line then 'paid' when v_cash_paid > 0 then 'partial' else 'outstanding' end,
      updated_at = now() where id = v_order.id;
      v_rows := v_rows || jsonb_build_array(jsonb_build_object('orderId', v_order.id, 'orderNumber', v_order.order_number, 'userId', v_order.user_id, 'additionalDue', v_due, 'creditIssuedMinor', v_credit_issued, 'creditAppliedMinor', v_credit_to_apply));
    end loop;
  end loop;

  update public.shipping_fee_adjustments set result = jsonb_build_object('status', 'applied', 'adjustmentId', v_adjustment.id, 'affectedOrders', jsonb_array_length(v_rows), 'orders', v_rows), completed_at = now() where id = v_adjustment.id;
  return jsonb_build_object('status', 'applied', 'adjustmentId', v_adjustment.id, 'affectedOrders', jsonb_array_length(v_rows), 'orders', v_rows);
end;
$function$;

create or replace function public.reverse_shipping_credit(
  p_source_key text,
  p_administrator_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_source public.shipping_credit_ledger%rowtype;
  v_available bigint;
begin
  if nullif(btrim(p_reason), '') is null then
    raise exception 'A reason is required to reverse shipping credit.' using errcode = '22023';
  end if;
  if p_administrator_id is null or not exists (
    select 1 from public.profiles p
    where p.id = p_administrator_id
      and lower(coalesce(p.role, '')) = 'admin'
      and lower(coalesce(p.status, '')) = 'active'
  ) then
    raise exception 'Only active administrators can reverse shipping credit.' using errcode = '42501';
  end if;
  select * into v_source from public.shipping_credit_ledger
  where source_key = p_source_key and entry_type = 'issue' for update;
  if not found then raise exception 'The shipping credit source was not found.' using errcode = 'P0002'; end if;
  select greatest(v_source.amount_minor - coalesce(sum(case when entry_type in ('consume', 'reversal') then amount_minor else 0 end), 0), 0)
    into v_available
    from public.shipping_credit_ledger
    where source_adjustment_order_id = v_source.source_adjustment_order_id;
  if v_available <= 0 then
    return jsonb_build_object('status', 'already_consumed', 'sourceKey', p_source_key);
  end if;
  insert into public.shipping_credit_ledger(order_id, user_id, entry_type, amount_minor, source_adjustment_order_id, source_key, metadata)
  values (v_source.order_id, v_source.user_id, 'reversal', v_available,
    v_source.source_adjustment_order_id,
    'shipping-credit-reversal:' || v_source.id::text,
    jsonb_build_object('administratorId', p_administrator_id, 'reason', btrim(p_reason)));
  return jsonb_build_object('status', 'reversed', 'sourceKey', p_source_key, 'amountMinor', v_available);
end;
$function$;

create or replace function public.get_my_shipping_credit_ledger()
returns table (id uuid, order_id uuid, entry_type text, amount_minor bigint, source_key text, created_at timestamptz)
language sql stable security definer set search_path = ''
as $function$
  select l.id, l.order_id, l.entry_type, l.amount_minor, l.source_key, l.created_at
  from public.shipping_credit_ledger l
  where l.user_id = auth.uid()
  order by l.created_at desc, l.id desc;
$function$;

revoke all on function public.preview_shipping_fee_adjustment(uuid,numeric,uuid) from public, anon, authenticated, service_role;
grant execute on function public.preview_shipping_fee_adjustment(uuid,numeric,uuid) to service_role;
revoke all on function public.apply_shipping_fee_adjustment(uuid,uuid,numeric,uuid,numeric) from public, anon, authenticated, service_role;
grant execute on function public.apply_shipping_fee_adjustment(uuid,uuid,numeric,uuid,numeric) to service_role;
revoke all on function public.reverse_shipping_credit(text,uuid,text) from public, anon, authenticated, service_role;
grant execute on function public.reverse_shipping_credit(text,uuid,text) to service_role;
revoke all on function public.get_my_shipping_credit_ledger() from public, anon, authenticated, service_role;
grant execute on function public.get_my_shipping_credit_ledger() to authenticated;

commit;
