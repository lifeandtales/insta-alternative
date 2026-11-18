begin;

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
    coalesce(asset.mime_type, case when source_post.owner_id is not null then 'image/post' end),
    case when source_post.owner_id is null then 'app-media' else 'post-images' end,
    case when c.story_audio then c.owner_id::text || '/' || c.id::text || '/soundtrack' end,
    case when original.id is not null then jsonb_build_object(
      'id',original.id,'owner_id',original.owner_id,'username',original_author.username,
      'display_name',original_author.display_name,'avatar_path',original_author.avatar_path,
      'metadata',original.metadata,'audio_path',case when original.story_audio
        then original.owner_id::text || '/' || original.id::text || '/soundtrack' end,
      'sensitive', root.metadata -> 'sensitive'
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
  where c.kind = 'story' and c.expires_at > now() and auth.uid() is not null
    and (asset.object_path is not null or source_post.owner_id is not null)
    and c.publish_at <= now() and exists (
      select 1 from public.connected_direct_inbox() i where i.peer_id = c.owner_id
    )
  order by c.publish_at desc, c.id
  limit 200;
$$;


revoke all on function public.connected_inbox_story_feed() from public, anon;
grant execute on function public.connected_inbox_story_feed() to authenticated;
commit;
