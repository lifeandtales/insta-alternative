-- Apply after the app backend, admin dashboard, connected social and S3 migrations.
begin;

-- Retain the moderation decision if the reporter deletes their account, while
-- removing the link to that account. Deleting a reporter must not undo a restriction.
alter table public.content_reports alter column reporter_id drop not null;
alter table public.content_reports drop constraint content_reports_reporter_id_fkey;
alter table public.content_reports add constraint content_reports_reporter_id_fkey
  foreign key(reporter_id) references public.profiles(id) on delete set null;
alter table public.content_reports add column reason_code text;
alter table public.content_reports add column status text not null default 'pending'
  check (status in ('pending','reviewing','resolved','dismissed'));
alter table public.content_reports add column action text;
alter table public.content_reports add column public_note text not null default '';
alter table public.content_reports add column reviewed_at timestamptz;
update public.content_reports r set status = case when v.decision='dismissed' then 'dismissed' else 'resolved' end,
  action = case when v.decision='dismissed' then 'dismissed' else null end, reviewed_at=v.reviewed_at
from app_private.admin_report_reviews v where v.report_id=r.id;
create index content_reports_reporter_history on public.content_reports(reporter_id,created_at desc,id);
create index content_reports_review_queue on public.content_reports(status,created_at,id);

create table app_private.report_evidence (
  report_id uuid primary key references public.content_reports(id) on delete cascade,
  snapshot jsonb not null
);
create table app_private.moderation_restrictions (
  target_kind text not null, target_ref text not null,
  report_id uuid not null references public.content_reports(id),
  active boolean not null default true, updated_at timestamptz not null default now(),
  primary key (target_kind,target_ref)
);
create table app_private.moderation_audit (
  id bigint generated always as identity primary key,
  report_id uuid not null references public.content_reports(id),
  admin_id uuid references auth.users(id) on delete set null,
  action text not null, public_note text not null, created_at timestamptz not null default now()
);
alter table app_private.report_evidence enable row level security;
alter table app_private.moderation_restrictions enable row level security;
alter table app_private.moderation_audit enable row level security;
revoke all on app_private.report_evidence,app_private.moderation_restrictions,app_private.moderation_audit from public,anon,authenticated;

create function app_private.moderation_allows(kind text, ref text, owner uuid default null)
returns boolean language sql stable security definer set search_path='' as $$
  select not exists (select 1 from app_private.moderation_restrictions r where r.active and
    ((r.target_kind=kind and r.target_ref=ref) or (r.target_kind='profile' and r.target_ref=owner::text)))
$$;
revoke all on function app_private.moderation_allows(text,text,uuid) from public,anon;
grant execute on function app_private.moderation_allows(text,text,uuid) to authenticated;

-- Restrictive policies supplement, rather than replace, existing privacy policies.
create policy "Moderation media visibility" on public.media_content as restrictive for select to authenticated
  using (app_private.moderation_allows(kind,id::text,owner_id));
create policy "Moderation image visibility" on public.image_posts as restrictive for select to authenticated
  using (app_private.moderation_allows('image_post',owner_id::text||':'||client_id::text,owner_id));
create policy "Moderation message visibility" on public.messages as restrictive for select to authenticated
  using (app_private.moderation_allows('message',id::text,sender_id));
create policy "Moderation profile visibility" on public.profiles as restrictive for select to authenticated
  using (id=auth.uid() or app_private.moderation_allows('profile',id::text,id));
create policy "Restricted accounts cannot publish media" on public.media_content as restrictive for insert to authenticated
  with check (app_private.moderation_allows('profile',auth.uid()::text,auth.uid()));
create policy "Restricted accounts cannot publish images" on public.image_posts as restrictive for insert to authenticated
  with check (app_private.moderation_allows('profile',auth.uid()::text,auth.uid()));
create policy "Restricted accounts cannot send messages" on public.messages as restrictive for insert to authenticated
  with check (app_private.moderation_allows('profile',auth.uid()::text,auth.uid()));

-- These helpers also protect SECURITY DEFINER RPC and private-media signing paths.
create or replace function app_private.account_is_blocked(other_user uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select not app_private.moderation_allows('profile',other_user::text,other_user)
    or not app_private.moderation_allows('profile',auth.uid()::text,auth.uid()) or exists (
      select 1 from public.account_blocks b where
        (b.blocker_id=auth.uid() and b.blocked_id=other_user) or
        (b.blocker_id=other_user and b.blocked_id=auth.uid()))
$$;
create or replace function app_private.can_view_content(content uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists (select 1 from public.media_content c join public.profiles p on p.id=c.owner_id
    where c.id=content and auth.uid() is not null
    and app_private.moderation_allows(c.kind,c.id::text,c.owner_id) and (
      c.owner_id=auth.uid() or (not app_private.account_is_blocked(c.owner_id)
        and (c.kind='story' or app_private.can_view_image_post(c.owner_id,true))
        and c.publish_at<=now() and (c.expires_at is null or c.expires_at>now()) and (
          (c.audience='public' and not p.is_private) or
          (c.audience in ('public','followers') and exists (select 1 from public.account_follows f
            where f.follower_id=auth.uid() and f.followed_id=c.owner_id and f.status='accepted')) or
          (c.audience='close_friends' and exists (select 1 from public.close_friends f
            where f.owner_id=c.owner_id and f.friend_id=auth.uid()))))))
$$;

create function app_private.capture_report_target(kind text, ref text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  result jsonb; target uuid; owner uuid; post_key bigint;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
  if kind='image_post' then
    owner:=split_part(ref,':',1)::uuid; post_key:=split_part(ref,':',2)::bigint;
    select jsonb_build_object('owner_id',p.owner_id,'caption',p.caption,'assets',coalesce((
      select jsonb_agg(jsonb_build_object('namespace','post-images','path',a->>'path',
        'mime',case when a->>'type'='video' then 'video/mp4' else 'image/jpeg' end))
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
revoke all on function app_private.capture_report_target(text,text) from public,anon,authenticated;

-- Admin media access is limited to attachments recorded for submitted reports.
create index report_evidence_assets_idx on app_private.report_evidence using gin(snapshot jsonb_path_ops);
create function app_private.admin_can_read_report_asset(namespace text,path text)
returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists(select 1 from app_private.admin_members where user_id=auth.uid())
    and exists(select 1 from app_private.report_evidence e, jsonb_array_elements(e.snapshot->'assets') a
      where a->>'path'=path and (a->>'namespace'=namespace or (namespace='app-media' and a->>'namespace'='reels')))
$$;
create function app_private.moderation_asset_allows(namespace text,path text)
returns boolean language sql stable security definer set search_path='' as $$
  select app_private.admin_can_read_report_asset(namespace,path) or not exists (
    select 1 from app_private.moderation_restrictions r where r.active and (
      (r.target_kind='profile' and r.target_ref=split_part(path,'/',case when namespace='chat-attachments' then 2 else 1 end))
      or exists(select 1 from app_private.report_evidence e,jsonb_array_elements(e.snapshot->'assets') a
        where e.report_id=r.report_id and a->>'path'=path and
          (a->>'namespace'=namespace or (namespace='app-media' and a->>'namespace'='reels')))
      or (namespace='post-images' and r.target_kind='image_post' and exists(select 1 from public.image_posts p
        where r.target_ref=p.owner_id::text||':'||p.client_id::text and p.items @> jsonb_build_array(jsonb_build_object('path',path))))
      or (namespace='app-media' and r.target_kind in ('post','reel','story') and exists(select 1 from public.media_assets a
        where a.content_id::text=r.target_ref and a.object_path=path))
      or (namespace='chat-attachments' and r.target_kind='message' and exists(select 1 from public.messages m
        where m.id::text=r.target_ref and m.object_path=path))))
$$;
revoke all on function app_private.admin_can_read_report_asset(text,text),app_private.moderation_asset_allows(text,text) from public,anon;
grant execute on function app_private.admin_can_read_report_asset(text,text),app_private.moderation_asset_allows(text,text) to authenticated;
create policy "Admins preview reported legacy attachments" on storage.objects for select to authenticated
  using (app_private.admin_can_read_report_asset(bucket_id,name));
create policy "Moderation legacy attachment visibility" on storage.objects as restrictive for select to authenticated
  using (app_private.moderation_asset_allows(bucket_id,name));
create policy "Admins preview reported S3 attachments" on public.s3_media_objects for select to authenticated
  using (not delete_requested and app_private.admin_can_read_report_asset(namespace,path));
create policy "Moderation S3 attachment visibility" on public.s3_media_objects as restrictive for select to authenticated
  using (app_private.moderation_asset_allows(namespace,path));
create policy "Admins preview reported Reel attachments" on public.media_assets for select to authenticated
  using (app_private.admin_can_read_report_asset('app-media',object_path));

create function public.submit_content_report(target_kind text,target_ref text,reason_code text,details text default '')
returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid; evidence jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
  if reason_code is null or reason_code not in ('dislike','unwanted','bullying','self_harm','violence','hate',
    'exploitation','sexual','scam','spam','misinformation','intellectual_property','impersonation','other')
    or details is null or char_length(details)>500 or target_ref is null or char_length(target_ref)>128 then
    raise exception 'Invalid report' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
  select r.id into result from public.content_reports r where r.reporter_id=auth.uid()
    and r.target_kind=submit_content_report.target_kind and r.target_ref=submit_content_report.target_ref
    and r.status in ('pending','reviewing') order by r.created_at desc limit 1;
  if result is not null then return result; end if;
  if (select count(*) from public.content_reports where reporter_id=auth.uid() and created_at>now()-interval '1 hour')>=30 then
    raise exception 'Too many reports. Try again later.' using errcode='P0001';
  end if;
  evidence:=app_private.capture_report_target(target_kind,target_ref);
  insert into public.content_reports(target_kind,target_ref,reason,reason_code)
    values (target_kind,target_ref,left(reason_code||case when btrim(details)='' then '' else ': '||btrim(details) end,500),reason_code)
    returning id into result;
  insert into app_private.report_evidence values(result,evidence);
  return result;
end;
$$;
-- All submissions must pass target visibility validation and capture server evidence.
revoke insert on public.content_reports from authenticated;
revoke insert(reporter_id,target_kind,target_ref,reason) on public.content_reports from authenticated;

create function public.my_content_reports(page_offset integer default 0)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id),'[]'::jsonb) from (
    select r.id,r.target_kind,r.reason,r.reason_code,r.status,r.action,r.public_note,r.created_at,r.reviewed_at,
      (select e.snapshot->>'author' from app_private.report_evidence e where e.report_id=r.id) as target_username
    from public.content_reports r where r.reporter_id=auth.uid()
    order by created_at desc,id limit 50 offset greatest(0,least(page_offset,100000))) r
$$;

create function public.admin_content_reports(status_filter text default 'pending',page_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  perform app_private.require_dashboard_admin();
  if status_filter is null or status_filter not in ('pending','reviewing','resolved','dismissed','all') then
    raise exception 'Invalid report filter' using errcode='22023'; end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at,r.id),'[]'::jsonb) into result from (
    select id,target_kind,target_ref,reason,reason_code,status,action,public_note,created_at,reviewed_at
    from public.content_reports where status_filter='all' or status=status_filter
    order by created_at,id limit 50 offset greatest(0,least(page_offset,100000))) r;
  return result;
end;
$$;

create function public.admin_report_detail(report_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; r public.content_reports; evidence jsonb;
begin
  perform app_private.require_dashboard_admin();
  select * into r from public.content_reports where id=report_id;
  if not found then raise exception 'Report not found' using errcode='P0002'; end if;
  select snapshot into evidence from app_private.report_evidence where report_evidence.report_id=admin_report_detail.report_id;
  return jsonb_build_object('report',to_jsonb(r)-'reporter_id','evidence',evidence,
    'restricted',not app_private.moderation_allows(r.target_kind,r.target_ref,null),
    'history',coalesce((select jsonb_agg(jsonb_build_object('action',a.action,'public_note',a.public_note,'created_at',a.created_at)
      order by a.created_at) from app_private.moderation_audit a where a.report_id=r.id),'[]'::jsonb));
end;
$$;

create function public.admin_moderate_report(report_id uuid,action_name text,note text)
returns boolean language plpgsql security definer set search_path='' as $$
declare r public.content_reports; target_owner uuid;
begin
  perform app_private.require_dashboard_admin();
  if action_name is null or action_name not in ('reviewing','dismissed','warned','removed','restricted','restored')
    or note is null or char_length(btrim(note)) not between 8 and 500 then
    raise exception 'Choose an action and explain the result (8-500 characters)' using errcode='22023'; end if;
  select * into r from public.content_reports where id=report_id for update;
  if not found then raise exception 'Report not found' using errcode='P0002'; end if;
  if r.status in ('resolved','dismissed') and action_name<>'restored' then
    raise exception 'Report already reviewed. Refresh the queue.' using errcode='40001'; end if;
  select (snapshot->>'owner_id')::uuid into target_owner from app_private.report_evidence e where e.report_id=r.id;
  if action_name in ('removed','restricted','warned') and target_owner is null then
    raise exception 'Legacy report has no verified target. It can only be reviewed or dismissed.' using errcode='22023'; end if;
  if action_name='removed' and r.target_kind='profile' or action_name='restricted' and r.target_kind<>'profile' then
    raise exception 'This action does not apply to the reported item' using errcode='22023'; end if;
  if action_name in ('removed','restricted') then
    if target_owner=auth.uid() or exists(select 1 from app_private.admin_members where user_id=target_owner) then
      raise exception 'Protected admin account' using errcode='42501'; end if;
    insert into app_private.moderation_restrictions(target_kind,target_ref,report_id)
      values(r.target_kind,r.target_ref,r.id) on conflict(target_kind,target_ref)
      do update set active=true,report_id=excluded.report_id,updated_at=now();
  elsif action_name='restored' then
    update app_private.moderation_restrictions set active=false,updated_at=now()
      where target_kind=r.target_kind and target_ref=r.target_ref and active;
    if not found then raise exception 'No active restriction' using errcode='22023'; end if;
  end if;
  update public.content_reports set status=case when action_name='reviewing' then 'reviewing'
      when action_name='dismissed' then 'dismissed' else 'resolved' end,
    action=action_name,public_note=btrim(note),reviewed_at=now() where id=r.id;
  insert into app_private.moderation_audit(report_id,admin_id,action,public_note)
    values(r.id,auth.uid(),action_name,btrim(note));
  if action_name<>'reviewing' then
    insert into app_private.admin_report_reviews(report_id,reviewer_id,decision)
      values(r.id,auth.uid(),case when action_name='dismissed' then 'dismissed' else 'resolved' end)
      on conflict on constraint admin_report_reviews_pkey do update set reviewer_id=excluded.reviewer_id,decision=excluded.decision,reviewed_at=now();
  end if;
  if action_name in ('warned','removed','restricted','restored') and target_owner is not null then
    insert into public.app_notifications(recipient_id,kind,payload) values(target_owner,'moderation',
      jsonb_build_object('action',action_name,'message',btrim(note),'target_kind',r.target_kind));
  end if;
  return true;
end;
$$;

-- Legacy clients must not mark complaints resolved without reviewing evidence.
create or replace function public.admin_review_report(report uuid,decision text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  perform app_private.require_dashboard_admin();
  raise exception 'Use the Reports moderation page to record an action and explanation' using errcode='22023';
end;
$$;
revoke all on function public.submit_content_report(text,text,text,text),public.my_content_reports(integer),
  public.admin_content_reports(text,integer),public.admin_report_detail(uuid),public.admin_moderate_report(uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.submit_content_report(text,text,text,text),public.my_content_reports(integer),
  public.admin_content_reports(text,integer),public.admin_report_detail(uuid),public.admin_moderate_report(uuid,text,text)
  to authenticated;
-- Deliver moderation warnings and decisions to the affected account.
create or replace function public.home_notification_history(page_offset integer default 0)
returns jsonb language sql stable security definer set search_path = '' as $$
  with items as (
    select n.id, n.kind, n.payload, n.created_at, n.read_at is not null as read,
      p.username, p.display_name, outgoing.status as follow_back_status,
      case when n.kind in ('post_like', 'story_like') then
        coalesce(n.payload->>'target_key', n.id::text) else n.id::text end as group_key
    from public.app_notifications n
    left join public.profiles p on p.id::text = n.payload->>'actor_id'
    left join public.account_follows outgoing on outgoing.follower_id = auth.uid() and outgoing.followed_id = p.id
    where n.recipient_id = auth.uid()
      and (n.kind in ('post_like', 'story_like', 'post_comment', 'content_mention', 'content_tag', 'new_follower', 'follow_accepted', 'moderation')
        or (n.kind = 'follow_request' and n.payload->>'review_status' = 'accepted'))
      and (p.id is null or not app_private.account_is_blocked(p.id))
  ), numbered as (
    select *, count(*) over grouped as group_count, bool_and(read) over grouped as group_read,
      row_number() over (partition by kind, group_key order by created_at desc, id desc) as group_rank
    from items window grouped as (partition by kind, group_key)
  ), listed as (
    select id, kind, payload, created_at, username, display_name, follow_back_status,
      case when kind = 'story_like' or group_count > 3 then group_read else read end as read,
      case when kind = 'story_like' or group_count > 3 then group_count - 1 else 0 end as other_count
    from numbered
    where group_rank = 1 or (kind <> 'story_like' and group_count <= 3)
  ), pending as (
    select f.follower_id, f.created_at, p.username, p.display_name, request.id as notification_id,
      request.id is not null and request.read_at is null as unread
    from public.account_follows f join public.profiles p on p.id = f.follower_id
    left join lateral (
      select n.id, n.read_at from public.app_notifications n
      where n.recipient_id = auth.uid() and n.kind = 'follow_request'
        and not (n.payload ? 'review_status') and n.payload->>'actor_id' = f.follower_id::text
      order by n.created_at desc, n.id desc limit 1
    ) request on true
    where f.followed_id = auth.uid() and f.status = 'requested'
      and not app_private.account_is_blocked(f.follower_id)
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(to_jsonb(row) order by created_at desc, id desc) from (
      select * from listed order by created_at desc, id desc limit 40 offset greatest(0, coalesce(page_offset, 0))
    ) row), '[]'::jsonb),
    'pending', coalesce((select jsonb_agg(to_jsonb(pending) order by created_at desc, follower_id) from pending), '[]'::jsonb),
    'unread', (select count(*) from listed where not read) + (exists(select 1 from pending where unread))::int,
    'total', (select count(*) from listed),
    'as_of', statement_timestamp()
  );
$$;

revoke all on function public.home_notification_history(integer) from public,anon;
grant execute on function public.home_notification_history(integer) to authenticated;
commit;
