begin;

-- Archived tracks retain their events and stages, but must not block a new
-- active lifecycle for the same batch and freight type.
alter table public.shipment_tracks
  drop constraint if exists shipment_tracks_batch_freight_unique;

create unique index if not exists shipment_tracks_active_batch_freight_unique
  on public.shipment_tracks (batch_id, freight_type)
  where archived_at is null;

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

    -- Archived tracks are historical records, not the active progress state.
    -- An explicit id can only edit an active track.
    if v_id is not null and v_freight_type <> 'both' then
      select * into v_previous
      from public.shipment_tracks st
      where st.id = v_id and st.archived_at is null
      for update;
      if not found then raise exception 'Shipment track not found.'; end if;
      if v_previous.batch_id <> v_batch_id or v_previous.freight_type <> v_type then
        raise exception 'The shipment track does not match the selected batch and freight type.';
      end if;
    else
      select * into v_previous
      from public.shipment_tracks st
      where st.batch_id = v_batch_id
        and st.freight_type = v_type
        and st.archived_at is null
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
    on conflict (batch_id, freight_type) where archived_at is null do update set
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

revoke all on function public.save_shipment_track(jsonb) from public, anon, authenticated;
grant execute on function public.save_shipment_track(jsonb) to authenticated;

commit;
