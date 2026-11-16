begin;

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

-- Resolve the extension's actual schema, including on projects with an existing installation.
do $migration$
declare
  extension_schema text;
begin
  select n.nspname into strict extension_schema
  from pg_catalog.pg_extension e join pg_catalog.pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pg_trgm';

  execute format('grant usage on schema %I to authenticated', extension_schema);

  execute format($index$
    create index if not exists profiles_username_trgm_idx on public.profiles
      using gin (username %1$I.gin_trgm_ops)
  $index$, extension_schema);
  execute format($index$
    create index if not exists profiles_display_name_trgm_idx on public.profiles
      using gin (lower(display_name) %1$I.gin_trgm_ops)
  $index$, extension_schema);

  execute format($function$
    create or replace function public.search_explore_people(search_text text)
    returns table (id uuid, username text, display_name text, bio text, is_private boolean, follow_status text)
    language sql stable security invoker
    set search_path = ''
    set pg_trgm.similarity_threshold = '0.25'
    as $query$
      with input as (
        select lower(left(ltrim(btrim(coalesce(search_text, '')), '@'), 100)) as term
      ), query as (
        select term, replace(replace(replace(term, chr(92), chr(92)||chr(92)),
          '%%', chr(92)||'%%'), '_', chr(92)||'_') as pattern
        from input where char_length(term) > 0
      )
      select p.id, p.username, p.display_name,
        case when not p.is_private or f.status = 'accepted' then p.bio else '' end,
        p.is_private, f.status
      from query q cross join public.profiles p
      left join public.account_follows f on f.follower_id = (select auth.uid()) and f.followed_id = p.id
      where (select auth.uid()) is not null and p.id <> (select auth.uid())
        and (p.username like '%%'||q.pattern||'%%'
          or lower(p.display_name) like '%%'||q.pattern||'%%'
          or (char_length(q.term) >= 3 and
            (p.username operator(%1$I.%%) q.term or lower(p.display_name) operator(%1$I.%%) q.term)))
      order by case
        when p.username = q.term then 0
        when p.username like q.pattern||'%%' then 1
        when lower(p.display_name) = q.term then 2
        when lower(p.display_name) like q.pattern||'%%' then 3
        when p.username like '%%'||q.pattern||'%%' then 4
        when lower(p.display_name) like '%%'||q.pattern||'%%' then 5
        else 6 end,
        greatest(%1$I.similarity(p.username, q.term), %1$I.similarity(lower(p.display_name), q.term)) desc,
        p.username
      limit 12
    $query$
  $function$, extension_schema);
end
$migration$;

revoke all on function public.search_explore_people(text) from public, anon, authenticated;
grant execute on function public.search_explore_people(text) to authenticated;

commit;
