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
    if (!state.signedInAccountId || !repostTarget(entity) || !canViewMedia(entity)) return false;
    if (entity.reel && entity.cloudAudience && !['public', 'followers'].includes(entity.cloudAudience)) return false;
    const author = cloudPerson(entity.handle);
    return entity.cloudOwnerId === state.signedInAccountId ||
        (entity.public && author?.isPrivate !== true) ||
        Boolean(state.cloudFollowingIds?.has(entity.cloudOwnerId) || author?.followStatus === 'accepted');
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
    return collection.items.filter(({ entity }) => canViewMedia(entity));
}

export function repostLoadStatus(handle = state.profileHandle) {
    const collection = state.cloudReposts;
    if (!collection || collection.handle !== handle || collection.viewer !== state.signedInAccountId) return '';
    return collection.status;
}

async function readRepostImages(client, rows, viewer) {
    const groups = [];
    const batchSize = 25;
    for (let start = 0; start < rows.length; start += batchSize) {
        const filter = rows.slice(start, start + batchSize)
            .map(row => `and(owner_id.eq.${row.image_owner_id},client_id.eq.${row.image_client_id})`)
            .join(',');
        groups.push(client.from('image_posts').select(cloudImageCollectionProjection)
            .or(filter).eq('viewer_like.user_id', viewer));
    }
    const results = await Promise.all(groups);
    const failed = results.find(result => result.error);
    if (failed) throw failed.error;
    return hydrateCloudImagePosts(client, results.flatMap(result => result.data), viewer);
}

async function readRepostReels(client, ids, viewer) {
    if (!ids.length) return [];
    const { data, error } = await client.from('media_content').select(cloudReelProjection)
        .eq('kind', 'reel').in('id', ids);
    if (error) throw error;
    return hydrateCloudReels(client, data, viewer);
}

let loadRevision = 0;

export async function loadCloudReposts(target, handle) {
    const viewer = state.signedInAccountId;
    if (!viewer || state.profileHandle !== handle) return;
    const revision = ++loadRevision;
    const isCurrent = () => state.signedInAccountId === viewer && state.profileHandle === handle && revision === loadRevision;
    state.cloudReposts = { handle, viewer, items: [], status: 'loading' };
    try {
        const client = await getSupabaseClient();
        const { data, error } = await client.from('profile_reposts')
            .select('id,image_owner_id,image_client_id,reel_id')
            .eq('user_id', target).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(100);
        if (!isCurrent()) return;
        if (error) throw error;
        const [images, reels] = await Promise.allSettled([
            readRepostImages(client, data.filter(row => row.image_owner_id), viewer),
            readRepostReels(client, data.map(row => row.reel_id).filter(Boolean), viewer),
        ]);
        if (!isCurrent()) return;
        const imageByKey = new Map((images.value || []).map(post => [`${post.cloudOwnerId}:${post.cloudClientId}`, post]));
        const reelById = new Map((reels.value || []).map(reel => [reel.cloudContentId, reel]));
        const items = data.flatMap(row => {
            const entity = row.image_owner_id ? imageByKey.get(`${row.image_owner_id}:${row.image_client_id}`) : reelById.get(row.reel_id);
            return entity ? [{ type: entity.reel ? 'reel' : 'post', entity }] : [];
        });
        state.cloudReposts = { handle, viewer, items, status: images.status === 'rejected' || reels.status === 'rejected' ? 'failed' : 'loaded' };
    } catch {
        if (isCurrent()) state.cloudReposts = { handle, viewer, items: [], status: 'failed' };
    }
}
