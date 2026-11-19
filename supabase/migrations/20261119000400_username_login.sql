begin;
create or replace function public.resolve_username_login(handle text, request_key text)
returns text language plpgsql security definer set search_path='' as $$
declare
 bucket timestamptz := date_trunc('minute', clock_timestamp());
 hits_now integer;
begin
 if handle is null or handle !~ '^[a-z0-9._]{3,30}$' or request_key is null or request_key !~ '^[a-f0-9]{64}$' then return null; end if;
 insert into app_private.signup_check_limits as l values('login-ip:'||request_key,bucket,1)
 on conflict(key) do update set window_at=excluded.window_at,hits=case when l.window_at=excluded.window_at then l.hits+1 else 1 end returning hits into hits_now;
 if hits_now>15 then return null; end if;
 insert into app_private.signup_check_limits as l values('login-global',bucket,1)
 on conflict(key) do update set window_at=excluded.window_at,hits=case when l.window_at=excluded.window_at then l.hits+1 else 1 end returning hits into hits_now;
 if hits_now>300 then return null; end if;
 delete from app_private.signup_check_limits where window_at<bucket-interval '1 hour';
 return (select u.email from public.profiles p join auth.users u on u.id=p.id where p.username=handle);
end;
$$;
revoke all on function public.resolve_username_login(text,text) from public,anon,authenticated;
grant execute on function public.resolve_username_login(text,text) to service_role;
commit;
