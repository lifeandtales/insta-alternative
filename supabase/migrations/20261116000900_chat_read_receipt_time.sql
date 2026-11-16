begin;

alter table public.conversation_preferences
  add column if not exists peer_read_at timestamptz;

create or replace function app_private.stamp_chat_read_time()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.peer_read_at := case when new.peer_seen_at is not null then now() end;
  elsif new.peer_seen_at > old.peer_seen_at
      or (old.peer_seen_at is null and new.peer_seen_at is not null) then
    new.peer_read_at := now();
  else
    new.peer_read_at := old.peer_read_at;
  end if;
  return new;
end;
$$;

drop trigger if exists stamp_chat_read_time on public.conversation_preferences;
create trigger stamp_chat_read_time before insert or update of peer_seen_at, peer_read_at
  on public.conversation_preferences for each row
  execute function app_private.stamp_chat_read_time();

create or replace function public.direct_chat_read_receipt_details(target uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('seen_at', p.peer_seen_at, 'read_at', p.peer_read_at)
  from public.conversations c
  join public.conversation_preferences p on p.conversation_id = c.id
    and p.user_id = case when c.participant_a = auth.uid() then c.participant_b else c.participant_a end
  where c.id = target and auth.uid() in (c.participant_a, c.participant_b)
    and not app_private.account_is_blocked(p.user_id);
$$;
revoke all on function public.direct_chat_read_receipt_details(uuid) from public, anon;
grant execute on function public.direct_chat_read_receipt_details(uuid) to authenticated;

commit;
