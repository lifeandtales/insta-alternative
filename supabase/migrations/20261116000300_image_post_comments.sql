begin;

create table if not exists public.image_post_comments (
  id uuid primary key default gen_random_uuid(),
  post_owner_id uuid not null,
  post_client_id bigint not null,
  author_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  foreign key (post_owner_id, post_client_id) references public.image_posts(owner_id, client_id) on delete cascade
);
create index if not exists image_post_comments_post_idx
  on public.image_post_comments(post_owner_id, post_client_id, created_at desc, id);
alter table public.image_post_comments enable row level security;
revoke all on public.image_post_comments from public, anon, authenticated;
grant select, delete on public.image_post_comments to authenticated;
grant insert (id, post_owner_id, post_client_id, body) on public.image_post_comments to authenticated;

drop policy if exists "Read comments on visible image posts" on public.image_post_comments;
create policy "Read comments on visible image posts" on public.image_post_comments
  for select to authenticated using (
    not app_private.account_is_blocked(author_id)
    and exists (select 1 from public.image_posts p
      where p.owner_id = post_owner_id and p.client_id = post_client_id)
  );

drop policy if exists "Write comments on visible image posts" on public.image_post_comments;
create policy "Write comments on visible image posts" on public.image_post_comments
  for insert to authenticated with check (
    author_id = (select auth.uid()) and exists (select 1 from public.image_posts p
      where p.owner_id = post_owner_id and p.client_id = post_client_id)
  );

drop policy if exists "Remove own image post comments" on public.image_post_comments;
create policy "Remove own image post comments" on public.image_post_comments
  for delete to authenticated using (author_id = (select auth.uid()) or post_owner_id = (select auth.uid()));

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
    and schemaname = 'public' and tablename = 'image_post_comments') then
    alter publication supabase_realtime add table public.image_post_comments;
  end if;
end;
$$;

commit;
