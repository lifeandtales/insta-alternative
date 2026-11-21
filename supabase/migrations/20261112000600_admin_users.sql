begin;

create or replace function public.admin_list_users(search_text text, page_offset integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  term text := lower(left(btrim(coalesce(search_text, '')), 160));
begin
  perform app_private.require_dashboard_admin();
  return coalesce((
    select jsonb_agg(to_jsonb(account) order by created_at desc nulls last, id)
    from (
      select u.id, u.email, u.created_at, u.banned_until, p.username, p.display_name,
        exists (select 1 from app_private.admin_members where user_id = u.id) as is_admin
      from auth.users u left join public.profiles p on p.id = u.id
      where term = '' or strpos(lower(u.email), term) > 0 or strpos(lower(p.username), term) > 0
        or strpos(lower(p.display_name), term) > 0 or u.id::text = term
      order by u.created_at desc nulls last, u.id
      limit 26 offset greatest(coalesce(page_offset, 0), 0)
    ) account
  ), '[]'::jsonb);
end;
$$;

create or replace function public.admin_user_details(target uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  account jsonb;
  totals jsonb;
  activity jsonb;
begin
  perform app_private.require_dashboard_admin();
  select jsonb_build_object('id', u.id, 'email', u.email, 'created_at', u.created_at,
    'last_sign_in_at', u.last_sign_in_at, 'email_confirmed_at', u.email_confirmed_at,
    'banned_until', u.banned_until, 'username', p.username, 'display_name', p.display_name,
    'bio', p.bio, 'is_admin', exists (select 1 from app_private.admin_members where user_id = u.id))
  into account from auth.users u left join public.profiles p on p.id = u.id where u.id = target;

  if account is null then
    raise exception 'Account not found' using errcode = 'P0002';
  end if;

  select jsonb_build_object(
    'Image posts', (select count(*) from public.image_posts where owner_id = target),
    'Posts', (select count(*) from public.media_content where owner_id = target and kind = 'post'),
    'Reels', (select count(*) from public.media_content where owner_id = target and kind = 'reel'),
    'Stories', (select count(*) from public.media_content where owner_id = target and kind = 'story'),
    'Messages sent', (select count(*) from public.messages where sender_id = target),
    'Attachments sent', (select count(*) from public.messages where sender_id = target and object_path is not null),
    'Comments', (select count(*) from public.media_comments where author_id = target),
    'Likes', (select count(*) from public.media_interactions where user_id = target and kind = 'like'),
    'Views', (select count(*) from public.media_interactions where user_id = target and kind = 'view'),
    'Saves', (select count(*) from public.media_interactions where user_id = target and kind = 'save'),
    'Reports submitted', (select count(*) from public.content_reports where reporter_id = target),
    'Communities created', (select count(*) from public.communities where owner_id = target),
    'Followers', (select count(*) from public.account_follows where followed_id = target and status = 'accepted'),
    'Following', (select count(*) from public.account_follows where follower_id = target and status = 'accepted'),
    'Groups joined', (select count(*) from public.group_members where user_id = target)
  ) into totals;

  select coalesce(jsonb_agg(to_jsonb(event) order by created_at desc, category), '[]'::jsonb)
  into activity from (
    select * from (
      (select 'Image posts'::text as category, created_at from public.image_posts where owner_id = target order by created_at desc limit 30)
      union all
      (select 'Posts'::text as category, created_at from public.media_content where owner_id = target and kind = 'post' order by created_at desc limit 30)
      union all
      (select 'Reels'::text as category, created_at from public.media_content where owner_id = target and kind = 'reel' order by created_at desc limit 30)
      union all
      (select 'Stories'::text as category, created_at from public.media_content where owner_id = target and kind = 'story' order by created_at desc limit 30)
      union all
      (select 'Messages sent'::text as category, created_at from public.messages where sender_id = target order by created_at desc limit 30)
      union all
      (select 'Attachments sent'::text as category, created_at from public.messages where sender_id = target and object_path is not null order by created_at desc limit 30)
      union all
      (select 'Comments'::text as category, created_at from public.media_comments where author_id = target order by created_at desc limit 30)
      union all
      (select 'Likes'::text as category, created_at from public.media_interactions where user_id = target and kind = 'like' order by created_at desc limit 30)
      union all
      (select 'Views'::text as category, created_at from public.media_interactions where user_id = target and kind = 'view' order by created_at desc limit 30)
      union all
      (select 'Saves'::text as category, created_at from public.media_interactions where user_id = target and kind = 'save' order by created_at desc limit 30)
      union all
      (select 'Reports submitted'::text as category, created_at from public.content_reports where reporter_id = target order by created_at desc limit 30)
      union all
      (select 'Communities created'::text as category, created_at from public.communities where owner_id = target order by created_at desc limit 30)
    ) events order by created_at desc, category limit 30
  ) event;

  return jsonb_build_object('account', account, 'totals', totals, 'activity', activity);
end;
$$;

revoke all on function public.admin_list_users(text, integer), public.admin_user_details(uuid)
  from public, anon, authenticated;
grant execute on function public.admin_list_users(text, integer), public.admin_user_details(uuid)
  to authenticated;

commit;
