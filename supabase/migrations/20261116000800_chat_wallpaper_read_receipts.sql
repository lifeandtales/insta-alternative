begin;

alter table public.conversation_preferences
  add column if not exists wallpaper_jpeg text
    check (wallpaper_jpeg is null or wallpaper_jpeg = '' or (
      length(wallpaper_jpeg) <= 1500000 and
      wallpaper_jpeg ~ '^data:image/jpeg;base64,[A-Za-z0-9+/]+={0,2}$'
    )),
  add column if not exists wallpaper_version text generated always as (md5(wallpaper_jpeg)) stored,
  add column if not exists peer_seen_at timestamptz;

create or replace function public.mark_direct_chat_read(target uuid, seen_at timestamptz)
returns void language sql security invoker set search_path = '' as $$
  insert into public.conversation_preferences as pref
    (conversation_id, user_id, last_read_at, marked_unread, peer_seen_at)
  select target, auth.uid(), least(seen_at, now()), false, (
    select max(m.created_at) from public.messages m
    where m.conversation_id = target and m.sender_id <> auth.uid()
      and m.created_at <= least(seen_at, now())
  )
  where auth.uid() is not null and seen_at is not null
  on conflict (conversation_id, user_id) do update
  set last_read_at = greatest(pref.last_read_at, excluded.last_read_at),
      marked_unread = false,
      peer_seen_at = greatest(pref.peer_seen_at, excluded.peer_seen_at);
$$;

create or replace function public.direct_chat_read_receipt(target uuid)
returns timestamptz language sql stable security definer set search_path = '' as $$
  select p.peer_seen_at
  from public.conversations c
  join public.conversation_preferences p on p.conversation_id = c.id
    and p.user_id = case when c.participant_a = auth.uid() then c.participant_b else c.participant_a end
  where c.id = target and auth.uid() in (c.participant_a, c.participant_b)
    and not app_private.account_is_blocked(p.user_id);
$$;
revoke all on function public.direct_chat_read_receipt(uuid) from public, anon;
grant execute on function public.direct_chat_read_receipt(uuid) to authenticated;

commit;
