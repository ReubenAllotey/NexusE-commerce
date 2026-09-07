begin;

create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid(),
  batch_number text not null unique,
  title text,
  start_date date,
  end_date date,
  shipment_type text not null default 'both',
  air_freight_days integer,
  sea_freight_days integer,
  status text not null default 'draft',
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint import_batches_batch_number_not_blank check (btrim(batch_number) <> ''),
  constraint import_batches_dates_check check (start_date is null or end_date is null or start_date <= end_date),
  constraint import_batches_shipment_type_check check (shipment_type in ('air', 'sea', 'both')),
  constraint import_batches_air_days_check check (air_freight_days is null or air_freight_days >= 0),
  constraint import_batches_sea_days_check check (sea_freight_days is null or sea_freight_days >= 0),
  constraint import_batches_status_check check (status in ('draft', 'open', 'closed', 'purchasing', 'shipped', 'arrived', 'completed'))
);

create index if not exists import_batches_status_idx on public.import_batches (status);
create index if not exists import_batches_start_date_idx on public.import_batches (start_date);
create index if not exists import_batches_end_date_idx on public.import_batches (end_date);
create unique index if not exists import_batches_one_open_idx
  on public.import_batches ((status)) where status = 'open';

alter table public.import_batches enable row level security;

revoke all on table public.import_batches from anon, authenticated;
grant select on table public.import_batches to authenticated;

drop policy if exists import_batches_admin_select on public.import_batches;
create policy import_batches_admin_select on public.import_batches
  for select to authenticated
  using (private.is_admin_user());

insert into public.import_batches (
  batch_number,
  start_date,
  end_date,
  shipment_type,
  air_freight_days,
  sea_freight_days,
  status,
  created_by
)
select
  btrim(sb.announcement_batch_number),
  sb.announcement_batch_window_start,
  sb.announcement_batch_window_end,
  lower(sb.announcement_shipping_mode),
  case when lower(sb.announcement_shipping_mode) in ('air', 'both') then sb.announcement_air_transit_days else null end,
  case when lower(sb.announcement_shipping_mode) in ('sea', 'both') then sb.announcement_sea_transit_days else null end,
  'open',
  sb.created_by
from public.site_banners sb
where sb.banner_key = 'homepage'
  and sb.status = 'active'
  and sb.deleted_at is null
  and btrim(coalesce(sb.announcement_batch_number, '')) <> ''
  and sb.announcement_batch_window_start is not null
  and sb.announcement_batch_window_end is not null
  and sb.announcement_batch_window_start <= sb.announcement_batch_window_end
  and lower(sb.announcement_shipping_mode) in ('air', 'sea', 'both')
  and (
    (lower(sb.announcement_shipping_mode) = 'air' and sb.announcement_air_transit_days is not null and sb.announcement_air_transit_days >= 0)
    or (lower(sb.announcement_shipping_mode) = 'sea' and sb.announcement_sea_transit_days is not null and sb.announcement_sea_transit_days >= 0)
    or (lower(sb.announcement_shipping_mode) = 'both' and sb.announcement_air_transit_days is not null and sb.announcement_air_transit_days >= 0 and sb.announcement_sea_transit_days is not null and sb.announcement_sea_transit_days >= 0)
  )
  and not exists (select 1 from public.import_batches);

create or replace function public.save_import_batch(payload jsonb)
returns public.import_batches
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_admin_id uuid := auth.uid();
  v_id uuid := nullif(btrim(coalesce(payload ->> 'id', '')), '')::uuid;
  v_batch_number text := btrim(coalesce(payload ->> 'batch_number', payload ->> 'batchNumber', ''));
  v_title text := nullif(btrim(coalesce(payload ->> 'title', '')), '');
  v_start_date date := nullif(btrim(coalesce(payload ->> 'start_date', payload ->> 'startDate', '')), '')::date;
  v_end_date date := nullif(btrim(coalesce(payload ->> 'end_date', payload ->> 'endDate', '')), '')::date;
  v_shipment_type text := lower(btrim(coalesce(payload ->> 'shipment_type', payload ->> 'shipmentType', 'both')));
  v_air_days integer := nullif(btrim(coalesce(payload ->> 'air_freight_days', payload ->> 'airFreightDays', '')), '')::integer;
  v_sea_days integer := nullif(btrim(coalesce(payload ->> 'sea_freight_days', payload ->> 'seaFreightDays', '')), '')::integer;
  v_status text := lower(btrim(coalesce(payload ->> 'status', 'draft')));
  v_notes text := nullif(btrim(coalesce(payload ->> 'notes', '')), '');
  v_previous_batch_number text;
  v_row public.import_batches%rowtype;
begin
  if v_admin_id is null or not private.is_admin_user() then
    raise exception 'Only active administrators can manage import batches.';
  end if;
  if v_batch_number = '' then raise exception 'A batch number is required.'; end if;
  if v_start_date is null or v_end_date is null then raise exception 'Batch start and end dates are required.'; end if;
  if v_start_date > v_end_date then raise exception 'Batch start date must be before its end date.'; end if;
  if v_shipment_type not in ('air', 'sea', 'both') then raise exception 'Invalid shipment type.'; end if;
  if v_status not in ('draft', 'open', 'closed', 'purchasing', 'shipped', 'arrived', 'completed') then raise exception 'Invalid batch status.'; end if;
  if v_air_days is not null and v_air_days < 0 then raise exception 'Air freight days cannot be negative.'; end if;
  if v_sea_days is not null and v_sea_days < 0 then raise exception 'Sea freight days cannot be negative.'; end if;
  if v_shipment_type in ('air', 'both') and v_air_days is null then raise exception 'Air freight days are required for this shipment type.'; end if;
  if v_shipment_type in ('sea', 'both') and v_sea_days is null then raise exception 'Sea freight days are required for this shipment type.'; end if;

  if v_shipment_type = 'air' then
    v_sea_days := null;
  elsif v_shipment_type = 'sea' then
    v_air_days := null;
  end if;

  if v_id is not null then
    select ib.batch_number into v_previous_batch_number from public.import_batches ib where ib.id = v_id for update;
    if v_previous_batch_number is null then raise exception 'Batch not found.'; end if;
    if v_previous_batch_number is distinct from v_batch_number and exists (select 1 from public.orders o where o.batch_number = v_previous_batch_number) then
      raise exception 'Batch number cannot be changed after orders have been placed.';
    end if;
  end if;
  if v_status = 'open' and exists (select 1 from public.import_batches ib where ib.status = 'open' and (v_id is null or ib.id <> v_id)) then
    raise exception 'Close the current open batch before opening another batch.';
  end if;

  if v_id is null then
    insert into public.import_batches (batch_number,title,start_date,end_date,shipment_type,air_freight_days,sea_freight_days,status,notes,created_by)
    values (v_batch_number,v_title,v_start_date,v_end_date,v_shipment_type,v_air_days,v_sea_days,v_status,v_notes,v_admin_id)
    returning * into v_row;
  else
    update public.import_batches as ib set
      batch_number=v_batch_number,title=v_title,start_date=v_start_date,end_date=v_end_date,
      shipment_type=v_shipment_type,air_freight_days=v_air_days,sea_freight_days=v_sea_days,
      status=v_status,notes=v_notes,updated_at=now()
    where ib.id = v_id returning * into v_row;
  end if;
  return v_row;
end;
$function$;

create or replace function public.set_import_batch_status(p_batch_id uuid, p_status text)
returns public.import_batches
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_row public.import_batches%rowtype;
begin
  if auth.uid() is null or not private.is_admin_user() then raise exception 'Only active administrators can manage import batches.'; end if;
  if v_status not in ('draft', 'open', 'closed', 'purchasing', 'shipped', 'arrived', 'completed') then raise exception 'Invalid batch status.'; end if;
  if v_status = 'open' and exists (select 1 from public.import_batches ib where ib.status = 'open' and ib.id <> p_batch_id) then raise exception 'Close the current open batch before opening another batch.'; end if;
  update public.import_batches set status=v_status, updated_at=now() where id=p_batch_id returning * into v_row;
  if not found then raise exception 'Batch not found.'; end if;
  return v_row;
end;
$function$;

create or replace function public.get_current_import_batch()
returns table (
  id uuid, batch_number text, title text, start_date date, end_date date,
  shipment_type text, air_freight_days integer, sea_freight_days integer,
  status text
)
language sql
stable
security definer
set search_path = ''
as $function$
  select ib.id, ib.batch_number, ib.title, ib.start_date, ib.end_date,
         ib.shipment_type, ib.air_freight_days, ib.sea_freight_days, ib.status
  from public.import_batches ib
  where ib.status = 'open'
  order by ib.start_date desc nulls last, ib.created_at desc
  limit 1;
$function$;

revoke all on function public.save_import_batch(jsonb) from public, anon, authenticated;
grant execute on function public.save_import_batch(jsonb) to authenticated;
revoke all on function public.set_import_batch_status(uuid, text) from public, anon, authenticated;
grant execute on function public.set_import_batch_status(uuid, text) to authenticated;
revoke all on function public.get_current_import_batch() from public;
grant execute on function public.get_current_import_batch() to anon, authenticated;

commit;
