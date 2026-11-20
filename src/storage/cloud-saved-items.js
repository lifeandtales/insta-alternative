import { state } from '../core/state.js';
import { getSupabaseClient } from './supabase.js';
import { cloudImageAuthorProjection, hydrateCloudImagePosts } from './image-posts.js';
import { cloudReelProjection, hydrateCloudReels } from './cloud-reels.js';

const activeRows = 'item_key,updated_at';
export const cloudImageCollectionProjection = '*,' + cloudImageAuthorProjection + ',cloud_comments:image_post_comments(count),cloud_likes:image_post_likes(count),viewer_like:image_post_likes(user_id)';
let snapshotRequest = 0;
let collectionRequest = 0;
let subscribedOwner;
let savedChannel;

export function cloudSavedKey(entity) {
    if (entity.cloudClientId && entity.cloudOwnerId) return `image:${entity.cloudOwnerId}:${entity.cloudClientId}`;
    if (entity.cloudContentId && entity.reel) return `reel:${entity.cloudContentId}`;
    return null;
}

export function isMediaSaved(type, entity) {
    const key = cloudSavedKey(entity);
    return key ? Boolean(state.cloudSavedKeys?.has(key)) : state.savedItems.has(`${type}:${entity.id}`);
}

export function cloudSavedEntities(type) {
    return state.cloudSavedMedia?.[type] || [];
}

export async function loadCloudSavedKeys() {
    const owner = state.signedInAccountId;
    if (!owner) return;
    const request = ++snapshotRequest;
    const client = await getSupabaseClient();
    const keys = new Set();
    const pageSize = 250;
    for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await client.from('saved_items').select('item_key')
            .eq('user_id', owner).eq('is_saved', true).order('item_key').range(offset, offset + pageSize - 1);
        if (error?.code === 'PGRST205' || error?.code === '42P01') return;
        if (error) throw error;
        if (owner !== state.signedInAccountId || request !== snapshotRequest) return;
        for (const row of data) keys.add(row.item_key);
        if (data.length < pageSize) break;
    }
    state.cloudSavedKeys = keys;
}

export async function loadCloudSavedCollection() {
    const owner = state.signedInAccountId;
    if (!owner) return;
    const request = ++collectionRequest;
    const client = await getSupabaseClient();
    const columns = `${activeRows},image:image_posts(${cloudImageCollectionProjection}),reel:media_content(${cloudReelProjection})`;
    const entries = [];
    const pageSize = 50;
    for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await client.from('saved_items').select(columns)
            .eq('user_id', owner).eq('is_saved', true).eq('image.viewer_like.user_id', owner)
            .order('updated_at', { ascending: false }).order('item_key').range(offset, offset + pageSize - 1);
        if (error?.code === 'PGRST205' || error?.code === '42P01') return;
        if (error) throw error;
        if (owner !== state.signedInAccountId || request !== collectionRequest) return;
        entries.push(...data);
        if (data.length < pageSize) break;
    }
    const [post, reel] = await Promise.all([
        hydrateCloudImagePosts(client, entries.flatMap(row => row.image ? [row.image] : []), owner),
        hydrateCloudReels(client, entries.flatMap(row => row.reel ? [row.reel] : []), owner)
    ]);
    if (owner !== state.signedInAccountId || request !== collectionRequest) return;
    state.cloudSavedMedia = { post, reel };
    state.cloudSavedDates = new Map(entries.map(row => [row.item_key, Date.parse(row.updated_at)]));
}

export async function setCloudSaved(entity, desired) {
    const owner = state.signedInAccountId;
    const key = cloudSavedKey(entity);
    const client = await getSupabaseClient();
    const { error } = await client.rpc('set_saved_media', entity.cloudContentId ? {
        desired, target_reel: entity.cloudContentId
    } : {
        desired, target_image_owner: entity.cloudOwnerId, target_image_id: entity.cloudClientId
    });
    if (error) throw error;
    if (owner !== state.signedInAccountId) return;
    snapshotRequest++;
    collectionRequest++;
    const keys = state.cloudSavedKeys ||= new Set();
    if (desired) keys.add(key);
    else keys.delete(key);
}

export async function subscribeToSavedChanges(owner, refresh) {
    const client = await getSupabaseClient();
    if (owner !== state.signedInAccountId || subscribedOwner === owner || typeof client.channel !== 'function') return;
    if (savedChannel) await client.removeChannel(savedChannel);
    subscribedOwner = owner;
    const channel = client.channel('private-saves-' + owner);
    for (const event of ['INSERT', 'UPDATE']) {
        channel.on('postgres_changes', { event, schema: 'public', table: 'saved_items', filter: 'user_id=eq.' + owner }, () => {
            if (owner === state.signedInAccountId && !document.hidden) void refresh().catch(() => {});
        });
    }
    savedChannel = channel.subscribe();
}
