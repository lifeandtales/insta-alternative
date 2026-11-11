-- Apply after the account/chat setup. Also works if the image-post migration is already applied.
begin;

create table if not exists public.image_posts (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  client_id bigint not null check (client_id > 0),
  caption text not null default '',
  location text not null default '',
  tags text[] not null default '{}',
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 20),
  cover_index integer not null default 0 check (cover_index between 0 and 19),
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (owner_id, client_id)
);

alter table public.image_posts enable row level security;
revoke all on public.image_posts from anon, authenticated;
grant select, insert, delete on public.image_posts to authenticated;
grant update (caption, location) on public.image_posts to authenticated;

drop policy if exists "Owners read their image posts" on public.image_posts;
create policy "Owners read their image posts" on public.image_posts
  for select to authenticated using (owner_id = (select auth.uid()));
drop policy if exists "Owners publish their image posts" on public.image_posts;
create policy "Owners publish their image posts" on public.image_posts
  for insert to authenticated with check (owner_id = (select auth.uid()));
drop policy if exists "Owners edit their image posts" on public.image_posts;
create policy "Owners edit their image posts" on public.image_posts
  for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
drop policy if exists "Owners delete their image posts" on public.image_posts;
create policy "Owners delete their image posts" on public.image_posts
  for delete to authenticated using (owner_id = (select auth.uid()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('post-images', 'post-images', false, 50000000, array['image/*']) on conflict (id) do nothing;

drop policy if exists "Owners read their post images" on storage.objects;
create policy "Owners read their post images" on storage.objects
  for select to authenticated using (
    bucket_id = 'post-images' and (storage.foldername(name))[1] = (select auth.uid())::text
  );
drop policy if exists "Owners upload their post images" on storage.objects;
create policy "Owners upload their post images" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'post-images' and (storage.foldername(name))[1] = (select auth.uid())::text
  );
drop policy if exists "Owners delete their post images" on storage.objects;
create policy "Owners delete their post images" on storage.objects
  for delete to authenticated using (
    bucket_id = 'post-images' and (storage.foldername(name))[1] = (select auth.uid())::text
  );

alter table public.profiles
  add column is_private boolean not null default false,
  add column avatar_path text,
  add column links text[] not null default '{}',
  add constraint profiles_avatar_path_owner check (avatar_path is null or split_part(avatar_path, '/', 1) = id::text);
grant update (is_private, avatar_path, links) on public.profiles to authenticated;

create table public.account_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
alter table public.account_blocks enable row level security;
revoke all on public.account_blocks from anon, authenticated;
grant select, insert, delete on public.account_blocks to authenticated;
create policy "Manage own blocks" on public.account_blocks
  for all to authenticated using (blocker_id = (select auth.uid())) with check (blocker_id = (select auth.uid()));

create function app_private.account_is_blocked(other_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.account_blocks b
    where (b.blocker_id = auth.uid() and b.blocked_id = other_user)
       or (b.blocker_id = other_user and b.blocked_id = auth.uid())
  )
$$;
revoke all on function app_private.account_is_blocked(uuid) from public;
grant execute on function app_private.account_is_blocked(uuid) to authenticated;
drop policy "Signed-in users read profile directory" on public.profiles;
create policy "Read accessible profiles" on public.profiles
  for select to authenticated using (not app_private.account_is_blocked(id));

create or replace function public.open_direct_chat(other_user uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  first_user uuid;
  second_user uuid;
  conversation uuid;
begin
  if caller is null or other_user is null or caller = other_user or app_private.account_is_blocked(other_user) then
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
create table public.account_follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  followed_id uuid not null references public.profiles(id) on delete cascade,
  status text not null check (status in ('requested', 'accepted')),
  created_at timestamptz not null default now(),
  primary key (follower_id, followed_id),
  check (follower_id <> followed_id)
);
create index account_follows_target_idx on public.account_follows(followed_id, status);
alter table public.account_follows enable row level security;
revoke all on public.account_follows from anon, authenticated;
grant select, delete on public.account_follows to authenticated;
grant update (status) on public.account_follows to authenticated;
create policy "Read own follow relationships" on public.account_follows
  for select to authenticated using ((select auth.uid()) in (follower_id, followed_id));
create policy "Remove own follow relationships" on public.account_follows
  for delete to authenticated using ((select auth.uid()) in (follower_id, followed_id));
create policy "Approve incoming follow requests" on public.account_follows
  for update to authenticated using (followed_id = (select auth.uid()) and status = 'requested')
  with check (followed_id = (select auth.uid()) and status = 'accepted' and not app_private.account_is_blocked(follower_id));

create function public.request_account_follow(other_user uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  private_account boolean;
  result text;
begin
  if caller is null or other_user is null or caller = other_user or app_private.account_is_blocked(other_user) then
    raise exception 'Account unavailable';
  end if;
  select is_private into private_account from public.profiles where id = other_user;
  if not found then raise exception 'Account unavailable'; end if;
  insert into public.account_follows(follower_id, followed_id, status)
  values (caller, other_user, case when private_account then 'requested' else 'accepted' end)
  on conflict (follower_id, followed_id) do nothing;
  select status into result from public.account_follows where follower_id = caller and followed_id = other_user;
  return result;
end
$$;
revoke all on function public.request_account_follow(uuid) from public;
grant execute on function public.request_account_follow(uuid) to authenticated;

create table public.close_friends (
  owner_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  friend_id uuid not null references public.profiles(id) on delete cascade,
  primary key (owner_id, friend_id),
  check (owner_id <> friend_id)
);
alter table public.close_friends enable row level security;
revoke all on public.close_friends from anon, authenticated;
grant select, insert, delete on public.close_friends to authenticated;
create policy "Manage own close friends" on public.close_friends
  for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

-- New video posts, Reels, and Stories use this common media model.
-- Existing image uploads continue to work through image_posts.
create table public.media_content (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  kind text not null check (kind in ('post', 'reel', 'story')),
  caption text not null default '' check (char_length(caption) <= 5000),
  audience text not null default 'private' check (audience in ('public', 'followers', 'close_friends', 'private')),
  created_at timestamptz not null default now(),
  publish_at timestamptz not null default now(),
  expires_at timestamptz,
  metadata jsonb not null default '{}' check (jsonb_typeof(metadata) = 'object'),
  unique (id, owner_id),
  check (kind <> 'story' or (expires_at is not null and expires_at > publish_at))
);
create index media_content_feed_idx on public.media_content(kind, publish_at desc);
create index media_content_owner_idx on public.media_content(owner_id, publish_at desc);

create table public.media_assets (
  content_id uuid not null,
  owner_id uuid not null default auth.uid(),
  position smallint not null check (position between 0 and 19),
  object_path text not null unique,
  mime_type text not null check (mime_type like 'image/%' or mime_type like 'video/%'),
  metadata jsonb not null default '{}' check (jsonb_typeof(metadata) = 'object'),
  primary key (content_id, position),
  foreign key (content_id, owner_id) references public.media_content(id, owner_id) on delete cascade,
  check (split_part(object_path, '/', 1) = owner_id::text and split_part(object_path, '/', 2) = content_id::text)
);

create function app_private.can_view_content(content uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.media_content c
    join public.profiles p on p.id = c.owner_id
    where c.id = content and auth.uid() is not null and (
      c.owner_id = auth.uid() or (
        not app_private.account_is_blocked(c.owner_id)
        and c.publish_at <= now() and (c.expires_at is null or c.expires_at > now())
        and (
          (c.audience = 'public' and not p.is_private)
          or (c.audience in ('public', 'followers') and exists (
            select 1 from public.account_follows f
            where f.follower_id = auth.uid() and f.followed_id = c.owner_id and f.status = 'accepted'
          ))
          or (c.audience = 'close_friends' and exists (
            select 1 from public.close_friends f where f.owner_id = c.owner_id and f.friend_id = auth.uid()
          ))
        )
      )
    )
  )
$$;
revoke all on function app_private.can_view_content(uuid) from public;
grant execute on function app_private.can_view_content(uuid) to authenticated;

alter table public.media_content enable row level security;
alter table public.media_assets enable row level security;
revoke all on public.media_content, public.media_assets from anon, authenticated;
grant select, insert, delete on public.media_content, public.media_assets to authenticated;
grant update (caption, audience, publish_at, expires_at, metadata) on public.media_content to authenticated;
create policy "Read visible content" on public.media_content
  for select to authenticated using (owner_id = (select auth.uid()) or app_private.can_view_content(id));
create policy "Create own content" on public.media_content
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "Update own content" on public.media_content
  for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "Delete own content" on public.media_content
  for delete to authenticated using (owner_id = (select auth.uid()));
create policy "Read assets for visible content" on public.media_assets
  for select to authenticated using (app_private.can_view_content(content_id));
create policy "Create own media assets" on public.media_assets
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "Delete own media assets" on public.media_assets
  for delete to authenticated using (owner_id = (select auth.uid()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('app-media', 'app-media', false, 50000000, array['image/*', 'video/*']),
  ('avatars', 'avatars', false, 10000000, array['image/*'])
on conflict (id) do nothing;
create policy "Read authorized app media and avatars" on storage.objects
  for select to authenticated using (
    (bucket_id = 'app-media' and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or exists (select 1 from public.media_assets a where a.object_path = storage.objects.name)
    ))
    or (bucket_id = 'avatars' and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or exists (select 1 from public.profiles p where p.avatar_path = storage.objects.name)
    ))
  );
create policy "Upload own app media and avatars" on storage.objects
  for insert to authenticated with check (
    bucket_id in ('app-media', 'avatars') and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy "Delete own app media and avatars" on storage.objects
  for delete to authenticated using (
    bucket_id in ('app-media', 'avatars') and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create table public.media_interactions (
  content_id uuid not null references public.media_content(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  kind text not null check (kind in ('like', 'save', 'view')),
  created_at timestamptz not null default now(),
  primary key (content_id, user_id, kind)
);
create index media_interactions_user_idx on public.media_interactions(user_id, kind);
alter table public.media_interactions enable row level security;
revoke all on public.media_interactions from anon, authenticated;
grant select, insert, delete on public.media_interactions to authenticated;
create policy "Read own interactions" on public.media_interactions
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Interact with visible content" on public.media_interactions
  for insert to authenticated with check (user_id = (select auth.uid()) and app_private.can_view_content(content_id));
create policy "Remove own likes and saves" on public.media_interactions
  for delete to authenticated using (user_id = (select auth.uid()) and kind <> 'view');

create table public.media_comments (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.media_content(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index media_comments_content_idx on public.media_comments(content_id, created_at);
alter table public.media_comments enable row level security;
revoke all on public.media_comments from anon, authenticated;
grant select, insert, delete on public.media_comments to authenticated;
create policy "Read comments on visible content" on public.media_comments
  for select to authenticated using (app_private.can_view_content(content_id) and not app_private.account_is_blocked(author_id));
create policy "Comment on visible content" on public.media_comments
  for insert to authenticated with check (author_id = (select auth.uid()) and app_private.can_view_content(content_id));
create policy "Delete own comments" on public.media_comments
  for delete to authenticated using (author_id = (select auth.uid()));

alter table public.conversations
  alter column participant_a drop not null,
  alter column participant_b drop not null,
  add column group_name text,
  add column retention_hours integer check (retention_hours is null or retention_hours = 24),
  add constraint conversations_shape check (
    (group_name is null and participant_a is not null and participant_b is not null)
    or (group_name is not null and char_length(btrim(group_name)) between 1 and 60 and participant_a is null and participant_b is null)
  );

create table public.group_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index group_members_user_idx on public.group_members(user_id);

create or replace function app_private.is_conversation_participant(conversation uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.conversations c
    where c.id = conversation and (
      auth.uid() in (c.participant_a, c.participant_b)
      or exists (select 1 from public.group_members m where m.conversation_id = c.id and m.user_id = auth.uid())
    )
  )
$$;

create function app_private.is_group_admin(conversation uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.group_members m where m.conversation_id = conversation and m.user_id = auth.uid() and m.role = 'admin')
$$;
revoke all on function app_private.is_group_admin(uuid) from public;
grant execute on function app_private.is_group_admin(uuid) to authenticated;

create function app_private.can_send_to_conversation(conversation uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.conversations c where c.id = conversation
    and app_private.is_conversation_participant(c.id)
    and (c.group_name is not null or not app_private.account_is_blocked(
      case when c.participant_a = auth.uid() then c.participant_b else c.participant_a end
    ))
  )
$$;
revoke all on function app_private.can_send_to_conversation(uuid) from public;
grant execute on function app_private.can_send_to_conversation(uuid) to authenticated;

create function public.create_group_chat(name text, member_ids uuid[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  new_conversation uuid;
begin
  if caller is null or name is null or char_length(btrim(name)) not between 1 and 60
     or coalesce(cardinality(member_ids), 0) not between 1 and 99
     or not exists (select 1 from unnest(member_ids) member where member <> caller)
     or exists (select 1 from unnest(member_ids) member where member is null or app_private.account_is_blocked(member)) then
    raise exception 'Choose a group name and valid members';
  end if;
  insert into public.conversations(group_name) values (btrim(name)) returning id into new_conversation;
  insert into public.group_members values (new_conversation, caller, 'admin');
  insert into public.group_members(conversation_id, user_id, role)
    select distinct new_conversation, member, 'member' from unnest(member_ids) member where member <> caller;
  return new_conversation;
end
$$;
revoke all on function public.create_group_chat(text, uuid[]) from public;
grant execute on function public.create_group_chat(text, uuid[]) to authenticated;

alter table public.group_members enable row level security;
revoke all on public.group_members from anon, authenticated;
grant select, insert, delete on public.group_members to authenticated;
create policy "Group members read membership" on public.group_members
  for select to authenticated using (app_private.is_conversation_participant(conversation_id));
create policy "Admins add members" on public.group_members
  for insert to authenticated with check (role = 'member' and app_private.is_group_admin(conversation_id) and not app_private.account_is_blocked(user_id));
create policy "Members leave or admins remove members" on public.group_members
  for delete to authenticated using (role = 'member' and (user_id = (select auth.uid()) or app_private.is_group_admin(conversation_id)));

drop policy "Participants read their conversations" on public.conversations;
create policy "Participants read their conversations" on public.conversations
  for select to authenticated using (app_private.is_conversation_participant(id));

alter table public.messages
  drop constraint messages_kind_check,
  drop constraint messages_check,
  drop constraint messages_conversation_id_reply_to_id_fkey,
  add column metadata jsonb not null default '{}' check (jsonb_typeof(metadata) = 'object'),
  add column shared_content_id uuid references public.media_content(id) on delete set null,
  add column expires_at timestamptz,
  add column attachment_expires_at timestamptz,
  add constraint messages_kind_check check (kind in (
    'text', 'photo', 'video', 'voice', 'file', 'location', 'contact', 'shared_post', 'shared_reel', 'shared_story'
  )),
  add constraint messages_payload_check check (
    (kind = 'text' and body is not null and length(btrim(body)) > 0 and object_path is null)
    or (kind in ('photo', 'video', 'voice', 'file') and object_path is not null)
    or (kind in ('location', 'contact', 'shared_post', 'shared_reel', 'shared_story') and object_path is null)
  ),
  add foreign key (conversation_id, reply_to_id) references public.messages(conversation_id, id) on delete set null (reply_to_id);
grant insert (metadata, shared_content_id) on public.messages to authenticated;
create index messages_expiration_idx on public.messages(expires_at) where expires_at is not null;

create function app_private.set_message_expiry()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  retention integer;
  attachment_bytes text;
begin
  if new.object_path is not null then
    select metadata->>'size' into attachment_bytes from storage.objects
      where bucket_id = 'chat-attachments' and name = new.object_path;
    if not found then raise exception 'Upload the attachment before sending'; end if;
    if attachment_bytes ~ '^[0-9]{1,18}$' and attachment_bytes::bigint > 200000000 then
      new.attachment_expires_at := new.created_at + interval '24 hours';
    end if;
  end if;
  select retention_hours into retention from public.conversations where id = new.conversation_id;
  if retention is not null then new.expires_at := new.created_at + make_interval(hours => retention); end if;
  return new;
end
$$;
revoke all on function app_private.set_message_expiry() from public;
create trigger set_message_expiry before insert on public.messages
  for each row execute function app_private.set_message_expiry();

create function public.set_chat_timer(conversation uuid, enabled boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not app_private.can_send_to_conversation(conversation)
     or not exists (select 1 from public.conversations c where c.id = conversation and c.group_name is null) then
    raise exception 'Conversation unavailable';
  end if;
  update public.conversations set retention_hours = case when enabled then 24 end where id = conversation;
  if enabled then
    update public.messages set expires_at = created_at + interval '24 hours'
      where conversation_id = conversation and expires_at is null;
  else
    update public.messages set expires_at = null where conversation_id = conversation and expires_at > now();
  end if;
end
$$;
revoke all on function public.set_chat_timer(uuid, boolean) from public;
grant execute on function public.set_chat_timer(uuid, boolean) to authenticated;

drop policy "Participants read visible messages" on public.messages;
create policy "Participants read visible messages" on public.messages
  for select to authenticated using (
    app_private.is_conversation_participant(conversation_id)
    and (expires_at is null or expires_at > now())
    and not exists (select 1 from public.hidden_messages h where h.user_id = (select auth.uid()) and h.message_id = messages.id)
  );
drop policy "Participants send messages as themselves" on public.messages;
create policy "Participants send messages as themselves" on public.messages
  for insert to authenticated with check (
    sender_id = (select auth.uid()) and app_private.can_send_to_conversation(conversation_id)
    and (shared_content_id is null or app_private.can_view_content(shared_content_id))
    and (object_path is null or (
      split_part(object_path, '/', 1) = conversation_id::text
      and split_part(object_path, '/', 2) = sender_id::text
    ))
  );

create table public.message_reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  emoji text not null check (char_length(emoji) between 1 and 16),
  primary key (message_id, user_id)
);
alter table public.message_reactions enable row level security;
revoke all on public.message_reactions from anon, authenticated;
grant select, insert, delete on public.message_reactions to authenticated;
grant update (emoji) on public.message_reactions to authenticated;
create policy "Read reactions on visible messages" on public.message_reactions
  for select to authenticated using (exists (select 1 from public.messages m where m.id = message_reactions.message_id));
create policy "Manage own visible message reactions" on public.message_reactions
  for all to authenticated using (user_id = (select auth.uid())) with check (
    user_id = (select auth.uid()) and exists (select 1 from public.messages m where m.id = message_reactions.message_id)
  );

create table public.conversation_preferences (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  muted boolean not null default false,
  pinned boolean not null default false,
  last_read_at timestamptz,
  cleared_at timestamptz,
  wallpaper_path text,
  primary key (conversation_id, user_id)
);
alter table public.conversation_preferences enable row level security;
revoke all on public.conversation_preferences from anon, authenticated;
grant select, insert, update, delete on public.conversation_preferences to authenticated;
create policy "Manage own conversation preferences" on public.conversation_preferences
  for all to authenticated using (user_id = (select auth.uid()) and app_private.is_conversation_participant(conversation_id))
  with check (user_id = (select auth.uid()) and app_private.is_conversation_participant(conversation_id));

create table public.account_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade default auth.uid(),
  settings jsonb not null default '{}' check (jsonb_typeof(settings) = 'object')
);
create table public.content_drafts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  kind text not null check (kind in ('post', 'reel', 'story')),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  updated_at timestamptz not null default now()
);
create table public.app_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index app_notifications_inbox_idx on public.app_notifications(recipient_id, created_at desc);
create table public.content_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  target_kind text not null check (target_kind in ('profile', 'post', 'image_post', 'reel', 'story', 'message')),
  target_ref text not null check (char_length(target_ref) between 1 and 128),
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  created_at timestamptz not null default now()
);
alter table public.account_preferences enable row level security;
alter table public.content_drafts enable row level security;
alter table public.app_notifications enable row level security;
alter table public.content_reports enable row level security;
revoke all on public.account_preferences, public.content_drafts, public.app_notifications, public.content_reports from anon, authenticated;
grant select, insert, update, delete on public.account_preferences, public.content_drafts to authenticated;
grant select on public.app_notifications to authenticated;
grant update (read_at) on public.app_notifications to authenticated;
grant insert (reporter_id, target_kind, target_ref, reason) on public.content_reports to authenticated;
grant insert on public.app_notifications to service_role;
grant select, update on public.content_reports to service_role;
create policy "Manage own account preferences" on public.account_preferences
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "Manage own drafts" on public.content_drafts
  for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "Read own notifications" on public.app_notifications
  for select to authenticated using (recipient_id = (select auth.uid()));
create policy "Mark own notifications read" on public.app_notifications
  for update to authenticated using (recipient_id = (select auth.uid())) with check (recipient_id = (select auth.uid()));
create policy "Submit own reports" on public.content_reports
  for insert to authenticated with check (reporter_id = (select auth.uid()));

-- Clear chat is local to each participant's history.
drop policy "Participants read visible messages" on public.messages;
create policy "Participants read visible messages" on public.messages
  for select to authenticated using (
    app_private.is_conversation_participant(conversation_id)
    and (expires_at is null or expires_at > now())
    and not exists (select 1 from public.hidden_messages h where h.user_id = (select auth.uid()) and h.message_id = messages.id)
    and not exists (
      select 1 from public.conversation_preferences p
      where p.conversation_id = messages.conversation_id and p.user_id = (select auth.uid()) and p.cleared_at >= messages.created_at
    )
  );

create function app_private.can_download_chat_file(path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select not exists (
    select 1 from public.messages m where m.object_path = path
      and (m.attachment_expires_at <= now() or m.expires_at <= now())
  )
$$;
revoke all on function app_private.can_download_chat_file(text) from public;
grant execute on function app_private.can_download_chat_file(text) to authenticated;
drop policy "Participants download shared attachments" on storage.objects;
create policy "Participants download active attachments" on storage.objects
  for select to authenticated using (
    bucket_id = 'chat-attachments'
    and app_private.can_access_attachment_folder(name)
    and app_private.can_download_chat_file(name)
    and (
      split_part(name, '/', 2) = (select auth.uid())::text
      or exists (select 1 from public.messages m where m.object_path = storage.objects.name)
    )
  );

create table public.story_highlights (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  title text not null check (char_length(btrim(title)) between 1 and 80),
  story_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);
alter table public.story_highlights enable row level security;
revoke all on public.story_highlights from anon, authenticated;
grant select, insert, update, delete on public.story_highlights to authenticated;
create policy "Manage own highlights" on public.story_highlights
  for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

create table public.communities (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  description text not null default '' check (char_length(description) <= 1000),
  created_at timestamptz not null default now()
);
create table public.community_members (
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  joined_at timestamptz not null default now(),
  primary key (community_id, user_id)
);
alter table public.communities enable row level security;
alter table public.community_members enable row level security;
revoke all on public.communities, public.community_members from anon, authenticated;
grant select, insert, delete on public.communities, public.community_members to authenticated;
grant update (name, description) on public.communities to authenticated;
create policy "Read community directory" on public.communities
  for select to authenticated using (not app_private.account_is_blocked(owner_id));
create policy "Create own community" on public.communities
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "Update own community" on public.communities
  for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "Delete own community" on public.communities
  for delete to authenticated using (owner_id = (select auth.uid()));
create policy "Read own community memberships" on public.community_members
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Join accessible communities" on public.community_members
  for insert to authenticated with check (user_id = (select auth.uid()) and exists (
    select 1 from public.communities c where c.id = community_members.community_id
  ));
create policy "Leave own community membership" on public.community_members
  for delete to authenticated using (user_id = (select auth.uid()));

commit;
