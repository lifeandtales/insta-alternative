begin;

create table if not exists public.group_call_rooms (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  caller_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('voice', 'video')),
  ring_until timestamptz not null default (now() + interval '45 seconds'),
  expires_at timestamptz not null default (now() + interval '45 seconds'),
  ended_at timestamptz
);
create unique index if not exists group_call_one_open_room on public.group_call_rooms(conversation_id)
  where ended_at is null;

create table if not exists public.group_call_attendees (
  room_id uuid references public.group_call_rooms(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  status text not null check (status in ('ringing', 'joined', 'declined', 'left')),
  primary key (room_id, user_id)
);
create index if not exists group_call_incoming_idx on public.group_call_attendees(user_id, room_id)
  where status = 'ringing';

create table if not exists public.group_call_signals (
  room_id uuid references public.group_call_rooms(id) on delete cascade,
  offerer uuid references public.profiles(id) on delete cascade,
  answerer uuid references public.profiles(id) on delete cascade,
  offer text not null,
  answer text,
  primary key (room_id, offerer, answerer),
  check (offerer < answerer)
);

alter table public.group_call_rooms enable row level security;
alter table public.group_call_attendees enable row level security;
alter table public.group_call_signals enable row level security;
revoke all on public.group_call_rooms, public.group_call_attendees, public.group_call_signals from public, anon, authenticated;

create or replace function public.start_group_call(target uuid, call_kind text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  room uuid;
begin
  if caller is null or call_kind is null or call_kind not in ('voice', 'video') then
    raise exception 'Calling is unavailable' using errcode = '42501';
  end if;
  perform 1 from public.conversations c where c.id = target and c.group_name is not null
    and exists (select 1 from public.group_members m where m.conversation_id = c.id and m.user_id = caller)
    for update;
  if not found then raise exception 'Calling is unavailable' using errcode = '42501'; end if;

  delete from public.group_call_rooms r where r.conversation_id = target
    and (r.ended_at is not null or r.expires_at <= now()
      or not exists (select 1 from public.group_members m where m.conversation_id = target and m.user_id = r.caller_id));
  insert into public.group_call_rooms(conversation_id, caller_id, kind)
    values (target, caller, call_kind) returning id into room;
  insert into public.group_call_attendees(room_id, user_id, status)
    select room, m.user_id, 'ringing'
    from public.group_members m left join public.conversation_preferences p
      on p.conversation_id = target and p.user_id = m.user_id
    where m.conversation_id = target and m.user_id <> caller
      and not app_private.account_is_blocked(m.user_id) and not coalesce(p.calls_muted, false);
  if not found then raise exception 'No members are available for this call' using errcode = '42501'; end if;
  insert into public.group_call_attendees values (room, caller, 'joined');
  return room;
end;
$$;

create or replace function public.incoming_group_call()
returns uuid language sql stable security definer set search_path = '' as $$
  select r.id from public.group_call_attendees a join public.group_call_rooms r on r.id = a.room_id
  join public.group_members m on m.conversation_id = r.conversation_id and m.user_id = a.user_id
  join public.group_members caller on caller.conversation_id = r.conversation_id and caller.user_id = r.caller_id
  left join public.conversation_preferences p on p.conversation_id = r.conversation_id and p.user_id = a.user_id
  where a.user_id = auth.uid() and a.status = 'ringing' and r.ring_until > now() and r.ended_at is null
    and not app_private.account_is_blocked(r.caller_id) and not coalesce(p.calls_muted, false)
  order by r.ring_until, r.id limit 1;
$$;

create or replace function public.group_call_snapshot(target uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', r.id, 'name', c.group_name, 'kind', r.kind, 'caller', coalesce(p.display_name, p.username),
    'status', mine.status,
    'ringing', (select count(*) from public.group_call_attendees a
      join public.group_members m on m.conversation_id = r.conversation_id and m.user_id = a.user_id
      where a.room_id = r.id and a.status = 'ringing' and r.ring_until > now() and not app_private.account_is_blocked(a.user_id)),
    'peers', coalesce((select jsonb_agg(jsonb_build_object('id', a.user_id, 'name', coalesce(person.display_name, person.username),
      'offer', s.offer, 'answer', s.answer) order by a.user_id)
      from public.group_call_attendees a
      join public.group_members m on m.conversation_id = r.conversation_id and m.user_id = a.user_id
      join public.profiles person on person.id = a.user_id
      left join public.group_call_signals s on s.room_id = r.id
        and s.offerer = least(a.user_id, mine.user_id) and s.answerer = greatest(a.user_id, mine.user_id)
      where mine.status = 'joined' and a.room_id = r.id and a.status = 'joined' and a.user_id <> mine.user_id
        and not app_private.account_is_blocked(a.user_id)), '[]'::jsonb))
  from public.group_call_rooms r join public.conversations c on c.id = r.conversation_id
  join public.group_call_attendees mine on mine.room_id = r.id and mine.user_id = auth.uid()
  join public.group_members m on m.conversation_id = r.conversation_id and m.user_id = mine.user_id
  join public.group_members caller on caller.conversation_id = r.conversation_id and caller.user_id = r.caller_id
  join public.profiles p on p.id = r.caller_id
  where r.id = target and r.ended_at is null and r.expires_at > now()
    and (mine.status = 'joined' or (mine.status = 'ringing' and r.ring_until > now()))
    and (r.caller_id = mine.user_id or not app_private.account_is_blocked(r.caller_id));
$$;

create or replace function public.respond_group_call(target uuid, action text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  viewer uuid := auth.uid();
  room public.group_call_rooms;
begin
  select r.* into room from public.group_call_rooms r
    join public.group_call_attendees a on a.room_id = r.id and a.user_id = viewer
    join public.group_members m on m.conversation_id = r.conversation_id and m.user_id = viewer
    where r.id = target and r.ended_at is null for update of r;
  if not found then return false; end if;
  if action = 'accept' then
    if room.ring_until <= now() or app_private.account_is_blocked(room.caller_id)
      or not exists (select 1 from public.group_members m where m.conversation_id = room.conversation_id and m.user_id = room.caller_id)
      or exists (select 1 from public.conversation_preferences p where p.conversation_id = room.conversation_id and p.user_id = viewer and p.calls_muted) then
      return false;
    end if;
    update public.group_call_attendees set status = 'joined'
      where room_id = target and user_id = viewer and status = 'ringing';
    if not found then return false; end if;
    update public.group_call_rooms set expires_at = greatest(expires_at, now() + interval '4 hours') where id = target;
  elsif action = 'decline' then
    update public.group_call_attendees set status = 'declined' where room_id = target and user_id = viewer and status = 'ringing';
    return found;
  elsif action = 'leave' then
    if viewer = room.caller_id then
      update public.group_call_rooms set ended_at = now() where id = target;
      delete from public.group_call_signals where room_id = target;
    else
      update public.group_call_attendees set status = 'left' where room_id = target and user_id = viewer and status = 'joined';
      if not found then return false; end if;
      delete from public.group_call_signals where room_id = target and viewer in (offerer, answerer);
    end if;
  else
    return false;
  end if;
  return true;
end;
$$;

create or replace function public.write_group_call_signal(target uuid, other_user uuid, description_type text, description text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  viewer uuid := auth.uid();
begin
  if viewer is null or other_user is null or other_user = viewer or app_private.account_is_blocked(other_user)
    or description is null or length(description) not between 10 and 100000 then return false; end if;
  perform 1 from public.group_call_rooms r
    join public.group_call_attendees mine on mine.room_id = r.id and mine.user_id = viewer and mine.status = 'joined'
    join public.group_call_attendees other on other.room_id = r.id and other.user_id = other_user and other.status = 'joined'
    join public.group_members m on m.conversation_id = r.conversation_id and m.user_id = viewer
    join public.group_members n on n.conversation_id = r.conversation_id and n.user_id = other_user
    join public.group_members caller on caller.conversation_id = r.conversation_id and caller.user_id = r.caller_id
    where r.id = target and r.expires_at > now() and r.ended_at is null for update of r;
  if not found then return false; end if;

  if viewer < other_user and description_type = 'offer' then
    insert into public.group_call_signals(room_id, offerer, answerer, offer) values (target, viewer, other_user, description)
      on conflict (room_id, offerer, answerer) do nothing;
    return true;
  elsif viewer > other_user and description_type = 'answer' then
    update public.group_call_signals set answer = coalesce(answer, description)
      where room_id = target and offerer = other_user and answerer = viewer;
    return found;
  end if;
  return false;
end;
$$;

revoke all on function public.start_group_call(uuid,text), public.incoming_group_call(), public.group_call_snapshot(uuid),
  public.respond_group_call(uuid,text), public.write_group_call_signal(uuid,uuid,text,text) from public, anon;
grant execute on function public.start_group_call(uuid,text), public.incoming_group_call(), public.group_call_snapshot(uuid),
  public.respond_group_call(uuid,text), public.write_group_call_signal(uuid,uuid,text,text) to authenticated;

commit;
