begin;

alter table public.conversations add column if not exists group_photo text;
revoke insert on public.group_members from authenticated;

create table if not exists public.group_invitations (
  conversation_id uuid references public.conversations(id) on delete cascade,
  recipient_id uuid references public.profiles(id) on delete cascade,
  inviter_id uuid not null references public.profiles(id) on delete cascade,
  primary key (conversation_id, recipient_id)
);
create index if not exists group_invitations_recipient_idx on public.group_invitations(recipient_id);
alter table public.group_invitations enable row level security;
revoke all on public.group_invitations from public, anon, authenticated;
grant select on public.group_invitations to authenticated;
drop policy if exists "Read own group invitations" on public.group_invitations;
create policy "Read own group invitations" on public.group_invitations for select to authenticated
  using (recipient_id = (select auth.uid()));

create or replace function public.set_group_invitation_preference(mode text)
returns void language sql security invoker set search_path = '' as $$
  insert into public.account_preferences as prefs (user_id, settings)
  select auth.uid(), jsonb_build_object('groupJoinMode', mode)
  where auth.uid() is not null and mode in ('automatic', 'review')
  on conflict (user_id) do update set settings = prefs.settings || excluded.settings;
$$;

create or replace function public.create_connected_group(name text, member_ids uuid[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  result uuid;
  member uuid;
  mode text;
begin
  if caller is null or name is null or char_length(btrim(name)) not between 1 and 60
     or coalesce(cardinality(member_ids), 0) not between 1 and 99
     or exists (select 1 from unnest(member_ids) id where id is null or id = caller or not app_private.accounts_are_connected(id)) then
    raise exception 'Choose valid group members with an accepted follow' using errcode = '42501';
  end if;
  insert into public.conversations(group_name) values (btrim(name)) returning id into result;
  insert into public.group_members(conversation_id, user_id, role) values (result, caller, 'admin');
  for member in select distinct unnest(member_ids) loop
    select p.settings->>'groupJoinMode' into mode from public.account_preferences p where p.user_id = member;
    if mode = 'review' then
      insert into public.group_invitations values (result, member, caller);
    else
      insert into public.group_members(conversation_id, user_id, role) values (result, member, 'member');
    end if;
  end loop;
  return result;
end;
$$;

create or replace function public.create_group_chat(name text, member_ids uuid[])
returns uuid language sql security invoker set search_path = '' as $$
  select public.create_connected_group(name, member_ids);
$$;

create or replace function public.respond_to_group_invitation(target uuid, accept boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  viewer uuid := auth.uid();
  inviter uuid;
begin
  if viewer is null or accept is null then return false; end if;
  delete from public.group_invitations where conversation_id = target and recipient_id = viewer
    returning inviter_id into inviter;
  if not found then return false; end if;
  if accept then
    if app_private.account_is_blocked(inviter) then return false; end if;
    insert into public.group_members(conversation_id, user_id, role) values (target, viewer, 'member') on conflict do nothing;
  end if;
  return true;
end;
$$;

create or replace function public.set_connected_group_photo(target uuid, photo text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if photo is null or char_length(photo) > 256000 or photo !~ '^data:image/jpeg;base64,[A-Za-z0-9+/]+={0,2}$' then
    return false;
  end if;
  update public.conversations c set group_photo = photo
    where c.id = target and c.group_name is not null
      and exists (select 1 from public.group_members m where m.conversation_id = c.id and m.user_id = auth.uid());
  return found;
end;
$$;

create or replace function public.connected_groups(target uuid default null)
returns table (id uuid, group_name text, pending boolean, members jsonb, sent_at timestamptz, body text, kind text, unread_count bigint, photo text, pinned boolean, muted boolean, marked_unread boolean)
language sql stable security definer set search_path = '' as $$
  with mine as (
    select g.conversation_id, false as pending from public.group_members g where g.user_id = auth.uid()
    union all
    select i.conversation_id, true from public.group_invitations i
      where i.recipient_id = auth.uid() and not app_private.account_is_blocked(i.inviter_id)
  ), eligible as (
    select c.id, c.group_name, c.created_at, mine.pending
    from mine join public.conversations c on c.id = mine.conversation_id
    where c.group_name is not null and (target is null or target = c.id)
  )
  select c.id, c.group_name, c.pending,
    coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'username', p.username, 'display_name', p.display_name,
        'avatar_path', case when app_private.can_view_image_post(p.id,true) then p.avatar_path end, 'role', g.role) order by p.username)
      from public.group_members g join public.profiles p on p.id = g.user_id where not c.pending and g.conversation_id = c.id), '[]'::jsonb),
    coalesce(latest.created_at,c.created_at), latest.body, latest.kind, coalesce(latest.unread_count, 0),
    case when not c.pending then (select g.group_photo from public.conversations g where g.id = c.id) end,
    coalesce(pref.pinned, false), coalesce(pref.muted, false), coalesce(pref.marked_unread, false)
  from eligible c
  left join public.conversation_preferences pref on pref.conversation_id = c.id and pref.user_id = auth.uid()
  left join lateral (
    select m.created_at, m.body, m.kind,
      count(*) filter (where m.sender_id <> auth.uid() and m.created_at > coalesce(pref.last_read_at, '-infinity'::timestamptz)) over() as unread_count
    from public.messages m where not c.pending and m.conversation_id = c.id
      and (m.expires_at is null or m.expires_at > now())
      and (pref.cleared_at is null or m.created_at > pref.cleared_at)
      and not exists (select 1 from public.hidden_messages h where h.user_id = auth.uid() and h.message_id = m.id)
    order by m.created_at desc, m.id desc limit 1
  ) latest on true
  order by coalesce(latest.created_at,c.created_at) desc, c.id
  limit 100;
$$;

create or replace function public.set_direct_chat_preference(target uuid, action text, enabled boolean default true)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null or enabled is null or not exists (
    select 1 from public.conversations c where c.id = target and (c.group_name is null or action <> 'clear')
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

create or replace function public.leave_connected_group(target uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.conversations c where c.id = target and c.group_name is not null for update;
  if not found then return false; end if;
  delete from public.group_members where conversation_id = target and user_id = auth.uid();
  if not found then return false; end if;
  if not exists (select 1 from public.group_members m where m.conversation_id = target and m.role = 'admin') then
    update public.group_members set role = 'admin' where conversation_id = target and user_id = (
      select m.user_id from public.group_members m where m.conversation_id = target order by m.user_id limit 1
    );
  end if;
  return true;
end;
$$;

revoke all on function public.set_group_invitation_preference(text), public.create_connected_group(text, uuid[]), public.create_group_chat(text, uuid[]),
  public.respond_to_group_invitation(uuid, boolean), public.connected_groups(uuid), public.set_connected_group_photo(uuid, text), public.leave_connected_group(uuid)
  from public, anon;
grant execute on function public.set_group_invitation_preference(text), public.create_connected_group(text, uuid[]), public.create_group_chat(text, uuid[]),
  public.respond_to_group_invitation(uuid, boolean), public.connected_groups(uuid), public.set_connected_group_photo(uuid, text), public.leave_connected_group(uuid)
  to authenticated;

do $$
declare relation text;
begin
  foreach relation in array array['group_members', 'group_invitations'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = relation) then
      execute format('alter publication supabase_realtime add table public.%I',relation);
    end if;
  end loop;
end
$$;

commit;
