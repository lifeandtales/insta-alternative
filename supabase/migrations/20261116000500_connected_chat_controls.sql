begin;

alter table public.conversation_preferences add column if not exists marked_unread boolean not null default false;

create or replace function app_private.accounts_are_connected(other_user uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select auth.uid() is not null and not app_private.account_is_blocked(other_user) and exists (
    select 1 from public.account_follows f where f.status = 'accepted'
      and ((f.follower_id = auth.uid() and f.followed_id = other_user)
        or (f.followed_id = auth.uid() and f.follower_id = other_user))
  );
$$;
revoke all on function app_private.accounts_are_connected(uuid) from public, anon;
grant execute on function app_private.accounts_are_connected(uuid) to authenticated;

create or replace function public.open_connected_chat(other_user uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
begin
  if not app_private.accounts_are_connected(other_user) then
    raise exception 'An accepted follow is required' using errcode = '42501';
  end if;
  return public.open_direct_chat(other_user);
end;
$$;

create or replace function public.connected_chat_can_send(target uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from public.conversations c where c.id = target and c.group_name is null
      and auth.uid() in (c.participant_a, c.participant_b)
      and app_private.accounts_are_connected(
        case when c.participant_a = auth.uid() then c.participant_b else c.participant_a end
      )
  );
$$;

create or replace function public.message_recipients(search_text text default '', page_offset integer default 0)
returns table (id uuid, username text, display_name text, avatar_path text, is_following boolean, follows_me boolean)
language sql stable security invoker set search_path = '' as $$
  with connected as (
    select case when f.follower_id = auth.uid() then f.followed_id else f.follower_id end as peer,
      bool_or(f.follower_id = auth.uid()) as outgoing, bool_or(f.followed_id = auth.uid()) as incoming
    from public.account_follows f
    where f.status = 'accepted' and auth.uid() in (f.follower_id,f.followed_id)
    group by 1
  ), input as (select lower(left(ltrim(btrim(coalesce(search_text,'')), '@'),100)) as term)
  select p.id, p.username, p.display_name,
    case when app_private.can_view_image_post(p.id,true) then p.avatar_path end, c.outgoing, c.incoming
  from connected c join public.profiles p on p.id = c.peer cross join input q
  where q.term = '' or strpos(p.username,q.term) > 0 or strpos(lower(p.display_name),q.term) > 0
  order by c.outgoing desc, p.username, p.id
  limit 31 offset greatest(coalesce(page_offset,0),0);
$$;

drop policy if exists "Mutual following required for direct sends" on public.messages;
drop policy if exists "Accepted following required for direct sends" on public.messages;
create policy "Accepted following required for direct sends" on public.messages as restrictive
  for insert to authenticated with check (exists (
    select 1 from public.conversations c where c.id = conversation_id and (
      c.group_name is not null or public.connected_chat_can_send(c.id)
    )
  ));

drop policy if exists "Honor cleared direct chats" on public.messages;
create policy "Honor cleared direct chats" on public.messages as restrictive for select to authenticated
  using (not exists (
    select 1 from public.conversation_preferences p
    join public.conversations c on c.id = p.conversation_id and c.group_name is null
    where p.conversation_id = messages.conversation_id and p.user_id = auth.uid()
      and messages.created_at <= p.cleared_at
  ));

create or replace function public.mark_direct_chat_read(target uuid, seen_at timestamptz)
returns void language sql security invoker set search_path = '' as $$
  insert into public.conversation_preferences as pref (conversation_id,user_id,last_read_at,marked_unread)
  select target,auth.uid(),least(seen_at,now()),false
  where auth.uid() is not null and seen_at is not null
  on conflict (conversation_id,user_id) do update
  set last_read_at = greatest(pref.last_read_at,excluded.last_read_at), marked_unread = false;
$$;

create or replace function public.set_direct_chat_preference(target uuid, action text, enabled boolean default true)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null or enabled is null or not exists (
    select 1 from public.conversations c where c.id = target and c.group_name is null
  ) then raise exception 'Chat unavailable' using errcode = '42501'; end if;

  insert into public.conversation_preferences(conversation_id,user_id) values (target,auth.uid()) on conflict do nothing;
  case action
    when 'pin' then update public.conversation_preferences set pinned = enabled where conversation_id = target and user_id = auth.uid();
    when 'mute' then update public.conversation_preferences set muted = enabled where conversation_id = target and user_id = auth.uid();
    when 'unread' then
      if enabled then
        update public.conversation_preferences set marked_unread = true where conversation_id = target and user_id = auth.uid();
      else
        perform public.mark_direct_chat_read(target,now());
      end if;
    when 'clear' then update public.conversation_preferences
      set marked_unread = false, cleared_at = now(), last_read_at = now() where conversation_id = target and user_id = auth.uid();
    else raise exception 'Invalid chat preference' using errcode = '22023';
  end case;
end;
$$;

create or replace function public.connected_direct_inbox()
returns table (id uuid, peer_id uuid, username text, display_name text, body text, kind text,
  sent_at timestamptz, unread boolean, avatar_path text, pinned boolean, muted boolean)
language sql stable security invoker set search_path = '' as $$
  select i.id,i.peer_id,i.username,i.display_name,i.body,i.kind,i.sent_at,
    i.unread or coalesce(p.marked_unread,false),i.avatar_path,coalesce(p.pinned,false),coalesce(p.muted,false)
  from public.direct_inbox() i left join public.conversation_preferences p on p.conversation_id = i.id and p.user_id = auth.uid()
  order by coalesce(p.pinned,false) desc,i.sent_at desc,i.id;
$$;

create or replace function public.set_direct_message_reaction(target uuid, reaction text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.messages where id = target
  ) then raise exception 'Message unavailable' using errcode = '42501'; end if;
  if reaction is null then
    delete from public.message_reactions where message_id = target and user_id = auth.uid();
  elsif reaction in ('❤️','😂','😮','😢','😡','👍') then
    insert into public.message_reactions(message_id,user_id,emoji) values (target,auth.uid(),reaction)
    on conflict (message_id,user_id) do update set emoji = excluded.emoji;
  else
    raise exception 'Invalid reaction' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.open_connected_chat(uuid), public.connected_chat_can_send(uuid),
  public.message_recipients(text,integer), public.set_direct_chat_preference(uuid,text,boolean),
  public.connected_direct_inbox(), public.set_direct_message_reaction(uuid,text) from public,anon,authenticated;
grant execute on function public.open_connected_chat(uuid), public.connected_chat_can_send(uuid),
  public.message_recipients(text,integer), public.set_direct_chat_preference(uuid,text,boolean),
  public.connected_direct_inbox(), public.set_direct_message_reaction(uuid,text) to authenticated;

do $$
declare relation text;
begin
  foreach relation in array array['conversation_preferences','message_reactions'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = relation) then
      execute format('alter publication supabase_realtime add table public.%I',relation);
    end if;
  end loop;
end;
$$;

commit;
