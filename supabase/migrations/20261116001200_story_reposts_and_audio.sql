begin;

alter table public.media_content
  add column if not exists story_source_id uuid references public.media_content(id) on delete cascade,
  add column if not exists story_post_owner uuid,
  add column if not exists story_post_id bigint,
  add column if not exists story_audio boolean not null default false;

alter table public.media_content
  drop constraint if exists story_image_source_fk,
  drop constraint if exists story_source_shape;

alter table public.media_content
  add constraint story_image_source_fk foreign key (story_post_owner, story_post_id)
    references public.image_posts(owner_id, client_id) match full on delete cascade,
  add constraint story_source_shape check (
    (kind = 'story' or (story_source_id is null and story_post_id is null and not story_audio))
    and (story_source_id is null or (story_post_id is null and story_source_id <> id))
  );

update storage.buckets
set allowed_mime_types = array['image/*','video/*','audio/*']
where id = 'app-media';

-- Follow live source permissions at every link, including when a source expires.
create or replace function app_private.story_source_visible(target uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  entry public.media_content%rowtype;
  steps integer := 0;
begin
  if auth.uid() is null then return false; end if;
  select * into entry from public.media_content where id = target;
  if not found then return false; end if;
  while entry.story_source_id is not null loop
    steps := steps + 1;
    if steps > 16 then return false; end if;
    select * into entry from public.media_content where id = entry.story_source_id;
    if not found or entry.publish_at > now() or entry.expires_at <= now()
      or not app_private.can_view_content(entry.id) then return false; end if;
  end loop;
  if entry.story_post_id is not null then
    return exists (select 1 from public.image_posts p
      where p.owner_id = entry.story_post_owner and p.client_id = entry.story_post_id
        and app_private.can_view_image_post(p.owner_id, p.is_public));
  end if;
  return true;
end;
$$;
revoke all on function app_private.story_source_visible(uuid) from public, anon;
grant execute on function app_private.story_source_visible(uuid) to authenticated;

drop policy if exists "Honor Story source access" on public.media_content;
create policy "Honor Story source access" on public.media_content
  as restrictive for select to authenticated
  using (kind <> 'story' or (story_source_id is null and story_post_id is null)
    or app_private.story_source_visible(id));

drop policy if exists "Read authorized Story soundtracks" on storage.objects;
create policy "Read authorized Story soundtracks" on storage.objects for select to authenticated
  using (bucket_id = 'app-media' and exists (
    select 1 from public.media_content c where c.kind = 'story' and c.story_audio
      and storage.objects.name = c.owner_id::text || '/' || c.id::text || '/soundtrack'
      and app_private.can_view_content(c.id) and app_private.story_source_visible(c.id)
  ));

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
      select 1 from public.media_content c where id=source_id and c.kind='story' and c.publish_at <= now()
        and c.expires_at > now()))
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
    and (c.owner_id = auth.uid() or (c.publish_at <= now() and exists (
      select 1 from public.account_follows f where f.follower_id = auth.uid()
        and f.followed_id = c.owner_id and f.status = 'accepted'
    )))
  order by c.publish_at desc, c.id
  limit 200;
$$;

revoke all on function public.publish_story_with_media(uuid,text,text,timestamptz,text,jsonb,boolean,uuid,uuid,bigint,timestamptz),
  public.connected_story_feed_with_media() from public, anon;
grant execute on function public.publish_story_with_media(uuid,text,text,timestamptz,text,jsonb,boolean,uuid,uuid,bigint,timestamptz),
  public.connected_story_feed_with_media() to authenticated;

commit;
