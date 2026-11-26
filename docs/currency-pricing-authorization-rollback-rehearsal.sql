begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Rehearsal only: run migration 0064 in this transaction, verify, then roll it
-- back. The DO block is intentionally copied from the permanent migration.
do $$
declare
  v_signature text;
  v_definition text;
  v_old_guard text := 'if (select coalesce(current_setting(''request.jwt.claim.role'', true), '''') <> ''service_role'') then';
  v_new_guard text := 'if coalesce(auth.role(), '''') <> ''service_role'' then';
  v_signatures text[] := array[
    'public.save_priced_product_bundle(jsonb,jsonb,uuid)',
    'public.apply_product_currency_repricing(uuid,uuid,numeric,text,uuid,uuid[],jsonb,integer)',
    'public.get_exchange_rate_settings()',
    'public.claim_exchange_rate_refresh(integer)',
    'public.release_exchange_rate_refresh(uuid)',
    'public.update_exchange_rate_settings(text,numeric,numeric,text,timestamptz,timestamptz,timestamptz,uuid,uuid,uuid,uuid,text)'
  ];
begin
  foreach v_signature in array v_signatures loop
    select pg_get_functiondef(v_signature::regprocedure) into v_definition;
    if v_definition is null then raise exception 'Missing RPC: %', v_signature; end if;
    if position(v_old_guard in v_definition) = 0 then raise exception 'Legacy guard missing: %', v_signature; end if;
    execute replace(v_definition, v_old_guard, v_new_guard);
  end loop;
end;
$$;

do $$
declare
  v_signature text;
  v_definition text;
  v_signatures text[] := array[
    'public.save_priced_product_bundle(jsonb,jsonb,uuid)',
    'public.apply_product_currency_repricing(uuid,uuid,numeric,text,uuid,uuid[],jsonb,integer)',
    'public.get_exchange_rate_settings()',
    'public.claim_exchange_rate_refresh(integer)',
    'public.release_exchange_rate_refresh(uuid)',
    'public.update_exchange_rate_settings(text,numeric,numeric,text,timestamptz,timestamptz,timestamptz,uuid,uuid,uuid,uuid,text)'
  ];
begin
  foreach v_signature in array v_signatures loop
    select pg_get_functiondef(v_signature::regprocedure) into v_definition;
    if position('auth.role()' in v_definition) = 0 then raise exception 'Modern guard missing: %', v_signature; end if;
  end loop;
end;
$$;

revoke all on function public.save_priced_product_bundle(jsonb,jsonb,uuid) from public, anon, authenticated;
grant execute on function public.save_priced_product_bundle(jsonb,jsonb,uuid) to service_role;
revoke all on function public.apply_product_currency_repricing(uuid,uuid,numeric,text,uuid,uuid[],jsonb,integer) from public, anon, authenticated;
grant execute on function public.apply_product_currency_repricing(uuid,uuid,numeric,text,uuid,uuid[],jsonb,integer) to service_role;
revoke all on function public.get_exchange_rate_settings() from public, anon, authenticated;
grant execute on function public.get_exchange_rate_settings() to service_role;
revoke all on function public.claim_exchange_rate_refresh(integer) from public, anon, authenticated;
grant execute on function public.claim_exchange_rate_refresh(integer) to service_role;
revoke all on function public.release_exchange_rate_refresh(uuid) from public, anon, authenticated;
grant execute on function public.release_exchange_rate_refresh(uuid) to service_role;
revoke all on function public.update_exchange_rate_settings(text,numeric,numeric,text,timestamptz,timestamptz,timestamptz,uuid,uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.update_exchange_rate_settings(text,numeric,numeric,text,timestamptz,timestamptz,timestamptz,uuid,uuid,uuid,uuid,text) to service_role;

rollback;
