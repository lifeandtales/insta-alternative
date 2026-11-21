begin;

create table if not exists public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  username text not null,
  reason text not null default '' check (char_length(reason)<=1000),
  status text not null default 'pending' check (status in ('pending','processing','completed','rejected','withdrawn')),
  reviewer_id uuid references auth.users(id) on delete set null,
  review_note text not null default '' check (char_length(review_note)<=1000),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  last_error text
);
create unique index if not exists one_active_deletion_request on public.account_deletion_requests(user_id)
  where status in ('pending','processing');
alter table public.account_deletion_requests enable row level security;
revoke all on public.account_deletion_requests from public,anon,authenticated;
grant select on public.account_deletion_requests to authenticated;
grant select,update on public.account_deletion_requests to service_role;
drop policy if exists "Read own deletion requests" on public.account_deletion_requests;
create policy "Read own deletion requests" on public.account_deletion_requests for select to authenticated
using(user_id=auth.uid());

create or replace function public.request_account_deletion(request_reason text default '')
returns uuid language plpgsql security definer set search_path='' as $$
declare request_id uuid; account_name text;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode='42501'; end if;
  select p.username into account_name from public.profiles p where p.id=auth.uid();
  if account_name is null then raise exception 'Account not found' using errcode='P0002'; end if;
  insert into public.account_deletion_requests(user_id,username,reason)
    values(auth.uid(),account_name,left(coalesce(request_reason,''),1000))
  on conflict(user_id) where status in ('pending','processing') do nothing returning id into request_id;
  if request_id is null then select id into request_id from public.account_deletion_requests
    where user_id=auth.uid() and status in ('pending','processing'); end if;
  return request_id;
end;
$$;

create or replace function public.withdraw_account_deletion(request_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare changed uuid;
begin
  update public.account_deletion_requests set status='withdrawn'
    where id=request_id and user_id=auth.uid() and status='pending' returning id into changed;
  return changed is not null;
end;
$$;

create or replace function public.admin_deletion_requests()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform app_private.require_dashboard_admin();
  return coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc) from (
    select id,user_id,username,reason,status,review_note,created_at,reviewed_at,last_error
      from public.account_deletion_requests order by created_at desc limit 100
  ) r),'[]'::jsonb);
end;
$$;

create or replace function public.admin_decide_account_deletion(request_id uuid,decision text,note text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare entry public.account_deletion_requests%rowtype;
begin
  perform app_private.require_dashboard_admin();
  if decision not in ('approve','reject') or char_length(coalesce(note,''))>1000 then
    raise exception 'Choose approve or reject' using errcode='22023'; end if;
  select * into entry from public.account_deletion_requests where id=request_id for update;
  if not found then raise exception 'Request not found' using errcode='P0002'; end if;
  if entry.status='processing' and entry.user_id is null then
    update public.account_deletion_requests set status='completed',last_error=null where id=request_id;
    return jsonb_build_object('status','completed');
  end if;
  if entry.status not in ('pending','processing') then raise exception 'This request is already closed' using errcode='22023'; end if;
  if entry.status='processing' and decision='reject' then
    raise exception 'Deletion has already started; retry to complete it' using errcode='22023'; end if;
  if decision='approve' and (entry.user_id=auth.uid() or exists(
    select 1 from app_private.admin_members where user_id=entry.user_id)) then
    raise exception 'Admin accounts are protected' using errcode='42501'; end if;
  update public.account_deletion_requests set status=case when decision='approve' then 'processing' else 'rejected' end,
    reviewer_id=auth.uid(),reviewed_at=now(),review_note=coalesce(note,''),last_error=null where id=request_id;
  return jsonb_build_object('status',case when decision='approve' then 'processing' else 'rejected' end,'user_id',entry.user_id);
end;
$$;

create or replace function public.admin_start_account_deletion(target uuid,deletion_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare request_id uuid; account_name text;
begin
  perform app_private.require_dashboard_admin();
  if target=auth.uid() or exists(select 1 from app_private.admin_members where user_id=target) then
    raise exception 'Admin accounts are protected' using errcode='42501'; end if;
  select coalesce(p.username,u.email,u.id::text) into account_name from auth.users u
    left join public.profiles p on p.id=u.id where u.id=target;
  if account_name is null then raise exception 'Account not found' using errcode='P0002'; end if;
  insert into public.account_deletion_requests(user_id,username,reason)
    values(target,account_name,left(coalesce(deletion_reason,'Admin action'),1000))
  on conflict(user_id) where status in ('pending','processing') do nothing returning id into request_id;
  if request_id is null then select id into request_id from public.account_deletion_requests
    where user_id=target and status in ('pending','processing'); end if;
  perform public.admin_decide_account_deletion(request_id,'approve',deletion_reason);
  return request_id;
end;
$$;

-- Enumerate verified ownership, never arbitrary paths supplied by the client.
create or replace function public.account_deletion_storage_inventory(target uuid)
returns jsonb language sql stable security definer set search_path='' as $$
select jsonb_build_object(
  'supabase',coalesce((select jsonb_agg(jsonb_build_object('bucket',o.bucket_id,'path',o.name))
    from storage.objects o where coalesce(to_jsonb(o)->>'owner_id',to_jsonb(o)->>'owner')=target::text
      or (o.bucket_id in ('post-images','app-media','avatars','community-media') and split_part(o.name,'/',1)=target::text)
      or (o.bucket_id='chat-attachments' and split_part(o.name,'/',2)=target::text)),'[]'::jsonb),
  's3',coalesce((select jsonb_agg(jsonb_build_object('category',m.category,'key',m.object_key))
    from public.s3_media_objects m where m.owner_id=target),'[]'::jsonb)
    || coalesce((select jsonb_agg(jsonb_build_object('category','reels','key','reels/'||r.object_path)) from (
      select object_path from public.media_assets where owner_id=target and split_part(object_path,'/',3)='s3'
      union select object_path from public.reel_s3_deletions where owner_id=target
    ) r),'[]'::jsonb)
);
$$;
revoke all on function public.account_deletion_storage_inventory(uuid) from public,anon,authenticated;
grant execute on function public.account_deletion_storage_inventory(uuid) to service_role;

create or replace function app_private.block_writes_during_account_deletion()
returns trigger language plpgsql security definer set search_path='' as $$
declare owner uuid:=coalesce(to_jsonb(new)->>'owner_id',to_jsonb(new)->>'sender_id',to_jsonb(new)->>'id')::uuid;
begin
  if exists(select 1 from public.account_deletion_requests r where r.user_id=owner and r.status='processing') then
    raise exception 'Account deletion is in progress' using errcode='42501'; end if;
  return new;
end;
$$;
revoke all on function app_private.block_writes_during_account_deletion() from public,anon,authenticated;
do $$ declare table_name text; begin
  foreach table_name in array array['profiles','image_posts','media_content','media_assets','story_highlights','messages','s3_media_objects'] loop
    execute format('drop trigger if exists block_writes_during_deletion on public.%I',table_name);
    execute format('create trigger block_writes_during_deletion before insert or update on public.%I for each row execute function app_private.block_writes_during_account_deletion()',table_name);
  end loop;
end $$;

create or replace function app_private.account_deletion_in_progress()
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.account_deletion_requests where user_id=auth.uid() and status='processing');
$$;
revoke all on function app_private.account_deletion_in_progress() from public,anon;
grant execute on function app_private.account_deletion_in_progress() to authenticated;
drop policy if exists "Block uploads during approved account deletion" on storage.objects;
create policy "Block uploads during approved account deletion" on storage.objects as restrictive for insert to authenticated
with check(not app_private.account_deletion_in_progress());
drop policy if exists "Block file changes during approved account deletion" on storage.objects;
create policy "Block file changes during approved account deletion" on storage.objects as restrictive for update to authenticated
using(not app_private.account_deletion_in_progress()) with check(not app_private.account_deletion_in_progress());

revoke all on function public.request_account_deletion(text),public.withdraw_account_deletion(uuid),
  public.admin_deletion_requests(),public.admin_decide_account_deletion(uuid,text,text),
  public.admin_start_account_deletion(uuid,text) from public,anon;
grant execute on function public.request_account_deletion(text),public.withdraw_account_deletion(uuid),
  public.admin_deletion_requests(),public.admin_decide_account_deletion(uuid,text,text),
  public.admin_start_account_deletion(uuid,text) to authenticated;

commit;
