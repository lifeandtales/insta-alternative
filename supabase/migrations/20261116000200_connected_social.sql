-- Apply after the combined backend and Explore People migrations.
begin;

create or replace function app_private.can_view_image_post(author uuid, published_publicly boolean)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (
    author = auth.uid() or (
      not app_private.account_is_blocked(author)
      and exists (
        select 1 from public.profiles p where p.id = author and (
          (published_publicly and not p.is_private) or exists (
            select 1 from public.account_follows f
            where f.follower_id = auth.uid() and f.followed_id = author and f.status = 'accepted'
          )
        )
      )
    )
  );
$$;
revoke all on function app_private.can_view_image_post(uuid, boolean) from public, anon;
grant execute on function app_private.can_view_image_post(uuid, boolean) to authenticated;

drop policy if exists "Owners read their image posts" on public.image_posts;
drop policy if exists "Read visible image posts" on public.image_posts;
create policy "Read visible image posts" on public.image_posts for select to authenticated
  using (app_private.can_view_image_post(owner_id, is_public));

create index if not exists image_posts_items_paths_idx on public.image_posts using gin (items jsonb_path_ops);
create index if not exists image_posts_latest_idx on public.image_posts (created_at desc);
drop policy if exists "Read images attached to visible posts" on storage.objects;
create policy "Read images attached to visible posts" on storage.objects for select to authenticated
  using (bucket_id = 'post-images' and exists (
    select 1 from public.image_posts p
    where p.owner_id::text = split_part(storage.objects.name, '/', 1)
      and p.items @> jsonb_build_array(jsonb_build_object('path', storage.objects.name))
  ));

-- Reuse the existing avatar bucket and close the private-account visibility check.
drop policy if exists "Respect avatar privacy" on storage.objects;
create policy "Respect avatar privacy" on storage.objects as restrictive for select to authenticated
  using (bucket_id <> 'avatars' or exists (
    select 1 from public.profiles p where p.avatar_path = storage.objects.name
      and app_private.can_view_image_post(p.id, true)
  ) or (storage.foldername(name))[1] = auth.uid()::text);

create or replace function public.search_social_people(search_text text)
returns table (id uuid, username text, display_name text, bio text, is_private boolean, follow_status text, avatar_path text)
language sql stable security invoker set search_path = '' as $$
  select found.id, found.username, found.display_name, found.bio, found.is_private, found.follow_status,
    case when app_private.can_view_image_post(p.id, true) then p.avatar_path end
  from public.search_explore_people(search_text) with ordinality as found
  join public.profiles p on p.id = found.id
  order by found.ordinality;
$$;

create or replace function app_private.accounts_follow_each_other(other_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.account_follows outgoing join public.account_follows incoming
      on incoming.follower_id = outgoing.followed_id and incoming.followed_id = outgoing.follower_id
    where outgoing.follower_id = auth.uid() and outgoing.followed_id = other_user
      and outgoing.status = 'accepted' and incoming.status = 'accepted'
  );
$$;
revoke all on function app_private.accounts_follow_each_other(uuid) from public, anon;
grant execute on function app_private.accounts_follow_each_other(uuid) to authenticated;

create or replace function public.open_mutual_chat(other_user uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
begin
  if not app_private.accounts_follow_each_other(other_user) then
    raise exception 'Both accounts must follow each other' using errcode = '42501';
  end if;
  return public.open_direct_chat(other_user);
end;
$$;

create or replace function public.social_profile(target uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  account public.profiles%rowtype;
  outgoing text;
begin
  if auth.uid() is null or app_private.account_is_blocked(target) then return null; end if;
  select * into account from public.profiles where id = target;
  if not found then return null; end if;
  select status into outgoing from public.account_follows where follower_id = auth.uid() and followed_id = target;
  return jsonb_build_object(
    'id', account.id, 'username', account.username, 'display_name', account.display_name,
    'bio', case when not account.is_private or outgoing = 'accepted' or target = auth.uid() then account.bio else '' end,
    'is_private', account.is_private, 'follow_status', outgoing,
    'avatar_path', case when app_private.can_view_image_post(target, true) then account.avatar_path end,
    'mutual', app_private.accounts_follow_each_other(target),
    'followers', (select count(*) from public.account_follows f
      where f.followed_id = target and f.status = 'accepted'
        and not app_private.account_is_blocked(f.follower_id)),
    'following', (select count(*) from public.account_follows f
      where f.follower_id = target and f.status = 'accepted'
        and not app_private.account_is_blocked(f.followed_id))
  );
end;
$$;

create or replace function public.social_connections(target uuid, direction text, page_offset integer default 0)
returns table (id uuid, username text, display_name text, avatar_path text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.username, p.display_name, case when app_private.can_view_image_post(p.id, true) then p.avatar_path end
  from public.account_follows f join public.profiles p
    on p.id = case when direction = 'followers' then f.follower_id else f.followed_id end
  where auth.uid() is not null and f.status = 'accepted'
    and (direction = 'followers' and f.followed_id = target or direction = 'following' and f.follower_id = target)
    and not app_private.account_is_blocked(target) and not app_private.account_is_blocked(p.id)
    and exists (select 1 from public.profiles owner where owner.id = target and (
      not owner.is_private or owner.id = auth.uid() or exists (
        select 1 from public.account_follows viewer
        where viewer.follower_id = auth.uid() and viewer.followed_id = target and viewer.status = 'accepted'
      )
    ))
  order by p.username
  limit 51 offset greatest(coalesce(page_offset, 0), 0);
$$;

-- Use the existing message visibility and membership policies for both history and inbox previews.
create or replace function public.direct_inbox()
returns table (id uuid, peer_id uuid, username text, display_name text, body text,
  kind text, sent_at timestamptz, unread boolean, avatar_path text)
language sql stable security invoker set search_path = '' as $$
  select c.id, p.id, p.username, p.display_name, latest.body, latest.kind, latest.created_at,
    latest.sender_id <> auth.uid() and latest.created_at > coalesce(pref.last_read_at, '-infinity'::timestamptz),
    case when app_private.can_view_image_post(p.id,true) then p.avatar_path end
  from public.conversations c
  join public.profiles p on p.id = case when c.participant_a = auth.uid() then c.participant_b else c.participant_a end
  left join public.conversation_preferences pref on pref.conversation_id = c.id and pref.user_id = auth.uid()
  join lateral (
    select m.body, m.kind, m.created_at, m.sender_id from public.messages m
    where m.conversation_id = c.id order by m.created_at desc, m.id desc limit 1
  ) latest on true
  where c.group_name is null and auth.uid() in (c.participant_a, c.participant_b)
  order by latest.created_at desc, c.id
  limit 100;
$$;

create or replace function public.mark_direct_chat_read(target uuid, seen_at timestamptz)
returns void language sql security invoker set search_path = '' as $$
  insert into public.conversation_preferences as pref (conversation_id, user_id, last_read_at)
  select target, auth.uid(), least(seen_at, now())
  where auth.uid() is not null and seen_at is not null
  on conflict (conversation_id,user_id) do update
  set last_read_at = greatest(pref.last_read_at, excluded.last_read_at);
$$;

drop policy if exists "Hide direct messages from blocked accounts" on public.messages;
create policy "Hide direct messages from blocked accounts" on public.messages as restrictive
  for select to authenticated using (exists (
    select 1 from public.conversations c where c.id = conversation_id and (
      c.group_name is not null or not app_private.account_is_blocked(
        case when c.participant_a = auth.uid() then c.participant_b else c.participant_a end
      )
    )
  ));

-- An existing chat remains readable after unfollowing. New sends require mutual following.
drop policy if exists "Mutual following required for direct sends" on public.messages;
create policy "Mutual following required for direct sends" on public.messages as restrictive
  for insert to authenticated with check (exists (
    select 1 from public.conversations c where c.id = conversation_id and (
      c.group_name is not null or app_private.accounts_follow_each_other(
        case when c.participant_a = auth.uid() then c.participant_b else c.participant_a end
      )
    )
  ));

revoke all on function public.social_profile(uuid), public.social_connections(uuid,text,integer), public.search_social_people(text),
  public.open_mutual_chat(uuid), public.direct_inbox(), public.mark_direct_chat_read(uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.social_profile(uuid), public.social_connections(uuid,text,integer), public.search_social_people(text),
  public.open_mutual_chat(uuid), public.direct_inbox(), public.mark_direct_chat_read(uuid,timestamptz) to authenticated;

do $$
declare relation text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime' and puballtables) then
    foreach relation in array array['profiles', 'account_follows', 'messages', 'image_posts', 'media_content'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
        and schemaname = 'public' and tablename = relation) then
        execute format('alter publication supabase_realtime add table public.%I', relation);
      end if;
    end loop;
  end if;
end;
$$;

commit;
