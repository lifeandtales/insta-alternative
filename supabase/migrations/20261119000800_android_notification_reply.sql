begin;
alter table public.android_push_devices add column if not exists supports_reply boolean not null default false;
create table if not exists app_private.android_reply_tickets (
  digest bytea primary key,
  recipient_id uuid not null,
  installation_id uuid not null,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  expires_at timestamptz not null,
  foreign key (recipient_id, installation_id)
    references public.android_push_devices(user_id, installation_id) on delete cascade
);
revoke all on app_private.android_reply_tickets from public, anon, authenticated;

create or replace function public.issue_android_reply_ticket(notice_id uuid, device_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  ticket uuid := gen_random_uuid();
begin
  delete from app_private.android_reply_tickets where expires_at <= now();
  insert into app_private.android_reply_tickets
  select sha256(convert_to(ticket::text,'UTF8')), n.recipient_id, d.installation_id,
    (n.payload->>'conversation_id')::uuid, now()+interval '15 minutes'
  from public.app_notifications n
  join public.android_push_devices d on d.user_id=n.recipient_id and d.installation_id=device_id
  where n.id=notice_id and n.kind='chat_message' and d.supports_reply
    and n.created_at > now()-interval '5 minutes' and n.payload ? 'conversation_id';
  if not found then return null; end if;
  return ticket;
end;
$$;

create or replace function public.send_android_notification_reply(ticket uuid, reply_text text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  item app_private.android_reply_tickets%rowtype;
begin
  if reply_text is null or char_length(btrim(reply_text)) not between 1 and 1000 then return false; end if;
  delete from app_private.android_reply_tickets
    where digest=sha256(convert_to(ticket::text,'UTF8')) and expires_at>now()
    returning * into item;
  if not found then return false; end if;
  perform set_config('request.jwt.claim.sub', item.recipient_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',item.recipient_id)::text, true);
  if not app_private.can_send_to_conversation(item.conversation_id) then return false; end if;
  insert into public.messages(conversation_id,sender_id,kind,body)
    values(item.conversation_id,item.recipient_id,'text',btrim(reply_text));
  return true;
end;
$$;
revoke all on function public.issue_android_reply_ticket(uuid,uuid), public.send_android_notification_reply(uuid,text) from public,anon,authenticated;
grant execute on function public.issue_android_reply_ticket(uuid,uuid), public.send_android_notification_reply(uuid,text) to service_role;
commit;
