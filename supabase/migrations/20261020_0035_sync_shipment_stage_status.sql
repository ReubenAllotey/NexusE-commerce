-- Synchronize configurable shipment stages with legacy shipment status fields.
-- Requires 20261012_0034_shipment_track_stages.sql.
-- Review and apply manually; never execute from the application.

begin;

do $prerequisite$
begin
  if to_regclass('public.shipment_tracks') is null
     or to_regclass('public.shipment_track_stages') is null
     or to_regprocedure('private.is_admin_user()') is null
     or to_regprocedure('private.set_updated_at()') is null
     or to_regprocedure('public.save_shipment_track_stages(uuid,jsonb)') is null then
    raise exception 'Migration 0034 and its shipment stage dependencies must be applied first';
  end if;
end;
$prerequisite$;

do $rename$
begin
  if to_regprocedure('public.save_shipment_track_stages(uuid,jsonb)') is not null
     and to_regprocedure('public.save_shipment_track_stages_legacy(uuid,jsonb)') is null then
    execute 'alter function public.save_shipment_track_stages(uuid, jsonb) rename to save_shipment_track_stages_legacy';
  end if;
end;
$rename$;

-- Keep the renamed implementation private so there is one callable public
-- stage-save contract for admin clients.
revoke all on function public.save_shipment_track_stages_legacy(uuid, jsonb)
  from public, anon, authenticated;

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
  v_stage_position integer;
  v_event_position integer := 0;
  v_delivery_position integer;
  v_legacy_step integer := 0;
  v_existing_stage_count integer := 0;
  v_submitted_existing_count integer := 0;
  v_stage_key text;
  v_active_key text;
  v_stage_status text;
  v_new_status text;
  v_active_status_mapped boolean := false;
  v_old_step integer;
  v_old_status text;
  v_stage_completed boolean;
  v_existing_stage record;
  v_old_progress jsonb;
  v_new_progress jsonb;
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

  -- Lock the parent before validating ownership or counts.
  select * into v_track
  from public.shipment_tracks
  where id = p_track_id and archived_at is null
  for update;

  if v_track.id is null then
    raise exception 'Shipment track not found';
  end if;

  v_old_step := v_track.current_step;
  v_old_status := v_track.current_status;

  -- Capture only progress-bearing fields. Names and descriptions are
  -- intentionally excluded so cosmetic edits do not create tracking events.
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', stage.id,
    'position', stage."position",
    'stage_key', lower(btrim(stage.stage_key)),
    'is_completed', stage.is_completed
  ) order by stage."position"), '[]'::jsonb)
    into v_old_progress
  from public.shipment_track_stages stage
  where stage.shipment_track_id = p_track_id;

  if exists (
    select 1 from jsonb_array_elements(p_stages) submitted_stage
    where nullif(btrim(submitted_stage->>'id'), '') is not null
    group by submitted_stage->>'id' having count(*) > 1
  ) then
    raise exception 'A shipment stage id may appear only once in a submission';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_stages) submitted_stage
    where nullif(lower(btrim(submitted_stage->>'stage_key')), '') is not null
    group by lower(btrim(submitted_stage->>'stage_key')) having count(*) > 1
  ) then
    raise exception 'A shipment stage key may appear only once in a submission';
  end if;

  -- Validate the entire request before moving or deleting any existing row.
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

  -- Completion must remain a contiguous prefix. Do this validation before
  -- moving any existing rows so malformed submissions leave the track intact.
  if exists (
    select 1
    from jsonb_array_elements(p_stages) with ordinality as later_stage(stage, later_position)
    where coalesce((later_stage.stage->>'is_completed')::boolean, false)
      and exists (
        select 1
        from jsonb_array_elements(p_stages) with ordinality as earlier_stage(stage, earlier_position)
        where earlier_stage.earlier_position < later_stage.later_position
          and not coalesce((earlier_stage.stage->>'is_completed')::boolean, false)
      )
  ) then
    raise exception 'Shipment stages must be completed sequentially';
  end if;

  select count(*) into v_existing_stage_count
  from public.shipment_track_stages where shipment_track_id = p_track_id;
  if v_existing_stage_count > 0 and v_submitted_existing_count = 0 then
    raise exception 'At least one existing shipment stage must be retained';
  end if;

  -- Move rows out of the active position range to make reordering safe.
  -- Do this one row at a time in descending order. PostgreSQL checks the
  -- unique index immediately, so a single set-based UPDATE is not sufficient
  -- protection when another row can temporarily occupy a target position.
  select coalesce(max("position"), -1) + jsonb_array_length(p_stages) + 1000
    into v_position_offset
  from public.shipment_track_stages where shipment_track_id = p_track_id;

  for v_existing_stage in
    select id, "position"
    from public.shipment_track_stages
    where shipment_track_id = p_track_id
    order by "position" desc, id desc
  loop
    update public.shipment_track_stages
    set "position" = v_existing_stage."position" + v_position_offset
    where id = v_existing_stage.id;
  end loop;

  for v_stage in select value from jsonb_array_elements(p_stages)
  loop
    if (v_stage ? 'id') and nullif(v_stage->>'id', '') is not null then
      v_stage_id := (v_stage->>'id')::uuid;
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
      v_stage_id, p_track_id, lower(btrim(v_stage->>'stage_key')),
      btrim(v_stage->>'stage_name'),
      nullif(btrim(coalesce(v_stage->>'description', '')), ''), v_position,
      coalesce((v_stage->>'is_completed')::boolean, false),
      case when coalesce((v_stage->>'is_completed')::boolean, false) then coalesce(
        nullif(v_stage->>'completed_at', '')::timestamptz,
        (select existing.completed_at from public.shipment_track_stages existing
         where existing.id = v_stage_id and existing.shipment_track_id = p_track_id), now()
      ) else null end
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
  where shipment_track_id = p_track_id and "position" >= v_position_offset;

  -- The first incomplete stage is active. Only its preceding contiguous
  -- prefix contributes to the legacy milestone status.
  for v_stage_position in 0..(jsonb_array_length(p_stages) - 1)
  loop
    select coalesce(is_completed, false) into v_stage_completed
    from public.shipment_track_stages
    where shipment_track_id = p_track_id and "position" = v_stage_position;
    if v_stage_completed then
      v_contiguous_completed := v_contiguous_completed + 1;
    else
      exit;
    end if;
  end loop;

  v_event_position := least(v_contiguous_completed, jsonb_array_length(p_stages) - 1);
  v_legacy_step := greatest(0, least(v_contiguous_completed, 4));
  v_new_status := null;

  -- current_step is the zero-based active milestone index in production. Map
  -- that active stable key first, rather than deriving status from the number
  -- of completed rows. An active "packed" stage remains preparing until it
  -- is completed; an active "departed" stage represents shipment from China.
  select lower(btrim(stage_key)) into v_active_key
  from public.shipment_track_stages
  where shipment_track_id = p_track_id
    and "position" = v_contiguous_completed;

  if v_active_key is null then
    select lower(btrim(stage_key)) into v_active_key
    from public.shipment_track_stages
    where shipment_track_id = p_track_id
    order by "position" desc
    limit 1;
  end if;

  v_new_status := case
    when v_active_key in ('confirmed', 'order_confirmed', 'order-confirmed', 'preparing', 'packed', 'packed_for_shipment', 'packed-for-shipment') then 'preparing'
    when v_active_key in ('departed', 'in_transit', 'in-transit') then 'shipped_from_china'
    when v_active_key in ('arrived', 'arrived_in_ghana', 'arrived-in-ghana') then 'arrived_in_ghana'
    when v_active_key in ('delivery', 'out_for_delivery', 'out-for-delivery') then 'out_for_delivery'
    else null
  end;
  v_active_status_mapped := v_new_status is not null;

  -- For custom active keys, fall back to the latest recognized completed
  -- milestone without inventing a status from an arbitrary stage name.
  for v_stage in
    select to_jsonb(stage_row) from public.shipment_track_stages stage_row
    where stage_row.shipment_track_id = p_track_id
      and stage_row."position" < v_contiguous_completed
    order by stage_row."position"
  loop
    v_stage_key := lower(btrim(v_stage->>'stage_key'));
    v_stage_status := case
      when v_stage_key in ('confirmed', 'order_confirmed', 'order-confirmed', 'preparing') then 'preparing'
      when v_stage_key in ('packed', 'packed_for_shipment', 'packed-for-shipment') then 'shipped_from_china'
      when v_stage_key in ('departed', 'in_transit', 'in-transit') then 'in_transit'
      when v_stage_key in ('arrived', 'arrived_in_ghana', 'arrived-in-ghana') then 'arrived_in_ghana'
      when v_stage_key in ('delivery', 'out_for_delivery', 'out-for-delivery') then 'out_for_delivery'
      else null
    end;
    if not v_active_status_mapped and v_stage_status is not null then
      v_new_status := v_stage_status;
    end if;
  end loop;

  select "position" into v_delivery_position
  from public.shipment_track_stages
  where shipment_track_id = p_track_id
    and lower(stage_key) in ('delivered', 'delivery_completed', 'delivery-completed')
    and is_completed and "position" < v_contiguous_completed
  order by "position" desc limit 1;

  if v_delivery_position is not null then
    v_new_status := 'delivered';
    v_legacy_step := 4;
    v_event_position := v_delivery_position;
  elsif v_old_status = 'delivered' then
    -- Preserve historical delivery even when the old five-stage template only
    -- contains the non-confirming "delivery" key.
    v_new_status := 'delivered';
    v_legacy_step := 4;
    v_event_position := greatest(jsonb_array_length(p_stages) - 1, 0);
  else
    -- Never preserve a stale legacy status after a backward correction or
    -- when the current completed prefix has no recognized milestone.
    v_new_status := coalesce(v_new_status, 'preparing');
  end if;

  update public.shipment_tracks
  set current_step = v_legacy_step, current_status = v_new_status, updated_at = now()
  where id = p_track_id;

  -- Insert only one final event, after the final legacy status is known.
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', stage.id,
    'position', stage."position",
    'stage_key', lower(btrim(stage.stage_key)),
    'is_completed', stage.is_completed
  ) order by stage."position"), '[]'::jsonb)
    into v_new_progress
  from public.shipment_track_stages stage
  where stage.shipment_track_id = p_track_id;

  if v_old_progress is distinct from v_new_progress
     or v_old_step is distinct from v_legacy_step
     or v_old_status is distinct from v_new_status then
    insert into public.shipment_track_events (
      shipment_track_id, current_step, current_status, title, message, event_at
    ) values (
      p_track_id, v_legacy_step, v_new_status,
      coalesce((select stage_name from public.shipment_track_stages
                where shipment_track_id = p_track_id and "position" = v_event_position), 'Shipment stage updated'),
      coalesce((select description from public.shipment_track_stages
                where shipment_track_id = p_track_id and "position" = v_event_position), 'Shipment progress updated.'),
      now()
    );
  end if;

  select jsonb_agg(to_jsonb(stage) order by stage."position") into v_result
  from public.shipment_track_stages stage where stage.shipment_track_id = p_track_id;
  return jsonb_build_object('track_id', p_track_id, 'stages', coalesce(v_result, '[]'::jsonb));
end;
$function$;

revoke all on function public.save_shipment_track_stages(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_shipment_track_stages(uuid, jsonb) to authenticated;

commit;
