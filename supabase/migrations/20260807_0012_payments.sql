begin;

create extension if not exists pgcrypto;

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  provider text not null default 'paystack',
  payment_method text,
  payment_network text,
  payment_phone_number text,
  provider_reference text not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'successful', 'failed', 'cancelled')),
  amount numeric not null
    check (amount >= 0),
  currency text not null default 'GHS'
    check (btrim(currency) <> ''),
  amount_minor bigint not null
    check (amount_minor >= 0),
  authorization_url text,
  access_code text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payments_provider_not_blank check (btrim(provider) <> ''),
  constraint payments_provider_reference_not_blank check (btrim(provider_reference) <> '')
);

create unique index payments_provider_reference_idx
  on public.payments (provider_reference);

create index payments_order_id_idx
  on public.payments (order_id);

create index payments_user_id_idx
  on public.payments (user_id);

create index payments_status_idx
  on public.payments (status);

create index payments_created_at_idx
  on public.payments (created_at);

create index payments_paid_at_idx
  on public.payments (paid_at);

create table public.payment_events (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete cascade,
  provider_event_type text not null default '',
  provider_reference text not null default '',
  status text not null default '',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint payment_events_provider_event_type_not_blank check (btrim(provider_event_type) <> ''),
  constraint payment_events_provider_reference_not_blank check (btrim(provider_reference) <> '')
);

create unique index payment_events_unique_event_idx
  on public.payment_events (payment_id, provider_event_type, provider_reference, status);

create index payment_events_payment_id_idx
  on public.payment_events (payment_id);

create index payment_events_provider_reference_idx
  on public.payment_events (provider_reference);

create index payment_events_created_at_idx
  on public.payment_events (created_at);

drop trigger if exists payments_set_updated_at on public.payments;
create trigger payments_set_updated_at
before update on public.payments
for each row
execute function private.set_updated_at();

alter table public.payments enable row level security;
alter table public.payment_events enable row level security;

drop policy if exists payments_select_own on public.payments;
create policy payments_select_own
  on public.payments
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists payments_select_admin on public.payments;
create policy payments_select_admin
  on public.payments
  for select
  to authenticated
  using (private.is_admin_user());

revoke all on table public.payments from public;
revoke all on table public.payments from anon;
revoke all on table public.payments from authenticated;
grant select on table public.payments to anon;
grant select on table public.payments to authenticated;

revoke all on table public.payment_events from public;
revoke all on table public.payment_events from anon;
revoke all on table public.payment_events from authenticated;

commit;
