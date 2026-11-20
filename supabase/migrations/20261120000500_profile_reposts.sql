begin;

create table if not exists public.profile_reposts (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  image_owner_id uuid,
  image_client_id bigint,
  reel_id uuid references public.media_content(id) on delete cascade,
  created_at timestamptz not null default now(),
  foreign key (image_owner_id, image_client_id) references public.image_posts(owner_id, client_id) match full on delete cascade,
  check (num_nonnulls(image_owner_id, reel_id) = 1),
  unique (user_id, image_owner_id, image_client_id),
  unique (user_id, reel_id)
);
create index if not exists profile_reposts_recent_idx on public.profile_reposts (user_id, created_at desc, id desc);
create index if not exists profile_reposts_image_idx on public.profile_reposts (image_owner_id, image_client_id);
create index if not exists profile_reposts_reel_idx on public.profile_reposts (reel_id);
alter table public.profile_reposts enable row level security;
revoke all on public.profile_reposts from public, anon, authenticated;
grant select, delete on public.profile_reposts to authenticated;
grant insert (image_owner_id, image_client_id, reel_id) on public.profile_reposts to authenticated;

create or replace function app_private.can_repost_original(image_owner uuid, image_client bigint, target_reel uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists (
    select 1 from public.image_posts p join public.profiles creator on creator.id = p.owner_id
    where p.owner_id = image_owner and p.client_id = image_client and p.is_public and not creator.is_private
  ) or exists (
    select 1 from public.media_content m join public.profiles creator on creator.id = m.owner_id
    where m.id = target_reel and m.kind = 'reel' and m.audience = 'public' and not creator.is_private
      and m.publish_at <= now() and (m.expires_at is null or m.expires_at > now())
  )
$$;
revoke all on function app_private.can_repost_original(uuid, bigint, uuid) from public, anon;
grant execute on function app_private.can_repost_original(uuid, bigint, uuid) to authenticated;

drop policy if exists "Read accessible reposts" on public.profile_reposts;
create policy "Read accessible reposts" on public.profile_reposts for select to authenticated using (
  app_private.can_view_image_post(user_id, true)
  and app_private.can_repost_original(image_owner_id, image_client_id, reel_id)
);

drop policy if exists "Repost publicly visible media" on public.profile_reposts;
create policy "Repost publicly visible media" on public.profile_reposts for insert to authenticated with check (
  user_id = (select auth.uid())
  and app_private.can_repost_original(image_owner_id, image_client_id, reel_id)
);

drop policy if exists "Remove own reposts" on public.profile_reposts;
create policy "Remove own reposts" on public.profile_reposts for delete to authenticated
  using (user_id = (select auth.uid()));

commit;
