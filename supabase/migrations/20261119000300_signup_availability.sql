begin;
create table if not exists app_private.signup_check_limits (
 key text primary key, window_at timestamptz not null, hits integer not null
);
revoke all on app_private.signup_check_limits from public,anon,authenticated;
create or replace function public.check_signup_availability(field_name text, field_value text, request_key text)
returns text language plpgsql security definer set search_path='' as $$
declare normalized text:=lower(trim(field_value)); bucket timestamptz:=date_trunc('minute',clock_timestamp()); ip_hits integer; total_hits integer;
begin
 if request_key is null or request_key !~ '^[a-f0-9]{64}$' then return 'invalid'; end if;
 if field_name not in ('email','username') or normalized is null or length(normalized)>254 then return 'invalid'; end if;
 insert into app_private.signup_check_limits as l values('ip:'||request_key,bucket,1)
 on conflict(key) do update set window_at=excluded.window_at,hits=case when l.window_at=excluded.window_at then l.hits+1 else 1 end returning hits into ip_hits;
 if ip_hits>60 then return 'limited'; end if;
 insert into app_private.signup_check_limits as l values('global',bucket,1)
 on conflict(key) do update set window_at=excluded.window_at,hits=case when l.window_at=excluded.window_at then l.hits+1 else 1 end returning hits into total_hits;
 if total_hits>1000 then return 'limited'; end if;
 delete from app_private.signup_check_limits where window_at<bucket-interval '1 hour';
 if field_name='email' then
   if normalized !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then return 'invalid'; end if;
   return case when exists(select 1 from auth.users u where lower(u.email)=normalized) then 'taken' else 'available' end;
 end if;
 if normalized !~ '^[a-z0-9._]{8,20}$' then return 'invalid'; end if;
 return case when exists(select 1 from public.profiles p where lower(p.username)=normalized) then 'taken' else 'available' end;
end;
$$;
revoke all on function public.check_signup_availability(text,text,text) from public,anon,authenticated;
grant execute on function public.check_signup_availability(text,text,text) to service_role;
commit;
