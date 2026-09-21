begin;

-- Keep the original order payment and later shipping-balance payments
-- distinguishable without changing existing payment history.
alter table public.payments
  add column if not exists payment_purpose text not null default 'order';

alter table public.payments
  drop constraint if exists payments_payment_purpose_check;

alter table public.payments
  add constraint payments_payment_purpose_check
  check (payment_purpose in ('order', 'shipping'));

create index if not exists payments_order_purpose_status_idx
  on public.payments (order_id, payment_purpose, status);

commit;
