begin;

create table public.android_push_devices (
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  installation_id uuid not null,
  token text not null unique check (char_length(token) between 20 and 4096),
  primary key (user_id, installation_id)
);
alter table public.android_push_devices enable row level security;
revoke all on public.android_push_devices from anon, authenticated;
grant select, insert, update, delete on public.android_push_devices to authenticated;
grant select, delete on public.android_push_devices to service_role;
create policy "Manage own Android push devices" on public.android_push_devices
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create or replace function app_private.enqueue_web_push()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.web_push_subscriptions s where s.user_id = new.recipient_id)
     or exists (select 1 from public.android_push_devices d where d.user_id = new.recipient_id) then
    insert into public.web_push_queue(notification_id) values (new.id) on conflict do nothing;
  end if;
  return new;
end
$$;

commit;
