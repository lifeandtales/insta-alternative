begin;

create schema if not exists app_private;
revoke all on schema app_private from public;
grant usage on schema app_private to authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9._]{3,30}$'),
  display_name text not null check (char_length(display_name) between 1 and 100),
  bio text not null default '' check (char_length(bio) <= 200),
  created_at timestamptz not null default now()
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  participant_a uuid not null references public.profiles(id) on delete cascade,
  participant_b uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (participant_a, participant_b),
  check (participant_a < participant_b)
);
create index conversations_participant_b_idx on public.conversations(participant_b);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('text', 'photo', 'video', 'voice', 'file')),
  body text check (char_length(body) <= 1000),
  object_path text,
  reply_to_id uuid,
  created_at timestamptz not null default now(),
  unique (conversation_id, id),
  foreign key (conversation_id, reply_to_id) references public.messages(conversation_id, id),
  check (
    (kind = 'text' and body is not null and length(btrim(body)) > 0 and object_path is null)
    or (kind <> 'text' and object_path is not null)
  )
);
create index messages_history_idx on public.messages(conversation_id, created_at desc, id desc);

create table public.hidden_messages (
  user_id uuid not null references public.profiles(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  primary key (user_id, message_id)
);

create function app_private.is_conversation_participant(conversation uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.conversations c
    where c.id = conversation and (select auth.uid()) in (c.participant_a, c.participant_b)
  )
$$;
revoke all on function app_private.is_conversation_participant(uuid) from public;
grant execute on function app_private.is_conversation_participant(uuid) to authenticated;

create function public.open_direct_chat(other_user uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  first_user uuid;
  second_user uuid;
  conversation uuid;
begin
  if caller is null or other_user is null or caller = other_user then
    raise exception 'Select another account';
  end if;
  first_user := least(caller, other_user);
  second_user := greatest(caller, other_user);
  insert into public.conversations(participant_a, participant_b)
  values (first_user, second_user)
  on conflict (participant_a, participant_b) do nothing
  returning id into conversation;
  if conversation is null then
    select id into conversation from public.conversations
    where participant_a = first_user and participant_b = second_user;
  end if;
  return conversation;
end
$$;
revoke all on function public.open_direct_chat(uuid) from public;
grant execute on function public.open_direct_chat(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.hidden_messages enable row level security;

revoke all on public.profiles, public.conversations, public.messages, public.hidden_messages from anon, authenticated;
grant select on public.profiles, public.conversations, public.messages, public.hidden_messages to authenticated;
grant insert (id, username, display_name, bio), update (username, display_name, bio) on public.profiles to authenticated;
grant insert (conversation_id, sender_id, kind, body, object_path, reply_to_id) on public.messages to authenticated;
grant insert on public.hidden_messages to authenticated;

create policy "Signed-in users read profile directory" on public.profiles
  for select to authenticated using (true);
create policy "Users create own profile" on public.profiles
  for insert to authenticated with check (id = (select auth.uid()));
create policy "Users update own profile" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "Participants read their conversations" on public.conversations
  for select to authenticated using ((select auth.uid()) in (participant_a, participant_b));
create policy "Users read their own hidden message records" on public.hidden_messages
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Participants read visible messages" on public.messages
  for select to authenticated using (
    app_private.is_conversation_participant(conversation_id)
    and not exists (select 1 from public.hidden_messages h where h.user_id = (select auth.uid()) and h.message_id = messages.id)
  );
create policy "Participants send messages as themselves" on public.messages
  for insert to authenticated with check (
    sender_id = (select auth.uid()) and app_private.is_conversation_participant(conversation_id)
    and (object_path is null or (
      split_part(object_path, '/', 1) = conversation_id::text
      and split_part(object_path, '/', 2) = sender_id::text
    ))
  );
create policy "Participants hide their own view of a message" on public.hidden_messages
  for insert to authenticated with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.messages m where m.id = hidden_messages.message_id)
  );

-- Publish inserts for clients that subscribe to new chat messages.
alter publication supabase_realtime add table public.messages;

-- Private attachment storage
-- 50 MB keeps this migration usable on a Supabase Free project.
insert into storage.buckets (id, name, public, file_size_limit)
values ('chat-attachments', 'chat-attachments', false, 50000000);

create function app_private.can_access_attachment_folder(object_name text)
returns boolean
language sql stable set search_path = ''
as $$
  select case
    when split_part(object_name, '/', 1) ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    then app_private.is_conversation_participant(split_part(object_name, '/', 1)::uuid)
    else false
  end
$$;
revoke all on function app_private.can_access_attachment_folder(text) from public;
grant execute on function app_private.can_access_attachment_folder(text) to authenticated;

create policy "Participants download shared attachments" on storage.objects
  for select to authenticated using (
    bucket_id = 'chat-attachments'
    and app_private.can_access_attachment_folder(name)
    and (
      split_part(name, '/', 2) = (select auth.uid())::text
      or exists (select 1 from public.messages m where m.object_path = storage.objects.name)
    )
  );

create policy "Participants upload to their own attachment folder" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'chat-attachments'
    and app_private.can_access_attachment_folder(name)
    and split_part(name, '/', 2) = (select auth.uid())::text
    and cardinality(storage.foldername(name)) = 2
  );

create index messages_attachment_path_idx on public.messages(object_path) where object_path is not null;

commit;
