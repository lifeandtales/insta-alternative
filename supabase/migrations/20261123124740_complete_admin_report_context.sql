-- Admin-only context for reported comments, profiles and source-backed Stories.
begin;
alter table public.content_reports drop constraint if exists content_reports_target_kind_check;
alter table public.content_reports add constraint content_reports_target_kind_check check(target_kind in
  ('profile','post','image_post','reel','story','message','image_comment','media_comment','comment_reply'));

-- Private read helpers run only inside an authorised admin RPC (or evidence capture).
create function app_private.review_media_item(item_kind text,item_ref text,depth integer default 0)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb; c public.media_content; source jsonb; files jsonb;
begin
  if depth>16 then return null; end if;
  if item_kind='image_post' then
    select jsonb_build_object('kind','image_post','ref',p.owner_id::text||':'||p.client_id::text,
      'owner_id',p.owner_id,'caption',p.caption,'created_at',p.created_at,'is_private',not p.is_public,
      'assets',coalesce((select jsonb_agg(jsonb_build_object('namespace','post-images','path',a->>'path',
        'mime',coalesce((select s.mime_type from public.s3_media_objects s where s.namespace='post-images' and s.path=a->>'path'),
          (select o.metadata->>'mimetype' from storage.objects o where o.bucket_id='post-images' and o.name=a->>'path'),
          case when coalesce(a#>>'{settings,type}',a->>'type')='video' then 'video/mp4' else 'image/jpeg' end),
        'settings',a->'settings') order by n) from jsonb_array_elements(p.items) with ordinality items(a,n)),'[]'::jsonb))
    into result from public.image_posts p
    where p.owner_id::text=split_part(item_ref,':',1) and p.client_id::text=split_part(item_ref,':',2);
  elsif item_kind in ('post','reel','story') then
    select * into c from public.media_content where id::text=item_ref and kind=item_kind;
    if not found then return null; end if;
    select coalesce(jsonb_agg(jsonb_build_object('namespace',case when c.kind='reel' then 'reels' else 'app-media' end,
      'path',a.object_path,'mime',a.mime_type,'content_id',c.id) order by a.position),'[]'::jsonb)
      into files from public.media_assets a where a.content_id=c.id;
    if c.kind='story' then
      if c.story_source_id is not null then
        source:=app_private.review_media_item((select kind from public.media_content where id=c.story_source_id),c.story_source_id::text,depth+1);
      elsif c.story_post_id is not null then
        source:=app_private.review_media_item('image_post',c.story_post_owner::text||':'||c.story_post_id::text,depth+1);
      end if;
      if jsonb_array_length(files)=0 and source is not null then files:=coalesce(source->'assets','[]'::jsonb); end if;
      if c.story_audio then files:=files||jsonb_build_array(jsonb_build_object('namespace','app-media',
        'path',c.owner_id::text||'/'||c.id::text||'/soundtrack','mime','audio/mpeg','role','soundtrack')); end if;
    end if;
    result:=jsonb_build_object('kind',c.kind,'ref',c.id,'owner_id',c.owner_id,'caption',c.caption,
      'created_at',c.created_at,'publish_at',c.publish_at,'expires_at',c.expires_at,
      'audience',c.audience,'metadata',c.metadata,'assets',files,'source',source);
  end if;
  if result is not null then result:=result||jsonb_build_object('author',(select username from public.profiles where id::text=result->>'owner_id')); end if;
  return result;
end;
$$;
revoke all on function app_private.review_media_item(text,text,integer) from public,anon,authenticated;

create function app_private.review_comment_item(comment_kind text,comment_ref text)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb; parent jsonb;
begin
  if comment_kind='image_comment' then
    select jsonb_build_object('owner_id',c.author_id,'caption',c.body,'parent_kind','image_post',
      'parent_ref',c.post_owner_id::text||':'||c.post_client_id::text,'created_at',c.created_at,'assets','[]'::jsonb)
      into result from public.image_post_comments c where c.id::text=comment_ref;
  elsif comment_kind='media_comment' then
    select jsonb_build_object('owner_id',c.author_id,'caption',c.body,'parent_kind',m.kind,
      'parent_ref',m.id::text,'created_at',c.created_at,'assets','[]'::jsonb)
      into result from public.media_comments c join public.media_content m on m.id=c.content_id where c.id::text=comment_ref;
  elsif comment_kind='comment_reply' then
    select jsonb_build_object('owner_id',r.author_id,'caption',r.body,'created_at',r.created_at,
      'parent_comment_kind',case when r.image_comment_id is not null then 'image_comment' else 'media_comment' end,
      'parent_comment_ref',coalesce(r.image_comment_id,r.media_comment_id)::text,'assets','[]'::jsonb)
      into result from public.comment_replies r where r.id::text=comment_ref;
    if result is not null then
      parent:=app_private.review_comment_item(result->>'parent_comment_kind',result->>'parent_comment_ref');
      if parent is null then return null; end if;
      result:=result||jsonb_build_object('parent_kind',parent->'parent_kind','parent_ref',parent->'parent_ref',
        'parent_comment',parent);
    end if;
  end if;
  if result is not null then
    result:=result||jsonb_build_object('kind',comment_kind,'ref',comment_ref,'author',
      (select username from public.profiles where id::text=result->>'owner_id'));
  end if;
  return result;
end;
$$;
revoke all on function app_private.review_comment_item(text,text) from public,anon,authenticated;

create policy "Moderation image comments" on public.image_post_comments as restrictive for select to authenticated
  using(app_private.moderation_allows('image_comment',id::text,author_id));
create policy "Moderation media comments" on public.media_comments as restrictive for select to authenticated
  using(app_private.moderation_allows('media_comment',id::text,author_id));
create policy "Moderation comment replies" on public.comment_replies as restrictive for select to authenticated
  using(app_private.moderation_allows('comment_reply',id::text,author_id));

create or replace function app_private.capture_report_target(kind text, ref text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  result jsonb; target uuid; owner uuid; post_key bigint;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
  if kind='image_post' then
    owner:=split_part(ref,':',1)::uuid; post_key:=split_part(ref,':',2)::bigint;
    select jsonb_build_object('owner_id',p.owner_id,'caption',p.caption,'assets',coalesce((
      select jsonb_agg(jsonb_build_object('namespace','post-images','path',a->>'path',
        'mime',coalesce(
          (select s.mime_type from public.s3_media_objects s where s.namespace='post-images' and s.path=a->>'path'),
          (select o.metadata->>'mimetype' from storage.objects o where o.bucket_id='post-images' and o.name=a->>'path'),
          case when coalesce(a#>>'{settings,type}',a->>'type')='video' then 'video/mp4' else 'image/jpeg' end)))
      from jsonb_array_elements(p.items) a),'[]'::jsonb)) into result
    from public.image_posts p where p.owner_id=owner and p.client_id=post_key
      and app_private.can_view_image_post(p.owner_id,p.is_public)
      and app_private.moderation_allows(capture_report_target.kind,ref,p.owner_id);
  elsif kind in ('post','reel','story') then
    target:=ref::uuid;
    select jsonb_build_object('owner_id',c.owner_id,'caption',c.caption,'assets',coalesce((
      select jsonb_agg(jsonb_build_object('namespace',case when c.kind='reel' then 'reels' else 'app-media' end,
        'path',a.object_path,'mime',a.mime_type)) from public.media_assets a where a.content_id=c.id),'[]'::jsonb)) into result
    from public.media_content c where c.id=target and c.kind=capture_report_target.kind and app_private.can_view_content(c.id);
  elsif kind='profile' then
    target:=ref::uuid;
    select jsonb_build_object('owner_id',p.id,'username',p.username,'display_name',p.display_name,'bio',p.bio,
      'assets',case when p.avatar_path is null then '[]'::jsonb else jsonb_build_array(
        jsonb_build_object('namespace','avatars','path',p.avatar_path,'mime','image/jpeg')) end) into result
    from public.profiles p where p.id=target and not app_private.account_is_blocked(p.id);
  elsif kind in ('image_comment','media_comment','comment_reply') then
    result:=app_private.review_comment_item(kind,ref);
    if result is not null then
      if app_private.account_is_blocked((result->>'owner_id')::uuid)
        or not app_private.moderation_allows(kind,ref,(result->>'owner_id')::uuid) then result:=null;
      elsif result->>'parent_kind'='image_post' then
        if not exists(select 1 from public.image_posts p
          where p.owner_id::text=split_part(result->>'parent_ref',':',1)
            and p.client_id::text=split_part(result->>'parent_ref',':',2)
            and app_private.can_view_image_post(p.owner_id,p.is_public)
            and app_private.moderation_allows('image_post',result->>'parent_ref',p.owner_id)) then result:=null; end if;
      elsif not app_private.can_view_content((result->>'parent_ref')::uuid) then result:=null;
      end if;
      if result is not null and kind='comment_reply' and not app_private.moderation_allows(
        result->>'parent_comment_kind',result->>'parent_comment_ref',(result#>>'{parent_comment,owner_id}')::uuid) then result:=null; end if;
      if result is not null then result:=result||jsonb_build_object('parent_item',
        app_private.review_media_item(result->>'parent_kind',result->>'parent_ref')); end if;
    end if;
  elsif kind='message' then
    target:=ref::uuid;
    select jsonb_build_object('owner_id',m.sender_id,'caption',m.body,'message_kind',m.kind,
      'assets',case when m.object_path is null or (m.attachment_expires_at is not null and m.attachment_expires_at<=now())
        then '[]'::jsonb else jsonb_build_array(jsonb_build_object('namespace','chat-attachments',
          'path',m.object_path,'mime',case m.kind when 'photo' then 'image/jpeg' when 'video' then 'video/mp4'
            when 'voice' then 'audio/ogg' else 'application/octet-stream' end)) end) into result
    from public.messages m where m.id=target and app_private.is_conversation_participant(m.conversation_id)
      and m.sender_id<>auth.uid() and app_private.moderation_allows(capture_report_target.kind,ref,m.sender_id)
      and (m.expires_at is null or m.expires_at>now())
      and not exists (select 1 from public.hidden_messages h where h.user_id=auth.uid() and h.message_id=m.id)
      and not exists (select 1 from public.conversation_preferences p where p.conversation_id=m.conversation_id
        and p.user_id=auth.uid() and p.cleared_at>=m.created_at);
  end if;
  if result is null then raise exception 'This item is unavailable to report' using errcode='42501'; end if;
  if kind in ('image_post','post','reel','story') then
    result:=result||app_private.review_media_item(kind,ref);
  end if;
  return result || jsonb_build_object('author', (select p.username from public.profiles p where p.id=(result->>'owner_id')::uuid));
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'Invalid report target' using errcode='22023';
end;
$$;

-- Explicit server-side admin browsing of profile content, including private accounts.
create function public.admin_profile_review(target uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  perform app_private.require_dashboard_admin();
  select jsonb_build_object('id',p.id,'username',p.username,'display_name',p.display_name,'bio',p.bio,
    'is_private',p.is_private,'created_at',p.created_at,
    'restricted',not app_private.moderation_allows('profile',p.id::text,p.id),
    'assets',case when p.avatar_path is null then '[]'::jsonb else jsonb_build_array(
      jsonb_build_object('namespace','avatars','path',p.avatar_path,'mime','image/jpeg')) end,
    'counts',jsonb_build_object('posts',(select count(*) from public.image_posts where owner_id=p.id)
      +(select count(*) from public.media_content where owner_id=p.id and kind='post'),
      'reels',(select count(*) from public.media_content where owner_id=p.id and kind='reel'),
      'stories',(select count(*) from public.media_content where owner_id=p.id and kind='story')))
  into result from public.profiles p where p.id=target;
  return result;
end;
$$;
create function public.admin_profile_media(target uuid,kind_filter text default 'posts',page_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  perform app_private.require_dashboard_admin();
  if kind_filter is null or kind_filter not in ('posts','reels','stories') then
    raise exception 'Invalid content filter' using errcode='22023'; end if;
  select coalesce(jsonb_agg(app_private.review_media_item(row.kind,row.ref) order by row.created_at desc,row.ref),'[]'::jsonb)
  into result from (
    select * from (
      select 'image_post'::text as kind,p.owner_id::text||':'||p.client_id::text as ref,p.created_at
        from public.image_posts p where p.owner_id=target and kind_filter='posts'
      union all
      select c.kind,c.id::text,c.created_at from public.media_content c where c.owner_id=target
        and c.kind=case kind_filter when 'posts' then 'post' when 'reels' then 'reel' else 'story' end
    ) items order by created_at desc,ref limit 12 offset greatest(0,least(coalesce(page_offset,0),100000))
  ) row;
  return result;
end;
$$;
create function public.admin_report_context(report_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r public.content_reports; saved jsonb; item jsonb; parent jsonb; owner uuid;
begin
  perform app_private.require_dashboard_admin();
  select * into r from public.content_reports where id=report_id;
  if not found then raise exception 'Report not found' using errcode='P0002'; end if;
  select snapshot into saved from app_private.report_evidence e where e.report_id=r.id;
  if r.target_kind in ('image_post','post','reel','story') then
    item:=app_private.review_media_item(r.target_kind,r.target_ref);
  elsif r.target_kind in ('image_comment','media_comment','comment_reply') then
    item:=app_private.review_comment_item(r.target_kind,r.target_ref);
    parent:=app_private.review_media_item(coalesce(item->>'parent_kind',saved->>'parent_kind'),
      coalesce(item->>'parent_ref',saved->>'parent_ref'));
    parent:=coalesce(parent,saved->'parent_item');
  elsif r.target_kind='profile' then
    item:=public.admin_profile_review(r.target_ref::uuid);
  elsif r.target_kind='message' then item:=saved;
  end if;
  owner:=coalesce((item->>'owner_id')::uuid,(saved->>'owner_id')::uuid);
  if r.target_kind='profile' then owner:=r.target_ref::uuid; end if;
  return jsonb_build_object('item',item,'parent_item',parent,'profile',public.admin_profile_review(owner),
    'target_deleted',item is null);
end;
$$;

-- Existing private-media APIs continue signing URLs; only their admin lookup expands.
create or replace function app_private.admin_can_read_report_asset(namespace text,path text)
returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists(select 1 from app_private.admin_members where user_id=auth.uid()) and (
    exists(select 1 from app_private.report_evidence e,jsonb_array_elements(coalesce(e.snapshot->'assets','[]'::jsonb)||coalesce(e.snapshot#>'{parent_item,assets}','[]'::jsonb)) a
      where a->>'path'=path and (a->>'namespace'=namespace or(namespace='app-media' and a->>'namespace'='reels')))
    or (namespace='avatars' and exists(select 1 from public.profiles p where p.avatar_path=path))
    or (namespace='post-images' and exists(select 1 from public.image_posts p,jsonb_array_elements(p.items) a
      where a->>'path'=path or a->>'cover_path'=path))
    or (namespace in ('app-media','reels') and exists(select 1 from public.media_assets a where a.object_path=path))
    or (namespace='app-media' and exists(select 1 from public.media_content c where c.kind='story' and c.story_audio
      and path=c.owner_id::text||'/'||c.id::text||'/soundtrack')))
$$;
revoke all on function public.admin_profile_review(uuid),public.admin_profile_media(uuid,text,integer),
  public.admin_report_context(uuid) from public,anon,authenticated;
grant execute on function public.admin_profile_review(uuid),public.admin_profile_media(uuid,text,integer),
  public.admin_report_context(uuid) to authenticated;
commit;
