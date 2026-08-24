begin;

-- Safe cleanup for production launch review:
-- - preserves admin accounts
-- - removes customer/test accounts
-- - removes customer/test transactional rows
-- - leaves products, categories, merch, banners, and schema untouched

create temp table cleanup_admin_ids on commit drop as
select p.id, p.email
from public.profiles as p
where p.role = 'admin';

do $$
begin
  if not exists (
    select 1
    from cleanup_admin_ids
  ) then
    raise exception 'No admin profiles were found. Abort cleanup.';
  end if;
end;
$$;

create temp table cleanup_customer_ids on commit drop as
select p.id, p.email
from public.profiles as p
where p.role = 'customer'
  and p.id not in (select a.id from cleanup_admin_ids as a);

-- Remove child tables first so FK restrictions do not block the cleanup.
delete from public.shipment_events;
delete from public.shipments;
delete from public.payment_events;
delete from public.payments;
delete from public.order_items;
delete from public.orders;

delete from public.support_messages
where user_id in (select c.id from cleanup_customer_ids as c);

delete from public.notifications
where user_id in (select c.id from cleanup_customer_ids as c);

delete from public.cart_items
where cart_id in (
  select c.id
  from public.carts as c
  where c.user_id in (select t.id from cleanup_customer_ids as t)
);

delete from public.carts
where user_id in (select c.id from cleanup_customer_ids as c);

delete from public.wishlist_items
where wishlist_id in (
  select w.id
  from public.wishlists as w
  where w.user_id in (select t.id from cleanup_customer_ids as t)
);

delete from public.wishlists
where user_id in (select c.id from cleanup_customer_ids as c);

delete from public.addresses
where user_id in (select c.id from cleanup_customer_ids as c);

delete from public.profiles
where id in (select c.id from cleanup_customer_ids as c);

delete from auth.users
where id in (select c.id from cleanup_customer_ids as c);

-- Optional contact-message cleanup:
-- If you decide customer support/contact submissions should be removed too,
-- uncomment the block below. It is intentionally left off by default because
-- contact messages may be kept separately from commerce test data.
--
-- delete from public.contact_messages
-- where user_id in (select c.id from cleanup_customer_ids as c);

commit;
