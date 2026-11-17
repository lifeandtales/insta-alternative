begin;

-- The current profile avatar is part of the signed-in directory.
drop policy if exists "Respect avatar privacy" on storage.objects;
create policy "Respect avatar privacy" on storage.objects as restrictive for select to authenticated
  using (bucket_id <> 'avatars' or exists (
    select 1 from public.profiles p where p.avatar_path = storage.objects.name
      and not app_private.account_is_blocked(p.id)
  ) or (storage.foldername(name))[1] = auth.uid()::text);

create or replace function public.search_social_people(search_text text)
returns table (id uuid, username text, display_name text, bio text, is_private boolean, follow_status text, avatar_path text)
language sql stable security invoker set search_path = '' as $$
  select found.id, found.username, found.display_name, found.bio, found.is_private, found.follow_status,
    p.avatar_path
  from public.search_explore_people(search_text) with ordinality as found
  join public.profiles p on p.id = found.id
  order by found.ordinality;
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
    'avatar_path', account.avatar_path,
    'post_count', ((select count(*) from public.image_posts p where p.owner_id = target)
      + (select count(*) from public.media_content c where c.owner_id = target and c.kind = 'post'
        and c.publish_at <= now() and (c.expires_at is null or c.expires_at > now()))),
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

create or replace function app_private.can_view_content(content uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.media_content c
    join public.profiles p on p.id = c.owner_id
    where c.id = content and auth.uid() is not null and (
      c.owner_id = auth.uid() or (
        not app_private.account_is_blocked(c.owner_id)
        and (c.kind = 'story' or app_private.can_view_image_post(c.owner_id, true))
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

commit;
