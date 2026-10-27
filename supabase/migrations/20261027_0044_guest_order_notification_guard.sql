begin;

-- Guest orders are intentionally not linked to a profile. Their persisted
-- payment and order updates must not fail because the legacy order-status
-- notification helper requires a user_id.
create or replace function private.handle_order_notification_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_status text := lower(btrim(coalesce(new.status, '')));
  v_status_label text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  -- Guest order notifications use the server-side guest-aware notification
  -- path. Preserve the legacy user notification behavior for registered users.
  if new.user_id is null then
    return new;
  end if;

  v_status_label := case v_status
    when 'pending' then 'Pending'
    when 'pending_payment' then 'Pending payment'
    when 'processing' then 'Processing'
    when 'in_transit' then 'In transit'
    when 'delivered' then 'Delivered'
    when 'cancelled' then 'Cancelled'
    else initcap(replace(v_status, '_', ' '))
  end;

  perform private.upsert_notification(
    new.user_id,
    'orders',
    case v_status
      when 'delivered' then 'Order delivered'
      when 'cancelled' then 'Order cancelled'
      when 'processing' then 'Order processing'
      when 'in_transit' then 'Order on the way'
      else 'Order updated'
    end,
    format('Order %s is now %s.', new.order_number, lower(v_status_label)),
    'order_status',
    'order:' || new.id::text || ':status:' || v_status,
    new.id,
    null,
    null,
    '/profile/orders',
    'View order',
    'Open the order details page.'
  );

  return new;
end;
$function$;

revoke all on function private.handle_order_notification_change() from public, anon, authenticated;

commit;
