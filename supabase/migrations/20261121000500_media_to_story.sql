begin;

create or replace function public.publish_story_with_media(
  story_id uuid, caption_text text, story_audience text, starts_at timestamptz,
  mime text, composition jsonb, soundtrack boolean default false, source_id uuid default null,
  post_owner uuid default null, post_id bigint default null, imported_expiry timestamptz default null
)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  owner uuid := auth.uid();
  starts timestamptz := case when imported_expiry is not null then starts_at else greatest(now(), starts_at) end;
  ends timestamptz := coalesce(imported_expiry, starts + interval '24 hours');
  folder text := owner::text || '/' || story_id::text || '/';
begin
  if owner is null or story_id is null or starts is null or ends <= greatest(starts, now())
    or (imported_expiry is not null and (starts > now() or ends > starts + interval '24 hours'))
    or story_audience is null or story_audience not in ('public','close_friends')
    or composition is null or jsonb_typeof(composition) <> 'object' or octet_length(composition::text) > 262144
    or (post_owner is null) <> (post_id is null) or (source_id is not null and post_id is not null)
    or (source_id is null and post_id is null and (
      mime is null or mime !~ '^(image|video)/' or not exists (
        select 1 from storage.objects where bucket_id='app-media' and name=folder || 'story')))
    or (soundtrack and not exists (
      select 1 from storage.objects where bucket_id='app-media' and name=folder || 'soundtrack'))
    or (source_id is not null and not exists (
      select 1 from public.media_content c where id=source_id and c.kind in ('story', 'reel') and c.publish_at <= now()
        and (c.expires_at > now() or (c.kind = 'reel' and c.expires_at is null))
        and (c.kind = 'story' or exists (select 1 from public.media_assets a
          where a.content_id = c.id and a.position = 0 and a.mime_type like 'video/%'))))
    or (post_id is not null and not exists (
      select 1 from public.image_posts p where p.owner_id=post_owner and p.client_id=post_id))
  then raise exception 'Story upload or original source is unavailable' using errcode = '22023'; end if;

  insert into public.media_content(id, owner_id, kind, caption, audience, publish_at, expires_at,
    metadata, story_source_id, story_post_owner, story_post_id, story_audio)
  values (story_id, owner, 'story', caption_text, story_audience, starts, ends,
    composition, source_id, post_owner, post_id, coalesce(soundtrack,false));
  if source_id is null and post_id is null then
    insert into public.media_assets(content_id, owner_id, position, object_path, mime_type)
    values (story_id, owner, 0, folder || 'story', mime);
  end if;
end;
$$;

create or replace function public.connected_story_feed_with_media()
returns table (
  id uuid, owner_id uuid, username text, display_name text, avatar_path text,
  caption text, audience text, publish_at timestamptz, expires_at timestamptz, metadata jsonb,
  object_path text, mime_type text, media_bucket text, audio_path text,
  source_details jsonb
) language sql stable security invoker set search_path = '' as $$
  select c.id, c.owner_id, p.username, p.display_name, p.avatar_path, c.caption, c.audience,
    c.publish_at, c.expires_at, c.metadata,
    coalesce(asset.object_path, source_post.items -> 0 ->> 'path'),
    coalesce(asset.mime_type, case when source_post.owner_id is not null then
      case when source_post.items -> 0 -> 'settings' ->> 'type' = 'video' then 'video/post' else 'image/post' end end),
    case when source_post.owner_id is null then 'app-media' else 'post-images' end,
    case when c.story_audio then c.owner_id::text || '/' || c.id::text || '/soundtrack' end,
    case when original.id is not null then jsonb_build_object(
      'kind',original.kind,'id',original.id,'owner_id',original.owner_id,'username',original_author.username,
      'display_name',original_author.display_name,'avatar_path',original_author.avatar_path,
      'metadata',original.metadata,'audio_path',case when original.story_audio
        then original.owner_id::text || '/' || original.id::text || '/soundtrack' end,
      'sensitive', root.metadata -> 'sensitive'
    ) when source_post.owner_id is not null then jsonb_build_object(
      'kind','post','id',source_post.client_id,'owner_id',source_post.owner_id,'username',post_author.username,
      'display_name',post_author.display_name,'avatar_path',post_author.avatar_path
    ) end
  from public.media_content c
  join public.profiles p on p.id = c.owner_id
  left join public.media_content original on original.id = c.story_source_id
  left join public.profiles original_author on original_author.id = original.owner_id
  join lateral (
    with recursive chain(id, source, depth) as (
      select c.id, c.story_source_id, 0
      union all
      select m.id, m.story_source_id, chain.depth + 1
      from chain join public.media_content m on m.id = chain.source where chain.depth < 16
    )
    select id from chain where source is null limit 1
  ) terminal on true
  join public.media_content root on root.id = terminal.id
  left join public.media_assets asset on asset.content_id = root.id and asset.position = 0
  left join public.image_posts source_post
    on source_post.owner_id = root.story_post_owner and source_post.client_id = root.story_post_id
  left join public.profiles post_author on post_author.id = source_post.owner_id
  where c.kind = 'story' and c.expires_at > now() and auth.uid() is not null
    and (asset.object_path is not null or source_post.owner_id is not null)
    and (c.owner_id = auth.uid() or (c.publish_at <= now() and exists (
      select 1 from public.account_follows f where f.follower_id = auth.uid()
        and f.followed_id = c.owner_id and f.status = 'accepted'
    )))
  order by c.publish_at desc, c.id
  limit 200;
$$;

create or replace function public.connected_inbox_story_feed()
returns table (
  id uuid, owner_id uuid, username text, display_name text, avatar_path text,
  caption text, audience text, publish_at timestamptz, expires_at timestamptz, metadata jsonb,
  object_path text, mime_type text, media_bucket text, audio_path text,
  source_details jsonb
) language sql stable security invoker set search_path = '' as $$
  select c.id, c.owner_id, p.username, p.display_name, p.avatar_path, c.caption, c.audience,
    c.publish_at, c.expires_at, c.metadata,
    coalesce(asset.object_path, source_post.items -> 0 ->> 'path'),
    coalesce(asset.mime_type, case when source_post.owner_id is not null then
      case when source_post.items -> 0 -> 'settings' ->> 'type' = 'video' then 'video/post' else 'image/post' end end),
    case when source_post.owner_id is null then 'app-media' else 'post-images' end,
    case when c.story_audio then c.owner_id::text || '/' || c.id::text || '/soundtrack' end,
    case when original.id is not null then jsonb_build_object(
      'kind',original.kind,'id',original.id,'owner_id',original.owner_id,'username',original_author.username,
      'display_name',original_author.display_name,'avatar_path',original_author.avatar_path,
      'metadata',original.metadata,'audio_path',case when original.story_audio
        then original.owner_id::text || '/' || original.id::text || '/soundtrack' end,
      'sensitive', root.metadata -> 'sensitive'
    ) when source_post.owner_id is not null then jsonb_build_object(
      'kind','post','id',source_post.client_id,'owner_id',source_post.owner_id,'username',post_author.username,
      'display_name',post_author.display_name,'avatar_path',post_author.avatar_path
    ) end
  from public.media_content c
  join public.profiles p on p.id = c.owner_id
  left join public.media_content original on original.id = c.story_source_id
  left join public.profiles original_author on original_author.id = original.owner_id
  join lateral (
    with recursive chain(id, source, depth) as (
      select c.id, c.story_source_id, 0
      union all
      select m.id, m.story_source_id, chain.depth + 1
      from chain join public.media_content m on m.id = chain.source where chain.depth < 16
    )
    select id from chain where source is null limit 1
  ) terminal on true
  join public.media_content root on root.id = terminal.id
  left join public.media_assets asset on asset.content_id = root.id and asset.position = 0
  left join public.image_posts source_post
    on source_post.owner_id = root.story_post_owner and source_post.client_id = root.story_post_id
  left join public.profiles post_author on post_author.id = source_post.owner_id
  where c.kind = 'story' and c.expires_at > now() and auth.uid() is not null
    and (asset.object_path is not null or source_post.owner_id is not null)
    and c.publish_at <= now() and exists (
      select 1 from public.connected_direct_inbox() i where i.peer_id = c.owner_id
    )
  order by c.publish_at desc, c.id
  limit 200;
$$;


create or replace function app_private.highlight_story_assets(target uuid, story_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id',c.id,'owner_id',c.owner_id,'username',p.username,'display_name',p.display_name,
    'avatar_path',p.avatar_path,'caption',c.caption,'audience',c.audience,
    'publish_at',c.publish_at,'expires_at',c.expires_at,'metadata',c.metadata,
    'object_path',coalesce(a.object_path, post.items -> 0 ->> 'path'),
    'mime_type',coalesce(a.mime_type, case when post.items -> 0 -> 'settings' ->> 'type' = 'video' then 'video/post' else 'image/post' end),
    'media_bucket',case when post.owner_id is null then 'app-media' else 'post-images' end,
    'audio_path',case when c.story_audio then c.owner_id::text || '/' || c.id::text || '/soundtrack' end,
    'source_details',case when original.id is not null then jsonb_build_object(
      'kind',original.kind,'id',original.id,'owner_id',original.owner_id,'username',original_author.username,
      'display_name',original_author.display_name,'avatar_path',original_author.avatar_path,
      'metadata',original.metadata,'audio_path',case when original.story_audio
        then original.owner_id::text || '/' || original.id::text || '/soundtrack' end,
      'sensitive',root.metadata -> 'sensitive') when post.owner_id is not null then jsonb_build_object(
      'kind','post','id',post.client_id,'owner_id',post.owner_id,'username',post_author.username,
      'display_name',post_author.display_name,'avatar_path',post_author.avatar_path
    ) end)
  from public.media_content c
  join public.profiles p on p.id=c.owner_id
  left join public.story_highlights h on h.id=target and h.owner_id=c.owner_id
  left join public.media_content original on original.id=c.story_source_id
  left join public.profiles original_author on original_author.id=original.owner_id
  join lateral (
    with recursive chain(id,source,depth) as (
      select c.id,c.story_source_id,0
      union all
      select m.id,m.story_source_id,chain.depth+1
      from chain join public.media_content m on m.id=chain.source where chain.depth<16
    ) select id from chain where source is null limit 1
  ) terminal on true
  join public.media_content root on root.id=terminal.id
  left join public.media_assets a on a.content_id=root.id and a.position=0
  left join public.image_posts post on post.owner_id=root.story_post_owner and post.client_id=root.story_post_id
  left join public.profiles post_author on post_author.id = post.owner_id
  where c.id=story_id and c.kind='story' and c.publish_at<=now() and app_private.story_source_visible(c.id)
    and (a.object_path is not null or post.owner_id is not null)
    and (
      (target is null and c.owner_id=auth.uid())
      or (c.id=any(h.story_ids) and app_private.can_view_story_highlight(h.id)
        and (c.owner_id=auth.uid() or c.audience='public'
          or (c.audience='followers' and exists (select 1 from public.account_follows f
            where f.follower_id=auth.uid() and f.followed_id=c.owner_id and f.status='accepted'))
          or (c.audience='close_friends' and exists (select 1 from public.close_friends f
            where f.owner_id=c.owner_id and f.friend_id=auth.uid()))))
    );
$$;

commit;
