begin;
create table if not exists public.live_broadcasts (
 id uuid primary key default gen_random_uuid(),
 host_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
 status text not null default 'preparing' check(status in ('preparing','live','ended')),
 created_at timestamptz not null default now(), started_at timestamptz,
 expires_at timestamptz not null default now()+interval '90 seconds', ended_at timestamptz
);
create unique index if not exists one_active_broadcast_per_host on public.live_broadcasts(host_id) where status in ('preparing','live');
create table if not exists public.live_broadcast_notices (
 broadcast_id uuid not null references public.live_broadcasts(id) on delete cascade,
 recipient_id uuid not null references public.profiles(id) on delete cascade,
 created_at timestamptz not null default now(), read_at timestamptz,
 primary key(broadcast_id,recipient_id)
);
create or replace function app_private.can_watch_live(target uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.live_broadcasts b
 where b.id=target and b.status='live' and b.expires_at>now() and not app_private.account_is_blocked(b.host_id)
 and (b.host_id=auth.uid() or exists(select 1 from public.account_follows f
 where f.follower_id=auth.uid() and f.followed_id=b.host_id and f.status='accepted')));
$$;
revoke all on function app_private.can_watch_live(uuid) from public,anon;
grant execute on function app_private.can_watch_live(uuid) to authenticated;
alter table public.live_broadcasts enable row level security;
alter table public.live_broadcast_notices enable row level security;
drop policy if exists live_broadcast_read on public.live_broadcasts;
create policy live_broadcast_read on public.live_broadcasts for select to authenticated using(host_id=auth.uid() or app_private.can_watch_live(id));
drop policy if exists live_notice_read on public.live_broadcast_notices;
create policy live_notice_read on public.live_broadcast_notices for select to authenticated using(recipient_id=auth.uid());
drop policy if exists live_notice_update on public.live_broadcast_notices;
create policy live_notice_update on public.live_broadcast_notices for update to authenticated using(recipient_id=auth.uid()) with check(recipient_id=auth.uid());
revoke all on public.live_broadcasts,public.live_broadcast_notices from anon,authenticated;
grant select on public.live_broadcasts,public.live_broadcast_notices to authenticated;
grant update(read_at) on public.live_broadcast_notices to authenticated;

create or replace function public.create_live_broadcast()
returns uuid language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
 if auth.uid() is null then raise exception 'Login required' using errcode='42501'; end if;
 update public.live_broadcasts set status='ended',ended_at=now() where host_id=auth.uid() and status<>'ended' and expires_at<=now();
 insert into public.live_broadcasts(host_id) values(auth.uid()) returning id into target;
 return target;
end;
$$;
create or replace function public.activate_live_broadcast(target uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 update public.live_broadcasts set status='live',started_at=now(),expires_at=now()+interval '90 seconds'
 where id=target and host_id=auth.uid() and status='preparing' and expires_at>now();
 if not found then raise exception 'Broadcast unavailable' using errcode='42501'; end if;
 insert into public.live_broadcast_notices(broadcast_id,recipient_id)
 select target,f.follower_id from public.account_follows f where f.followed_id=auth.uid() and f.status='accepted'
 and not exists(select 1 from public.account_blocks x where (x.blocker_id=auth.uid() and x.blocked_id=f.follower_id) or (x.blocked_id=auth.uid() and x.blocker_id=f.follower_id))
 on conflict do nothing;
end;
$$;
create or replace function public.heartbeat_live_broadcast(target uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 update public.live_broadcasts set expires_at=now()+interval '90 seconds'
 where id=target and host_id=auth.uid() and status='live' and expires_at>now();
 return found;
end;
$$;
create or replace function public.end_live_broadcast(target uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 update public.live_broadcasts set status='ended',ended_at=coalesce(ended_at,now()),expires_at=now()
 where id=target and host_id=auth.uid();
 if not found then raise exception 'Broadcast unavailable' using errcode='42501'; end if;
end;
$$;
create or replace function public.followed_live_broadcasts()
returns table(id uuid,host_id uuid,username text,display_name text,avatar_path text,started_at timestamptz,expires_at timestamptz)
language sql stable security invoker set search_path='' as $$
 select b.id,b.host_id,p.username,p.display_name,p.avatar_path,b.started_at,b.expires_at
 from public.live_broadcasts b join public.profiles p on p.id=b.host_id
 where b.status='live' and b.expires_at>now() and app_private.can_watch_live(b.id)
 order by b.started_at desc,b.id limit 100;
$$;
create or replace function public.live_broadcast_notifications()
returns table(broadcast_id uuid,host_id uuid,display_name text,created_at timestamptz,read_at timestamptz,is_live boolean)
language sql stable security definer set search_path='' as $$
 select n.broadcast_id,b.host_id,p.display_name,n.created_at,n.read_at,app_private.can_watch_live(b.id)
 from public.live_broadcast_notices n join public.live_broadcasts b on b.id=n.broadcast_id join public.profiles p on p.id=b.host_id
 where n.recipient_id=auth.uid() and not app_private.account_is_blocked(b.host_id)
 and exists(select 1 from public.account_follows f where f.follower_id=auth.uid() and f.followed_id=b.host_id and f.status='accepted')
 order by n.created_at desc limit 100;
$$;
revoke all on function public.create_live_broadcast(),public.activate_live_broadcast(uuid),public.heartbeat_live_broadcast(uuid),public.end_live_broadcast(uuid),public.followed_live_broadcasts(),public.live_broadcast_notifications() from public,anon;
grant execute on function public.create_live_broadcast(),public.activate_live_broadcast(uuid),public.heartbeat_live_broadcast(uuid),public.end_live_broadcast(uuid),public.followed_live_broadcasts(),public.live_broadcast_notifications() to authenticated;
commit;
