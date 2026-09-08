begin;

alter table public.order_items
  add column if not exists freight_type text;

alter table public.order_items
  drop constraint if exists order_items_freight_type_check;

alter table public.order_items
  add constraint order_items_freight_type_check
  check (freight_type is null or freight_type in ('air', 'sea'));

create index if not exists order_items_freight_type_idx
  on public.order_items (freight_type);

-- Existing single-freight orders can be backfilled safely. Mixed historical
-- orders remain NULL because their item-level freight is not recoverable.
update public.order_items oi
set freight_type = lower(o.shipment_type)
from public.orders o
where o.id = oi.order_id
  and oi.freight_type is null
  and lower(coalesce(o.shipment_type, '')) in ('air', 'sea');

create or replace function private.snapshot_order_item_freight_type()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_shipping_method text;
begin
  select lower(coalesce(p.shipping_method, ''))
    into v_shipping_method
  from public.products p
  where p.id = new.product_id;

  case v_shipping_method
    when 'air-freight' then
      new.freight_type := 'air';
    when 'sea-freight' then
      new.freight_type := 'sea';
    when 'both' then
      if new.freight_type is null or new.freight_type not in ('air', 'sea') then
        raise exception 'A dual-freight product requires a trusted air or sea freight selection.';
      end if;
    else
      raise exception 'The product has no valid shipping method for order fulfillment.';
  end case;

  return new;
end;
$function$;

drop trigger if exists order_items_snapshot_freight_type on public.order_items;
create trigger order_items_snapshot_freight_type
before insert on public.order_items
for each row
execute function private.snapshot_order_item_freight_type();

create table if not exists public.shipment_tracks (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.import_batches(id) on delete restrict,
  freight_type text not null,
  headline text,
  current_step integer not null default 0,
  current_status text not null default 'preparing',
  announcement text,
  estimated_departure date,
  estimated_arrival date,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shipment_tracks_freight_type_check check (freight_type in ('air', 'sea')),
  constraint shipment_tracks_current_step_check check (current_step between 0 and 4),
  constraint shipment_tracks_current_status_check check (
    current_status in ('preparing', 'shipped_from_china', 'in_transit', 'arrived_in_ghana', 'out_for_delivery', 'delivered')
  ),
  constraint shipment_tracks_dates_check check (
    estimated_departure is null or estimated_arrival is null or estimated_departure <= estimated_arrival
  ),
  constraint shipment_tracks_batch_freight_unique unique (batch_id, freight_type)
);

create index if not exists shipment_tracks_batch_id_idx
  on public.shipment_tracks (batch_id);

create index if not exists shipment_tracks_freight_type_idx
  on public.shipment_tracks (freight_type);

create index if not exists shipment_tracks_status_idx
  on public.shipment_tracks (current_status);

create table if not exists public.shipment_track_events (
  id uuid primary key default gen_random_uuid(),
  shipment_track_id uuid not null references public.shipment_tracks(id) on delete cascade,
  current_step integer not null,
  current_status text not null,
  title text not null,
  message text,
  event_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint shipment_track_events_step_check check (current_step between 0 and 4),
  constraint shipment_track_events_status_check check (
    current_status in ('preparing', 'shipped_from_china', 'in_transit', 'arrived_in_ghana', 'out_for_delivery', 'delivered')
  ),
  constraint shipment_track_events_title_not_blank check (btrim(title) <> '')
);

create index if not exists shipment_track_events_track_id_idx
  on public.shipment_track_events (shipment_track_id);

create index if not exists shipment_track_events_event_at_idx
  on public.shipment_track_events (event_at);

drop trigger if exists shipment_tracks_set_updated_at on public.shipment_tracks;
create trigger shipment_tracks_set_updated_at
before update on public.shipment_tracks
for each row
execute function private.set_updated_at();

alter table public.shipment_tracks enable row level security;
alter table public.shipment_track_events enable row level security;

revoke all on table public.shipment_tracks from public, anon, authenticated;
grant select on table public.shipment_tracks to authenticated;

revoke all on table public.shipment_track_events from public, anon, authenticated;

drop policy if exists shipment_tracks_admin_select on public.shipment_tracks;
create policy shipment_tracks_admin_select
  on public.shipment_tracks
  for select to authenticated
  using (private.is_admin_user());

drop policy if exists shipment_track_events_admin_select on public.shipment_track_events;
create policy shipment_track_events_admin_select
  on public.shipment_track_events
  for select to authenticated
  using (private.is_admin_user());

create or replace function public.save_shipment_track(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_admin_id uuid := auth.uid();
  v_payload jsonb := coalesce(payload, '{}'::jsonb);
  v_id uuid := nullif(btrim(coalesce(v_payload ->> 'id', v_payload ->> 'trackId', '')), '')::uuid;
  v_batch_id uuid := nullif(btrim(coalesce(v_payload ->> 'batch_id', v_payload ->> 'batchId', '')), '')::uuid;
  v_freight_type text := lower(btrim(coalesce(v_payload ->> 'freight_type', v_payload ->> 'freightType', '')));
  v_headline text := nullif(btrim(coalesce(v_payload ->> 'headline', '')), '');
  v_step integer := greatest(least(coalesce((v_payload ->> 'current_step')::integer, coalesce((v_payload ->> 'currentStep')::integer, 0)), 4), 0);
  v_status text := lower(btrim(coalesce(v_payload ->> 'current_status', v_payload ->> 'currentStatus', '')));
  v_announcement text := nullif(btrim(coalesce(v_payload ->> 'announcement', v_payload ->> 'body', v_payload ->> 'message', '')), '');
  v_departure date := nullif(btrim(coalesce(v_payload ->> 'estimated_departure', v_payload ->> 'estimatedDeparture', '')), '')::date;
  v_arrival date := nullif(btrim(coalesce(v_payload ->> 'estimated_arrival', v_payload ->> 'estimatedArrival', '')), '')::date;
  v_allow_correction boolean := coalesce((v_payload ->> 'allow_correction')::boolean, false);
  v_track public.shipment_tracks%rowtype;
  v_previous public.shipment_tracks%rowtype;
  v_types text[];
  v_type text;
  v_result jsonb := '[]'::jsonb;
begin
  if v_admin_id is null or not private.is_admin_user() then
    raise exception 'Only active administrators can manage shipment tracks.';
  end if;

  if v_batch_id is null then
    raise exception 'A managed batch is required.';
  end if;

  if not exists (select 1 from public.import_batches ib where ib.id = v_batch_id) then
    raise exception 'The selected batch does not exist.';
  end if;

  if v_freight_type not in ('air', 'sea', 'both') then
    raise exception 'Freight type must be Air, Sea, or Both.';
  end if;

  if v_status = '' then
    v_status := private.shipment_status_for_step(v_step);
  end if;

  if v_status not in ('preparing', 'shipped_from_china', 'in_transit', 'arrived_in_ghana', 'out_for_delivery', 'delivered') then
    raise exception 'Invalid shipment track status.';
  end if;

  if v_status = 'delivered' then
    v_step := 4;
  elsif private.shipment_status_rank(v_status) <> v_step then
    raise exception 'Shipment status and step are out of sync.';
  end if;

  if v_departure is not null and v_arrival is not null and v_departure > v_arrival then
    raise exception 'Estimated departure must be before estimated arrival.';
  end if;

  v_types := case when v_freight_type = 'both' then array['air', 'sea']::text[] else array[v_freight_type]::text[] end;

  foreach v_type in array v_types loop
    v_previous := null;

    if v_id is not null and v_freight_type <> 'both' then
      select * into v_previous from public.shipment_tracks st where st.id = v_id for update;
      if not found then raise exception 'Shipment track not found.'; end if;
      if v_previous.batch_id <> v_batch_id or v_previous.freight_type <> v_type then
        raise exception 'The shipment track does not match the selected batch and freight type.';
      end if;
    else
      select * into v_previous
      from public.shipment_tracks st
      where st.batch_id = v_batch_id and st.freight_type = v_type
      for update;
    end if;

    if v_previous.id is not null
      and not v_allow_correction
      and private.shipment_status_rank(v_previous.current_status) > private.shipment_status_rank(v_status) then
      raise exception 'Backward shipment progress is not allowed.';
    end if;

    insert into public.shipment_tracks (
      id, batch_id, freight_type, headline, current_step, current_status,
      announcement, estimated_departure, estimated_arrival, created_by
    ) values (
      coalesce(v_previous.id, case when v_id is not null and v_freight_type <> 'both' then v_id else gen_random_uuid() end),
      v_batch_id, v_type, v_headline, v_step, v_status,
      v_announcement, v_departure, v_arrival, v_admin_id
    )
    on conflict (batch_id, freight_type) do update set
      headline = excluded.headline,
      current_step = excluded.current_step,
      current_status = excluded.current_status,
      announcement = excluded.announcement,
      estimated_departure = excluded.estimated_departure,
      estimated_arrival = excluded.estimated_arrival,
      updated_at = now()
    returning * into v_track;

    if v_previous.id is null
      or v_previous.current_step is distinct from v_track.current_step
      or v_previous.current_status is distinct from v_track.current_status then
      insert into public.shipment_track_events (
        shipment_track_id, current_step, current_status, title, message
      ) values (
        v_track.id,
        v_track.current_step,
        v_track.current_status,
        coalesce(v_headline, private.shipment_step_label(v_step)),
        coalesce(v_announcement, 'Shipment progress updated.')
      );
    end if;

    v_result := v_result || jsonb_build_array(to_jsonb(v_track));
  end loop;

  return jsonb_build_object('tracks', v_result);
end;
$function$;

create or replace function public.get_my_shipment_tracks()
returns table (
  id uuid,
  batch_id uuid,
  batch_number text,
  freight_type text,
  headline text,
  current_step integer,
  current_status text,
  announcement text,
  estimated_departure date,
  estimated_arrival date,
  updated_at timestamptz,
  orders jsonb,
  items jsonb
)
language sql
stable
security definer
set search_path = ''
as $function$
  select
    st.id,
    st.batch_id,
    ib.batch_number,
    st.freight_type,
    st.headline,
    st.current_step,
    st.current_status,
    st.announcement,
    st.estimated_departure,
    st.estimated_arrival,
    st.updated_at,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', o.id,
          'orderNumber', o.order_number,
          'batchNumber', o.batch_number,
          'shipmentType', o.shipment_type,
          'status', o.status,
          'paymentStatus', o.payment_status
        ) order by o.created_at asc
      )
      from public.orders o
      where lower(btrim(coalesce(o.batch_number, ''))) = lower(btrim(ib.batch_number))
        and o.user_id = auth.uid()
        and lower(coalesce(o.shipment_type, '')) <> ''
        and exists (
          select 1
          from public.order_items oi
          where oi.order_id = o.id
            and oi.freight_type = st.freight_type
        )
        and (
          exists (
          select 1
          from public.payments p
          where p.order_id = o.id
            and lower(coalesce(p.status, '')) = 'successful'
          )
          or (
            o.checkout_group_id is not null
            and exists (
              select 1
              from public.orders sibling
              join public.payments sibling_payment
                on sibling_payment.order_id = sibling.id
            where sibling.checkout_group_id = o.checkout_group_id
              and sibling.user_id = o.user_id
              and lower(coalesce(sibling_payment.status, '')) = 'successful'
            )
          )
        )
        and lower(coalesce(o.status, '')) not in ('cancelled', 'canceled', 'failed', 'abandoned')
    ), '[]'::jsonb) as orders,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', oi.id,
          'orderId', oi.order_id,
          'orderNumber', o.order_number,
          'productId', oi.product_id,
          'productName', oi.product_name,
          'productSlug', oi.product_slug,
          'brand', oi.brand,
          'imageUrl', oi.image_url,
          'unitPrice', oi.unit_price,
          'quantity', oi.quantity,
          'selectedColor', oi.selected_color,
          'selectedSize', oi.selected_size,
          'variantKey', oi.variant_key,
          'selectedOptions', oi.selected_options,
          'freightType', oi.freight_type,
          'lineSubtotal', oi.line_subtotal,
          'lineShipping', oi.line_shipping
        ) order by o.created_at asc, oi.created_at asc, oi.id asc
      )
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
      where lower(btrim(coalesce(o.batch_number, ''))) = lower(btrim(ib.batch_number))
        and o.user_id = auth.uid()
        and oi.freight_type = st.freight_type
        and (
          exists (
          select 1
          from public.payments p
          where p.order_id = o.id
            and lower(coalesce(p.status, '')) = 'successful'
          )
          or (
            o.checkout_group_id is not null
            and exists (
              select 1
              from public.orders sibling
              join public.payments sibling_payment
                on sibling_payment.order_id = sibling.id
            where sibling.checkout_group_id = o.checkout_group_id
              and sibling.user_id = o.user_id
              and lower(coalesce(sibling_payment.status, '')) = 'successful'
            )
          )
        )
        and lower(coalesce(o.status, '')) not in ('cancelled', 'canceled', 'failed', 'abandoned')
    ), '[]'::jsonb) as items
  from public.shipment_tracks st
  join public.import_batches ib on ib.id = st.batch_id
  where exists (
    select 1
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where lower(btrim(coalesce(o.batch_number, ''))) = lower(btrim(ib.batch_number))
      and o.user_id = auth.uid()
      and oi.freight_type = st.freight_type
      and (
        exists (
        select 1
        from public.payments p
        where p.order_id = o.id
          and lower(coalesce(p.status, '')) = 'successful'
        )
        or (
          o.checkout_group_id is not null
          and exists (
            select 1
            from public.orders sibling
            join public.payments sibling_payment
              on sibling_payment.order_id = sibling.id
            where sibling.checkout_group_id = o.checkout_group_id
              and sibling.user_id = o.user_id
              and lower(coalesce(sibling_payment.status, '')) = 'successful'
          )
        )
      )
      and lower(coalesce(o.status, '')) not in ('cancelled', 'canceled', 'failed', 'abandoned')
  );
$function$;

create or replace function private.handle_shipment_track_event_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_track record;
  v_order record;
  v_source_key text;
  v_freight_label text;
begin
  select st.*, ib.batch_number
    into v_track
  from public.shipment_tracks st
  join public.import_batches ib on ib.id = st.batch_id
  where st.id = new.shipment_track_id;

  if v_track.id is null then
    return new;
  end if;

  v_freight_label := case when v_track.freight_type = 'air' then 'Air' else 'Sea' end;
  v_source_key := format(
    'shipment-track:%s:step:%s:status:%s',
    v_track.id,
    new.current_step,
    new.current_status
  );

  for v_order in
    select distinct o.user_id, o.id as order_id, o.order_number
    from public.orders o
    join public.order_items oi on oi.order_id = o.id
    where o.user_id is not null
      and lower(btrim(coalesce(o.batch_number, ''))) = lower(btrim(v_track.batch_number))
      and oi.freight_type = v_track.freight_type
      and (
        exists (
        select 1
        from public.payments p
        where p.order_id = o.id
          and lower(coalesce(p.status, '')) = 'successful'
        )
        or (
          o.checkout_group_id is not null
          and exists (
            select 1
            from public.orders sibling
            join public.payments sibling_payment
              on sibling_payment.order_id = sibling.id
            where sibling.checkout_group_id = o.checkout_group_id
              and sibling.user_id = o.user_id
              and lower(coalesce(sibling_payment.status, '')) = 'successful'
          )
        )
      )
      and lower(coalesce(o.status, '')) not in ('cancelled', 'canceled', 'failed', 'abandoned')
  loop
    perform private.upsert_notification(
      v_order.user_id,
      'shipments',
      format('%s freight shipment updated', v_freight_label),
      format('Your Batch %s %s Freight shipment has been updated: %s.', v_track.batch_number, v_freight_label, new.title),
      'shipment_status',
      v_source_key || ':' || v_order.order_id::text,
      v_order.order_id,
      null,
      null,
      format('/profile/shipments?batch=%s&freight=%s', v_track.batch_number, v_track.freight_type),
      'View shipment tracking',
      format('Order %s shipment progress.', coalesce(v_order.order_number, 'order'))
    );
  end loop;

  return new;
end;
$function$;

drop trigger if exists shipment_track_event_notification on public.shipment_track_events;
create trigger shipment_track_event_notification
after insert on public.shipment_track_events
for each row
execute function private.handle_shipment_track_event_notification();

revoke all on function public.save_shipment_track(jsonb) from public, anon, authenticated;
grant execute on function public.save_shipment_track(jsonb) to authenticated;

revoke all on function public.get_my_shipment_tracks() from public, anon;
grant execute on function public.get_my_shipment_tracks() to authenticated;

revoke all on function private.handle_shipment_track_event_notification() from public, anon, authenticated;

commit;
