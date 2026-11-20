begin;

create index if not exists media_interactions_content_kind_idx
  on public.media_interactions (content_id, kind);

create table if not exists public.video_post_views (
  post_owner_id uuid not null,
  post_client_id bigint not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary key (post_owner_id, post_client_id, user_id),
  foreign key (post_owner_id, post_client_id)
    references public.image_posts(owner_id, client_id) on delete cascade
);
alter table public.video_post_views enable row level security;
revoke all on public.video_post_views from public, anon, authenticated;

update storage.buckets
set allowed_mime_types = array_append(allowed_mime_types, 'video/*')
where id = 'post-images' and allowed_mime_types is not null
  and not ('video/*' = any(allowed_mime_types));

drop policy if exists "Read visible video post covers" on storage.objects;
create policy "Read visible video post covers" on storage.objects for select to authenticated
  using (bucket_id = 'post-images' and exists (
    select 1 from public.image_posts p
    where p.items @> jsonb_build_array(jsonb_build_object('cover_path', storage.objects.name))
      and split_part(storage.objects.name, '/', 1) = p.owner_id::text
      and app_private.can_view_image_post(p.owner_id, p.is_public)
  ));

create or replace function public.publish_video_reel(
  target uuid, caption_text text, reel_audience text, details jsonb,
  video_mime text, cover_mime text, duration_seconds double precision
) returns void language plpgsql security invoker set search_path = '' as $$
declare
  owner uuid := auth.uid();
  prefix text;
begin
  if owner is null or video_mime not like 'video/%' or cover_mime not like 'image/%'
      or reel_audience not in ('public', 'followers') then
    raise exception 'Invalid reel' using errcode = '22023';
  end if;
  prefix := owner::text || '/' || target::text || '/';
  insert into public.media_content(id, owner_id, kind, caption, audience, metadata)
  values (target, owner, 'reel', caption_text, reel_audience, details)
  on conflict (id) do nothing;
  if not exists (select 1 from public.media_content c where c.id = target and c.owner_id = owner and c.kind = 'reel') then
    raise exception 'Reel unavailable' using errcode = '42501';
  end if;
  insert into public.media_assets(content_id, owner_id, position, object_path, mime_type, metadata)
  values
    (target, owner, 0, prefix || 'video', video_mime, jsonb_build_object('duration_seconds', duration_seconds)),
    (target, owner, 1, prefix || 'cover', cover_mime, '{}'::jsonb)
  on conflict (content_id, position) do nothing;
end
$$;

-- Stories keep their existing engagement path. Video views use the qualified RPC.
drop policy if exists "Interact with visible content" on public.media_interactions;
create policy "Interact with visible content" on public.media_interactions
  for insert to authenticated with check (
    user_id = (select auth.uid()) and app_private.can_view_content(content_id)
    and (kind <> 'view' or exists (
      select 1 from public.media_content c where c.id = content_id and c.kind = 'story'
    ))
  );

create or replace function public.video_engagement(target_reels uuid[], target_posts jsonb)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'reels', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'views', totals.views,
        'likes', totals.likes, 'liked', coalesce(totals.liked, false),
        'viewed', coalesce(totals.viewed, false)))
      from public.media_content c
      cross join lateral (
        select count(*) filter (where i.kind = 'view') as views,
          count(*) filter (where i.kind = 'like' and not app_private.account_is_blocked(i.user_id)) as likes,
          bool_or(i.user_id = auth.uid() and i.kind = 'like') as liked,
          bool_or(i.user_id = auth.uid() and i.kind = 'view') as viewed
        from public.media_interactions i where i.content_id = c.id and i.kind in ('like', 'view')
      ) totals
      where c.id = any(target_reels) and c.kind = 'reel' and c.publish_at <= now()
        and app_private.can_view_content(c.id)
    ), '[]'::jsonb),
    'posts', coalesce((
      select jsonb_agg(jsonb_build_object('owner', p.owner_id, 'id', p.client_id,
        'views', totals.views, 'viewed', coalesce(totals.viewed, false)))
      from jsonb_to_recordset(target_posts) as targets(owner uuid, id bigint)
      join public.image_posts p on p.owner_id = targets.owner and p.client_id = targets.id
      cross join lateral (
        select count(*) as views, bool_or(v.user_id = auth.uid()) as viewed
        from public.video_post_views v where v.post_owner_id = p.owner_id and v.post_client_id = p.client_id
      ) totals
      where app_private.can_view_image_post(p.owner_id, p.is_public)
    ), '[]'::jsonb)
  )
$$;

create or replace function public.record_qualified_video_view(
  reel_id uuid, post_owner uuid, post_id bigint, asset_index integer,
  duration_seconds double precision, watched_seconds double precision
) returns bigint language plpgsql security definer set search_path = '' as $$
declare
  viewer uuid := auth.uid();
  stored_duration double precision;
  result bigint;
begin
  if viewer is null or (reel_id is null) = (post_owner is null or post_id is null)
      or not coalesce(duration_seconds > 0 and duration_seconds <= 86400
        and watched_seconds between duration_seconds / 2 and duration_seconds, false) then
    raise exception 'A qualified video view is required' using errcode = '22023';
  end if;
  if reel_id is not null then
    select case when jsonb_typeof(a.metadata->'duration_seconds') = 'number'
        then (a.metadata->>'duration_seconds')::double precision end
      into stored_duration
    from public.media_content c join public.media_assets a on a.content_id = c.id
    where c.id = reel_id and c.kind = 'reel' and c.publish_at <= now() and a.mime_type like 'video/%'
      and app_private.can_view_content(c.id)
    order by a.position limit 1;
  else
    select case when jsonb_typeof(p.items->asset_index->'duration_seconds') = 'number'
        then (p.items->asset_index->>'duration_seconds')::double precision end
      into stored_duration
    from public.image_posts p where p.owner_id = post_owner and p.client_id = post_id
      and asset_index between 0 and 19
      and p.items->asset_index->'settings'->>'type' = 'video'
      and app_private.can_view_image_post(p.owner_id, p.is_public);
  end if;
  if not found then raise exception 'Video unavailable' using errcode = '42501'; end if;
  if stored_duration > 0 and watched_seconds < stored_duration / 2 then
    raise exception 'Watch at least half of the video' using errcode = '22023';
  end if;
  if reel_id is not null then
    insert into public.media_interactions(content_id, user_id, kind)
    values (reel_id, viewer, 'view') on conflict do nothing;
    select count(*) into result from public.media_interactions where content_id = reel_id and kind = 'view';
  else
    insert into public.video_post_views values (post_owner, post_id, viewer) on conflict do nothing;
    select count(*) into result from public.video_post_views
      where post_owner_id = post_owner and post_client_id = post_id;
  end if;
  return result;
end
$$;

create or replace function public.set_reel_like(target uuid, desired boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or desired is null or not exists (
    select 1 from public.media_content c where c.id = target and c.kind = 'reel'
      and c.publish_at <= now() and app_private.can_view_content(c.id)
  ) then raise exception 'Reel unavailable' using errcode = '42501'; end if;
  if desired then
    insert into public.media_interactions(content_id, user_id, kind)
    values (target, auth.uid(), 'like') on conflict do nothing;
  else
    delete from public.media_interactions where content_id = target and user_id = auth.uid() and kind = 'like';
  end if;
  return public.video_engagement(array[target], '[]') -> 'reels' -> 0;
end
$$;

revoke all on function public.video_engagement(uuid[], jsonb),
  public.record_qualified_video_view(uuid, uuid, bigint, integer, double precision, double precision),
  public.set_reel_like(uuid, boolean), public.publish_video_reel(uuid, text, text, jsonb, text, text, double precision)
  from public, anon, authenticated;
grant execute on function public.video_engagement(uuid[], jsonb),
  public.record_qualified_video_view(uuid, uuid, bigint, integer, double precision, double precision),
  public.set_reel_like(uuid, boolean), public.publish_video_reel(uuid, text, text, jsonb, text, text, double precision)
  to authenticated;

commit;
