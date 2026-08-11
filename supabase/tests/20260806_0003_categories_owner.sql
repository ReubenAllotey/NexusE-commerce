-- OWNER-ONLY / STAGING-ONLY category verification.
-- Run this file only in a database-owner SQL Editor context.
-- These tests intentionally exercise the trigger path that requires table ownership.

do $$
declare
  v_corrupt_cycle_parent_id uuid;
  v_corrupt_cycle_child_id uuid;
  v_depth_previous_id uuid;
  v_depth_leaf_id uuid;
  v_count integer;
begin
  -- Corrupted legacy hierarchy data should fail safely instead of looping forever.
  alter table public.categories disable trigger trg_categories_normalize_write;
  begin
    insert into public.categories (
      name,
      slug,
      description,
      icon,
      status,
      display_order,
      show_on_homepage
    ) values (
      'Corrupt Cycle Parent',
      'corrupt-cycle-parent',
      'Used to verify corrupted hierarchy handling.',
      'electronics',
      'active',
      22,
      false
    )
    returning id into v_corrupt_cycle_parent_id;

    insert into public.categories (
      name,
      slug,
      description,
      icon,
      status,
      parent_id,
      display_order,
      show_on_homepage
    ) values (
      'Corrupt Cycle Child',
      'corrupt-cycle-child',
      'Used to verify corrupted hierarchy handling.',
      'electronics',
      'active',
      v_corrupt_cycle_parent_id,
      23,
      false
    )
    returning id into v_corrupt_cycle_child_id;

    update public.categories
    set parent_id = v_corrupt_cycle_child_id
    where id = v_corrupt_cycle_parent_id;
  exception
    when others then
      alter table public.categories enable trigger trg_categories_normalize_write;
      raise;
  end;
  alter table public.categories enable trigger trg_categories_normalize_write;

  begin
    update public.categories
    set display_order = display_order
    where id = v_corrupt_cycle_parent_id;

    raise exception 'Expected corrupted hierarchy cycle to be rejected safely.';
  exception
    when SQLSTATE 'P0001' then
      if position('Existing category hierarchy contains a cycle.' in SQLERRM) = 0 then
        raise exception 'Unexpected rejection for corrupted hierarchy cycle: %', SQLERRM;
      end if;
    when others then
      raise exception 'Unexpected SQL error for corrupted hierarchy cycle: %', SQLERRM;
  end;

  -- Depth-limited ancestor traversal should stop and raise a clear error.
  alter table public.categories disable trigger trg_categories_normalize_write;
  begin
    v_depth_previous_id := null;

    for v_count in 1..102 loop
      insert into public.categories (
        name,
        slug,
        description,
        icon,
        status,
        parent_id,
        display_order,
        show_on_homepage
      ) values (
        format('Depth Node %s', v_count),
        format('depth-node-%s', v_count),
        'Used to verify hierarchy depth protection.',
        'home',
        'active',
        v_depth_previous_id,
        30 + v_count,
        false
      )
      returning id into v_depth_leaf_id;

      if v_count = 1 then
        null;
      end if;

      v_depth_previous_id := v_depth_leaf_id;
    end loop;
  exception
    when others then
      alter table public.categories enable trigger trg_categories_normalize_write;
      raise;
  end;
  alter table public.categories enable trigger trg_categories_normalize_write;

  begin
    update public.categories
    set display_order = display_order
    where id = v_depth_leaf_id;

    raise exception 'Expected hierarchy depth limit to be rejected.';
  exception
    when SQLSTATE 'P0001' then
      if position('Category hierarchy exceeds the supported depth.' in SQLERRM) = 0 then
        raise exception 'Unexpected rejection for hierarchy depth limit: %', SQLERRM;
      end if;
    when others then
      raise exception 'Unexpected SQL error for hierarchy depth limit: %', SQLERRM;
  end;

  delete from public.categories
  where id in (v_corrupt_cycle_parent_id, v_corrupt_cycle_child_id, v_depth_leaf_id);
end;
$$;

