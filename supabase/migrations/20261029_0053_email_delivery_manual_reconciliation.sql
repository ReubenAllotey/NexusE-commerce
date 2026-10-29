begin;

create table if not exists public.notification_email_reconciliation_events (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.notification_email_deliveries(id) on delete restrict,
  decision text not null check (decision in ('mark_sent', 'requeue')),
  provider_message_id text,
  reason text not null check (btrim(reason) <> '' and length(reason) <= 1000),
  admin_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists notification_email_reconciliation_events_delivery_idx
  on public.notification_email_reconciliation_events (delivery_id, created_at desc);

alter table public.notification_email_reconciliation_events enable row level security;
revoke all on table public.notification_email_reconciliation_events from public, anon, authenticated, service_role;

create or replace function public.reconcile_notification_email_delivery(
  p_delivery_id uuid,
  p_decision text,
  p_reason text,
  p_admin_id uuid,
  p_provider_message_id text default null
)
returns table (
  delivery_id uuid,
  status text,
  attempts integer,
  max_attempts integer,
  audit_id uuid
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_delivery public.notification_email_deliveries%rowtype;
  v_audit_id uuid;
  v_decision text := lower(btrim(coalesce(p_decision, '')));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_provider_message_id text := nullif(btrim(coalesce(p_provider_message_id, '')), '');
begin
  if p_delivery_id is null then
    raise exception 'delivery_id is required';
  end if;
  if p_admin_id is null then
    raise exception 'admin_id is required';
  end if;
  if v_decision not in ('mark_sent', 'requeue') then
    raise exception 'decision must be mark_sent or requeue';
  end if;
  if v_reason = '' or length(v_reason) > 1000 then
    raise exception 'a reconciliation reason is required';
  end if;
  if v_decision = 'mark_sent' and v_provider_message_id is not null and length(v_provider_message_id) > 255 then
    raise exception 'provider_message_id is too long';
  end if;

  select * into v_delivery
  from public.notification_email_deliveries
  where id = p_delivery_id
  for update;

  if not found then
    raise exception 'email delivery was not found';
  end if;
  if v_delivery.status <> 'manual_review' then
    raise exception 'only manual_review deliveries can be reconciled';
  end if;

  if v_decision = 'requeue' and v_delivery.attempts >= v_delivery.max_attempts then
    raise exception 'the delivery has reached its retry limit';
  end if;

  insert into public.notification_email_reconciliation_events (
    delivery_id, decision, provider_message_id, reason, admin_id
  ) values (
    v_delivery.id, v_decision, v_provider_message_id, v_reason, p_admin_id
  ) returning id into v_audit_id;

  if v_decision = 'mark_sent' then
    update public.notification_email_deliveries
    set status = 'sent',
        sent_at = coalesce(sent_at, now()),
        provider = 'brevo',
        provider_message_id = coalesce(v_provider_message_id, provider_message_id),
        locked_at = null,
        lock_token = null,
        last_error = null,
        updated_at = now()
    where id = v_delivery.id and status = 'manual_review';
  else
    update public.notification_email_deliveries
    set status = 'pending',
        next_attempt_at = now(),
        locked_at = null,
        lock_token = null,
        last_error = left('Manually requeued after provider non-acceptance: ' || v_reason, 500),
        updated_at = now()
    where id = v_delivery.id and status = 'manual_review';
  end if;

  if not found then
    raise exception 'email delivery changed before reconciliation completed';
  end if;

  return query
  select d.id, d.status, d.attempts, d.max_attempts, v_audit_id
  from public.notification_email_deliveries d
  where d.id = v_delivery.id;
end;
$function$;

revoke all on function public.reconcile_notification_email_delivery(uuid, text, text, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.reconcile_notification_email_delivery(uuid, text, text, uuid, text)
  to service_role;

commit;
