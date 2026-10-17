-- Shipment stage management. Review and apply manually; this migration is not
-- executed by the application.

begin;

alter table public.shipment_tracks
  add column if not exists archived_at timestamptz;

create index if not exists shipment_tracks_archived_at_idx
  on public.shipment_tracks (archived_at);

alter table public.shipment_tracks
  drop constraint if exists shipment_tracks_current_step_check;

alter table public.shipment_tracks
  add constraint shipment_tracks_current_step_check check (current_step >= 0);

create table if not exists public.shipment_track_stages (
  id uuid primary key default gen_random_uuid(),
  shipment_track_id uuid not null references public.shipment_tracks(id) on delete restrict,
  stage_key text not null,
  stage_name text not null,
  description text,
  "position" integer not null check ("position" >= 0),
  is_completed boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shipment_track_stages_name_check check (btrim(stage_name) <> ''),
  unique (shipment_track_id, "position")
);

-- Keep this migration safe if an interrupted/manual deployment created only
-- part of the stage table before being retried.
alter table public.shipment_track_stages
  add column if not exists stage_key text,
  add column if not exists stage_name text,
  add column if not exists description text,
  add column if not exists "position" integer,
  add column if not exists is_completed boolean not null default false,
  add column if not exists completed_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create index if not exists shipment_track_stages_track_position_idx
  on public.shipment_track_stages (shipment_track_id, "position");

drop trigger if exists shipment_track_stages_set_updated_at on public.shipment_track_stages;
create trigger shipment_track_stages_set_updated_at
before update on public.shipment_track_stages
for each row execute function private.set_updated_at();

alter table public.shipment_track_stages enable row level security;
revoke all on table public.shipment_track_stages from public, anon, authenticated;
grant select on table public.shipment_track_stages to authenticated;

drop policy if exists shipment_track_stages_admin_select on public.shipment_track_stages;
create policy shipment_track_stages_admin_select
on public.shipment_track_stages
for select to authenticated
using (private.is_admin_user());

-- Seed the existing five-step tracks once so current progress is not lost.
insert into public.shipment_track_stages (
  shipment_track_id, stage_key, stage_name, description, "position", is_completed, completed_at
)
select
  st.id,
  seed.stage_key,
  seed.stage_name,
  null,
  seed."position",
  seed."position" < st.current_step
    or st.current_status = 'delivered',
  case when seed."position" < st.current_step or st.current_status = 'delivered' then st.updated_at else null end
from public.shipment_tracks st
cross join lateral (
  values
    (0, 'confirmed', 'Orders confirmed'),
    (1, 'packed', 'Orders packed for shipment'),
    (2, 'departed', case when st.freight_type = 'sea' then 'Departed China Port' else 'Departed China Airport' end),
    (3, 'arrived', case when st.freight_type = 'sea' then 'Arrived Ghana Port' else 'Arrived Ghana Airport' end),
    (4, 'delivery', 'Packed for delivery')
) as seed("position", stage_key, stage_name)
where not exists (
  select 1 from public.shipment_track_stages existing
  where existing.shipment_track_id = st.id
);

create or replace function private.validate_shipment_track_delivery_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.current_status = 'delivered' then
    if TG_OP = 'UPDATE' and OLD.current_status = 'delivered' then
      return new;
    end if;

    if not exists (
      select 1
      from public.shipment_track_stages stage_row
      where stage_row.shipment_track_id = new.id
        and lower(stage_row.stage_key) in ('delivered', 'delivery_completed', 'delivery-completed')
        and stage_row.is_completed = true
    ) then
      raise exception 'A completed delivery-confirmation stage is required before marking a shipment delivered';
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists shipment_tracks_validate_delivery_status on public.shipment_tracks;
create trigger shipment_tracks_validate_delivery_status
before insert or update of current_status on public.shipment_tracks
for each row
execute function private.validate_shipment_track_delivery_status();

create or replace function public.save_shipment_track_stages(
  p_track_id uuid,
  p_stages jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_track public.shipment_tracks%rowtype;
  v_stage jsonb;
  v_stage_id uuid;
  v_position integer := 0;
  v_position_offset integer;
  v_contiguous_completed integer := 0;
  v_current_position integer;
  v_event_position integer;
  v_delivery_position integer := 0;
  v_legacy_step integer := 0;
  v_existing_stage_count integer := 0;
  v_submitted_existing_count integer := 0;
  v_stage_key text;
  v_stage_status text;
  v_delivery_completed boolean := false;
  v_stage_completed boolean;
  v_old_step integer;
  v_old_status text;
  v_new_status text;
  v_result jsonb;
begin
  if not private.is_admin_user() then
    raise exception 'Administrator access required';
  end if;

  if p_track_id is null or jsonb_typeof(p_stages) <> 'array' then
    raise exception 'A shipment track and stage array are required';
  end if;

  if jsonb_array_length(p_stages) = 0 or jsonb_array_length(p_stages) > 32 then
    raise exception 'Shipment tracks must contain between 1 and 32 stages';
  end if;

  -- Lock the parent before checking stage ownership or the existing stage
  -- count. This serializes concurrent stage edits for the same track.
  select * into v_track
  from public.shipment_tracks
  where id = p_track_id and archived_at is null
  for update;

  if v_track.id is null then
    raise exception 'Shipment track not found';
  end if;

  v_old_step := v_track.current_step;
  v_old_status := v_track.current_status;

  if exists (
    select 1
    from jsonb_array_elements(p_stages) submitted_stage
    where nullif(btrim(submitted_stage->>'id'), '') is not null
    group by submitted_stage->>'id'
    having count(*) > 1
  ) then
    raise exception 'A shipment stage id may appear only once in a submission';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_stages) submitted_stage
    where nullif(lower(btrim(submitted_stage->>'stage_key')), '') is not null
    group by lower(btrim(submitted_stage->>'stage_key'))
    having count(*) > 1
  ) then
    raise exception 'A shipment stage key may appear only once in a submission';
  end if;

  -- Validate the complete payload before moving or deleting any existing row.
  -- The function is transactional, but doing this up front also makes the
  -- failure mode explicit to callers.
  for v_stage in select value from jsonb_array_elements(p_stages)
  loop
    if jsonb_typeof(v_stage) <> 'object' then
      raise exception 'Every shipment stage must be a JSON object';
    end if;

    if nullif(btrim(v_stage->>'stage_name'), '') is null then
      raise exception 'Every shipment stage needs a name';
    end if;

    v_stage_key := lower(nullif(btrim(v_stage->>'stage_key'), ''));
    if v_stage_key is null then
      raise exception 'Every shipment stage needs a stable stage key';
    end if;

    if (v_stage ? 'is_completed')
       and jsonb_typeof(v_stage->'is_completed') <> 'boolean' then
      raise exception 'Stage completion must be a boolean';
    end if;

    if (v_stage ? 'id') and nullif(v_stage->>'id', '') is not null then
      begin
        v_stage_id := (v_stage->>'id')::uuid;
      exception when invalid_text_representation then
        raise exception 'Invalid shipment stage id';
      end;

      if not exists (
        select 1 from public.shipment_track_stages
        where id = v_stage_id and shipment_track_id = p_track_id
      ) then
        raise exception 'Shipment stage does not belong to this track';
      end if;
      v_submitted_existing_count := v_submitted_existing_count + 1;
    end if;

    if (v_stage ? 'completed_at') and nullif(v_stage->>'completed_at', '') is not null then
      begin
        perform (v_stage->>'completed_at')::timestamptz;
      exception when invalid_datetime_format or datetime_field_overflow then
        raise exception 'Invalid shipment stage completion date';
      end;
    end if;
  end loop;

  select count(*) into v_existing_stage_count
  from public.shipment_track_stages
  where shipment_track_id = p_track_id;

  if v_existing_stage_count > 0 and v_submitted_existing_count = 0 then
    raise exception 'At least one existing shipment stage must be retained';
  end if;

  -- Move existing rows above both the old and submitted position ranges before
  -- assigning the submitted order. This avoids transient unique-key conflicts.
  select coalesce(max("position"), -1) + jsonb_array_length(p_stages) + 1000
    into v_position_offset
  from public.shipment_track_stages
  where shipment_track_id = p_track_id;

  update public.shipment_track_stages
  set "position" = "position" + v_position_offset
  where shipment_track_id = p_track_id;

  for v_stage in select value from jsonb_array_elements(p_stages)
  loop
    if (v_stage ? 'id') and nullif(v_stage->>'id', '') is not null then
      begin
        v_stage_id := (v_stage->>'id')::uuid;
      exception when invalid_text_representation then
        raise exception 'Invalid shipment stage id';
      end;
      if not exists (
        select 1 from public.shipment_track_stages
        where id = v_stage_id and shipment_track_id = p_track_id
      ) then
        raise exception 'Shipment stage does not belong to this track';
      end if;
    else
      v_stage_id := gen_random_uuid();
    end if;

    insert into public.shipment_track_stages (
      id, shipment_track_id, stage_key, stage_name, description, "position",
      is_completed, completed_at
    ) values (
      v_stage_id,
      p_track_id,
      coalesce(nullif(btrim(v_stage->>'stage_key'), ''), format('stage-%s', v_position + 1)),
      btrim(v_stage->>'stage_name'),
      nullif(btrim(coalesce(v_stage->>'description', '')), ''),
      v_position,
      coalesce((v_stage->>'is_completed')::boolean, false),
      case when coalesce((v_stage->>'is_completed')::boolean, false)
        then coalesce(
          nullif(v_stage->>'completed_at', '')::timestamptz,
          (select existing.completed_at
           from public.shipment_track_stages existing
           where existing.id = v_stage_id
             and existing.shipment_track_id = p_track_id),
          now()
        )
        else null end
    )
    on conflict (id) do update set
      stage_key = excluded.stage_key,
      stage_name = excluded.stage_name,
      description = excluded.description,
      "position" = excluded."position",
      is_completed = excluded.is_completed,
      completed_at = excluded.completed_at;

    v_position := v_position + 1;
  end loop;

  delete from public.shipment_track_stages
  where shipment_track_id = p_track_id
    and "position" >= v_position_offset;

  -- Legacy shipment status is derived only from the contiguous completed
  -- prefix. Custom names and non-contiguous completion must not fabricate a
  -- legacy status such as "Arrived in Ghana".
  for v_current_position in 0..(jsonb_array_length(p_stages) - 1)
  loop
    select coalesce(is_completed, false)
      into v_stage_completed
    from public.shipment_track_stages
    where shipment_track_id = p_track_id
      and "position" = v_current_position;

    if v_stage_completed then
      v_contiguous_completed := v_contiguous_completed + 1;
    else
      exit;
    end if;
  end loop;

  -- Legacy statuses are derived only from explicit, stable stage keys. An
  -- arbitrary custom stage never becomes "shipped", "arrived", or
  -- "delivered" merely because it is complete.
  v_new_status := null;
  for v_stage in
    select to_jsonb(stage_row)
    from public.shipment_track_stages stage_row
    where stage_row.shipment_track_id = p_track_id
    order by stage_row."position"
  loop
    v_stage_key := lower(btrim(v_stage->>'stage_key'));
    v_stage_status := null;

    if v_stage_key in ('delivered', 'delivery_completed', 'delivery-completed') then
      if coalesce((v_stage->>'is_completed')::boolean, false)
         and (v_stage->>'position')::integer < v_contiguous_completed then
        v_delivery_completed := true;
        v_delivery_position := (v_stage->>'position')::integer;
      end if;
      v_stage_status := 'delivered';
    elsif v_stage_key = 'delivery' then
      -- The legacy "delivery" stage means packed for delivery, not received.
      v_stage_status := 'out_for_delivery';
    elsif v_stage_key in ('out_for_delivery', 'out-for-delivery') then
      v_stage_status := 'out_for_delivery';
    elsif v_stage_key in ('arrived', 'arrived_in_ghana', 'arrived-in-ghana') then
      v_stage_status := 'arrived_in_ghana';
    elsif v_stage_key in ('departed', 'in_transit', 'in-transit') then
      v_stage_status := 'in_transit';
    elsif v_stage_key in ('packed', 'packed_for_shipment', 'packed-for-shipment') then
      v_stage_status := 'shipped_from_china';
    elsif v_stage_key in ('confirmed', 'order_confirmed', 'order-confirmed', 'preparing') then
      v_stage_status := 'preparing';
    end if;

    if v_stage_status is not null
       and coalesce((v_stage->>'is_completed')::boolean, false)
       and (v_stage->>'position')::integer < v_contiguous_completed then
      v_new_status := v_stage_status;
    end if;
  end loop;

  if v_delivery_completed then
    v_new_status := 'delivered';
    v_legacy_step := 4;
    v_event_position := v_delivery_position;
  elsif v_old_status = 'delivered' then
    -- The legacy five-stage template ends in "delivery" (packed for
    -- delivery). Never reinterpret that key as proof of receipt, but do not
    -- silently reopen a shipment that was already historically delivered.
    v_new_status := 'delivered';
    v_legacy_step := 4;
    v_event_position := greatest(jsonb_array_length(p_stages) - 1, 0);
  else
    -- New or not-yet-delivered tracks retain a valid existing status when the
    -- administrator uses entirely custom keys, without inventing delivery.
    v_new_status := coalesce(v_new_status, case when v_old_status = 'delivered' then 'preparing' else v_old_status end, 'preparing');
    v_legacy_step := greatest(0, least(v_contiguous_completed, 4));
    v_event_position := greatest(least(v_contiguous_completed, jsonb_array_length(p_stages) - 1), 0);
  end if;

  update public.shipment_tracks
  set current_step = v_legacy_step,
      current_status = v_new_status,
      updated_at = now()
  where id = p_track_id;

  if v_old_step is distinct from v_legacy_step
     or v_old_status is distinct from v_new_status then
    insert into public.shipment_track_events (
      shipment_track_id, current_step, current_status, title, message, event_at
    ) values (
      p_track_id,
      v_legacy_step,
      v_new_status,
      coalesce((select stage_name from public.shipment_track_stages where shipment_track_id = p_track_id and "position" = v_event_position), 'Shipment stage updated'),
      coalesce((select description from public.shipment_track_stages where shipment_track_id = p_track_id and "position" = v_event_position), 'Shipment progress updated.'),
      now()
    );
  end if;

  select jsonb_agg(to_jsonb(stage) order by stage."position") into v_result
  from public.shipment_track_stages stage
  where stage.shipment_track_id = p_track_id;

  return jsonb_build_object('track_id', p_track_id, 'stages', coalesce(v_result, '[]'::jsonb));
end;
$function$;

create or replace function public.archive_shipment_track(p_track_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_track public.shipment_tracks%rowtype;
begin
  if not private.is_admin_user() then
    raise exception 'Administrator access required';
  end if;

  update public.shipment_tracks
  set archived_at = now(), updated_at = now()
  where id = p_track_id and archived_at is null
  returning * into v_track;

  if v_track.id is null then
    raise exception 'Shipment track not found';
  end if;

  return to_jsonb(v_track);
end;
$function$;

create or replace function public.get_my_shipment_track_stages()
returns table (
  shipment_track_id uuid,
  stage_id uuid,
  stage_key text,
  stage_name text,
  description text,
  "position" integer,
  is_completed boolean,
  completed_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $function$
  select s.shipment_track_id, s.id, s.stage_key, s.stage_name, s.description,
         s."position", s.is_completed, s.completed_at
  from public.shipment_track_stages s
  join public.shipment_tracks st on st.id = s.shipment_track_id
  join public.import_batches ib on ib.id = st.batch_id
  where st.archived_at is null
    and exists (
      select 1
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
      where o.user_id = auth.uid()
        and oi.freight_type = st.freight_type
        and lower(btrim(coalesce(o.batch_number, ''))) = lower(btrim(ib.batch_number))
        and (
          exists (
            select 1 from public.payments p
            where p.order_id = o.id
              and lower(coalesce(p.status, '')) = 'successful'
          )
          or (
            o.checkout_group_id is not null
            and exists (
              select 1
              from public.orders sibling
              join public.payments sibling_payment on sibling_payment.order_id = sibling.id
              where sibling.checkout_group_id = o.checkout_group_id
                and sibling.user_id = o.user_id
                and lower(coalesce(sibling_payment.status, '')) = 'successful'
            )
          )
        )
        and lower(coalesce(o.status, '')) not in ('cancelled', 'canceled', 'failed', 'abandoned')
    )
  order by s.shipment_track_id, s."position";
$function$;

revoke all on function public.save_shipment_track_stages(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.archive_shipment_track(uuid) from public, anon, authenticated;
revoke all on function public.get_my_shipment_track_stages() from public, anon;
grant execute on function public.save_shipment_track_stages(uuid, jsonb) to authenticated;
grant execute on function public.archive_shipment_track(uuid) to authenticated;
grant execute on function public.get_my_shipment_track_stages() to authenticated;

-- Keep the existing customer RPC contract stable while excluding archived tracks.
create or replace function public.get_my_active_shipment_tracks()
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
  select old.id, old.batch_id, old.batch_number, old.freight_type, old.headline,
         old.current_step, old.current_status, old.announcement,
         old.estimated_departure, old.estimated_arrival, old.updated_at,
         old.orders, old.items
  from public.get_my_shipment_tracks() old
  join public.shipment_tracks st on st.id = old.id
  where st.archived_at is null;
$function$;

revoke all on function public.get_my_active_shipment_tracks() from public, anon;
grant execute on function public.get_my_active_shipment_tracks() to authenticated;

commit;
