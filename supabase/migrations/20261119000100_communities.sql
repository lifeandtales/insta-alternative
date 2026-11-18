begin;

create table if not exists public.curated_communities (
  slug text primary key check (slug ~ '^[a-z][a-z-]{1,40}$'),
  name text not null, icon text not null, description text not null,
  position integer not null unique
);
insert into public.curated_communities(slug,name,icon,description,position) values
 ('food','Food','🍲','Recipes, flavours and food discoveries.',1),
 ('blogging','Blogging','✍️','Ideas, experiences and everyday stories.',2),
 ('nature','Nature','🌿','Discover the natural world.',3),
 ('news','News','📰','Share news with context and sources.',4),
 ('politics','Politics','🏛️','Discuss public life with respect.',5),
 ('science','Science','🔬','Questions, discoveries and experiments.',6),
 ('environment','Environment','🌍','Our planet and a sustainable future.',7),
 ('marine-sciences','Marine Sciences','🌊','Explore oceans and life beneath the waves.',8),
 ('geography','Geography','🧭','Places, landscapes and the world around us.',9),
 ('economics','Economics','📊','Understand economies and everyday decisions.',10)
on conflict(slug) do update set name=excluded.name, icon=excluded.icon, description=excluded.description;

create table if not exists public.community_subscriptions (
 community_slug text not null references public.curated_communities(slug),
 user_id uuid not null references public.profiles(id) on delete cascade,
 muted boolean not null default false, created_at timestamptz not null default now(),
 primary key(community_slug,user_id)
);
create table if not exists public.community_entries (
 id uuid primary key default gen_random_uuid(),
 community_slug text not null references public.curated_communities(slug),
 author_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
 kind text not null check(kind in ('post','story')),
 caption text not null default '' check(length(caption)<=2200),
 object_path text not null unique,
 mime_type text not null check(mime_type in ('image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime')),
 created_at timestamptz not null default now(),
 expires_at timestamptz,
 check(object_path = author_id::text || '/' || id::text || '/media'),
 check((kind='post' and expires_at is null) or (kind='story' and expires_at=created_at+interval '24 hours'))
);
create or replace function app_private.stamp_community_entry()
returns trigger language plpgsql set search_path='' as $$
begin
 new.created_at := now();
 new.expires_at := case when new.kind='story' then new.created_at+interval '24 hours' end;
 return new;
end;
$$;
drop trigger if exists community_entry_timestamp on public.community_entries;
create trigger community_entry_timestamp before insert on public.community_entries
 for each row execute function app_private.stamp_community_entry();
create index if not exists community_entries_feed on public.community_entries(community_slug,kind,created_at desc,id desc);
create table if not exists public.community_likes (
 entry_id uuid not null references public.community_entries(id) on delete cascade,
 user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
 created_at timestamptz not null default now(), primary key(entry_id,user_id)
);
create table if not exists public.community_comments (
 id uuid primary key default gen_random_uuid(),
 entry_id uuid not null references public.community_entries(id) on delete cascade,
 author_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
 body text not null check(length(trim(body)) between 1 and 1000),
 created_at timestamptz not null default now()
);
create index if not exists community_comments_entry on public.community_comments(entry_id,created_at);

create or replace function app_private.can_view_community_entry(target uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.community_entries e where e.id=target
   and (e.expires_at is null or e.expires_at>now()) and not app_private.account_is_blocked(e.author_id));
$$;
revoke all on function app_private.can_view_community_entry(uuid) from public,anon;
grant execute on function app_private.can_view_community_entry(uuid) to authenticated;

alter table public.curated_communities enable row level security;
alter table public.community_subscriptions enable row level security;
alter table public.community_entries enable row level security;
alter table public.community_likes enable row level security;
alter table public.community_comments enable row level security;
drop policy if exists community_catalog_read on public.curated_communities;
create policy community_catalog_read on public.curated_communities for select to authenticated using(true);
drop policy if exists community_members_own on public.community_subscriptions;
create policy community_members_own on public.community_subscriptions for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
drop policy if exists community_entries_read on public.community_entries;
create policy community_entries_read on public.community_entries for select to authenticated using(app_private.can_view_community_entry(id));
drop policy if exists community_entries_insert on public.community_entries;
create policy community_entries_insert on public.community_entries for insert to authenticated with check(
 author_id=auth.uid() and created_at between now()-interval '1 minute' and now()+interval '1 minute'
 and exists(select 1 from public.community_subscriptions m where m.community_slug=community_entries.community_slug and m.user_id=auth.uid()));
drop policy if exists community_entries_delete on public.community_entries;
create policy community_entries_delete on public.community_entries for delete to authenticated using(author_id=auth.uid());
drop policy if exists community_likes_read on public.community_likes;
create policy community_likes_read on public.community_likes for select to authenticated using(app_private.can_view_community_entry(entry_id) and not app_private.account_is_blocked(user_id));
drop policy if exists community_likes_insert on public.community_likes;
create policy community_likes_insert on public.community_likes for insert to authenticated with check(user_id=auth.uid() and app_private.can_view_community_entry(entry_id));
drop policy if exists community_likes_delete on public.community_likes;
create policy community_likes_delete on public.community_likes for delete to authenticated using(user_id=auth.uid());
drop policy if exists community_comments_read on public.community_comments;
create policy community_comments_read on public.community_comments for select to authenticated using(app_private.can_view_community_entry(entry_id) and not app_private.account_is_blocked(author_id));
drop policy if exists community_comments_insert on public.community_comments;
create policy community_comments_insert on public.community_comments for insert to authenticated with check(author_id=auth.uid() and app_private.can_view_community_entry(entry_id));
drop policy if exists community_comments_delete on public.community_comments;
create policy community_comments_delete on public.community_comments for delete to authenticated using(author_id=auth.uid());
grant select on public.curated_communities to authenticated;
grant select,insert,update,delete on public.community_subscriptions to authenticated;
grant select,insert,delete on public.community_entries,public.community_likes,public.community_comments to authenticated;
revoke all on public.curated_communities,public.community_subscriptions,public.community_entries,public.community_likes,public.community_comments from anon;

create or replace function public.community_directory()
returns table(slug text,name text,icon text,description text,followers bigint,posts bigint,following boolean,muted boolean,has_stories boolean)
language sql stable security definer set search_path='' as $$
 select c.slug,c.name,c.icon,c.description,
 (select count(*) from public.community_subscriptions m where m.community_slug=c.slug),
 (select count(*) from public.community_entries e where e.community_slug=c.slug and e.kind='post' and not app_private.account_is_blocked(e.author_id)),
 exists(select 1 from public.community_subscriptions m where m.community_slug=c.slug and m.user_id=auth.uid()),
 coalesce((select m.muted from public.community_subscriptions m where m.community_slug=c.slug and m.user_id=auth.uid()),false),
 exists(select 1 from public.community_entries e where e.community_slug=c.slug and e.kind='story' and e.expires_at>now() and not app_private.account_is_blocked(e.author_id))
 from public.curated_communities c where auth.uid() is not null order by c.position;
$$;
create or replace function public.community_feed(target text, entry_kind text default 'post', before_time timestamptz default null)
returns table(id uuid,author_id uuid,display_name text,username text,kind text,caption text,object_path text,mime_type text,created_at timestamptz,expires_at timestamptz,likes bigint,comments bigint,liked boolean)
language sql stable security invoker set search_path='' as $$
 select e.id,e.author_id,p.display_name,p.username,e.kind,e.caption,e.object_path,e.mime_type,e.created_at,e.expires_at,
 (select count(*) from public.community_likes l where l.entry_id=e.id),
 (select count(*) from public.community_comments c where c.entry_id=e.id),
 exists(select 1 from public.community_likes l where l.entry_id=e.id and l.user_id=auth.uid())
 from public.community_entries e join public.profiles p on p.id=e.author_id
 where e.community_slug=target and e.kind=entry_kind and (before_time is null or e.created_at<before_time)
 order by e.created_at desc,e.id desc limit 50;
$$;
revoke all on function public.community_directory(),public.community_feed(text,text,timestamptz) from public,anon;
grant execute on function public.community_directory(),public.community_feed(text,text,timestamptz) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('community-media','community-media',false,50000000,array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime'])
on conflict(id) do nothing;
drop policy if exists community_media_read on storage.objects;
create policy community_media_read on storage.objects for select to authenticated using(bucket_id='community-media' and (
 (storage.foldername(name))[1]=auth.uid()::text or exists(select 1 from public.community_entries e where e.object_path=name and app_private.can_view_community_entry(e.id))));
drop policy if exists community_media_insert on storage.objects;
create policy community_media_insert on storage.objects for insert to authenticated with check(bucket_id='community-media' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists community_media_delete on storage.objects;
create policy community_media_delete on storage.objects for delete to authenticated using(bucket_id='community-media' and (storage.foldername(name))[1]=auth.uid()::text);
commit;
