begin;

-- The message SELECT policy consults hidden_messages. Look up eligibility without
-- expanding that SELECT policy inside the hidden_messages INSERT policy.
create or replace function app_private.may_hide_chat_message(target uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select auth.uid() is not null and (
    exists (
      select 1 from public.hidden_messages h
      where h.user_id = auth.uid() and h.message_id = target
    )
    or exists (
      select 1 from public.messages m
      join public.conversations c on c.id = m.conversation_id
      where m.id = target
        and app_private.is_conversation_participant(c.id)
        and (m.expires_at is null or m.expires_at > now())
        and (c.group_name is not null or not app_private.account_is_blocked(
          case when c.participant_a = auth.uid() then c.participant_b else c.participant_a end))
        and not exists (
          select 1 from public.conversation_preferences p
          where p.conversation_id = c.id and p.user_id = auth.uid() and p.cleared_at >= m.created_at
        )
    )
  );
$$;
revoke all on function app_private.may_hide_chat_message(uuid) from public, anon;
grant execute on function app_private.may_hide_chat_message(uuid) to authenticated;

drop policy if exists "Participants hide their own view of a message" on public.hidden_messages;
create policy "Participants hide their own view of a message" on public.hidden_messages
  for insert to authenticated with check (
    user_id = (select auth.uid()) and app_private.may_hide_chat_message(message_id)
  );

commit;
