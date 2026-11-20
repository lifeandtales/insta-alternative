begin;

-- These in-app events are displayed in the bell without sending a device push.
create or replace function app_private.enqueue_web_push()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.kind in ('post_like', 'story_like', 'post_comment', 'new_follower') then return new; end if;
  if exists (select 1 from public.web_push_subscriptions s where s.user_id = new.recipient_id)
     or exists (select 1 from public.android_push_devices d where d.user_id = new.recipient_id) then
    insert into public.web_push_queue(notification_id) values (new.id) on conflict do nothing;
  end if;
  return new;
end
$$;

create unique index if not exists app_notification_unique_like
on public.app_notifications (recipient_id, kind, (payload->>'target_key'), (payload->>'actor_id'))
where kind in ('post_like', 'story_like') and payload ? 'target_key';

create or replace function app_private.notify_media_reaction()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  event_payload jsonb;
  recipient uuid;
  actor uuid;
  event_kind text;
  content_kind text;
begin
  if tg_table_name in ('image_post_likes', 'image_post_comments') then
    recipient := new.post_owner_id;
    actor := coalesce(to_jsonb(new)->>'user_id', to_jsonb(new)->>'author_id')::uuid;
    event_kind := case when tg_table_name = 'image_post_likes' then 'post_like' else 'post_comment' end;
    event_payload := jsonb_build_object('actor_id', actor, 'post_owner', recipient, 'post_client_id', new.post_client_id,
      'target_key', 'post:' || recipient::text || ':' || new.post_client_id::text);
  else
    if tg_table_name = 'media_interactions' and to_jsonb(new)->>'kind' <> 'like' then return new; end if;
    select owner_id, kind into recipient, content_kind from public.media_content where id = new.content_id;
    if not found or content_kind not in ('post', 'reel', 'story') then return new; end if;
    if tg_table_name = 'media_comments' and content_kind = 'story' then return new; end if;
    actor := coalesce(to_jsonb(new)->>'user_id', to_jsonb(new)->>'author_id')::uuid;
    event_kind := case when tg_table_name = 'media_comments' then 'post_comment'
      when content_kind = 'story' then 'story_like' else 'post_like' end;
    event_payload := jsonb_build_object('actor_id', actor, 'content_id', new.content_id,
      'content_kind', content_kind, 'target_key', content_kind || ':' || new.content_id::text);
  end if;
  if actor = recipient or exists (
    select 1 from public.account_blocks where (blocker_id, blocked_id) in ((recipient, actor), (actor, recipient))
  ) then return new; end if;
  insert into public.app_notifications(recipient_id, kind, payload)
  values (recipient, event_kind, event_payload) on conflict do nothing;
  return new;
end
$$;
revoke all on function app_private.notify_media_reaction() from public, anon, authenticated;

do $$
declare relation text;
begin
  foreach relation in array array['image_post_likes', 'image_post_comments', 'media_interactions', 'media_comments'] loop
    execute format('drop trigger if exists notify_media_reaction on public.%I', relation);
    execute format('create trigger notify_media_reaction after insert on public.%I for each row execute function app_private.notify_media_reaction()', relation);
  end loop;
end
$$;

create or replace function app_private.sync_follow_notification()
returns trigger language plpgsql security definer set search_path = '' as $$
declare changed_id uuid;
begin
  if tg_op = 'DELETE' then
    if old.status = 'requested' then
      update public.app_notifications n
      set payload = n.payload || '{"review_status":"closed"}'::jsonb
      where n.recipient_id = old.followed_id and n.kind = 'follow_request'
        and n.payload->>'actor_id' = old.follower_id::text and not (n.payload ? 'review_status');
    end if;
    return old;
  end if;
  if new.status <> 'accepted' then return new; end if;
  if exists (select 1 from public.account_blocks
    where (blocker_id, blocked_id) in ((new.followed_id, new.follower_id), (new.follower_id, new.followed_id))
  ) then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'requested' then
    update public.app_notifications n
    set payload = n.payload || '{"review_status":"accepted"}'::jsonb
    where n.id = (
      select request.id from public.app_notifications request
      where request.recipient_id = new.followed_id and request.kind = 'follow_request'
        and request.payload->>'actor_id' = new.follower_id::text and not (request.payload ? 'review_status')
      order by request.created_at desc, request.id desc limit 1
    )
    returning n.id into changed_id;
    if changed_id is not null then return new; end if;
  elsif tg_op = 'UPDATE' then return new;
  end if;
  insert into public.app_notifications(recipient_id, kind, payload)
  values (new.followed_id, 'new_follower', jsonb_build_object('actor_id', new.follower_id));
  return new;
end
$$;
revoke all on function app_private.sync_follow_notification() from public, anon, authenticated;
drop trigger if exists sync_follow_notification on public.account_follows;
create trigger sync_follow_notification after insert or update of status or delete on public.account_follows
for each row execute function app_private.sync_follow_notification();

create or replace function app_private.notify_content_mentions()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  tags text[] := '{}';
  written text := left(new.caption,5000);
  audience text;
  target_payload jsonb;
begin
  if tg_table_name = 'image_posts' then
    tags := new.tags;
    target_payload := jsonb_build_object('post_owner', new.owner_id, 'post_client_id', new.client_id,
      'target_key', 'post:' || new.owner_id::text || ':' || new.client_id::text);
    audience := case when new.is_public then 'public' else 'private' end;
  else
    if new.publish_at > now() or new.expires_at <= now()
       or new.story_source_id is not null or new.story_post_id is not null then return new; end if;
    audience := new.audience;
    target_payload := jsonb_build_object('content_id', new.id, 'content_kind', new.kind,
      'target_key', new.kind || ':' || new.id::text);
    if jsonb_typeof(new.metadata->'tags') = 'array' then
      select array(select jsonb_array_elements_text(new.metadata->'tags') limit 50) into tags;
    end if;
    if new.kind = 'story' and jsonb_typeof(new.metadata#>'{edits,layers}') = 'array' then
      select written || ' ' || coalesce(string_agg(left(l->>'text',500), ' '),'') into written
      from (select value as l from jsonb_array_elements(new.metadata#>'{edits,layers}') limit 30) layers
      where l->>'type' = 'text';
    end if;
  end if;
  insert into public.app_notifications(recipient_id,kind,payload)
  select p.id,case when bool_or(target.tagged) then 'content_tag' else 'content_mention' end,
    target_payload || jsonb_build_object('actor_id',new.owner_id)
  from (
    select lower(r[1]) as username,false as tagged
    from regexp_matches(written,'(?<![[:alnum:]_@.])@([a-zA-Z0-9_][a-zA-Z0-9._]{1,29})(?![a-zA-Z0-9._])','g') r
    union all
    select lower(ltrim(tag,'@')),true from unnest(tags) tag
  ) target
  join public.profiles p on p.username=target.username
  join public.profiles author on author.id=new.owner_id
  where p.id<>new.owner_id and not exists (select 1 from public.account_blocks b
    where (b.blocker_id,b.blocked_id) in ((p.id,new.owner_id),(new.owner_id,p.id)))
  and ((audience='public' and not author.is_private)
    or (audience in ('public','followers') and exists (
      select 1 from public.account_follows f where f.follower_id=p.id and f.followed_id=new.owner_id and f.status='accepted'))
    or (audience='close_friends' and exists (
      select 1 from public.close_friends c where c.owner_id=new.owner_id and c.friend_id=p.id)))
  group by p.id;
  return new;
end;
$$;
revoke all on function app_private.notify_content_mentions() from public,anon,authenticated;

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
      and (n.kind in ('post_like', 'story_like', 'post_comment', 'content_mention', 'content_tag', 'new_follower', 'follow_accepted')
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

create or replace function public.mark_home_notifications_read(up_to timestamptz)
returns void language sql security invoker set search_path = '' as $$
  update public.app_notifications set read_at = now()
  where recipient_id = auth.uid() and read_at is null and created_at <= up_to
    and kind in ('post_like', 'story_like', 'post_comment', 'content_mention', 'content_tag',
      'new_follower', 'follow_accepted', 'follow_request');
$$;
revoke all on function public.home_notification_history(integer), public.mark_home_notifications_read(timestamptz)
  from public, anon, authenticated;
grant execute on function public.home_notification_history(integer), public.mark_home_notifications_read(timestamptz)
  to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') and not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime'
    and schemaname = 'public' and tablename = 'app_notifications'
  ) then
    alter publication supabase_realtime add table public.app_notifications;
  end if;
end
$$;

commit;
