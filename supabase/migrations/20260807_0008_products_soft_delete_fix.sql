begin;

drop function if exists public.set_product_deleted_at(uuid, timestamptz);
drop function if exists public.restore_product(uuid);

create function public.set_product_deleted_at(p_product_id uuid, p_deleted_at timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_saved public.products%rowtype;
begin
  if not private.is_admin_user() then
    raise exception 'Only active administrators can update product visibility.';
  end if;

  update public.products as p
  set deleted_at = p_deleted_at
  where p.id = p_product_id
  returning p.*
  into v_saved;

  if not found then
    raise exception 'Product id does not exist.';
  end if;

  return jsonb_build_object('product', to_jsonb(v_saved));
end;
$function$;

create function public.restore_product(p_product_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_saved public.products%rowtype;
begin
  if not private.is_admin_user() then
    raise exception 'Only active administrators can update product visibility.';
  end if;

  update public.products as p
  set deleted_at = null
  where p.id = p_product_id
  returning p.*
  into v_saved;

  if not found then
    raise exception 'Product id does not exist.';
  end if;

  return jsonb_build_object('product', to_jsonb(v_saved));
end;
$function$;

revoke all on function public.set_product_deleted_at(uuid, timestamptz) from public;
revoke all on function public.set_product_deleted_at(uuid, timestamptz) from anon;
revoke all on function public.set_product_deleted_at(uuid, timestamptz) from authenticated;
grant execute on function public.set_product_deleted_at(uuid, timestamptz) to authenticated;

revoke all on function public.restore_product(uuid) from public;
revoke all on function public.restore_product(uuid) from anon;
revoke all on function public.restore_product(uuid) from authenticated;
grant execute on function public.restore_product(uuid) to authenticated;

commit;
