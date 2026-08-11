begin;

create extension if not exists pgcrypto;

create table public.support_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  order_id uuid references public.orders(id) on delete set null,
  subject text not null,
  message text not null,
  category text,
  status text not null default 'new',
  priority text,
  admin_reply text,
  replied_at timestamptz,
  replied_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint support_messages_subject_not_blank check (btrim(subject) <> ''),
  constraint support_messages_message_not_blank check (btrim(message) <> ''),
  constraint support_messages_status_check check (status in ('new', 'open', 'resolved')),
  constraint support_messages_category_not_blank check (category is null or btrim(category) <> ''),
  constraint support_messages_priority_not_blank check (priority is null or btrim(priority) <> '')
);

create table public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  full_name text not null,
  email text not null,
  phone_number text,
  subject text not null,
  message text not null,
  status text not null default 'new',
  admin_reply text,
  replied_at timestamptz,
  replied_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contact_messages_full_name_not_blank check (btrim(full_name) <> ''),
  constraint contact_messages_email_not_blank check (btrim(email) <> ''),
  constraint contact_messages_subject_not_blank check (btrim(subject) <> ''),
  constraint contact_messages_message_not_blank check (btrim(message) <> ''),
  constraint contact_messages_status_check check (status in ('new', 'open', 'resolved'))
);

create index support_messages_user_id_idx
  on public.support_messages (user_id);

create index support_messages_status_idx
  on public.support_messages (status);

create index support_messages_created_at_idx
  on public.support_messages (created_at);

create index support_messages_order_id_idx
  on public.support_messages (order_id);

create index contact_messages_user_id_idx
  on public.contact_messages (user_id);

create index contact_messages_status_idx
  on public.contact_messages (status);

create index contact_messages_created_at_idx
  on public.contact_messages (created_at);

create index contact_messages_email_idx
  on public.contact_messages (email);

create or replace function public.create_support_message(payload jsonb)
returns public.support_messages
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_order_id uuid;
  v_subject text;
  v_message text;
  v_category text;
  v_priority text;
  v_support_message public.support_messages%rowtype;
begin
  if v_user_id is null then
    raise exception 'Please sign in to send a support message.';
  end if;

  if not exists (
    select 1
    from public.profiles as p
    where p.id = v_user_id
      and p.status = 'active'
  ) then
    raise exception 'Only active customers can send support messages.';
  end if;

  v_order_id := nullif(btrim(coalesce(payload ->> 'orderId', payload ->> 'order_id')), '')::uuid;
  v_subject := btrim(coalesce(payload ->> 'subject', payload ->> 'title', ''));
  v_message := btrim(coalesce(payload ->> 'message', ''));
  v_category := nullif(btrim(coalesce(payload ->> 'category', '')), '');
  v_priority := nullif(btrim(coalesce(payload ->> 'priority', '')), '');

  if v_subject = '' then
    raise exception 'A support subject is required.';
  end if;

  if v_message = '' then
    raise exception 'A support message is required.';
  end if;

  if v_order_id is not null and not exists (
    select 1
    from public.orders as o
    where o.id = v_order_id
      and o.user_id = v_user_id
  ) then
    raise exception 'The selected order does not belong to your account.';
  end if;

  insert into public.support_messages as sm (
    user_id,
    order_id,
    subject,
    message,
    category,
    status,
    priority
  ) values (
    v_user_id,
    v_order_id,
    v_subject,
    v_message,
    v_category,
    'new',
    v_priority
  )
  returning * into v_support_message;

  return v_support_message;
end;
$function$;

create or replace function public.reply_to_support_message(
  p_message_id uuid,
  p_admin_reply text,
  p_status text default 'open'
)
returns public.support_messages
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_reply text := btrim(coalesce(p_admin_reply, ''));
  v_status text := lower(btrim(coalesce(p_status, 'open')));
  v_support_message public.support_messages%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Please sign in to continue.';
  end if;

  if not private.is_admin_user() then
    raise exception 'Only active administrators can reply to support messages.';
  end if;

  if v_reply = '' then
    raise exception 'A reply message is required.';
  end if;

  if v_status not in ('new', 'open', 'resolved') then
    raise exception 'Invalid support message status.';
  end if;

  update public.support_messages as sm
     set admin_reply = v_reply,
         replied_at = now(),
         replied_by = auth.uid(),
         status = v_status
   where sm.id = p_message_id
   returning sm.* into v_support_message;

  if not found then
    raise exception 'Support message not found.';
  end if;

  return v_support_message;
end;
$function$;

create or replace function public.set_support_message_status(
  p_message_id uuid,
  p_status text
)
returns public.support_messages
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_support_message public.support_messages%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Please sign in to continue.';
  end if;

  if not private.is_admin_user() then
    raise exception 'Only active administrators can update support messages.';
  end if;

  if v_status not in ('new', 'open', 'resolved') then
    raise exception 'Invalid support message status.';
  end if;

  update public.support_messages as sm
     set status = v_status
   where sm.id = p_message_id
   returning sm.* into v_support_message;

  if not found then
    raise exception 'Support message not found.';
  end if;

  return v_support_message;
end;
$function$;

create or replace function public.delete_support_message(p_message_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null then
    raise exception 'Please sign in to continue.';
  end if;

  if not private.is_admin_user() then
    raise exception 'Only active administrators can delete support messages.';
  end if;

  delete from public.support_messages as sm
   where sm.id = p_message_id;

  if not found then
    raise exception 'Support message not found.';
  end if;

  return p_message_id;
end;
$function$;

create or replace function public.create_contact_message(payload jsonb)
returns public.contact_messages
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_full_name text;
  v_email text;
  v_phone_number text;
  v_subject text;
  v_message text;
  v_contact_message public.contact_messages%rowtype;
begin
  v_full_name := btrim(coalesce(payload ->> 'fullName', payload ->> 'full_name', ''));
  v_email := lower(btrim(coalesce(payload ->> 'email', payload ->> 'emailAddress', '')));
  v_phone_number := nullif(btrim(coalesce(payload ->> 'phoneNumber', payload ->> 'phone_number', '')), '');
  v_subject := btrim(coalesce(payload ->> 'subject', ''));
  v_message := btrim(coalesce(payload ->> 'message', ''));

  if v_full_name = '' then
    raise exception 'A full name is required.';
  end if;

  if v_email = '' then
    raise exception 'An email address is required.';
  end if;

  if v_subject = '' then
    raise exception 'A subject is required.';
  end if;

  if v_message = '' then
    raise exception 'A message is required.';
  end if;

  insert into public.contact_messages as cm (
    user_id,
    full_name,
    email,
    phone_number,
    subject,
    message,
    status
  ) values (
    v_user_id,
    v_full_name,
    v_email,
    v_phone_number,
    v_subject,
    v_message,
    'new'
  )
  returning * into v_contact_message;

  return v_contact_message;
end;
$function$;

create or replace function public.reply_to_contact_message(
  p_message_id uuid,
  p_admin_reply text,
  p_status text default 'open'
)
returns public.contact_messages
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_reply text := btrim(coalesce(p_admin_reply, ''));
  v_status text := lower(btrim(coalesce(p_status, 'open')));
  v_contact_message public.contact_messages%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Please sign in to continue.';
  end if;

  if not private.is_admin_user() then
    raise exception 'Only active administrators can reply to contact messages.';
  end if;

  if v_reply = '' then
    raise exception 'A reply message is required.';
  end if;

  if v_status not in ('new', 'open', 'resolved') then
    raise exception 'Invalid contact message status.';
  end if;

  update public.contact_messages as cm
     set admin_reply = v_reply,
         replied_at = now(),
         replied_by = auth.uid(),
         status = v_status
   where cm.id = p_message_id
   returning cm.* into v_contact_message;

  if not found then
    raise exception 'Contact message not found.';
  end if;

  return v_contact_message;
end;
$function$;

create or replace function public.set_contact_message_status(
  p_message_id uuid,
  p_status text
)
returns public.contact_messages
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_contact_message public.contact_messages%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Please sign in to continue.';
  end if;

  if not private.is_admin_user() then
    raise exception 'Only active administrators can update contact messages.';
  end if;

  if v_status not in ('new', 'open', 'resolved') then
    raise exception 'Invalid contact message status.';
  end if;

  update public.contact_messages as cm
     set status = v_status
   where cm.id = p_message_id
   returning cm.* into v_contact_message;

  if not found then
    raise exception 'Contact message not found.';
  end if;

  return v_contact_message;
end;
$function$;

create or replace function public.delete_contact_message(p_message_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null then
    raise exception 'Please sign in to continue.';
  end if;

  if not private.is_admin_user() then
    raise exception 'Only active administrators can delete contact messages.';
  end if;

  delete from public.contact_messages as cm
   where cm.id = p_message_id;

  if not found then
    raise exception 'Contact message not found.';
  end if;

  return p_message_id;
end;
$function$;

drop trigger if exists support_messages_set_updated_at on public.support_messages;
create trigger support_messages_set_updated_at
before update on public.support_messages
for each row execute function private.set_updated_at();

drop trigger if exists contact_messages_set_updated_at on public.contact_messages;
create trigger contact_messages_set_updated_at
before update on public.contact_messages
for each row execute function private.set_updated_at();

alter table public.support_messages enable row level security;
alter table public.contact_messages enable row level security;

drop policy if exists support_messages_select_own on public.support_messages;
create policy support_messages_select_own
on public.support_messages
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists support_messages_select_admin on public.support_messages;
create policy support_messages_select_admin
on public.support_messages
for select
to authenticated
using ((select private.is_admin_user()));

drop policy if exists contact_messages_select_admin on public.contact_messages;
create policy contact_messages_select_admin
on public.contact_messages
for select
to authenticated
using ((select private.is_admin_user()));

revoke all on table public.support_messages from public;
revoke all on table public.support_messages from anon;
revoke all on table public.support_messages from authenticated;
grant select on table public.support_messages to authenticated;

revoke all on table public.contact_messages from public;
revoke all on table public.contact_messages from anon;
revoke all on table public.contact_messages from authenticated;
grant select on table public.contact_messages to authenticated;

revoke all on function public.create_support_message(jsonb) from public;
revoke all on function public.create_support_message(jsonb) from anon;
revoke all on function public.create_support_message(jsonb) from authenticated;
grant execute on function public.create_support_message(jsonb) to authenticated;

revoke all on function public.reply_to_support_message(uuid, text, text) from public;
revoke all on function public.reply_to_support_message(uuid, text, text) from anon;
revoke all on function public.reply_to_support_message(uuid, text, text) from authenticated;
grant execute on function public.reply_to_support_message(uuid, text, text) to authenticated;

revoke all on function public.set_support_message_status(uuid, text) from public;
revoke all on function public.set_support_message_status(uuid, text) from anon;
revoke all on function public.set_support_message_status(uuid, text) from authenticated;
grant execute on function public.set_support_message_status(uuid, text) to authenticated;

revoke all on function public.delete_support_message(uuid) from public;
revoke all on function public.delete_support_message(uuid) from anon;
revoke all on function public.delete_support_message(uuid) from authenticated;
grant execute on function public.delete_support_message(uuid) to authenticated;

revoke all on function public.create_contact_message(jsonb) from public;
revoke all on function public.create_contact_message(jsonb) from anon;
revoke all on function public.create_contact_message(jsonb) from authenticated;
grant execute on function public.create_contact_message(jsonb) to anon, authenticated;

revoke all on function public.reply_to_contact_message(uuid, text, text) from public;
revoke all on function public.reply_to_contact_message(uuid, text, text) from anon;
revoke all on function public.reply_to_contact_message(uuid, text, text) from authenticated;
grant execute on function public.reply_to_contact_message(uuid, text, text) to authenticated;

revoke all on function public.set_contact_message_status(uuid, text) from public;
revoke all on function public.set_contact_message_status(uuid, text) from anon;
revoke all on function public.set_contact_message_status(uuid, text) from authenticated;
grant execute on function public.set_contact_message_status(uuid, text) to authenticated;

revoke all on function public.delete_contact_message(uuid) from public;
revoke all on function public.delete_contact_message(uuid) from anon;
revoke all on function public.delete_contact_message(uuid) from authenticated;
grant execute on function public.delete_contact_message(uuid) to authenticated;

commit;
