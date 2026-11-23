-- Correct media classification; retain the original report, text and attachment paths.
begin;
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
  return result || jsonb_build_object('author', (select p.username from public.profiles p where p.id=(result->>'owner_id')::uuid));
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'Invalid report target' using errcode='22023';
end;
$$;

-- Repair media type metadata in existing evidence without changing its content.
update app_private.report_evidence e set snapshot=jsonb_set(e.snapshot,'{assets}',(
  select jsonb_agg(case when a->>'namespace'='post-images' then a||jsonb_build_object('mime',coalesce(
    (select s.mime_type from public.s3_media_objects s where s.namespace='post-images' and s.path=a->>'path'),
    (select o.metadata->>'mimetype' from storage.objects o where o.bucket_id='post-images' and o.name=a->>'path'),
    a->>'mime')) else a end order by n)
  from jsonb_array_elements(e.snapshot->'assets') with ordinality as items(a,n)
)) where exists(select 1 from jsonb_array_elements(e.snapshot->'assets') a where a->>'namespace'='post-images');
commit;
