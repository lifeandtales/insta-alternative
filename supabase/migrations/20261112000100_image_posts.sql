begin;

create table public.image_posts (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  client_id bigint not null check (client_id > 0),
  caption text not null default '',
  location text not null default '',
  tags text[] not null default '{}',
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 20),
  cover_index integer not null default 0 check (cover_index between 0 and 19),
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (owner_id, client_id)
);

alter table public.image_posts enable row level security;
revoke all on public.image_posts from anon, authenticated;
grant select, insert, delete on public.image_posts to authenticated;
grant update (caption, location) on public.image_posts to authenticated;

create policy "Owners read their image posts" on public.image_posts
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "Owners publish their image posts" on public.image_posts
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "Owners edit their image posts" on public.image_posts
  for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "Owners delete their image posts" on public.image_posts
  for delete to authenticated using (owner_id = (select auth.uid()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('post-images', 'post-images', false, 50000000, array['image/*']);

create policy "Owners read their post images" on storage.objects
  for select to authenticated using (
    bucket_id = 'post-images' and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy "Owners upload their post images" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'post-images' and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy "Owners delete their post images" on storage.objects
  for delete to authenticated using (
    bucket_id = 'post-images' and (storage.foldername(name))[1] = (select auth.uid())::text
  );

commit;
