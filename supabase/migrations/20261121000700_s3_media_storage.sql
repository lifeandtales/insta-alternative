begin;

-- Supabase retains business data and authorization; this index locates private S3 bytes.
create table if not exists public.s3_media_objects (
  namespace text not null check (namespace in ('post-images','app-media','avatars','chat-attachments')),
  path text not null,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  category text not null check (category in ('post-photos','post-videos','stories','profile-photos','messages')),
  object_key text not null unique,
  mime_type text not null,
  byte_size bigint not null check (byte_size > 0 and byte_size <= 50000000),
  delete_requested boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (namespace,path),
  check (split_part(path,'/',case when namespace='chat-attachments' then 2 else 1 end)=owner_id::text),
  check (object_key like 'media/' || owner_id::text || '/%'),
  check ((namespace='avatars' and category='profile-photos' and mime_type like 'image/%' and byte_size<=10000000)
    or (namespace='post-images' and ((category='post-photos' and mime_type like 'image/%')
      or (category='post-videos' and mime_type like 'video/%')))
    or (namespace='app-media' and category='stories' and mime_type ~ '^(image|video|audio)/')
    or (namespace='chat-attachments' and category='messages'))
);
alter table public.s3_media_objects enable row level security;
revoke all on public.s3_media_objects from public, anon, authenticated;
grant select on public.s3_media_objects to authenticated;
grant select, insert, update, delete on public.s3_media_objects to service_role;
create index if not exists s3_media_objects_owner_idx on public.s3_media_objects(owner_id,delete_requested);

create or replace function app_private.can_read_s3_media(media_namespace text, media_path text, media_owner uuid)
returns boolean language sql stable security invoker set search_path='' as $$
  select auth.uid() is not null and (
    (media_namespace='chat-attachments' and exists (
      select 1 from public.messages m where m.object_path=media_path and m.sender_id=media_owner
        and (m.attachment_expires_at is null or m.attachment_expires_at>now())
    )) or (media_namespace<>'chat-attachments' and (media_owner=auth.uid() or (
    not app_private.account_is_blocked(media_owner) and (
      (media_namespace='avatars' and exists (
        select 1 from public.profiles p where p.id=media_owner and p.avatar_path=media_path))
      or (media_namespace='post-images' and exists (
        select 1 from public.image_posts p where p.owner_id=media_owner
          and app_private.can_view_image_post(p.owner_id,p.is_public)
          and (p.items @> jsonb_build_array(jsonb_build_object('path',media_path))
            or p.items @> jsonb_build_array(jsonb_build_object('cover_path',media_path)))))
      or (media_namespace='app-media' and (
        exists (select 1 from public.media_assets a where a.owner_id=media_owner and a.object_path=media_path
          and app_private.can_view_content(a.content_id) and app_private.story_source_visible(a.content_id))
        or exists (select 1 from public.media_content c where c.owner_id=media_owner and c.story_audio
          and media_path=c.owner_id::text || '/' || c.id::text || '/soundtrack'
          and app_private.can_view_content(c.id) and app_private.story_source_visible(c.id))
        or app_private.can_download_highlight_asset(media_path)
      ))
    )
  ))));
$$;
revoke all on function app_private.can_read_s3_media(text,text,uuid) from public, anon;
grant execute on function app_private.can_read_s3_media(text,text,uuid) to authenticated;
drop policy if exists "Read authorized S3 media" on public.s3_media_objects;
create policy "Read authorized S3 media" on public.s3_media_objects for select to authenticated
  using (not delete_requested and app_private.can_read_s3_media(namespace,path,owner_id));

-- Cleanup can be retried after a failed S3 request. Never delete a still-referenced object.
create or replace function app_private.s3_media_referenced(media_namespace text, media_path text)
returns boolean language sql stable security definer set search_path='' as $$
  select case media_namespace
    when 'avatars' then exists (select 1 from public.profiles p where p.avatar_path=media_path)
    when 'post-images' then exists (select 1 from public.image_posts p
      where p.items @> jsonb_build_array(jsonb_build_object('path',media_path))
        or p.items @> jsonb_build_array(jsonb_build_object('cover_path',media_path)))
    when 'chat-attachments' then exists (select 1 from public.messages m where m.object_path=media_path)
    when 'app-media' then exists (select 1 from public.media_assets a where a.object_path=media_path)
      or exists (select 1 from public.media_content c where c.story_audio
        and media_path=c.owner_id::text || '/' || c.id::text || '/soundtrack')
      or exists (select 1 from public.story_highlights h where h.cover_path=media_path)
    else true end;
$$;
revoke all on function app_private.s3_media_referenced(text,text) from public, anon, authenticated;

create or replace function public.request_s3_media_cleanup(media_namespace text, media_paths text[])
returns table(path text,category text,object_key text)
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or coalesce(cardinality(media_paths),0)>50 then
    raise exception 'Sign in with a valid media list' using errcode='42501';
  end if;
  -- Reference triggers take a shared row lock. Recheck references in a fresh statement
  -- after taking the exclusive lock, so an in-flight publish cannot race cleanup.
  perform 1 from public.s3_media_objects m where m.namespace=media_namespace
    and m.path=any(media_paths) and m.owner_id=auth.uid() for update;
  return query update public.s3_media_objects m set delete_requested=true
    where m.namespace=media_namespace and m.path=any(media_paths) and m.owner_id=auth.uid()
      and not app_private.s3_media_referenced(m.namespace,m.path)
    returning m.path,m.category,m.object_key;
end;
$$;
revoke all on function public.request_s3_media_cleanup(text,text[]) from public, anon;
grant execute on function public.request_s3_media_cleanup(text,text[]) to authenticated;

-- A client may attach an S3 alias only while its verified immutable object is live.
create or replace function app_private.check_s3_media_reference()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  media_namespace text;
  media_paths text[];
  entry public.s3_media_objects%rowtype;
  reference_owner uuid := coalesce(to_jsonb(new)->>'owner_id',to_jsonb(new)->>'sender_id',to_jsonb(new)->>'id')::uuid;
begin
  if tg_table_name='profiles' then
    media_namespace:='avatars'; media_paths:=array[new.avatar_path];
  elsif tg_table_name='image_posts' then
    media_namespace:='post-images';
    select array_agg(p) into media_paths from (
      select item->>'path' as p from jsonb_array_elements(new.items) item
      union all select item->>'cover_path' from jsonb_array_elements(new.items) item
    ) paths where p is not null;
  elsif tg_table_name='story_highlights' then
    media_namespace:='app-media'; media_paths:=array[new.cover_path];
  elsif tg_table_name='messages' then
    media_namespace:='chat-attachments'; media_paths:=array[new.object_path];
  elsif tg_table_name='media_content' then
    media_namespace:='app-media';
    media_paths:=case when new.story_audio then array[new.owner_id::text || '/' || new.id::text || '/soundtrack'] else '{}'::text[] end;
  else
    media_namespace:='app-media'; media_paths:=array[new.object_path];
  end if;
  for entry in select * from public.s3_media_objects m
    where m.namespace=media_namespace and m.path=any(media_paths) for share
  loop
    if entry.delete_requested or entry.owner_id <> reference_owner then
      raise exception 'Media is unavailable' using errcode='42501';
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function app_private.check_s3_media_reference() from public, anon, authenticated;
drop trigger if exists check_s3_avatar on public.profiles;
create trigger check_s3_avatar before insert or update of avatar_path on public.profiles
for each row execute function app_private.check_s3_media_reference();
drop trigger if exists check_s3_post_media on public.image_posts;
create trigger check_s3_post_media before insert or update of items on public.image_posts
for each row execute function app_private.check_s3_media_reference();
drop trigger if exists check_s3_story_media on public.media_assets;
create trigger check_s3_story_media before insert or update of object_path on public.media_assets
for each row execute function app_private.check_s3_media_reference();
drop trigger if exists check_s3_story_audio on public.media_content;
create trigger check_s3_story_audio before insert or update of story_audio on public.media_content
for each row execute function app_private.check_s3_media_reference();
drop trigger if exists check_s3_highlight_media on public.story_highlights;
create trigger check_s3_highlight_media before insert or update of cover_path on public.story_highlights
for each row execute function app_private.check_s3_media_reference();

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
        select 1 from storage.objects where bucket_id='app-media' and name=folder || 'story'
        union all select 1 from public.s3_media_objects m where m.namespace='app-media'
          and m.path=folder || 'story' and m.owner_id=owner and m.mime_type=mime and not m.delete_requested)))
    or (soundtrack and not exists (
      select 1 from storage.objects where bucket_id='app-media' and name=folder || 'soundtrack'
      union all select 1 from public.s3_media_objects m where m.namespace='app-media'
        and m.path=folder || 'soundtrack' and m.owner_id=owner and m.mime_type like 'audio/%' and not m.delete_requested))
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


create or replace function public.can_upload_s3_chat_attachment(media_path text)
returns boolean language sql stable security invoker set search_path='' as $$
  select auth.uid() is not null and split_part(media_path,'/',2)=auth.uid()::text
    and case when split_part(media_path,'/',1) ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
      then app_private.can_send_to_conversation(split_part(media_path,'/',1)::uuid) else false end;
$$;
revoke all on function public.can_upload_s3_chat_attachment(text) from public,anon;
grant execute on function public.can_upload_s3_chat_attachment(text) to authenticated;
drop trigger if exists check_s3_message_media on public.messages;
create trigger check_s3_message_media before insert or update of object_path on public.messages
for each row execute function app_private.check_s3_media_reference();

create or replace function app_private.set_message_expiry()
returns trigger language plpgsql security definer set search_path='' as $$
declare retention integer; attachment_bytes text;
begin
  if new.object_path is not null then
    select size into attachment_bytes from (
      select metadata->>'size' as size from storage.objects
        where bucket_id='chat-attachments' and name=new.object_path
      union all select m.byte_size::text from public.s3_media_objects m
        where m.namespace='chat-attachments' and m.path=new.object_path
          and m.owner_id=new.sender_id and not m.delete_requested
    ) files limit 1;
    if not found then raise exception 'Upload the attachment before sending'; end if;
    if attachment_bytes ~ '^[0-9]{1,18}$' and attachment_bytes::bigint>200000000 then
      new.attachment_expires_at:=new.created_at+interval '24 hours';
    end if;
  end if;
  select retention_hours into retention from public.conversations where id=new.conversation_id;
  if retention is not null then new.expires_at:=new.created_at+make_interval(hours=>retention); end if;
  return new;
end;
$$;

commit;
