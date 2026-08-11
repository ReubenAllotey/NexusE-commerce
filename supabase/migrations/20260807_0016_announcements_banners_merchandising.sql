begin;

create extension if not exists pgcrypto;

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  message text not null,
  category text not null,
  status text not null default 'active',
  starts_at timestamptz,
  ends_at timestamptz,
  deleted_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint announcements_title_not_blank check (btrim(title) <> ''),
  constraint announcements_message_not_blank check (btrim(message) <> ''),
  constraint announcements_category_check check (
    category in (
      'shipping-update',
      'new-arrival',
      'promotion',
      'maintenance',
      'payment-reminder',
      'general-announcement'
    )
  ),
  constraint announcements_status_check check (status in ('active', 'scheduled', 'expired'))
);

create index announcements_category_idx on public.announcements (category);
create index announcements_status_idx on public.announcements (status);
create index announcements_starts_at_idx on public.announcements (starts_at);
create index announcements_ends_at_idx on public.announcements (ends_at);
create index announcements_deleted_at_idx on public.announcements (deleted_at);
create index announcements_created_at_idx on public.announcements (created_at);

create table public.site_banners (
  id uuid primary key default gen_random_uuid(),
  banner_key text not null unique,
  announcement_label text not null,
  announcement_batch_number text not null,
  announcement_headline text not null,
  announcement_body text not null,
  announcement_batch_window_start date,
  announcement_batch_window_end date,
  announcement_shipping_mode text not null,
  announcement_air_transit_days integer not null default 16,
  announcement_sea_transit_days integer not null default 30,
  announcement_cta_label text not null,
  announcement_cta_href text not null,
  reflection_label text not null,
  reflection_headline text not null,
  reflection_verse text not null,
  reflection_body text,
  status text not null default 'active',
  display_order integer not null default 0,
  deleted_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint site_banners_banner_key_not_blank check (btrim(banner_key) <> ''),
  constraint site_banners_announcement_label_not_blank check (btrim(announcement_label) <> ''),
  constraint site_banners_announcement_batch_number_not_blank check (btrim(announcement_batch_number) <> ''),
  constraint site_banners_announcement_headline_not_blank check (btrim(announcement_headline) <> ''),
  constraint site_banners_announcement_body_not_blank check (btrim(announcement_body) <> ''),
  constraint site_banners_announcement_shipping_mode_check check (
    announcement_shipping_mode in ('air', 'sea', 'both')
  ),
  constraint site_banners_announcement_air_transit_days_check check (announcement_air_transit_days > 0),
  constraint site_banners_announcement_sea_transit_days_check check (announcement_sea_transit_days > 0),
  constraint site_banners_announcement_cta_label_not_blank check (btrim(announcement_cta_label) <> ''),
  constraint site_banners_announcement_cta_href_not_blank check (btrim(announcement_cta_href) <> ''),
  constraint site_banners_reflection_label_not_blank check (btrim(reflection_label) <> ''),
  constraint site_banners_reflection_headline_not_blank check (btrim(reflection_headline) <> ''),
  constraint site_banners_reflection_verse_not_blank check (btrim(reflection_verse) <> ''),
  constraint site_banners_status_check check (status in ('active', 'inactive')),
  constraint site_banners_display_order_check check (display_order >= 0)
);

create index site_banners_status_idx on public.site_banners (status);
create index site_banners_display_order_idx on public.site_banners (display_order);
create index site_banners_deleted_at_idx on public.site_banners (deleted_at);
create index site_banners_created_at_idx on public.site_banners (created_at);

create table public.product_merchandising (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  placement text not null,
  display_order integer not null default 0,
  starts_at timestamptz,
  ends_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_merchandising_placement_check check (placement in ('flashy', 'best-selling')),
  constraint product_merchandising_display_order_check check (display_order >= 0),
  constraint product_merchandising_unique_per_placement unique (product_id, placement)
);

create index product_merchandising_product_id_idx on public.product_merchandising (product_id);
create index product_merchandising_placement_idx on public.product_merchandising (placement);
create index product_merchandising_display_order_idx on public.product_merchandising (display_order);
create index product_merchandising_starts_at_idx on public.product_merchandising (starts_at);
create index product_merchandising_ends_at_idx on public.product_merchandising (ends_at);

create or replace function public.save_announcement(payload jsonb)
returns public.announcements
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_admin_id uuid := auth.uid();
  v_id uuid := nullif(btrim(coalesce(payload ->> 'id', payload ->> 'announcementId', '')), '')::uuid;
  v_title text := btrim(coalesce(payload ->> 'title', payload ->> 'headline', ''));
  v_message text := btrim(coalesce(payload ->> 'message', payload ->> 'body', ''));
  v_category text := lower(btrim(coalesce(payload ->> 'category', payload ->> 'announcementCategory', 'general-announcement')));
  v_status text := lower(btrim(coalesce(payload ->> 'status', '')));
  v_starts_at timestamptz := nullif(btrim(coalesce(payload ->> 'startsAt', payload ->> 'publishDate', payload ->> 'starts_at', '')), '')::timestamptz;
  v_ends_at timestamptz := nullif(btrim(coalesce(payload ->> 'endsAt', payload ->> 'expireDate', payload ->> 'ends_at', '')), '')::timestamptz;
  v_row public.announcements%rowtype;
begin
  if v_admin_id is null then
    raise exception 'Please sign in to continue.';
  end if;

  if not private.is_admin_user() then
    raise exception 'Only active administrators can save announcements.';
  end if;

  if v_title = '' then
    raise exception 'An announcement title is required.';
  end if;

  if v_message = '' then
    raise exception 'An announcement message is required.';
  end if;

  if v_category not in (
    'shipping-update',
    'new-arrival',
    'promotion',
    'maintenance',
    'payment-reminder',
    'general-announcement'
  ) then
    raise exception 'Invalid announcement category.';
  end if;

  if v_status not in ('', 'active', 'scheduled', 'expired') then
    raise exception 'Invalid announcement status.';
  end if;

  if v_status = '' then
    v_status := case
      when v_starts_at is not null and v_starts_at > now() then 'scheduled'
      when v_ends_at is not null and v_ends_at < now() then 'expired'
      else 'active'
    end;
  end if;

  if v_id is null then
    insert into public.announcements as a (
      title,
      message,
      category,
      status,
      starts_at,
      ends_at,
      created_by
    ) values (
      v_title,
      v_message,
      v_category,
      v_status,
      v_starts_at,
      v_ends_at,
      v_admin_id
    )
    returning a.* into v_row;
  else
    update public.announcements as a
       set title = v_title,
           message = v_message,
           category = v_category,
           status = v_status,
           starts_at = v_starts_at,
           ends_at = v_ends_at,
           updated_at = now()
     where a.id = v_id
     returning a.* into v_row;

    if not found then
      raise exception 'Announcement not found.';
    end if;
  end if;

  return v_row;
end;
$function$;

create or replace function public.soft_delete_announcement(p_announcement_id uuid)
returns public.announcements
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_admin_id uuid := auth.uid();
  v_row public.announcements%rowtype;
begin
  if v_admin_id is null then
    raise exception 'Please sign in to continue.';
  end if;

  if not private.is_admin_user() then
    raise exception 'Only active administrators can delete announcements.';
  end if;

  update public.announcements as a
     set deleted_at = coalesce(a.deleted_at, now()),
         status = 'expired',
         updated_at = now()
   where a.id = p_announcement_id
   returning a.* into v_row;

  if not found then
    raise exception 'Announcement not found.';
  end if;

  return v_row;
end;
$function$;

create or replace function public.save_site_banner(payload jsonb)
returns public.site_banners
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_admin_id uuid := auth.uid();
  v_banner_key text := lower(btrim(coalesce(payload ->> 'banner_key', payload ->> 'bannerKey', 'homepage')));
  v_announcement_label text := btrim(coalesce(payload ->> 'announcement_label', payload ->> 'label', 'Announcement'));
  v_announcement_batch_number text := btrim(coalesce(payload ->> 'announcement_batch_number', payload ->> 'batchNumber', 'SEA-08'));
  v_announcement_headline text := btrim(coalesce(payload ->> 'announcement_headline', payload ->> 'headline', ''));
  v_announcement_body text := btrim(coalesce(payload ->> 'announcement_body', payload ->> 'body', ''));
  v_announcement_batch_window_start date := nullif(btrim(coalesce(payload ->> 'announcement_batch_window_start', payload ->> 'batchWindowStart', '')), '')::date;
  v_announcement_batch_window_end date := nullif(btrim(coalesce(payload ->> 'announcement_batch_window_end', payload ->> 'batchWindowEnd', '')), '')::date;
  v_announcement_shipping_mode text := lower(btrim(coalesce(payload ->> 'announcement_shipping_mode', payload ->> 'shippingMode', 'sea')));
  v_announcement_air_transit_days integer := coalesce(nullif(btrim(coalesce(payload ->> 'announcement_air_transit_days', payload ->> 'airTransitDays', '')), '')::integer, 16);
  v_announcement_sea_transit_days integer := coalesce(nullif(btrim(coalesce(payload ->> 'announcement_sea_transit_days', payload ->> 'seaTransitDays', '')), '')::integer, 30);
  v_announcement_cta_label text := btrim(coalesce(payload ->> 'announcement_cta_label', payload ->> 'ctaLabel', 'View Details'));
  v_announcement_cta_href text := btrim(coalesce(payload ->> 'announcement_cta_href', payload ->> 'ctaHref', '/products'));
  v_reflection_label text := btrim(coalesce(payload ->> 'reflection_label', payload ->> 'reflectionLabel', 'Daily Reflection'));
  v_reflection_headline text := btrim(coalesce(payload ->> 'reflection_headline', payload ->> 'headline', ''));
  v_reflection_verse text := btrim(coalesce(payload ->> 'reflection_verse', payload ->> 'verse', ''));
  v_reflection_body text := nullif(btrim(coalesce(payload ->> 'reflection_body', payload ->> 'body', '')), '');
  v_status text := lower(btrim(coalesce(payload ->> 'status', 'active')));
  v_display_order integer := coalesce(nullif(btrim(coalesce(payload ->> 'display_order', payload ->> 'displayOrder', '')), '')::integer, 0);
  v_row public.site_banners%rowtype;
begin
  if v_admin_id is null then
    raise exception 'Please sign in to continue.';
  end if;

  if not private.is_admin_user() then
    raise exception 'Only active administrators can save the site banner.';
  end if;

  if v_banner_key = '' then
    raise exception 'A banner key is required.';
  end if;

  if v_announcement_headline = '' then
    raise exception 'An announcement headline is required.';
  end if;

  if v_announcement_body = '' then
    raise exception 'An announcement body is required.';
  end if;

  if v_announcement_shipping_mode not in ('air', 'sea', 'both') then
    raise exception 'Invalid shipping mode.';
  end if;

  if v_announcement_air_transit_days <= 0 then
    raise exception 'Air transit days must be greater than zero.';
  end if;

  if v_announcement_sea_transit_days <= 0 then
    raise exception 'Sea transit days must be greater than zero.';
  end if;

  if v_announcement_cta_label = '' then
    raise exception 'A banner button label is required.';
  end if;

  if v_announcement_cta_href = '' then
    raise exception 'A banner link is required.';
  end if;

  if v_reflection_headline = '' then
    raise exception 'A reflection headline is required.';
  end if;

  if v_reflection_verse = '' then
    raise exception 'A reflection verse is required.';
  end if;

  if v_status not in ('active', 'inactive') then
    raise exception 'Invalid banner status.';
  end if;

  insert into public.site_banners as sb (
    banner_key,
    announcement_label,
    announcement_batch_number,
    announcement_headline,
    announcement_body,
    announcement_batch_window_start,
    announcement_batch_window_end,
    announcement_shipping_mode,
    announcement_air_transit_days,
    announcement_sea_transit_days,
    announcement_cta_label,
    announcement_cta_href,
    reflection_label,
    reflection_headline,
    reflection_verse,
    reflection_body,
    status,
    display_order,
    created_by
  ) values (
    v_banner_key,
    v_announcement_label,
    v_announcement_batch_number,
    v_announcement_headline,
    v_announcement_body,
    v_announcement_batch_window_start,
    v_announcement_batch_window_end,
    v_announcement_shipping_mode,
    v_announcement_air_transit_days,
    v_announcement_sea_transit_days,
    v_announcement_cta_label,
    v_announcement_cta_href,
    v_reflection_label,
    v_reflection_headline,
    v_reflection_verse,
    v_reflection_body,
    v_status,
    v_display_order,
    v_admin_id
  )
  on conflict (banner_key) do update
     set announcement_label = excluded.announcement_label,
         announcement_batch_number = excluded.announcement_batch_number,
         announcement_headline = excluded.announcement_headline,
         announcement_body = excluded.announcement_body,
         announcement_batch_window_start = excluded.announcement_batch_window_start,
         announcement_batch_window_end = excluded.announcement_batch_window_end,
         announcement_shipping_mode = excluded.announcement_shipping_mode,
         announcement_air_transit_days = excluded.announcement_air_transit_days,
         announcement_sea_transit_days = excluded.announcement_sea_transit_days,
         announcement_cta_label = excluded.announcement_cta_label,
         announcement_cta_href = excluded.announcement_cta_href,
         reflection_label = excluded.reflection_label,
         reflection_headline = excluded.reflection_headline,
         reflection_verse = excluded.reflection_verse,
         reflection_body = excluded.reflection_body,
         status = excluded.status,
         display_order = excluded.display_order,
         updated_at = now()
  returning sb.* into v_row;

  return v_row;
end;
$function$;

create or replace function public.save_product_merchandising(payload jsonb)
returns public.product_merchandising
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_admin_id uuid := auth.uid();
  v_product_id uuid := nullif(btrim(coalesce(payload ->> 'productId', payload ->> 'product_id', '')), '')::uuid;
  v_placement text := lower(btrim(coalesce(payload ->> 'placement', payload ->> 'group', 'flashy')));
  v_display_order integer := greatest(coalesce(nullif(btrim(coalesce(payload ->> 'displayOrder', payload ->> 'display_order', '')), '')::integer, 0), 0);
  v_starts_at timestamptz := nullif(btrim(coalesce(payload ->> 'startsAt', payload ->> 'starts_at', '')), '')::timestamptz;
  v_ends_at timestamptz := nullif(btrim(coalesce(payload ->> 'endsAt', payload ->> 'ends_at', '')), '')::timestamptz;
  v_product public.products%rowtype;
  v_row public.product_merchandising%rowtype;
begin
  if v_admin_id is null then
    raise exception 'Please sign in to continue.';
  end if;

  if not private.is_admin_user() then
    raise exception 'Only active administrators can manage merchandising.';
  end if;

  if v_product_id is null then
    raise exception 'A product id is required.';
  end if;

  if v_placement not in ('flashy', 'best-selling') then
    raise exception 'Invalid merchandising placement.';
  end if;

  select p.*
    into v_product
  from public.products as p
  where p.id = v_product_id;

  if not found then
    raise exception 'Product not found.';
  end if;

  if v_product.status <> 'active' or v_product.deleted_at is not null then
    raise exception 'Only active, undeleted products can be assigned to merchandising.';
  end if;

  insert into public.product_merchandising as pm (
    product_id,
    placement,
    display_order,
    starts_at,
    ends_at,
    created_by
  ) values (
    v_product_id,
    v_placement,
    v_display_order,
    v_starts_at,
    v_ends_at,
    v_admin_id
  )
  on conflict (product_id, placement) do update
     set display_order = excluded.display_order,
         starts_at = excluded.starts_at,
         ends_at = excluded.ends_at,
         updated_at = now()
  returning pm.* into v_row;

  return v_row;
end;
$function$;

create or replace function public.delete_product_merchandising(
  p_product_id uuid,
  p_placement text
)
returns public.product_merchandising
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_admin_id uuid := auth.uid();
  v_placement text := lower(btrim(coalesce(p_placement, 'flashy')));
  v_row public.product_merchandising%rowtype;
begin
  if v_admin_id is null then
    raise exception 'Please sign in to continue.';
  end if;

  if not private.is_admin_user() then
    raise exception 'Only active administrators can manage merchandising.';
  end if;

  if p_product_id is null then
    raise exception 'A product id is required.';
  end if;

  if v_placement not in ('flashy', 'best-selling') then
    raise exception 'Invalid merchandising placement.';
  end if;

  delete from public.product_merchandising as pm
   where pm.product_id = p_product_id
     and pm.placement = v_placement
   returning pm.* into v_row;

  if not found then
    raise exception 'Merchandising record not found.';
  end if;

  return v_row;
end;
$function$;

drop trigger if exists announcements_set_updated_at on public.announcements;
create trigger announcements_set_updated_at
before update on public.announcements
for each row execute function private.set_updated_at();

drop trigger if exists site_banners_set_updated_at on public.site_banners;
create trigger site_banners_set_updated_at
before update on public.site_banners
for each row execute function private.set_updated_at();

drop trigger if exists product_merchandising_set_updated_at on public.product_merchandising;
create trigger product_merchandising_set_updated_at
before update on public.product_merchandising
for each row execute function private.set_updated_at();

alter table public.announcements enable row level security;
alter table public.site_banners enable row level security;
alter table public.product_merchandising enable row level security;

drop policy if exists announcements_select_public on public.announcements;
create policy announcements_select_public
on public.announcements
for select
to anon, authenticated
using (
  deleted_at is null
  and status = 'active'
  and (starts_at is null or starts_at <= now())
  and (ends_at is null or ends_at >= now())
);

drop policy if exists announcements_select_admin on public.announcements;
create policy announcements_select_admin
on public.announcements
for select
to authenticated
using ((select private.is_admin_user()));

drop policy if exists site_banners_select_public on public.site_banners;
create policy site_banners_select_public
on public.site_banners
for select
to anon, authenticated
using (
  banner_key = 'homepage'
  and deleted_at is null
  and status = 'active'
);

drop policy if exists site_banners_select_admin on public.site_banners;
create policy site_banners_select_admin
on public.site_banners
for select
to authenticated
using ((select private.is_admin_user()));

drop policy if exists product_merchandising_select_public on public.product_merchandising;
create policy product_merchandising_select_public
on public.product_merchandising
for select
to anon, authenticated
using (
  (starts_at is null or starts_at <= now())
  and (ends_at is null or ends_at >= now())
  and exists (
    select 1
    from public.products as p
    where p.id = product_merchandising.product_id
      and p.status = 'active'
      and p.deleted_at is null
  )
);

drop policy if exists product_merchandising_select_admin on public.product_merchandising;
create policy product_merchandising_select_admin
on public.product_merchandising
for select
to authenticated
using ((select private.is_admin_user()));

revoke all on table public.announcements from public;
revoke all on table public.announcements from anon;
revoke all on table public.announcements from authenticated;
grant select on table public.announcements to anon, authenticated;

revoke all on table public.site_banners from public;
revoke all on table public.site_banners from anon;
revoke all on table public.site_banners from authenticated;
grant select on table public.site_banners to anon, authenticated;

revoke all on table public.product_merchandising from public;
revoke all on table public.product_merchandising from anon;
revoke all on table public.product_merchandising from authenticated;
grant select on table public.product_merchandising to anon, authenticated;

revoke all on function public.save_announcement(jsonb) from public;
revoke all on function public.save_announcement(jsonb) from anon;
revoke all on function public.save_announcement(jsonb) from authenticated;
grant execute on function public.save_announcement(jsonb) to authenticated;

revoke all on function public.soft_delete_announcement(uuid) from public;
revoke all on function public.soft_delete_announcement(uuid) from anon;
revoke all on function public.soft_delete_announcement(uuid) from authenticated;
grant execute on function public.soft_delete_announcement(uuid) to authenticated;

revoke all on function public.save_site_banner(jsonb) from public;
revoke all on function public.save_site_banner(jsonb) from anon;
revoke all on function public.save_site_banner(jsonb) from authenticated;
grant execute on function public.save_site_banner(jsonb) to authenticated;

revoke all on function public.save_product_merchandising(jsonb) from public;
revoke all on function public.save_product_merchandising(jsonb) from anon;
revoke all on function public.save_product_merchandising(jsonb) from authenticated;
grant execute on function public.save_product_merchandising(jsonb) to authenticated;

revoke all on function public.delete_product_merchandising(uuid, text) from public;
revoke all on function public.delete_product_merchandising(uuid, text) from anon;
revoke all on function public.delete_product_merchandising(uuid, text) from authenticated;
grant execute on function public.delete_product_merchandising(uuid, text) to authenticated;

commit;
