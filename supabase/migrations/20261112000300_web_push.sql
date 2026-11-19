begin;

create table public.web_push_subscriptions (
  endpoint text primary key check (char_length(endpoint) between 1 and 2048),
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  p256dh text not null check (p256dh ~ '^[A-Za-z0-9_-]{87}$'),
  auth_secret text not null check (auth_secret ~ '^[A-Za-z0-9_-]{22}$'),
  created_at timestamptz not null default now()
);
create index web_push_subscriptions_user_idx on public.web_push_subscriptions(user_id);
alter table public.web_push_subscriptions enable row level security;
revoke all on public.web_push_subscriptions from anon, authenticated;
grant select, insert, update, delete on public.web_push_subscriptions to authenticated;
grant select, delete on public.web_push_subscriptions to service_role;
create policy "Manage own web push subscriptions" on public.web_push_subscriptions
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create table public.web_push_queue (
  notification_id uuid primary key references public.app_notifications(id) on delete cascade,
  attempts integer not null default 0,
  available_at timestamptz not null default now()
);
create index web_push_queue_available_idx on public.web_push_queue(available_at);
alter table public.web_push_queue enable row level security;
revoke all on public.web_push_queue from anon, authenticated;
grant select, update, delete on public.web_push_queue to service_role;
grant select on public.app_notifications to service_role;

create function app_private.enqueue_web_push()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.web_push_subscriptions s where s.user_id = new.recipient_id) then
    insert into public.web_push_queue(notification_id) values (new.id) on conflict do nothing;
  end if;
  return new;
end
$$;
revoke all on function app_private.enqueue_web_push() from public;
create trigger enqueue_web_push after insert on public.app_notifications
  for each row execute function app_private.enqueue_web_push();

create function public.claim_web_push_batch()
returns table (notification_id uuid, recipient_id uuid, kind text, attempts integer)
language sql security definer set search_path = '' as $$
  with claimed as (
    select q.notification_id
    from public.web_push_queue q
    where q.available_at <= now()
    order by q.available_at
    limit 10
    for update skip locked
  ), leased as (
    update public.web_push_queue q
    set attempts = q.attempts + 1, available_at = now() + interval '2 minutes'
    from claimed c where q.notification_id = c.notification_id
    returning q.notification_id, q.attempts
  )
  select l.notification_id, n.recipient_id, n.kind, l.attempts
  from leased l join public.app_notifications n on n.id = l.notification_id
$$;
revoke all on function public.claim_web_push_batch() from public, anon, authenticated;
grant execute on function public.claim_web_push_batch() to service_role;

create function app_private.notify_chat_recipients()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.app_notifications(recipient_id, kind, payload)
  select recipient.id, 'chat_message', jsonb_build_object('conversation_id', new.conversation_id)
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
revoke all on function app_private.notify_chat_recipients() from public;
create trigger notify_chat_recipients after insert on public.messages
  for each row execute function app_private.notify_chat_recipients();

commit;
