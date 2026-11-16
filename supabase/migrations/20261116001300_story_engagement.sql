begin;

create or replace function public.record_story_engagement(target uuid, action text, enabled boolean default true)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null or action is null or action not in ('view','like') or enabled is null
    or not exists (select 1 from public.media_content c where c.id=target and c.kind='story'
      and c.owner_id<>auth.uid() and c.publish_at<=now() and c.expires_at>now()) then
    raise exception 'Story unavailable' using errcode = '42501';
  end if;
  if action = 'view' or enabled then
    insert into public.media_interactions(content_id,user_id,kind)
      values (target,auth.uid(),'view') on conflict do nothing;
  end if;
  if action = 'like' then
    if enabled then
      insert into public.media_interactions(content_id,user_id,kind)
        values (target,auth.uid(),'like') on conflict do nothing;
    else
      delete from public.media_interactions where content_id=target and user_id=auth.uid() and kind='like';
    end if;
  end if;
end;
$$;

create or replace function public.story_viewer_count(target uuid)
returns bigint language sql stable security definer set search_path = '' as $$
  select count(*) from public.media_interactions v
  where v.content_id=target and v.kind='view'
    and exists (select 1 from public.media_content c where c.id=target and c.kind='story' and c.owner_id=auth.uid())
    and not app_private.account_is_blocked(v.user_id);
$$;

create or replace function public.story_viewers(target uuid, page_offset integer default 0)
returns table (id uuid, username text, display_name text, avatar_path text, viewed_at timestamptz, liked boolean)
language sql stable security definer set search_path = '' as $$
  select p.id, p.username, p.display_name,
    case when app_private.can_view_image_post(p.id,true) then p.avatar_path end,
    v.created_at, l.user_id is not null
  from public.media_interactions v join public.profiles p on p.id = v.user_id
  left join public.media_interactions l on l.content_id=v.content_id and l.user_id=v.user_id and l.kind='like'
  where v.content_id=target and v.kind='view'
    and exists (select 1 from public.media_content c where c.id=target and c.kind='story' and c.owner_id=auth.uid())
    and not app_private.account_is_blocked(v.user_id)
  order by (l.user_id is not null) desc, v.created_at desc, p.id
  limit 51 offset greatest(coalesce(page_offset,0),0);
$$;

revoke all on function public.record_story_engagement(uuid,text,boolean), public.story_viewer_count(uuid),
  public.story_viewers(uuid,integer) from public, anon;
grant execute on function public.record_story_engagement(uuid,text,boolean), public.story_viewer_count(uuid),
  public.story_viewers(uuid,integer) to authenticated;

create or replace function public.set_story_settings(allow_replies boolean, save_to_archive boolean)
returns void language sql security invoker set search_path = '' as $$
  insert into public.account_preferences as p (user_id,settings)
  values (auth.uid(),jsonb_build_object('story',jsonb_build_object(
    'allowReplies',allow_replies,'saveToArchive',save_to_archive)))
  on conflict (user_id) do update set settings=p.settings || excluded.settings;
$$;

create or replace function app_private.capture_story_archive_setting()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.kind = 'story' then
    new.metadata := new.metadata || jsonb_build_object('saveToArchive', not exists (
      select 1 from public.account_preferences p where p.user_id=new.owner_id
        and p.settings #> '{story,saveToArchive}' = 'false'::jsonb));
  end if;
  return new;
end;
$$;

drop trigger if exists capture_story_archive_setting on public.media_content;
create trigger capture_story_archive_setting before insert on public.media_content
  for each row execute function app_private.capture_story_archive_setting();

create or replace function public.story_allows_replies(target uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.media_content c
    left join public.account_preferences p on p.user_id=c.owner_id
    where c.id=target and c.kind='story' and c.owner_id<>auth.uid()
      and c.publish_at<=now() and c.expires_at>now()
      and app_private.can_view_content(c.id) and app_private.story_source_visible(c.id)
      and (p.settings #> '{story,allowReplies}') is distinct from 'false'::jsonb
  );
$$;

create or replace function public.send_connected_story_reply(target uuid, reply_text text)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  author uuid;
  chat_id uuid;
begin
  if reply_text is null or length(btrim(reply_text)) not between 1 and 1000
    or not public.story_allows_replies(target) then
    raise exception 'Story replies unavailable' using errcode='42501';
  end if;
  select c.owner_id into author from public.media_content c where c.id=target;
  chat_id := public.open_connected_chat(author);
  insert into public.messages(conversation_id,sender_id,kind,body,metadata)
  values(chat_id,auth.uid(),'text',btrim(reply_text),jsonb_build_object('story_id',target));
end;
$$;

alter table public.story_highlights
  add column if not exists audience text not null default 'public' check (audience in ('public','close_friends')),
  add column if not exists archived boolean not null default false,
  add column if not exists position integer not null default 0,
  add column if not exists cover_path text;

-- Highlight access combines the profile, highlight, and source Story audiences.
create or replace function app_private.can_view_story_highlight(target uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.story_highlights h where h.id=target and auth.uid() is not null and
    (h.owner_id=auth.uid() or (not h.archived and app_private.can_view_image_post(h.owner_id,true)
      and (h.audience='public' or exists (select 1 from public.close_friends f
        where f.owner_id=h.owner_id and f.friend_id=auth.uid()))))
  );
$$;

create or replace function app_private.highlight_story_assets(target uuid, story_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id',c.id,'owner_id',c.owner_id,'username',p.username,'display_name',p.display_name,
    'avatar_path',p.avatar_path,'caption',c.caption,'audience',c.audience,
    'publish_at',c.publish_at,'expires_at',c.expires_at,'metadata',c.metadata,
    'object_path',coalesce(a.object_path, post.items -> 0 ->> 'path'),
    'mime_type',coalesce(a.mime_type, 'image/post'),
    'media_bucket',case when post.owner_id is null then 'app-media' else 'post-images' end,
    'audio_path',case when c.story_audio then c.owner_id::text || '/' || c.id::text || '/soundtrack' end,
    'source_details',case when original.id is not null then jsonb_build_object(
      'id',original.id,'owner_id',original.owner_id,'username',original_author.username,
      'display_name',original_author.display_name,'avatar_path',original_author.avatar_path,
      'metadata',original.metadata,'audio_path',case when original.story_audio
        then original.owner_id::text || '/' || original.id::text || '/soundtrack' end,
      'sensitive',root.metadata -> 'sensitive') end)
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

create or replace function public.connected_story_highlights(profile_owner uuid)
returns setof jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id',h.id,'owner_id',h.owner_id,'title',h.title,'audience',h.audience,
    'archived',h.archived,'position',h.position,'cover_path',h.cover_path,'stories',items.stories)
  from public.story_highlights h
  cross join lateral (
    select jsonb_agg(resolved.asset order by s.ordinality) as stories
    from unnest(h.story_ids) with ordinality s(id,ordinality)
    cross join lateral (select app_private.highlight_story_assets(h.id,s.id) as asset) resolved
    where resolved.asset is not null
  ) items
  where h.owner_id=profile_owner and app_private.can_view_story_highlight(h.id) and items.stories is not null
  order by h.position,h.created_at,h.id;
$$;

create or replace function public.connected_story_archive()
returns setof jsonb language sql stable security definer set search_path = '' as $$
  select asset from public.media_content c
  cross join lateral (select app_private.highlight_story_assets(null,c.id) as asset) resolved
  where c.owner_id=auth.uid() and c.kind='story' and c.expires_at<=now()
    and (c.metadata->'saveToArchive') is distinct from 'false'::jsonb and asset is not null
  order by c.publish_at desc limit 100;
$$;

create or replace function app_private.can_download_highlight_asset(object_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.story_highlights h
    cross join lateral unnest(h.story_ids) as s(id)
    where app_private.can_view_story_highlight(h.id)
      and split_part(object_name,'/',1)=h.owner_id::text
      and (h.cover_path=object_name and split_part(object_name,'/',2)=h.id::text
        or (split_part(object_name,'/',2)=s.id::text and split_part(object_name,'/',3) in ('story','soundtrack')))
      and app_private.highlight_story_assets(h.id,s.id) is not null
  );
$$;

drop policy if exists "Read authorized Highlight media" on storage.objects;
create policy "Read authorized Highlight media" on storage.objects for select to authenticated
  using (bucket_id='app-media' and app_private.can_download_highlight_asset(name));

create or replace function public.reorder_connected_story_highlights(highlight_ids uuid[])
returns void language sql security invoker set search_path = '' as $$
  update public.story_highlights h set position=s.ordinality::integer
  from unnest(highlight_ids) with ordinality s(id,ordinality)
  where h.id=s.id and h.owner_id=auth.uid();
$$;

revoke all on function app_private.can_view_story_highlight(uuid), app_private.highlight_story_assets(uuid,uuid),
  app_private.can_download_highlight_asset(text) from public, anon;
grant execute on function app_private.can_download_highlight_asset(text) to authenticated;
revoke all on function public.set_story_settings(boolean,boolean), public.story_allows_replies(uuid),
  public.send_connected_story_reply(uuid,text), public.connected_story_highlights(uuid),
  public.connected_story_archive(), public.reorder_connected_story_highlights(uuid[]) from public, anon;
grant execute on function public.set_story_settings(boolean,boolean), public.story_allows_replies(uuid),
  public.send_connected_story_reply(uuid,text), public.connected_story_highlights(uuid),
  public.connected_story_archive(), public.reorder_connected_story_highlights(uuid[]) to authenticated;

commit;
