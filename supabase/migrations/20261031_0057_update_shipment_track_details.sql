begin;

-- Metadata edits must not pass stage-derived current_step/current_status back
-- through the legacy progress-validation RPC.
create or replace function public.update_shipment_track_details(
  p_track_id uuid,
  p_headline text default null,
  p_announcement text default null,
  p_estimated_departure date default null,
  p_estimated_arrival date default null
)
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

  if p_track_id is null then
    raise exception 'A shipment track is required';
  end if;

  if p_estimated_departure is not null
     and p_estimated_arrival is not null
     and p_estimated_departure > p_estimated_arrival then
    raise exception 'Estimated departure must be before estimated arrival.';
  end if;

  update public.shipment_tracks
  set headline = nullif(btrim(coalesce(p_headline, '')), ''),
      announcement = nullif(btrim(coalesce(p_announcement, '')), ''),
      estimated_departure = p_estimated_departure,
      estimated_arrival = p_estimated_arrival,
      updated_at = now()
  where id = p_track_id
    and archived_at is null
  returning * into v_track;

  if v_track.id is null then
    raise exception 'Shipment track not found';
  end if;

  return to_jsonb(v_track);
end;
$function$;

revoke all on function public.update_shipment_track_details(uuid, text, text, date, date)
  from public, anon, authenticated;
grant execute on function public.update_shipment_track_details(uuid, text, text, date, date)
  to authenticated;

commit;
