begin;

create extension if not exists pgcrypto;

create table public.shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  batch_number text not null,
  shipping_method text not null
    check (shipping_method in ('air', 'sea', 'both')),
  current_status text not null
    check (current_status in ('preparing', 'shipped_from_china', 'in_transit', 'arrived_in_ghana', 'out_for_delivery', 'delivered')),
  current_step integer not null default 0
    check (current_step between 0 and 4),
  headline text,
  body text,
  shipped_at timestamptz,
  arrived_country_at timestamptz,
  out_for_delivery_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shipments_batch_number_not_blank check (btrim(batch_number) <> ''),
  constraint shipments_shipping_method_not_blank check (btrim(shipping_method) <> ''),
  constraint shipments_current_status_not_blank check (btrim(current_status) <> ''),
  constraint shipments_delivered_requires_timestamp check (current_status <> 'delivered' or delivered_at is not null)
);

create unique index shipments_order_id_idx
  on public.shipments (order_id);

create index shipments_batch_number_idx
  on public.shipments (batch_number);

create index shipments_current_status_idx
  on public.shipments (current_status);

create index shipments_current_step_idx
  on public.shipments (current_step);

create index shipments_created_at_idx
  on public.shipments (created_at);

create index shipments_updated_at_idx
  on public.shipments (updated_at);

create table public.shipment_events (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  status text not null
    check (status in ('preparing', 'shipped_from_china', 'in_transit', 'arrived_in_ghana', 'out_for_delivery', 'delivered')),
  step_index integer not null
    check (step_index between 0 and 4),
  title text not null,
  message text,
  location text,
  event_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint shipment_events_title_not_blank check (btrim(title) <> ''),
  constraint shipment_events_status_not_blank check (btrim(status) <> '')
);

create index shipment_events_shipment_id_idx
  on public.shipment_events (shipment_id);

create index shipment_events_event_at_idx
  on public.shipment_events (event_at);

create index shipment_events_created_at_idx
  on public.shipment_events (created_at);

create index shipment_events_status_idx
  on public.shipment_events (status);

drop trigger if exists shipments_set_updated_at on public.shipments;
create trigger shipments_set_updated_at
before update on public.shipments
for each row
execute function private.set_updated_at();

alter table public.shipments enable row level security;
alter table public.shipment_events enable row level security;

drop policy if exists shipments_select_own on public.shipments;
create policy shipments_select_own
  on public.shipments
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.orders as o
      where o.id = order_id
        and o.user_id = auth.uid()
    )
  );

drop policy if exists shipments_select_admin on public.shipments;
create policy shipments_select_admin
  on public.shipments
  for select
  to authenticated
  using ((select private.is_admin_user()));

drop policy if exists shipment_events_select_own on public.shipment_events;
create policy shipment_events_select_own
  on public.shipment_events
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.shipments as s
      join public.orders as o
        on o.id = s.order_id
      where s.id = shipment_id
        and o.user_id = auth.uid()
    )
  );

drop policy if exists shipment_events_select_admin on public.shipment_events;
create policy shipment_events_select_admin
  on public.shipment_events
  for select
  to authenticated
  using ((select private.is_admin_user()));

revoke all on table public.shipments from public;
revoke all on table public.shipments from anon;
revoke all on table public.shipments from authenticated;

revoke all on table public.shipment_events from public;
revoke all on table public.shipment_events from anon;
revoke all on table public.shipment_events from authenticated;

grant select on table public.shipments to authenticated;
grant select on table public.shipment_events to authenticated;

create or replace function private.shipment_status_rank(p_status text)
returns integer
language plpgsql
stable
set search_path = ''
as $function$
begin
  case lower(btrim(coalesce(p_status, '')))
    when 'preparing' then
      return 0;
    when 'shipped_from_china' then
      return 1;
    when 'in_transit' then
      return 2;
    when 'arrived_in_ghana' then
      return 3;
    when 'out_for_delivery' then
      return 4;
    when 'delivered' then
      return 5;
    else
      return 0;
  end case;
end;
$function$;

create or replace function private.shipment_status_for_step(p_step integer)
returns text
language plpgsql
stable
set search_path = ''
as $function$
begin
  case greatest(least(coalesce(p_step, 0), 4), 0)
    when 0 then
      return 'preparing';
    when 1 then
      return 'shipped_from_china';
    when 2 then
      return 'in_transit';
    when 3 then
      return 'arrived_in_ghana';
    when 4 then
      return 'out_for_delivery';
    else
      return 'preparing';
  end case;
end;
$function$;

create or replace function private.shipment_step_label(p_step integer)
returns text
language plpgsql
stable
set search_path = ''
as $function$
begin
  case greatest(least(coalesce(p_step, 0), 4), 0)
    when 0 then
      return 'Orders confirmed';
    when 1 then
      return 'Orders packed for shipment';
    when 2 then
      return 'Items depart from China port';
    when 3 then
      return 'Orders arrived at Ghana port';
    when 4 then
      return 'Orders packed for delivery';
    else
      return 'Orders confirmed';
  end case;
end;
$function$;

create or replace function private.shipment_location_for_status(p_status text)
returns text
language plpgsql
stable
set search_path = ''
as $function$
begin
  case lower(btrim(coalesce(p_status, '')))
    when 'shipped_from_china' then
      return 'China Port';
    when 'in_transit' then
      return 'In transit';
    when 'arrived_in_ghana' then
      return 'Tema Port';
    when 'out_for_delivery' then
      return 'Local delivery hub';
    when 'delivered' then
      return 'Delivered';
    else
      return 'Warehouse';
  end case;
end;
$function$;

revoke all on function private.shipment_status_rank(text) from public;
revoke all on function private.shipment_status_rank(text) from anon;
revoke all on function private.shipment_status_rank(text) from authenticated;
revoke all on function private.shipment_status_for_step(integer) from public;
revoke all on function private.shipment_status_for_step(integer) from anon;
revoke all on function private.shipment_status_for_step(integer) from authenticated;
revoke all on function private.shipment_step_label(integer) from public;
revoke all on function private.shipment_step_label(integer) from anon;
revoke all on function private.shipment_step_label(integer) from authenticated;
revoke all on function private.shipment_location_for_status(text) from public;
revoke all on function private.shipment_location_for_status(text) from anon;
revoke all on function private.shipment_location_for_status(text) from authenticated;

create or replace function public.create_or_update_shipment(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_payload jsonb := coalesce(payload, '{}'::jsonb);
  v_order_id uuid := nullif(btrim(coalesce(v_payload ->> 'order_id', v_payload ->> 'orderId')), '')::uuid;
  v_shipment_id uuid := nullif(btrim(coalesce(v_payload ->> 'shipment_id', v_payload ->> 'shipmentId')), '')::uuid;
  v_batch_number text := nullif(btrim(coalesce(v_payload ->> 'batch_number', v_payload ->> 'batchNumber')), '');
  v_shipping_method text := lower(btrim(coalesce(v_payload ->> 'shipping_method', v_payload ->> 'shippingMethod', 'air')));
  v_headline text := nullif(btrim(coalesce(v_payload ->> 'headline', v_payload ->> 'title')), '');
  v_body text := nullif(btrim(coalesce(v_payload ->> 'body', v_payload ->> 'message')), '');
  v_current_step integer := greatest(least(coalesce((v_payload ->> 'current_step')::integer, coalesce((v_payload ->> 'currentStep')::integer, 0)), 4), 0);
  v_current_status text := nullif(btrim(coalesce(v_payload ->> 'current_status', v_payload ->> 'currentStatus')), '');
  v_allow_correction boolean := coalesce((v_payload ->> 'allow_correction')::boolean, false);
  v_event_title text := nullif(btrim(coalesce(v_payload ->> 'event_title', v_payload ->> 'eventTitle')), '');
  v_event_message text := nullif(btrim(coalesce(v_payload ->> 'event_message', v_payload ->> 'eventMessage')), '');
  v_event_location text := nullif(btrim(coalesce(v_payload ->> 'location', v_payload ->> 'eventLocation')), '');
  v_event_at timestamptz := coalesce(nullif(btrim(coalesce(v_payload ->> 'event_at', v_payload ->> 'eventAt')), '')::timestamptz, now());
  v_target_order_ids uuid[] := ARRAY[]::uuid[];
  v_order_row public.orders%rowtype;
  v_shipment_row public.shipments%rowtype;
  v_existing boolean := false;
  v_existing_rank integer := 0;
  v_new_rank integer := 0;
  v_shipped_at timestamptz;
  v_arrived_country_at timestamptz;
  v_out_for_delivery_at timestamptz;
  v_delivered_at timestamptz;
  v_shipments_json jsonb := '[]'::jsonb;
  v_events_json jsonb := '[]'::jsonb;
  v_event_row public.shipment_events%rowtype;
begin
  if v_user_id is null then
    raise exception 'Please sign in to continue.';
  end if;

  if not private.is_admin_user() then
    raise exception 'Only active administrators can manage shipments.';
  end if;

  if v_shipping_method not in ('air', 'sea', 'both') then
    raise exception 'Invalid shipping method.';
  end if;

  if v_shipment_id is not null then
    select *
      into v_shipment_row
    from public.shipments as s
    where s.id = v_shipment_id;

    if not found then
      raise exception 'Shipment not found.';
    end if;

    select *
      into v_order_row
    from public.orders as o
    where o.id = v_shipment_row.order_id;

    if not found then
      raise exception 'The related order could not be found.';
    end if;

    if v_order_id is not null and v_order_id <> v_order_row.id then
      raise exception 'The supplied order does not match the selected shipment.';
    end if;

    if v_batch_number is not null and lower(btrim(v_batch_number)) <> lower(btrim(v_shipment_row.batch_number)) then
      raise exception 'The supplied batch number does not match the selected shipment.';
    end if;

    v_batch_number := coalesce(v_batch_number, nullif(btrim(v_shipment_row.batch_number), ''));
    v_target_order_ids := ARRAY[v_order_row.id];
  elsif v_order_id is not null then
    select *
      into v_order_row
    from public.orders as o
    where o.id = v_order_id;

    if not found then
      raise exception 'The supplied order could not be found.';
    end if;

    if v_batch_number is not null and lower(btrim(coalesce(v_order_row.batch_number, ''))) <> lower(btrim(v_batch_number)) then
      raise exception 'The supplied order does not belong to the supplied batch.';
    end if;

    v_batch_number := coalesce(v_batch_number, nullif(btrim(v_order_row.batch_number), ''));

    if v_batch_number is null then
      raise exception 'The order does not have a batch number yet.';
    end if;

    v_target_order_ids := ARRAY[v_order_row.id];
  elsif v_batch_number is not null then
    select coalesce(array_agg(o.id order by o.created_at asc, o.id asc), ARRAY[]::uuid[])
      into v_target_order_ids
    from public.orders as o
    where lower(btrim(coalesce(o.batch_number, ''))) = lower(btrim(v_batch_number));
  else
    raise exception 'A batch number or order id is required.';
  end if;

  if coalesce(cardinality(v_target_order_ids), 0) = 0 then
    raise exception 'No orders were found for the supplied batch number.';
  end if;

  if v_current_status is null then
    v_current_status := private.shipment_status_for_step(v_current_step);
  end if;

  if v_current_status = 'delivered' then
    v_current_step := 4;
  elsif private.shipment_status_rank(v_current_status) <> v_current_step then
    raise exception 'Shipment status and step are out of sync.';
  end if;

  for v_order_row in
    select *
      from public.orders as o
      where o.id = any (v_target_order_ids)
      order by o.created_at asc, o.id asc
  loop
    v_shipment_row := null;

    select *
      into v_shipment_row
    from public.shipments as s
    where s.order_id = v_order_row.id;

    v_existing := found;
    v_new_rank := private.shipment_status_rank(v_current_status);

    if v_existing then
      v_existing_rank := private.shipment_status_rank(v_shipment_row.current_status);

      if not v_allow_correction and v_existing_rank > v_new_rank then
        raise exception 'Backward shipment progress is not allowed.';
      end if;
    else
      v_existing_rank := 0;
    end if;

    v_shipped_at :=
      case
        when v_new_rank >= 2 then coalesce(v_shipment_row.shipped_at, now())
        else v_shipment_row.shipped_at
      end;
    v_arrived_country_at :=
      case
        when v_new_rank >= 3 then coalesce(v_shipment_row.arrived_country_at, now())
        else v_shipment_row.arrived_country_at
      end;
    v_out_for_delivery_at :=
      case
        when v_new_rank >= 4 then coalesce(v_shipment_row.out_for_delivery_at, now())
        else v_shipment_row.out_for_delivery_at
      end;
    v_delivered_at :=
      case
        when v_current_status = 'delivered' then coalesce(v_shipment_row.delivered_at, now())
        else v_shipment_row.delivered_at
      end;

    if v_new_rank = 5 then
      v_current_step := 4;
    end if;

    insert into public.shipments as s (
      order_id,
      batch_number,
      shipping_method,
      current_status,
      current_step,
      headline,
      body,
      shipped_at,
      arrived_country_at,
      out_for_delivery_at,
      delivered_at,
      created_at,
      updated_at
    ) values (
      v_order_row.id,
      coalesce(v_batch_number, nullif(btrim(v_order_row.batch_number), ''), nullif(btrim(v_shipment_row.batch_number), '')),
      v_shipping_method,
      v_current_status,
      v_current_step,
      v_headline,
      v_body,
      v_shipped_at,
      v_arrived_country_at,
      v_out_for_delivery_at,
      v_delivered_at,
      coalesce(v_shipment_row.created_at, now()),
      now()
    )
    on conflict (order_id) do update set
      batch_number = excluded.batch_number,
      shipping_method = excluded.shipping_method,
      current_status = excluded.current_status,
      current_step = excluded.current_step,
      headline = excluded.headline,
      body = excluded.body,
      shipped_at = excluded.shipped_at,
      arrived_country_at = excluded.arrived_country_at,
      out_for_delivery_at = excluded.out_for_delivery_at,
      delivered_at = excluded.delivered_at,
      updated_at = now()
    returning *
      into v_shipment_row;

    insert into public.shipment_events (
      shipment_id,
      status,
      step_index,
      title,
      message,
      location,
      event_at,
      created_at
    ) values (
      v_shipment_row.id,
      v_current_status,
      v_current_step,
      coalesce(v_event_title, private.shipment_step_label(v_current_step)),
      coalesce(v_event_message, v_body, 'Shipment progress updated.'),
      coalesce(v_event_location, private.shipment_location_for_status(v_current_status)),
      v_event_at,
      now()
    )
    returning *
      into v_event_row;

    v_shipments_json := v_shipments_json || jsonb_build_array(
      jsonb_build_object(
        'id', v_shipment_row.id,
        'orderId', v_shipment_row.order_id,
        'orderNumber', v_order_row.order_number,
        'customerId', v_order_row.user_id,
        'customerName', v_order_row.customer_name,
        'customerEmail', v_order_row.customer_email,
        'batchNumber', v_shipment_row.batch_number,
        'shippingMethod', v_shipment_row.shipping_method,
        'shippingMethodLabel',
          case v_shipment_row.shipping_method
            when 'sea' then 'Sea Freight'
            when 'both' then 'Sea & Air'
            else 'Air Freight'
          end,
        'currentStatus', v_shipment_row.current_status,
        'currentStatusLabel',
          case v_shipment_row.current_status
            when 'shipped_from_china' then 'Shipped from China'
            when 'in_transit' then 'In transit'
            when 'arrived_in_ghana' then 'Arrived in Ghana'
            when 'out_for_delivery' then 'Out for delivery'
            when 'delivered' then 'Delivered'
            else 'Preparing'
          end,
        'currentStep', v_shipment_row.current_step,
        'stepLabel', private.shipment_step_label(v_shipment_row.current_step),
        'progressPercent',
          case
            when v_shipment_row.current_status = 'delivered' then 100
            else round((v_shipment_row.current_step::numeric / 4) * 100)
          end,
        'headline', v_shipment_row.headline,
        'body', v_shipment_row.body,
        'shippedAt', v_shipment_row.shipped_at,
        'arrivedCountryAt', v_shipment_row.arrived_country_at,
        'outForDeliveryAt', v_shipment_row.out_for_delivery_at,
        'deliveredAt', v_shipment_row.delivered_at,
        'createdAt', v_shipment_row.created_at,
        'updatedAt', v_shipment_row.updated_at
      )
    );

    v_events_json := v_events_json || jsonb_build_array(
      jsonb_build_object(
        'id', v_event_row.id,
        'shipmentId', v_event_row.shipment_id,
        'status', v_event_row.status,
        'stepIndex', v_event_row.step_index,
        'title', v_event_row.title,
        'message', v_event_row.message,
        'location', v_event_row.location,
        'eventAt', v_event_row.event_at,
        'createdAt', v_event_row.created_at
      )
    );

    if v_current_status = 'delivered' then
      update public.orders as o
        set status = 'delivered',
            delivered_at = coalesce(o.delivered_at, now()),
            updated_at = now()
      where o.id = v_order_row.id;
    end if;
  end loop;

  return jsonb_build_object(
    'batchNumber', v_batch_number,
    'currentStatus', v_current_status,
    'currentStep', v_current_step,
    'shipments', v_shipments_json,
    'events', v_events_json
  );
end;
$function$;

create or replace function public.add_shipment_event(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_payload jsonb := coalesce(payload, '{}'::jsonb);
  v_order_id uuid := nullif(btrim(coalesce(v_payload ->> 'order_id', v_payload ->> 'orderId')), '')::uuid;
  v_shipment_id uuid := nullif(btrim(coalesce(v_payload ->> 'shipment_id', v_payload ->> 'shipmentId')), '')::uuid;
  v_batch_number text := nullif(btrim(coalesce(v_payload ->> 'batch_number', v_payload ->> 'batchNumber')), '');
  v_status text := nullif(btrim(coalesce(v_payload ->> 'status', v_payload ->> 'currentStatus')), '');
  v_step_index integer := greatest(least(coalesce((v_payload ->> 'step_index')::integer, coalesce((v_payload ->> 'stepIndex')::integer, 0)), 4), 0);
  v_title text := nullif(btrim(coalesce(v_payload ->> 'title', v_payload ->> 'eventTitle')), '');
  v_message text := nullif(btrim(coalesce(v_payload ->> 'message', v_payload ->> 'eventMessage')), '');
  v_location text := nullif(btrim(coalesce(v_payload ->> 'location', v_payload ->> 'eventLocation')), '');
  v_event_at timestamptz := coalesce(nullif(btrim(coalesce(v_payload ->> 'event_at', v_payload ->> 'eventAt')), '')::timestamptz, now());
  v_target_order_ids uuid[] := ARRAY[]::uuid[];
  v_order_row public.orders%rowtype;
  v_shipment_row public.shipments%rowtype;
  v_status_rank integer := 0;
  v_shipments_json jsonb := '[]'::jsonb;
  v_events_json jsonb := '[]'::jsonb;
  v_event_row public.shipment_events%rowtype;
begin
  if v_user_id is null then
    raise exception 'Please sign in to continue.';
  end if;

  if not private.is_admin_user() then
    raise exception 'Only active administrators can manage shipments.';
  end if;

  if v_shipment_id is not null then
    select *
      into v_shipment_row
    from public.shipments as s
    where s.id = v_shipment_id;

    if not found then
      raise exception 'Shipment not found.';
    end if;

    select *
      into v_order_row
    from public.orders as o
    where o.id = v_shipment_row.order_id;

    if not found then
      raise exception 'The related order could not be found.';
    end if;

    if v_order_id is not null and v_order_id <> v_order_row.id then
      raise exception 'The supplied order does not match the selected shipment.';
    end if;

    if v_batch_number is not null and lower(btrim(v_batch_number)) <> lower(btrim(v_shipment_row.batch_number)) then
      raise exception 'The supplied batch number does not match the selected shipment.';
    end if;

    v_batch_number := coalesce(v_batch_number, nullif(btrim(v_shipment_row.batch_number), ''));
    v_target_order_ids := ARRAY[v_order_row.id];
  elsif v_order_id is not null then
    select *
      into v_order_row
    from public.orders as o
    where o.id = v_order_id;

    if not found then
      raise exception 'The supplied order could not be found.';
    end if;

    if v_batch_number is not null and lower(btrim(coalesce(v_order_row.batch_number, ''))) <> lower(btrim(v_batch_number)) then
      raise exception 'The supplied order does not belong to the supplied batch.';
    end if;

    v_batch_number := coalesce(v_batch_number, nullif(btrim(v_order_row.batch_number), ''));

    if v_batch_number is null then
      raise exception 'The order does not have a batch number yet.';
    end if;

    v_target_order_ids := ARRAY[v_order_row.id];
  elsif v_batch_number is not null then
    select coalesce(array_agg(o.id order by o.created_at asc, o.id asc), ARRAY[]::uuid[])
      into v_target_order_ids
    from public.orders as o
    where lower(btrim(coalesce(o.batch_number, ''))) = lower(btrim(v_batch_number));
  else
    raise exception 'A batch number, shipment id, or order id is required.';
  end if;

  if coalesce(cardinality(v_target_order_ids), 0) = 0 then
    raise exception 'No shipments were found for the supplied target.';
  end if;

  if v_status is null then
    v_status := private.shipment_status_for_step(v_step_index);
  end if;

  if v_status = 'delivered' then
    v_step_index := 4;
  end if;

  v_status_rank := private.shipment_status_rank(v_status);

  if v_status <> 'delivered' and v_status_rank <> v_step_index then
    raise exception 'Shipment status and step are out of sync.';
  end if;

  for v_order_row in
    select *
      from public.orders as o
      where o.id = any (v_target_order_ids)
      order by o.created_at asc, o.id asc
  loop
    select *
      into v_shipment_row
    from public.shipments as s
    where s.order_id = v_order_row.id;

    if not found then
      raise exception 'Shipment not found for order %.', v_order_row.id;
    end if;

    insert into public.shipment_events (
      shipment_id,
      status,
      step_index,
      title,
      message,
      location,
      event_at,
      created_at
    ) values (
      v_shipment_row.id,
      v_status,
      v_step_index,
      coalesce(v_title, private.shipment_step_label(v_step_index)),
      coalesce(v_message, v_shipment_row.body, 'Shipment progress updated.'),
      coalesce(v_location, private.shipment_location_for_status(v_status)),
      v_event_at,
      now()
    )
    returning *
      into v_event_row;

    v_events_json := v_events_json || jsonb_build_array(
      jsonb_build_object(
        'id', v_event_row.id,
        'shipmentId', v_event_row.shipment_id,
        'status', v_event_row.status,
        'stepIndex', v_event_row.step_index,
        'title', v_event_row.title,
        'message', v_event_row.message,
        'location', v_event_row.location,
        'eventAt', v_event_row.event_at,
        'createdAt', v_event_row.created_at
      )
    );

    v_shipments_json := v_shipments_json || jsonb_build_array(
      jsonb_build_object(
        'id', v_shipment_row.id,
        'orderId', v_shipment_row.order_id,
        'orderNumber', v_order_row.order_number,
        'batchNumber', v_shipment_row.batch_number,
        'currentStatus', v_shipment_row.current_status,
        'currentStep', v_shipment_row.current_step,
        'stepLabel', private.shipment_step_label(v_shipment_row.current_step)
      )
    );
  end loop;

  return jsonb_build_object(
    'shipments', v_shipments_json,
    'events', v_events_json
  );
end;
$function$;

revoke all on function public.create_or_update_shipment(jsonb) from public;
revoke all on function public.create_or_update_shipment(jsonb) from anon;
revoke all on function public.create_or_update_shipment(jsonb) from authenticated;
grant execute on function public.create_or_update_shipment(jsonb) to authenticated;

revoke all on function public.add_shipment_event(jsonb) from public;
revoke all on function public.add_shipment_event(jsonb) from anon;
revoke all on function public.add_shipment_event(jsonb) from authenticated;
grant execute on function public.add_shipment_event(jsonb) to authenticated;

commit;
