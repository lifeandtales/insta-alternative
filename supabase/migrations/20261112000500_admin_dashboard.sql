-- Apply after the combined app backend migration.
begin;

create table if not exists app_private.admin_members (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table app_private.admin_members enable row level security;
revoke all on app_private.admin_members from public, anon, authenticated;

-- Store review decisions separately so normal report submissions need no new access.
create table if not exists app_private.admin_report_reviews (
  report_id uuid primary key references public.content_reports(id) on delete cascade,
  reviewer_id uuid references auth.users(id) on delete set null,
  decision text not null check (decision in ('resolved', 'dismissed')),
  reviewed_at timestamptz not null default now()
);
alter table app_private.admin_report_reviews enable row level security;
revoke all on app_private.admin_report_reviews from public, anon, authenticated;

create or replace function app_private.require_dashboard_admin()
returns void language plpgsql stable security invoker set search_path = '' as $$
begin
  if not exists (select 1 from app_private.admin_members where user_id = auth.uid()) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
end;
$$;
revoke all on function app_private.require_dashboard_admin() from public, anon, authenticated;

create or replace function public.admin_dashboard_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  totals jsonb;
  activity jsonb;
  reports jsonb;
begin
  perform app_private.require_dashboard_admin();
  select jsonb_build_object(
    'Accounts', (select count(*) from public.profiles),
    'Image posts', (select count(*) from public.image_posts),
    'Posts', (select count(*) from public.media_content where kind = 'post'),
    'Reels', (select count(*) from public.media_content where kind = 'reel'),
    'Stories', (select count(*) from public.media_content where kind = 'story'),
    'Direct chats', (select count(*) from public.conversations where group_name is null),
    'Group chats', (select count(*) from public.conversations where group_name is not null),
    'Messages', (select count(*) from public.messages),
    'Chat attachments', (select count(*) from public.messages where object_path is not null),
    'Follows', (select count(*) from public.account_follows),
    'Blocks', (select count(*) from public.account_blocks),
    'Comments', (select count(*) from public.media_comments),
    'Likes', (select count(*) from public.media_interactions where kind = 'like'),
    'Views', (select count(*) from public.media_interactions where kind = 'view'),
    'Saves', (select count(*) from public.media_interactions where kind = 'save'),
    'Notifications', (select count(*) from public.app_notifications),
    'Communities', (select count(*) from public.communities),
    'Highlights', (select count(*) from public.story_highlights),
    'Reports', (select count(*) from public.content_reports)
  ) into totals;

  select coalesce(jsonb_agg(to_jsonb(event) order by event.created_at desc, event.category), '[]'::jsonb)
  into activity
  from (
    select * from (
      (select 'Accounts'::text as category, created_at from public.profiles order by created_at desc limit 30)
      union all
      (select 'Image posts'::text as category, created_at from public.image_posts order by created_at desc limit 30)
      union all
      (select 'Posts'::text as category, created_at from public.media_content where kind = 'post' order by created_at desc limit 30)
      union all
      (select 'Reels'::text as category, created_at from public.media_content where kind = 'reel' order by created_at desc limit 30)
      union all
      (select 'Stories'::text as category, created_at from public.media_content where kind = 'story' order by created_at desc limit 30)
      union all
      (select 'Direct chats'::text as category, created_at from public.conversations where group_name is null order by created_at desc limit 30)
      union all
      (select 'Group chats'::text as category, created_at from public.conversations where group_name is not null order by created_at desc limit 30)
      union all
      (select 'Messages'::text as category, created_at from public.messages order by created_at desc limit 30)
      union all
      (select 'Chat attachments'::text as category, created_at from public.messages where object_path is not null order by created_at desc limit 30)
      union all
      (select 'Follows'::text as category, created_at from public.account_follows order by created_at desc limit 30)
      union all
      (select 'Comments'::text as category, created_at from public.media_comments order by created_at desc limit 30)
      union all
      (select 'Likes'::text as category, created_at from public.media_interactions where kind = 'like' order by created_at desc limit 30)
      union all
      (select 'Views'::text as category, created_at from public.media_interactions where kind = 'view' order by created_at desc limit 30)
      union all
      (select 'Saves'::text as category, created_at from public.media_interactions where kind = 'save' order by created_at desc limit 30)
      union all
      (select 'Notifications'::text as category, created_at from public.app_notifications order by created_at desc limit 30)
      union all
      (select 'Communities'::text as category, created_at from public.communities order by created_at desc limit 30)
      union all
      (select 'Highlights'::text as category, created_at from public.story_highlights order by created_at desc limit 30)
      union all
      (select 'Reports'::text as category, created_at from public.content_reports order by created_at desc limit 30)
    ) as events
    order by created_at desc, category
    limit 30
  ) as event;

  select coalesce(jsonb_agg(to_jsonb(report) order by report.created_at desc, report.id), '[]'::jsonb)
  into reports
  from (
    select r.id, r.target_kind, r.target_ref, r.reason, r.created_at
    from public.content_reports r
    where not exists (select 1 from app_private.admin_report_reviews v where v.report_id = r.id)
    order by r.created_at desc, r.id
    limit 30
  ) as report;

  return jsonb_build_object('totals', totals, 'activity', activity, 'reports', reports);
end;
$$;

create or replace function public.admin_review_report(report uuid, decision text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_dashboard_admin();
  insert into app_private.admin_report_reviews (report_id, reviewer_id, decision)
  values (report, auth.uid(), decision)
  on conflict (report_id) do nothing;
  return found;
end;
$$;

revoke all on function public.admin_dashboard_overview() from public, anon, authenticated;
revoke all on function public.admin_review_report(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_dashboard_overview() to authenticated;
grant execute on function public.admin_review_report(uuid, text) to authenticated;

commit;
