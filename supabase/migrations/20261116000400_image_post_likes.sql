begin;

create table if not exists public.image_post_likes (
  post_owner_id uuid not null,
  post_client_id bigint not null,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_owner_id, post_client_id, user_id),
  foreign key (post_owner_id, post_client_id) references public.image_posts(owner_id, client_id) on delete cascade
);

alter table public.image_post_likes enable row level security;
revoke all on public.image_post_likes from public, anon, authenticated;
grant select, delete on public.image_post_likes to authenticated;
grant insert (post_owner_id, post_client_id) on public.image_post_likes to authenticated;

drop policy if exists "Read likes on visible image posts" on public.image_post_likes;
create policy "Read likes on visible image posts" on public.image_post_likes
  for select to authenticated using (
    not app_private.account_is_blocked(user_id) and exists (
      select 1 from public.image_posts p where p.owner_id = post_owner_id and p.client_id = post_client_id
    )
  );
drop policy if exists "Like visible image posts" on public.image_post_likes;
create policy "Like visible image posts" on public.image_post_likes
  for insert to authenticated with check (user_id = (select auth.uid()) and exists (
    select 1 from public.image_posts p where p.owner_id = post_owner_id and p.client_id = post_client_id
  ));
drop policy if exists "Remove own image post likes" on public.image_post_likes;
create policy "Remove own image post likes" on public.image_post_likes
  for delete to authenticated using (user_id = (select auth.uid()));

-- Publish an authorized image_posts UPDATE on both like and unlike.
-- Subscribing to raw DELETE events would bypass the likes table's read policy.
alter table public.image_posts add column if not exists likes_revision bigint not null default 0;

create or replace function app_private.bump_image_post_likes_revision()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.image_posts p
  set likes_revision = likes_revision + 1
  where p.owner_id = coalesce(new.post_owner_id, old.post_owner_id)
    and p.client_id = coalesce(new.post_client_id, old.post_client_id);
  return null;
end;
$$;
revoke all on function app_private.bump_image_post_likes_revision() from public, anon, authenticated;
drop trigger if exists bump_image_post_likes_revision on public.image_post_likes;
create trigger bump_image_post_likes_revision after insert or delete on public.image_post_likes
  for each row execute function app_private.bump_image_post_likes_revision();

create or replace function public.set_image_post_like(target_owner uuid, target_post bigint, desired boolean)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null or desired is null or not exists (
    select 1 from public.image_posts where owner_id = target_owner and client_id = target_post
  ) then
    raise exception 'Post unavailable' using errcode = '42501';
  end if;

  if desired then
    insert into public.image_post_likes (post_owner_id, post_client_id)
    values (target_owner, target_post)
    on conflict do nothing;
  else
    delete from public.image_post_likes
    where post_owner_id = target_owner and post_client_id = target_post and user_id = auth.uid();
  end if;

  return (
    select jsonb_build_object('count', count(*), 'liked', coalesce(bool_or(user_id = auth.uid()), false))
    from public.image_post_likes
    where post_owner_id = target_owner and post_client_id = target_post
  );
end;
$$;
revoke all on function public.set_image_post_like(uuid, bigint, boolean) from public, anon, authenticated;
grant execute on function public.set_image_post_like(uuid, bigint, boolean) to authenticated;

commit;
