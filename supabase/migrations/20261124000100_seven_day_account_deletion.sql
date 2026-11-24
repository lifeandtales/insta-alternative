begin;

alter table public.account_deletion_requests
  add column if not exists delete_after timestamptz,
  add column if not exists cleanup_claimed_at timestamptz;
-- Earlier admin-review requests receive a full grace period on upgrade.
update public.account_deletion_requests
set delete_after=now()+interval '7 days'
where status='pending' and delete_after is null;
create index if not exists deletion_deadline_queue
on public.account_deletion_requests(delete_after) where status='pending';

create or replace function public.request_account_deletion(request_reason text default '')
returns uuid language plpgsql security definer set search_path='' as $$
begin
  raise exception 'Confirm your identity and password through account-deletion first' using errcode='42501';
end;
$$;

create or replace function public.start_verified_account_deletion(target uuid, request_reason text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare entry public.account_deletion_requests%rowtype; account_name text;
begin
  perform 1 from auth.users where id=target for update;
  select username into account_name from public.profiles where id=target;
  if account_name is null then raise exception 'Account not found'; end if;
  if exists(select 1 from app_private.admin_members where user_id=target) then
    raise exception 'Admin accounts are protected'; end if;
  select * into entry from public.account_deletion_requests
    where user_id=target and status in ('pending','processing') for update;
  if not found then
    insert into public.account_deletion_requests(user_id,username,reason,delete_after)
    values(target,account_name,left(coalesce(request_reason,''),1000),now()+interval '7 days')
    returning * into entry;
  end if;
  return jsonb_build_object('id',entry.id,'status',entry.status,'delete_after',entry.delete_after);
end;
$$;
revoke all on function public.start_verified_account_deletion(uuid,text) from public,anon,authenticated;
grant execute on function public.start_verified_account_deletion(uuid,text) to service_role;

create or replace function public.cancel_account_deletion_after_login()
returns jsonb language plpgsql security definer set search_path='' as $$
declare entry public.account_deletion_requests%rowtype; session_created timestamptz;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  perform 1 from auth.users where id=auth.uid() for update;
  select * into entry from public.account_deletion_requests
    where user_id=auth.uid() and status in ('pending','processing') for update;
  if not found then return jsonb_build_object('status','none'); end if;
  if entry.status='processing' or entry.delete_after<=now() then
    return jsonb_build_object('status','deleting','delete_after',entry.delete_after);
  end if;
  select created_at into session_created from auth.sessions
    where id=(auth.jwt()->>'session_id')::uuid and user_id=auth.uid();
  -- A refresh or an older still-open session cannot withdraw the request.
  if session_created is null or session_created<=entry.created_at then
    return jsonb_build_object('status','pending','delete_after',entry.delete_after);
  end if;
  update public.account_deletion_requests set status='withdrawn' where id=entry.id;
  return jsonb_build_object('status','cancelled');
end;
$$;
revoke all on function public.cancel_account_deletion_after_login() from public,anon;
grant execute on function public.cancel_account_deletion_after_login() to authenticated;

-- Successful new Auth sessions cancel eligible requests, including logins from
-- an older app. Token refreshes reuse their session and do not fire this trigger.
create or replace function app_private.cancel_deletion_on_fresh_login()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  update public.account_deletion_requests
  set status='withdrawn'
  where user_id=new.user_id and status='pending'
    and delete_after>now() and new.created_at>created_at;
  return new;
end;
$$;
revoke all on function app_private.cancel_deletion_on_fresh_login() from public,anon,authenticated;
drop trigger if exists cancel_deletion_on_fresh_login on auth.sessions;
create trigger cancel_deletion_on_fresh_login after insert on auth.sessions
for each row execute function app_private.cancel_deletion_on_fresh_login();

create or replace function public.withdraw_account_deletion(request_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  raise exception 'Log in again to cancel your deletion request' using errcode='42501';
end;
$$;

create or replace function public.claim_due_account_deletions()
returns setof public.account_deletion_requests language sql security definer set search_path='' as $$
  update public.account_deletion_requests r
  set status='processing',cleanup_claimed_at=now()
  where r.id in (
    select id from public.account_deletion_requests
    where (status='pending' and delete_after<=now())
       or (status='processing' and (cleanup_claimed_at is null or cleanup_claimed_at<now()-interval '10 minutes'))
    order by delete_after nulls first limit 10 for update skip locked
  )
  returning r.*;
$$;
revoke all on function public.claim_due_account_deletions() from public,anon,authenticated;
grant execute on function public.claim_due_account_deletions() to service_role;

create or replace function public.admin_deletion_requests()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform app_private.require_dashboard_admin();
  return coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc) from (
    select id,user_id,username,reason,status,review_note,created_at,reviewed_at,last_error,delete_after,
      case when status='pending' then greatest(0,ceil(extract(epoch from (delete_after-now()))/86400))::integer end days_left
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
  if entry.status='processing' and decision='approve'
     and entry.cleanup_claimed_at>now()-interval '10 minutes' then
    raise exception 'Cleanup is already running. Refresh the request status.' using errcode='55000';
  end if;
  if entry.status='processing' and decision='reject' then
    raise exception 'Deletion has already started; retry to complete it' using errcode='22023'; end if;
  if decision='approve' and (entry.user_id=auth.uid() or exists(
    select 1 from app_private.admin_members where user_id=entry.user_id)) then
    raise exception 'Admin accounts are protected' using errcode='42501'; end if;
  update public.account_deletion_requests set status=case when decision='approve' then 'processing' else 'rejected' end,
    cleanup_claimed_at=case when decision='approve' then now() else null end,
    reviewer_id=auth.uid(),reviewed_at=now(),review_note=coalesce(note,''),last_error=null where id=request_id;
  return jsonb_build_object('status',case when decision='approve' then 'processing' else 'rejected' end,'user_id',entry.user_id);
end;
$$;

-- Existing storage cleanup and typed admin confirmation still apply.
-- The worker has its own authenticated endpoint and runs independently of phones.
create or replace function app_private.wake_account_deletion_worker()
returns void language plpgsql security definer set search_path='' as $$
declare worker_secret text;
begin
  select decrypted_secret into worker_secret from vault.decrypted_secrets where name='PUSH_WORKER_SECRET';
  if nullif(worker_secret,'') is null then raise exception 'Worker secret is missing'; end if;
  perform net.http_post(
    url:='https://nbmxfsadqflsjlibxqor.supabase.co/functions/v1/account-deletion',
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||worker_secret),
    body:='{"action":"process_due"}'::jsonb, timeout_milliseconds:=120000);
end;
$$;
revoke all on function app_private.wake_account_deletion_worker() from public,anon,authenticated;
select cron.schedule('insta-account-deletion-worker','* * * * *',
  'select app_private.wake_account_deletion_worker();');

commit;
