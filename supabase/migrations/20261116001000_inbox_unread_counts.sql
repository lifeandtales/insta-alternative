begin;

create or replace function public.connected_direct_inbox_with_counts()
returns table (id uuid, peer_id uuid, username text, display_name text, body text, kind text,
  sent_at timestamptz, unread boolean, avatar_path text, pinned boolean, muted boolean,
  unread_count integer)
language sql stable security invoker set search_path = '' as $$
  select i.id, i.peer_id, i.username, i.display_name, i.body, i.kind, i.sent_at,
    i.unread or counts.total > 0, i.avatar_path, i.pinned, i.muted, counts.total
  from public.connected_direct_inbox() i
  left join public.conversation_preferences p on p.conversation_id = i.id and p.user_id = auth.uid()
  cross join lateral (
    select count(*)::integer as total from (
      select 1 from public.messages m
      where m.conversation_id = i.id and m.sender_id = i.peer_id
        and m.created_at > coalesce(p.last_read_at, '-infinity'::timestamptz)
      limit 5
    ) unread_messages
  ) counts
  where auth.uid() is not null
  order by i.pinned desc, i.sent_at desc, i.id;
$$;

revoke all on function public.connected_direct_inbox_with_counts() from public, anon;
grant execute on function public.connected_direct_inbox_with_counts() to authenticated;

commit;
