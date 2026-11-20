import { getSupabaseClient } from './supabase.js';

export async function supportsCloudVideo() {
    const client = await getSupabaseClient();
    const { error } = await client.rpc('video_engagement', { target_reels: [], target_posts: [] });
    if (error?.code === 'PGRST202' || error?.code === '42883') return false;
    if (error) throw error;
    return true;
}

export async function loadVideoEngagement(client, targets) {
    const reelIds = targets.reels || [];
    const posts = targets.posts || [];
    if (!reelIds.length && !posts.length) return { reels: [], posts: [] };
    const { data, error } = await client.rpc('video_engagement', { target_reels: reelIds, target_posts: posts });
    if (error?.code === 'PGRST202' || error?.code === '42883') return { reels: [], posts: [] };
    if (error) throw error;
    return { reels: data?.reels || [], posts: data?.posts || [] };
}

export async function recordVideoView(entity, assetIndex, duration, watched) {
    const client = await getSupabaseClient();
    const { data, error } = await client.rpc('record_qualified_video_view', {
        reel_id: entity.cloudContentId || null,
        post_owner: entity.cloudClientId ? entity.cloudOwnerId : null,
        post_id: entity.cloudClientId || null,
        asset_index: assetIndex,
        duration_seconds: duration,
        watched_seconds: watched,
    });
    if (error) throw error;
    return Number(data);
}

export async function setCloudReelLike(reel, liked) {
    const client = await getSupabaseClient();
    const { data, error } = await client.rpc('set_reel_like', { target: reel.cloudContentId, desired: liked });
    if (error) throw error;
    return { liked: data.liked, count: data.likes };
}
