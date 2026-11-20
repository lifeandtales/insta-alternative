begin;

create table if not exists public.comment_replies (
  id uuid primary key default gen_random_uuid(),
  image_comment_id uuid references public.image_post_comments(id) on delete cascade,
  media_comment_id uuid references public.media_comments(id) on delete cascade,
  author_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  check (num_nonnulls(image_comment_id, media_comment_id) = 1)
);

create index if not exists comment_replies_image_idx
  on public.comment_replies (image_comment_id, created_at, id)
  where image_comment_id is not null;
create index if not exists comment_replies_media_idx
  on public.comment_replies (media_comment_id, created_at, id)
  where media_comment_id is not null;

alter table public.comment_replies enable row level security;
revoke all on public.comment_replies from public, anon, authenticated;
grant select on public.comment_replies to authenticated;
grant insert (id, image_comment_id, media_comment_id, body) on public.comment_replies to authenticated;

drop policy if exists "Read replies to visible comments" on public.comment_replies;
create policy "Read replies to visible comments" on public.comment_replies
  for select to authenticated using (
    not app_private.account_is_blocked(author_id) and (
      exists (select 1 from public.image_post_comments c where c.id = image_comment_id)
      or exists (select 1 from public.media_comments c where c.id = media_comment_id)
    )
  );

drop policy if exists "Media owners reply to comments" on public.comment_replies;
create policy "Media owners reply to comments" on public.comment_replies
  for insert to authenticated with check (
    author_id = (select auth.uid()) and (
      exists (select 1 from public.image_post_comments c
        where c.id = image_comment_id and c.post_owner_id = (select auth.uid()))
      or exists (select 1 from public.media_comments c
        join public.media_content m on m.id = c.content_id
        where c.id = media_comment_id and m.kind in ('post', 'reel')
          and m.owner_id = (select auth.uid()))
    )
  );

create table if not exists public.comment_likes (
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  image_comment_id uuid references public.image_post_comments(id) on delete cascade,
  media_comment_id uuid references public.media_comments(id) on delete cascade,
  reply_id uuid references public.comment_replies(id) on delete cascade,
  check (num_nonnulls(image_comment_id, media_comment_id, reply_id) = 1),
  unique (image_comment_id, user_id),
  unique (media_comment_id, user_id),
  unique (reply_id, user_id)
);

alter table public.comment_likes enable row level security;
revoke all on public.comment_likes from public, anon, authenticated;
grant select, delete on public.comment_likes to authenticated;
grant insert (image_comment_id, media_comment_id, reply_id) on public.comment_likes to authenticated;

drop policy if exists "Read likes on visible comments and replies" on public.comment_likes;
create policy "Read likes on visible comments and replies" on public.comment_likes
  for select to authenticated using (
    not app_private.account_is_blocked(user_id) and (
      exists (select 1 from public.image_post_comments c where c.id = image_comment_id)
      or exists (select 1 from public.media_comments c where c.id = media_comment_id)
      or exists (select 1 from public.comment_replies r where r.id = reply_id)
    )
  );

drop policy if exists "Like visible comments and replies" on public.comment_likes;
create policy "Like visible comments and replies" on public.comment_likes
  for insert to authenticated with check (
    user_id = (select auth.uid()) and (
      exists (select 1 from public.image_post_comments c where c.id = image_comment_id)
      or exists (select 1 from public.media_comments c where c.id = media_comment_id)
      or exists (select 1 from public.comment_replies r where r.id = reply_id)
    )
  );

drop policy if exists "Remove own comment likes" on public.comment_likes;
create policy "Remove own comment likes" on public.comment_likes
  for delete to authenticated using (user_id = (select auth.uid()));

create or replace function public.comment_like_summary(comment_kind text, ids uuid[])
returns table(target_id uuid, total bigint, liked boolean)
language sql stable set search_path = '' as $$
  select coalesce(l.image_comment_id, l.media_comment_id, l.reply_id), count(*),
    bool_or(l.user_id = (select auth.uid()))
  from public.comment_likes l
  where (comment_kind = 'image' and l.image_comment_id = any(ids))
    or (comment_kind = 'media' and l.media_comment_id = any(ids))
    or (comment_kind = 'reply' and l.reply_id = any(ids))
  group by 1
$$;
revoke all on function public.comment_like_summary(text, uuid[]) from public, anon;
grant execute on function public.comment_like_summary(text, uuid[]) to authenticated;

do $$
declare relation text;
begin
  foreach relation in array array['media_comments', 'comment_replies'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = relation) then
      execute format('alter publication supabase_realtime add table public.%I', relation);
    end if;
  end loop;
end
$$;

commit;
