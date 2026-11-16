-- Apply after the connected social migration.
begin;

create table if not exists public.saved_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  image_owner_id uuid,
  image_client_id bigint,
  reel_id uuid references public.media_content(id) on delete cascade,
  item_key text generated always as (
    case when reel_id is not null then 'reel:' || reel_id::text
      else 'image:' || image_owner_id::text || ':' || image_client_id::text end
  ) stored,
  is_saved boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (user_id,item_key),
  foreign key (image_owner_id,image_client_id) references public.image_posts(owner_id,client_id) on delete cascade,
  check ((image_owner_id is not null and image_client_id is not null and reel_id is null)
    or (image_owner_id is null and image_client_id is null and reel_id is not null))
);

create index if not exists saved_items_collection_idx on public.saved_items(user_id,updated_at desc,item_key)
  where is_saved;
alter table public.saved_items enable row level security;
revoke all on public.saved_items from public,anon,authenticated;
grant select on public.saved_items to authenticated;
grant insert (image_owner_id,image_client_id,reel_id,is_saved) on public.saved_items to authenticated;
grant update (is_saved,updated_at) on public.saved_items to authenticated;

drop policy if exists "Read only your saved items" on public.saved_items;
create policy "Read only your saved items" on public.saved_items for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Save only visible media to your collection" on public.saved_items;
create policy "Save only visible media to your collection" on public.saved_items for insert to authenticated
  with check (user_id = (select auth.uid()) and (
    exists (select 1 from public.image_posts p where p.owner_id = image_owner_id and p.client_id = image_client_id)
    or exists (select 1 from public.media_content m where m.id = reel_id and m.kind = 'reel'
      and m.publish_at <= now() and (m.expires_at is null or m.expires_at > now()))
  ));

drop policy if exists "Update only your saved items" on public.saved_items;
create policy "Update only your saved items" on public.saved_items for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and (not is_saved or
    exists (select 1 from public.image_posts p where p.owner_id = image_owner_id and p.client_id = image_client_id)
    or exists (select 1 from public.media_content m where m.id = reel_id and m.kind = 'reel'
      and m.publish_at <= now() and (m.expires_at is null or m.expires_at > now()))
  ));

create or replace function public.set_saved_media(
  desired boolean, target_image_owner uuid default null, target_image_id bigint default null, target_reel uuid default null
)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null or desired is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  if desired then
    insert into public.saved_items (image_owner_id,image_client_id,reel_id,is_saved)
    values (target_image_owner,target_image_id,target_reel,true)
    on conflict (user_id,item_key) do update set is_saved = true, updated_at = now();
  else
    -- An update delivers an owner-only Realtime event. Do not publish bookmarks as DELETE events.
    update public.saved_items
    set is_saved = false, updated_at = now()
    where user_id = auth.uid()
      and image_owner_id is not distinct from target_image_owner
      and image_client_id is not distinct from target_image_id
      and reel_id is not distinct from target_reel;
  end if;
end;
$$;

revoke all on function public.set_saved_media(boolean,uuid,bigint,uuid) from public,anon,authenticated;
grant execute on function public.set_saved_media(boolean,uuid,bigint,uuid) to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
    and schemaname = 'public' and tablename = 'saved_items') then
    alter publication supabase_realtime add table public.saved_items;
  end if;
end;
$$;

commit;
