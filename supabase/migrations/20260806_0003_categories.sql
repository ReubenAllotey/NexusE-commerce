begin;

create extension if not exists pgcrypto;

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  description text,
  icon text,
  status text not null default 'active'
    check (status in ('active', 'hidden')),
  parent_id uuid references public.categories(id) on delete restrict,
  display_order integer not null default 0,
  show_on_homepage boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (btrim(name) <> ''),
  check (btrim(slug) <> ''),
  check (deleted_at is null or status = 'hidden')
);

create unique index categories_slug_normalized_unique_idx
  on public.categories (lower(slug));

create index categories_parent_id_idx
  on public.categories (parent_id);

create index categories_status_idx
  on public.categories (status);

create index categories_display_order_idx
  on public.categories (display_order);

create index categories_show_on_homepage_idx
  on public.categories (show_on_homepage);

alter table public.categories enable row level security;

revoke all on schema private from public;
revoke all on schema private from anon;
revoke all on schema private from authenticated;

grant usage on schema private to authenticated;

create or replace function private.normalize_categories_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_source_slug text;
  v_parent public.categories%rowtype;
  v_cycle_found boolean := false;
  v_existing_cycle_detected boolean := false;
  v_depth_limit_reached boolean := false;
  v_has_visible_children boolean := false;
  v_self_id uuid;
begin
  -- Stable hierarchy lock key: categories are serialized with a transaction-level advisory lock.
  -- This is only a serialization aid; the real correctness guarantee still comes from the
  -- recursive validation and the unique normalized slug / hierarchy checks below.
  perform pg_advisory_xact_lock(20260806, 3);

  if tg_op = 'INSERT' then
    new.name := btrim(coalesce(new.name, ''));
    new.description := nullif(btrim(coalesce(new.description, '')), '');
    new.icon := nullif(btrim(coalesce(new.icon, '')), '');
    new.display_order := coalesce(new.display_order, 0);
    new.show_on_homepage := coalesce(new.show_on_homepage, false);
    v_source_slug := coalesce(nullif(btrim(new.slug), ''), new.name);
    new.status := case
      when lower(coalesce(btrim(new.status), 'active')) = 'hidden' then 'hidden'
      else 'active'
    end;
  else
    new.name := btrim(coalesce(new.name, old.name, ''));
    new.description := nullif(btrim(coalesce(new.description, old.description, '')), '');
    new.icon := nullif(btrim(coalesce(new.icon, old.icon, '')), '');
    new.display_order := coalesce(new.display_order, old.display_order, 0);
    new.show_on_homepage := coalesce(new.show_on_homepage, old.show_on_homepage, false);
    v_source_slug := coalesce(nullif(btrim(new.slug), ''), nullif(btrim(old.slug), ''));
    new.status := case
      when lower(coalesce(btrim(new.status), btrim(old.status), 'active')) = 'hidden' then 'hidden'
      else 'active'
    end;
  end if;

  if new.name = '' then
    raise exception 'Category name is required.';
  end if;

  v_source_slug := lower(btrim(coalesce(v_source_slug, '')));
  new.slug := trim(both '-' from regexp_replace(v_source_slug, '[^a-z0-9]+', '-', 'g'));

  if new.slug = '' then
    raise exception 'Category slug cannot be empty after normalization.';
  end if;

  if new.deleted_at is not null then
    new.status := 'hidden';
  end if;

  if tg_op = 'INSERT' then
    v_self_id := new.id;
  else
    v_self_id := old.id;
  end if;

  if new.parent_id is not null then
    if new.parent_id = v_self_id then
      raise exception 'A category cannot be its own parent.';
    end if;

    select *
      into v_parent
    from public.categories c
    where c.id = new.parent_id;

    if not found then
      raise exception 'Parent category must exist.';
    end if;

    if v_parent.deleted_at is not null then
      raise exception 'Deleted categories cannot be used as parents.';
    end if;

    if new.status = 'active'
       and new.deleted_at is null
       and v_parent.status <> 'active' then
      raise exception 'Active categories cannot use hidden parents.';
    end if;

    -- Walk parent links with a visited-path guard so corrupted legacy hierarchies cannot loop
    -- forever. The depth cap is a safety limit, not the primary correctness guarantee.
    with recursive ancestors as (
      select
        c.id,
        c.parent_id,
        array[c.id] as visited,
        false as cycle_detected
      from public.categories c
      where c.id = new.parent_id

      union all

      select
        p.id,
        p.parent_id,
        a.visited || p.id,
        p.id = any(a.visited)
      from public.categories p
      join ancestors a
        on p.id = a.parent_id
      where not a.cycle_detected
        and cardinality(a.visited) < 100
    )
    select
      bool_or(v_self_id = any(visited)),
      bool_or(cycle_detected),
      bool_or(cardinality(visited) = 100 and parent_id is not null)
    into v_cycle_found, v_existing_cycle_detected, v_depth_limit_reached
    from ancestors;

    if v_cycle_found then
      raise exception 'Circular category relationships are not allowed.';
    end if;

    if v_existing_cycle_detected then
      raise exception 'Existing category hierarchy contains a cycle.';
    end if;

    if v_depth_limit_reached then
      raise exception 'Category hierarchy exceeds the supported depth.';
    end if;
  end if;

  if tg_op = 'UPDATE'
     and (
       (new.status = 'hidden' and old.status <> 'hidden')
       or (new.deleted_at is not null and old.deleted_at is null)
     ) then
    -- Recursive cleanup updates are intentionally kept out of this trigger path.
    -- If an internal maintenance path ever needs to adjust child rows directly,
    -- it must do so through a separate controlled path that explicitly bypasses
    -- this row-level validation with pg_trigger_depth().
    select exists (
      select 1
      from public.categories child_category
      where child_category.parent_id = old.id
        and child_category.deleted_at is null
        and child_category.status = 'active'
    ) into v_has_visible_children;

    if v_has_visible_children then
      raise exception 'Move, hide, or delete child categories before hiding or deleting this category.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_categories_normalize_write on public.categories;
create trigger trg_categories_normalize_write
before insert or update on public.categories
for each row execute function private.normalize_categories_write();

drop trigger if exists trg_categories_updated_at on public.categories;
create trigger trg_categories_updated_at
before update on public.categories
for each row execute function private.set_updated_at();

drop policy if exists categories_select_public on public.categories;
create policy categories_select_public
on public.categories
for select
to anon, authenticated
using (deleted_at is null and status = 'active');

drop policy if exists categories_select_admin on public.categories;
create policy categories_select_admin
on public.categories
for select
to authenticated
using ((select private.is_admin_user()));

drop policy if exists categories_insert_admin on public.categories;
create policy categories_insert_admin
on public.categories
for insert
to authenticated
with check ((select private.is_admin_user()));

drop policy if exists categories_update_admin on public.categories;
create policy categories_update_admin
on public.categories
for update
to authenticated
using ((select private.is_admin_user()))
with check ((select private.is_admin_user()));

revoke all on function private.normalize_categories_write() from public;
revoke all on function private.normalize_categories_write() from anon;
revoke all on function private.normalize_categories_write() from authenticated;

grant select on public.categories to anon;
grant select, insert, update on public.categories to authenticated;

revoke all on public.categories from public;
revoke all on public.categories from anon;

commit;
