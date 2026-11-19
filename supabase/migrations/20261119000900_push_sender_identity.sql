begin;

create or replace function app_private.notify_chat_recipients()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.app_notifications(recipient_id, kind, payload)
  select recipient.id, 'chat_message', jsonb_build_object('conversation_id', new.conversation_id, 'sender_id', new.sender_id,
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

commit;
