begin;

revoke all privileges on table public.categories from authenticated;
revoke all privileges on table public.categories from anon;
revoke all privileges on table public.categories from public;

grant select on table public.categories to anon;
grant select, insert, update on table public.categories to authenticated;

commit;
