begin;

create or replace function public.search_chat_messages(
  target uuid, search_text text, before_time timestamptz default null, before_id uuid default null
)
returns table (id uuid, created_at timestamptz)
language sql stable security invoker
set search_path = ''
as $$
  with input as (select lower(left(btrim(coalesce(search_text, '')), 100)) as term)
  select m.id, m.created_at
  from public.messages m cross join input q
  where m.conversation_id = target
    and m.kind in ('text', 'file')
    and q.term <> ''
    and strpos(lower(case m.kind when 'file' then m.metadata->>'fileName' else m.body end), q.term) > 0
    and (before_time is null or (m.created_at, m.id) < (before_time, before_id))
  order by m.created_at desc, m.id desc
  limit 101;
$$;
revoke all on function public.search_chat_messages(uuid, text, timestamptz, uuid) from public, anon;
grant execute on function public.search_chat_messages(uuid, text, timestamptz, uuid) to authenticated;

commit;
