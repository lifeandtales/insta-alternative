begin;

create or replace function app_private.account_is_in_deletion(target uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.account_deletion_requests
    where user_id=target and status in ('pending','processing'));
$$;
revoke all on function app_private.account_is_in_deletion(uuid) from public,anon;
grant execute on function app_private.account_is_in_deletion(uuid) to authenticated;

-- Existing visibility, discovery, and follow checks already call this helper.
-- Keep real blocks and temporary deletion unavailability effective together.
create or replace function app_private.account_is_blocked(other_user uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select (other_user<>auth.uid() and app_private.account_is_in_deletion(other_user))
    or exists(select 1 from public.account_blocks b
      where (b.blocker_id=auth.uid() and b.blocked_id=other_user)
         or (b.blocker_id=other_user and b.blocked_id=auth.uid()));
$$;

-- Preserve the latest profile implementation, including any unrelated fields.
do $migration$
declare definition text;
begin
  definition:=pg_get_functiondef('public.social_profile(uuid)'::regprocedure);
  if position('deletion_state' in definition)=0 then
    definition:=replace(definition, 'begin', $guard$begin
  if auth.uid() is not null and target<>auth.uid()
     and app_private.account_is_in_deletion(target) then
    return (select jsonb_build_object(
      'id',p.id,'username',p.username,'display_name','Account deleted',
      'deletion_state',true,'bio','','avatar_path',null,'is_private',true,
      'follow_status',null,'followers',0,'following',0,'post_count',0)
      from public.profiles p where p.id=target);
  end if;
$guard$);
    execute definition;
  end if;
end;
$migration$;

-- Password reset and session timestamps may change, but reserved identities cannot.
create or replace function app_private.reserve_pending_deletion_identity()
returns trigger language plpgsql security definer set search_path='' as $$
declare identity_id uuid:=new.id;
begin
  if tg_table_schema='auth' then
    if tg_op='UPDATE' and app_private.account_is_in_deletion(old.id)
       and (new.email is distinct from old.email or new.phone is distinct from old.phone) then
      raise exception 'This identity is reserved during account deletion' using errcode='23505';
    end if;
    if exists(select 1 from auth.users u
      where u.id<>identity_id and app_private.account_is_in_deletion(u.id)
      and ((nullif(new.email,'') is not null and lower(u.email)=lower(new.email))
        or (nullif(new.phone,'') is not null and u.phone=new.phone))) then
      raise exception 'This identity is already in use' using errcode='23505';
    end if;
  else
    if tg_op='UPDATE' and app_private.account_is_in_deletion(old.id)
       and new.username is distinct from old.username then
      raise exception 'This username is reserved during account deletion' using errcode='23505';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function app_private.reserve_pending_deletion_identity() from public,anon,authenticated;
drop trigger if exists reserve_deletion_identity on auth.users;
create trigger reserve_deletion_identity before insert or update of email,phone on auth.users
for each row execute function app_private.reserve_pending_deletion_identity();
drop trigger if exists reserve_deletion_username on public.profiles;
create trigger reserve_deletion_username before update of username on public.profiles
for each row execute function app_private.reserve_pending_deletion_identity();

-- Refuse old-session writes during the grace period, while service cleanup works.
do $migration$
declare relation text;
begin
  foreach relation in array array['profiles','image_posts','media_content','media_assets',
    'story_highlights','messages','s3_media_objects'] loop
    execute format('drop policy if exists "Pause account during deletion" on public.%I',relation);
    execute format('create policy "Pause account during deletion" on public.%I as restrictive
      for all to authenticated using(not app_private.account_is_in_deletion(auth.uid()))
      with check(not app_private.account_is_in_deletion(auth.uid()))',relation);
  end loop;
end;
$migration$;

drop policy if exists "Hide deleting owner media" on public.s3_media_objects;
create policy "Hide deleting owner media" on public.s3_media_objects as restrictive
for select to authenticated using(not app_private.account_is_in_deletion(owner_id));
drop policy if exists "Hide deleting sender messages" on public.messages;
create policy "Hide deleting sender messages" on public.messages as restrictive
for select to authenticated using(not app_private.account_is_in_deletion(sender_id));

drop policy if exists "Pause storage during deletion" on storage.objects;
create policy "Pause storage during deletion" on storage.objects as restrictive
for all to authenticated using(not app_private.account_is_in_deletion(auth.uid()))
with check(not app_private.account_is_in_deletion(auth.uid()));
create or replace function app_private.deleting_storage_owner(bucket text, object_name text, object_owner text)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.account_deletion_requests r
    where r.user_id is not null and r.status in ('pending','processing') and (
      object_owner=r.user_id::text
      or (bucket in ('post-images','app-media','avatars','community-media') and split_part(object_name,'/',1)=r.user_id::text)
      or (bucket='chat-attachments' and split_part(object_name,'/',2)=r.user_id::text)));
$$;
revoke all on function app_private.deleting_storage_owner(text,text,text) from public,anon;
grant execute on function app_private.deleting_storage_owner(text,text,text) to authenticated;
drop policy if exists "Hide deleting owner files" on storage.objects;
create policy "Hide deleting owner files" on storage.objects as restrictive
for select to authenticated using(not app_private.deleting_storage_owner(
  bucket_id,name,coalesce(to_jsonb(objects)->>'owner_id',to_jsonb(objects)->>'owner')));

commit;
