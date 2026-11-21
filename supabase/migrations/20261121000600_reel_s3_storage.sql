begin;

create table if not exists public.reel_s3_deletions (
  owner_id uuid not null,
  content_id uuid not null,
  object_path text primary key
);
alter table public.reel_s3_deletions enable row level security;
revoke all on public.reel_s3_deletions from public, anon, authenticated;
grant select, delete on public.reel_s3_deletions to service_role;

create or replace function app_private.queue_reel_s3_deletion()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if split_part(old.object_path, '/', 3) = 's3' then
    insert into public.reel_s3_deletions(owner_id, content_id, object_path)
    values (old.owner_id, old.content_id, old.object_path)
    on conflict do nothing;
  end if;
  return old;
end;
$$;
revoke all on function app_private.queue_reel_s3_deletion() from public, anon, authenticated;

drop trigger if exists queue_reel_s3_deletion on public.media_assets;
create trigger queue_reel_s3_deletion after delete on public.media_assets
for each row execute function app_private.queue_reel_s3_deletion();

-- Only the Edge Function may attach verified S3 objects to published Reels.
drop policy if exists "Only backend can create S3 assets" on public.media_assets;
create policy "Only backend can create S3 assets" on public.media_assets
as restrictive for insert to authenticated
with check (split_part(object_path, '/', 3) <> 's3');

create or replace function public.publish_s3_reel(
  target uuid, reel_owner uuid, generation uuid, caption_text text, reel_audience text,
  details jsonb, video_mime text, cover_mime text, duration_seconds double precision
) returns text[] language plpgsql security invoker set search_path = '' as $$
declare
  prefix text := reel_owner::text || '/' || target::text || '/s3/' || generation::text || '/';
  inserted uuid;
  paths text[];
begin
  if target is null or reel_owner is null or generation is null
      or not coalesce(video_mime like 'video/%' and cover_mime like 'image/%'
        and reel_audience in ('public', 'followers'), false) then
    raise exception 'Invalid Reel' using errcode = '22023';
  end if;

  insert into public.media_content(id, owner_id, kind, caption, audience, metadata)
  select target, p.id, 'reel', caption_text,
    case when p.is_private then 'followers' else reel_audience end, details
  from public.profiles p where p.id = reel_owner
  on conflict (id) do nothing returning id into inserted;

  if inserted is not null then
    insert into public.media_assets(content_id, owner_id, position, object_path, mime_type, metadata)
    values
      (target, reel_owner, 0, prefix || 'video', video_mime, jsonb_build_object('duration_seconds', duration_seconds)),
      (target, reel_owner, 1, prefix || 'cover', cover_mime, '{}'::jsonb);
  end if;

  select array_agg(a.object_path order by a.position) into paths
  from public.media_content c join public.media_assets a on a.content_id = c.id
  where c.id = target and c.owner_id = reel_owner and c.kind = 'reel';
  if coalesce(cardinality(paths), 0) <> 2 then
    raise exception 'Reel unavailable' using errcode = '42501';
  end if;
  return paths;
end;
$$;
revoke all on function public.publish_s3_reel(uuid, uuid, uuid, text, text, jsonb, text, text, double precision)
  from public, anon, authenticated;
grant execute on function public.publish_s3_reel(uuid, uuid, uuid, text, text, jsonb, text, text, double precision)
  to service_role;
grant select, insert on public.media_content, public.media_assets to service_role;
grant select on public.profiles to service_role;

commit;
