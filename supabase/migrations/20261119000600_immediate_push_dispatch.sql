begin;

create extension if not exists pg_net;

create or replace function app_private.wake_push_worker()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  worker_secret text;
begin
  if not exists (select 1 from new_push_jobs) then
    return null;
  end if;

  select decrypted_secret into worker_secret
  from vault.decrypted_secrets
  where name = 'PUSH_WORKER_SECRET';

  if nullif(worker_secret, '') is not null then
    -- pg_net sends the request after commit, when the new jobs are visible.
    perform net.http_post(
      url := 'https://nbmxfsadqflsjlibxqor.supabase.co/functions/v1/web-push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || worker_secret
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 15000
    );
  end if;

  return null;
exception when others then
  -- Leave committed queue jobs for the scheduled worker if wake-up fails.
  raise warning 'Push worker wake-up could not be queued (SQLSTATE %)', sqlstate;
  return null;
end;
$$;

revoke all on function app_private.wake_push_worker() from public, anon, authenticated;

drop trigger if exists wake_push_worker on public.web_push_queue;
create trigger wake_push_worker
after insert on public.web_push_queue
referencing new table as new_push_jobs
for each statement execute function app_private.wake_push_worker();

commit;
