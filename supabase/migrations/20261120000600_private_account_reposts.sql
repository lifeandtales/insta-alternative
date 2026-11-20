begin;

-- Keep the original media's audience authoritative for both creating and viewing a repost.
create or replace function app_private.can_repost_original(image_owner uuid, image_client bigint, target_reel uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists (
    select 1 from public.image_posts p
    where p.owner_id = image_owner and p.client_id = image_client
      and app_private.can_view_image_post(p.owner_id, p.is_public)
  ) or exists (
    select 1 from public.media_content m
    where m.id = target_reel and m.kind = 'reel' and m.audience in ('public', 'followers')
      and m.publish_at <= now() and (m.expires_at is null or m.expires_at > now())
      and app_private.can_view_content(m.id)
  )
$$;
revoke all on function app_private.can_repost_original(uuid, bigint, uuid) from public, anon;
grant execute on function app_private.can_repost_original(uuid, bigint, uuid) to authenticated;

commit;
