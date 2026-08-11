begin;

lock table public.profiles in access exclusive mode;

do $bootstrap$
declare
  v_target_user_id uuid := '745790e1-420c-472e-b431-0ce26bda6cc9';
  v_target_email text := 'admin@nexus.com';
  v_match_count integer;
  v_matched_profile record;
  v_rows_updated integer;
begin
  select count(*)
    into v_match_count
  from public.profiles
  where id = v_target_user_id
    and lower(email) = lower(btrim(v_target_email))
    and status = 'active';

  if v_match_count <> 1 then
    raise exception 'Exactly one active profile must match the supplied UUID and email before bootstrap.';
  end if;

  select id, email, role, status
    into v_matched_profile
  from public.profiles
  where id = v_target_user_id
    and lower(email) = lower(btrim(v_target_email))
    and status = 'active';

  raise notice 'Bootstrap target matched: id=%, email=%, role=%, status=%',
    v_matched_profile.id,
    v_matched_profile.email,
    v_matched_profile.role,
    v_matched_profile.status;

  alter table public.profiles disable trigger trg_profiles_enforce_rules;

  update public.profiles
  set role = 'admin'
  where id = v_target_user_id
    and lower(email) = lower(btrim(v_target_email))
    and status = 'active';

  get diagnostics v_rows_updated = row_count;

  if v_rows_updated <> 1 then
    raise exception 'Bootstrap promotion must affect exactly one profile.';
  end if;

  alter table public.profiles enable trigger trg_profiles_enforce_rules;
exception
  when others then
    alter table public.profiles enable trigger trg_profiles_enforce_rules;
    raise;
end;
$bootstrap$;

commit;
