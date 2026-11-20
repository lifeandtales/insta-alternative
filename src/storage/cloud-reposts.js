import { state } from '../core/state.js';
import { canViewMedia } from '../core/social.js';
import { cloudPerson } from '../features/cloud-people.js';
import { cloudReelProjection, hydrateCloudReels } from './cloud-reels.js';
import { hydrateCloudImagePosts } from './image-posts.js';
import { cloudImageCollectionProjection } from './cloud-saved-items.js';
import { getSupabaseClient } from './supabase.js';

function repostTarget(entity) {
    if (entity.reel && entity.cloudContentId) return { reel_id: entity.cloudContentId };
    if (!entity.reel && entity.cloudClientId && entity.cloudOwnerId) {
        return { image_owner_id: entity.cloudOwnerId, image_client_id: entity.cloudClientId };
    }
    return null;
}

export function canRepost(entity) {
    return Boolean(state.signedInAccountId && repostTarget(entity) && entity.public && canViewMedia(entity) &&
        cloudPerson(entity.handle)?.isPrivate !== true);
}

function filterOriginal(query, entity) {
    return Object.entries(repostTarget(entity)).reduce((request, [column, value]) => request.eq(column, value), query);
}

export async function hasReposted(entity) {
    const viewer = state.signedInAccountId;
    const client = await getSupabaseClient();
    const { data, error } = await filterOriginal(client.from('profile_reposts').select('id').eq('user_id', viewer), entity).maybeSingle();
    if (error) throw error;
    return Boolean(data);
}

export async function setRepost(entity, desired) {
    const viewer = state.signedInAccountId;
    const client = await getSupabaseClient();
    if (!viewer || state.signedInAccountId !== viewer || !canRepost(entity)) throw new Error('The original is unavailable.');
    const table = client.from('profile_reposts');
    const { error } = await (desired ? table.insert(repostTarget(entity))
        : filterOriginal(table.delete().eq('user_id', viewer), entity));
    if (error && error.code !== '23505') throw error;
}

export function getRepostedMedia(handle = state.profileHandle) {
    const collection = state.cloudReposts;
    if (!collection || collection.handle !== handle || collection.viewer !== state.signedInAccountId) return [];
    return collection.items.filter(({ entity }) => entity.public && canViewMedia(entity) &&
        cloudPerson(entity.handle)?.isPrivate !== true);
}

let loadRevision = 0;

export async function loadCloudReposts(target, handle) {
    const viewer = state.signedInAccountId;
    if (!viewer) return;
    const revision = ++loadRevision;
    const client = await getSupabaseClient();
    const { data, error } = await client.from('profile_reposts')
        .select(`id,image:image_posts(${cloudImageCollectionProjection}),reel:media_content(${cloudReelProjection})`)
        .eq('user_id', target).eq('image.viewer_like.user_id', viewer)
        .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(100);
    if (state.signedInAccountId !== viewer || revision !== loadRevision) return;
    if (error) {
        if (state.cloudReposts?.handle === handle) state.cloudReposts = null;
        if (!['PGRST200', 'PGRST205', '42P01'].includes(error.code)) throw error;
        return;
    }
    const [posts, reels] = await Promise.all([
        hydrateCloudImagePosts(client, data.flatMap(row => row.image ? [row.image] : []), viewer),
        hydrateCloudReels(client, data.flatMap(row => row.reel ? [row.reel] : []), viewer),
    ]);
    if (state.signedInAccountId !== viewer || revision !== loadRevision || state.profileHandle !== handle) return;
    const imageByKey = new Map(posts.map(post => [`${post.cloudOwnerId}:${post.cloudClientId}`, post]));
    const reelById = new Map(reels.map(reel => [reel.cloudContentId, reel]));
    const items = data.flatMap(row => {
        const entity = row.image ? imageByKey.get(`${row.image.owner_id}:${row.image.client_id}`) : reelById.get(row.reel?.id);
        return entity ? [{ type: entity.reel ? 'reel' : 'post', entity }] : [];
    });
    state.cloudReposts = { handle, viewer, items };
}
