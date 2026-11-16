begin;

create or replace function public.publish_connected_story(
  story_id uuid, caption_text text, story_audience text, starts_at timestamptz,
  mime text, composition jsonb
)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  owner uuid := auth.uid();
  starts timestamptz := greatest(now(), starts_at);
  object_name text := owner::text || '/' || story_id::text || '/story';
begin
  if owner is null or story_id is null or mime is null or mime !~ '^(image|video)/'
    or story_audience is null or story_audience not in ('public','close_friends')
    or composition is null or jsonb_typeof(composition) <> 'object' or octet_length(composition::text) > 262144
    or not exists (select 1 from storage.objects where bucket_id = 'app-media' and name = object_name)
  then raise exception 'Invalid Story upload' using errcode = '22023'; end if;

  insert into public.media_content(id, owner_id, kind, caption, audience, publish_at, expires_at, metadata)
  values (story_id, owner, 'story', caption_text, story_audience, starts, starts + interval '24 hours', composition);
  insert into public.media_assets(content_id, owner_id, position, object_path, mime_type)
  values (story_id, owner, 0, object_name, mime);
end;
$$;

create or replace function public.connected_story_feed()
returns table (
  id uuid, owner_id uuid, username text, display_name text, avatar_path text,
  caption text, audience text, publish_at timestamptz, expires_at timestamptz, metadata jsonb,
  object_path text, mime_type text
)
language sql stable security invoker set search_path = '' as $$
  select c.id, c.owner_id, p.username, p.display_name, p.avatar_path, c.caption, c.audience,
         c.publish_at, c.expires_at, c.metadata, a.object_path, a.mime_type
  from public.media_content c
  join public.media_assets a on a.content_id = c.id and a.position = 0
  join public.profiles p on p.id = c.owner_id
  where c.kind = 'story' and c.expires_at > now() and auth.uid() is not null
    and (c.owner_id = auth.uid() or (c.publish_at <= now() and exists (
      select 1 from public.account_follows f where f.follower_id = auth.uid()
        and f.followed_id = c.owner_id and f.status = 'accepted'
    )))
  order by c.publish_at desc, c.id
  limit 200;
$$;

revoke all on function public.publish_connected_story(uuid,text,text,timestamptz,text,jsonb),
  public.connected_story_feed() from public, anon;
grant execute on function public.publish_connected_story(uuid,text,text,timestamptz,text,jsonb),
  public.connected_story_feed() to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'media_content') then
    alter publication supabase_realtime add table public.media_content;
  end if;
end
$$;

commit;
