begin;

alter table public.conversation_preferences add column if not exists calls_muted boolean not null default false;

create table if not exists public.direct_calls (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  caller_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('voice','video')),
  status text not null default 'ringing' check (status in ('ringing','accepted','declined','ended','missed')),
  offer text,
  answer text,
  expires_at timestamptz not null default (now() + interval '45 seconds'),
  check (caller_id <> recipient_id)
);
create unique index if not exists direct_calls_one_open_conversation on public.direct_calls(conversation_id)
  where status in ('ringing','accepted');
create index if not exists direct_calls_incoming_idx on public.direct_calls(recipient_id,expires_at) where status = 'ringing';
alter table public.direct_calls enable row level security;
revoke all on public.direct_calls from public,anon,authenticated;
grant select on public.direct_calls to authenticated;
drop policy if exists "Only call participants can read signaling" on public.direct_calls;
create policy "Only call participants can read signaling" on public.direct_calls for select to authenticated
  using (auth.uid() in (caller_id,recipient_id)
    and not app_private.account_is_blocked(case when auth.uid() = caller_id then recipient_id else caller_id end));

create or replace function public.start_direct_call(target uuid, call_kind text, call_offer text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  peer uuid;
  call_id uuid;
begin
  if caller is null or call_kind is null or call_kind not in ('voice','video')
    or call_offer is null or length(call_offer) not between 10 and 100000
    or not public.connected_chat_can_send(target) then
    raise exception 'Calling is unavailable' using errcode = '42501';
  end if;
  select case when c.participant_a = caller then c.participant_b else c.participant_a end into peer
  from public.conversations c where id = target and caller in (participant_a,participant_b) for update;
  if peer is null or app_private.account_is_blocked(peer) then raise exception 'Calling is unavailable' using errcode = '42501'; end if;
  update public.direct_calls set status = 'missed', offer = null, answer = null
    where conversation_id = target and status in ('ringing','accepted') and expires_at <= now();
  insert into public.direct_calls(conversation_id,caller_id,recipient_id,kind,offer)
    values(target,caller,peer,call_kind,call_offer) returning id into call_id;
  return call_id;
end;
$$;

create or replace function public.respond_to_direct_call(target uuid, action text, call_answer text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  viewer uuid := auth.uid();
begin
  if viewer is null then return false; end if;
  if action = 'accept' then
    if call_answer is null or length(call_answer) not between 10 and 100000 then return false; end if;
    update public.direct_calls set status = 'accepted', answer = call_answer, expires_at = now() + interval '4 hours'
    where id = target and recipient_id = viewer and status = 'ringing' and expires_at > now()
      and not app_private.account_is_blocked(caller_id) and public.connected_chat_can_send(conversation_id);
  elsif action = 'decline' then
    update public.direct_calls set status = 'declined', offer = null, answer = null
    where id = target and recipient_id = viewer and status = 'ringing';
  elsif action = 'end' then
    update public.direct_calls set status = 'ended', offer = null, answer = null
    where id = target and viewer in (caller_id,recipient_id) and status in ('ringing','accepted');
  else
    return false;
  end if;
  return found;
end;
$$;
revoke all on function public.start_direct_call(uuid,text,text), public.respond_to_direct_call(uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.start_direct_call(uuid,text,text), public.respond_to_direct_call(uuid,text,text) to authenticated;

-- This ownership and reference check also applies when a message is hidden by RLS.
create or replace function app_private.can_delete_unreferenced_chat_upload(path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and split_part(path,'/',2) = auth.uid()::text
    and not exists (select 1 from public.messages where object_path = path);
$$;
revoke all on function app_private.can_delete_unreferenced_chat_upload(text) from public,anon;
grant execute on function app_private.can_delete_unreferenced_chat_upload(text) to authenticated;

drop policy if exists "Delete unreferenced own chat attachments" on storage.objects;
create policy "Delete unreferenced own chat attachments" on storage.objects for delete to authenticated
  using (bucket_id = 'chat-attachments' and app_private.can_delete_unreferenced_chat_upload(name));

commit;
