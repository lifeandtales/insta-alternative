begin;

create or replace function app_private.notify_chat_recipients()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.app_notifications(recipient_id, kind, payload)
  select recipient.id, 'chat_message', jsonb_build_object('conversation_id', new.conversation_id,
    'preview', case when new.kind = 'text' then left(new.body, 180) else 'Sent an attachment.' end)
  from (
    select c.participant_a as id from public.conversations c where c.id = new.conversation_id
    union
    select c.participant_b from public.conversations c where c.id = new.conversation_id
    union
    select m.user_id from public.group_members m where m.conversation_id = new.conversation_id
  ) recipient
  where recipient.id <> new.sender_id
    and not exists (
      select 1 from public.conversation_preferences p
      where p.conversation_id = new.conversation_id and p.user_id = recipient.id and p.muted
    )
    and not exists (
      select 1 from public.account_blocks b where
        (b.blocker_id = recipient.id and b.blocked_id = new.sender_id)
        or (b.blocker_id = new.sender_id and b.blocked_id = recipient.id)
    );
  return new;
end
$$;
create or replace function app_private.notify_follow_changes()
returns trigger language plpgsql security definer set search_path='' as $$
declare recipient uuid; actor uuid; event_kind text;
begin
  if new.status = 'requested' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    recipient := new.followed_id; actor := new.follower_id; event_kind := 'follow_request';
  elsif tg_op = 'UPDATE' and old.status = 'requested' and new.status = 'accepted' then
    recipient := new.follower_id; actor := new.followed_id; event_kind := 'follow_accepted';
  else
    return new;
  end if;
  insert into public.app_notifications(recipient_id,kind,payload)
  select recipient,event_kind,jsonb_build_object('actor_id',actor)
  where not exists (select 1 from public.account_blocks b
    where (b.blocker_id,b.blocked_id) in ((recipient,actor),(actor,recipient)));
  return new;
end;
$$;
revoke all on function app_private.notify_follow_changes() from public,anon,authenticated;
drop trigger if exists notify_follow_changes on public.account_follows;
create trigger notify_follow_changes after insert or update of status on public.account_follows
for each row execute function app_private.notify_follow_changes();

create or replace function app_private.notify_content_mentions()
returns trigger language plpgsql security definer set search_path='' as $$
declare tags text[] := '{}'; written text := left(new.caption,5000); audience text;
begin
  if tg_table_name = 'image_posts' then
    tags := new.tags;
    audience := case when new.is_public then 'public' else 'private' end;
  else
    if new.publish_at > now() or new.expires_at <= now()
       or new.story_source_id is not null or new.story_post_id is not null then return new; end if;
    audience := new.audience;
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
    jsonb_build_object('actor_id',new.owner_id)
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
drop trigger if exists notify_content_mentions on public.image_posts;
create trigger notify_content_mentions after insert on public.image_posts
for each row execute function app_private.notify_content_mentions();
drop trigger if exists notify_content_mentions on public.media_content;
create trigger notify_content_mentions after insert on public.media_content
for each row execute function app_private.notify_content_mentions();

commit;
