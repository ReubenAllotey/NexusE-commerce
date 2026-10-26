begin;

-- Replace the legacy shipment-track notification function with a version that
-- uses the current notification contract and supports verified guest orders.
-- The existing shipment_track_event_notification trigger is preserved.
create or replace function private.handle_shipment_track_event_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_track record;
  v_order record;
  v_source_key text := format('shipment-track-event:%s:', new.id);
  v_freight_label text;
  v_title text;
  v_message text;
  v_action_url text;
begin
  select st.*, ib.batch_number
    into v_track
  from public.shipment_tracks st
  join public.import_batches ib on ib.id = st.batch_id
  where st.id = new.shipment_track_id;

  if v_track.id is null or v_track.archived_at is not null then
    return new;
  end if;

  v_freight_label := case when v_track.freight_type = 'air' then 'Air' else 'Sea' end;
  v_title := case
    when lower(coalesce(new.current_status, '')) = 'delivered' then 'Shipment delivered'
    when lower(coalesce(new.current_status, '')) = 'out_for_delivery' then 'Shipment out for delivery'
    when lower(coalesce(new.current_status, '')) = 'arrived_in_ghana' then 'Shipment arrived in Ghana'
    when lower(coalesce(new.current_status, '')) = 'shipped_from_china' then 'Shipment dispatched from China'
    when lower(coalesce(new.title, '')) like '%custom%'
      or lower(coalesce(new.title, '')) like '%clear%' then 'Shipment cleared and ready for delivery'
    else 'Shipment update'
  end;
  v_message := format(
    'Your %s freight shipment for batch %s has been updated: %s. %s',
    v_freight_label,
    v_track.batch_number,
    coalesce(nullif(btrim(new.title), ''), 'Shipment progress updated'),
    coalesce(nullif(btrim(new.message), ''), 'Your shipment tracking timeline has been updated.')
  );
  v_action_url := format(
    '/profile/shipments?batch=%s&freight=%s',
    v_track.batch_number,
    v_track.freight_type
  );

  for v_order in
    select distinct o.user_id, o.id as order_id, o.order_number,
      lower(nullif(btrim(o.customer_email), '')) as customer_email,
      coalesce(nullif(btrim(o.customer_name), ''), 'Customer') as customer_name
    from public.orders o
    join public.order_items oi on oi.order_id = o.id
    where lower(btrim(coalesce(o.batch_number, ''))) = lower(btrim(v_track.batch_number))
      and oi.freight_type = v_track.freight_type
      and (
        exists (
          select 1 from public.payments p
          where p.order_id = o.id
            and lower(btrim(coalesce(p.payment_purpose, ''))) = 'order'
            and lower(coalesce(p.status, '')) = 'successful'
        )
        or (
          o.checkout_group_id is not null
          and exists (
            select 1
            from public.orders sibling
            join public.payments sibling_payment on sibling_payment.order_id = sibling.id
            where sibling.checkout_group_id = o.checkout_group_id
              and (
                (o.user_id is not null and sibling.user_id = o.user_id)
                or (
                  o.user_id is null
                  and sibling.user_id is null
                  and lower(btrim(coalesce(sibling.customer_email, ''))) = lower(btrim(coalesce(o.customer_email, '')))
                )
              )
              and lower(btrim(coalesce(sibling_payment.payment_purpose, ''))) = 'order'
              and lower(coalesce(sibling_payment.status, '')) = 'successful'
          )
        )
      )
      and lower(coalesce(o.status, '')) not in ('cancelled', 'canceled', 'failed', 'abandoned')
      and (o.user_id is not null or nullif(btrim(o.customer_email), '') is not null)
  loop
    if v_order.user_id is null then
      insert into public.notifications (
        user_id, recipient_email, recipient_name, category, title, message,
        order_id, shipment_id, payment_id, action_url, action_label,
        action_description, source_type, source_key, is_read, read_at
      ) values (
        null, v_order.customer_email, v_order.customer_name, 'shipping', v_title, v_message,
        v_order.order_id, null, null, null, null,
        format('Shipment %s %s freight tracking update for order %s.', v_track.batch_number, v_freight_label, coalesce(v_order.order_number, v_order.order_id::text)),
        'shipment_event', v_source_key || v_order.order_id::text, false, null
      ) on conflict do nothing;
    else
      perform private.upsert_notification(
        v_order.user_id,
        'shipping',
        v_title,
        v_message,
        'shipment_event',
        v_source_key || v_order.order_id::text,
        v_order.order_id,
        null,
        null,
        v_action_url,
        'View shipment tracking',
        format('Shipment %s %s freight tracking for order %s.', v_track.batch_number, v_freight_label, coalesce(v_order.order_number, v_order.order_id::text))
      );
    end if;
  end loop;

  return new;
end;
$function$;

revoke all on function private.handle_shipment_track_event_notification() from public, anon, authenticated;

commit;
