begin;

create extension if not exists pgcrypto;
create schema if not exists private;

create table public.carts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.cart_items (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references public.carts(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  quantity integer not null,
  selected_color text,
  selected_size text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cart_items_quantity_gt_zero check (quantity > 0)
);

create table public.wishlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.wishlist_items (
  id uuid primary key default gen_random_uuid(),
  wishlist_id uuid not null references public.wishlists(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  created_at timestamptz not null default now()
);

create unique index cart_items_one_line_per_variant_idx
  on public.cart_items (
    cart_id,
    product_id,
    coalesce(selected_color, ''),
    coalesce(selected_size, '')
  );

create index cart_items_cart_id_idx on public.cart_items (cart_id);
create index cart_items_product_id_idx on public.cart_items (product_id);

create unique index wishlist_items_one_product_per_wishlist_idx
  on public.wishlist_items (wishlist_id, product_id);

create index wishlist_items_wishlist_id_idx on public.wishlist_items (wishlist_id);
create index wishlist_items_product_id_idx on public.wishlist_items (product_id);

create or replace function private.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

create or replace function private.normalize_cart_variant_text(value text)
returns text
language sql
immutable
as $function$
  select nullif(btrim(value), '');
$function$;

create trigger carts_set_updated_at
before update on public.carts
for each row
execute function private.set_updated_at();

create trigger cart_items_set_updated_at
before update on public.cart_items
for each row
execute function private.set_updated_at();

create trigger wishlists_set_updated_at
before update on public.wishlists
for each row
execute function private.set_updated_at();

alter table public.carts enable row level security;
alter table public.cart_items enable row level security;
alter table public.wishlists enable row level security;
alter table public.wishlist_items enable row level security;

create policy carts_select_own
  on public.carts
  for select
  to authenticated
  using (user_id = auth.uid());

create policy carts_insert_own
  on public.carts
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy carts_update_own
  on public.carts
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy carts_delete_own
  on public.carts
  for delete
  to authenticated
  using (user_id = auth.uid());

create policy cart_items_select_own
  on public.cart_items
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.carts as c
      where c.id = cart_items.cart_id
        and c.user_id = auth.uid()
    )
  );

create policy cart_items_insert_own
  on public.cart_items
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.carts as c
      where c.id = cart_items.cart_id
        and c.user_id = auth.uid()
    )
  );

create policy cart_items_update_own
  on public.cart_items
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.carts as c
      where c.id = cart_items.cart_id
        and c.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.carts as c
      where c.id = cart_items.cart_id
        and c.user_id = auth.uid()
    )
  );

create policy cart_items_delete_own
  on public.cart_items
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.carts as c
      where c.id = cart_items.cart_id
        and c.user_id = auth.uid()
    )
  );

create policy wishlists_select_own
  on public.wishlists
  for select
  to authenticated
  using (user_id = auth.uid());

create policy wishlists_insert_own
  on public.wishlists
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy wishlists_update_own
  on public.wishlists
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy wishlists_delete_own
  on public.wishlists
  for delete
  to authenticated
  using (user_id = auth.uid());

create policy wishlist_items_select_own
  on public.wishlist_items
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.wishlists as w
      where w.id = wishlist_items.wishlist_id
        and w.user_id = auth.uid()
    )
  );

create policy wishlist_items_insert_own
  on public.wishlist_items
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.wishlists as w
      where w.id = wishlist_items.wishlist_id
        and w.user_id = auth.uid()
    )
  );

create policy wishlist_items_update_own
  on public.wishlist_items
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.wishlists as w
      where w.id = wishlist_items.wishlist_id
        and w.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.wishlists as w
      where w.id = wishlist_items.wishlist_id
        and w.user_id = auth.uid()
    )
  );

create policy wishlist_items_delete_own
  on public.wishlist_items
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.wishlists as w
      where w.id = wishlist_items.wishlist_id
        and w.user_id = auth.uid()
    )
  );

revoke all on function private.set_updated_at() from public;
revoke all on function private.set_updated_at() from anon;
revoke all on function private.set_updated_at() from authenticated;
revoke all on function private.normalize_cart_variant_text(text) from public;
revoke all on function private.normalize_cart_variant_text(text) from anon;
revoke all on function private.normalize_cart_variant_text(text) from authenticated;

revoke all on table public.carts from public;
revoke all on table public.carts from anon;
grant select, insert, update, delete on table public.carts to authenticated;

revoke all on table public.cart_items from public;
revoke all on table public.cart_items from anon;
grant select, insert, update, delete on table public.cart_items to authenticated;

revoke all on table public.wishlists from public;
revoke all on table public.wishlists from anon;
grant select, insert, update, delete on table public.wishlists to authenticated;

revoke all on table public.wishlist_items from public;
revoke all on table public.wishlist_items from anon;
grant select, insert, update, delete on table public.wishlist_items to authenticated;

commit;
