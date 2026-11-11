import { state } from '../core/state.js';
import { currentUser, posts } from '../data/sample-data.js';
import { mediaEdits } from '../features/post-media.js';
import { getSupabaseClient } from './supabase.js';

const bucketName = 'post-images';
const tableName = 'image_posts';

function imageSettings(item) {
    return {
        ...mediaEdits(item),
        fit: item.fit === 'cover' ? 'cover' : 'contain',
        x: Number.isFinite(item.x) ? item.x : 50,
        y: Number.isFinite(item.y) ? item.y : 50,
        layout: 'post',
        type: 'image',
    };
}

export async function publishImagePost(post, { retry = false } = {}) {
    const ownerId = state.signedInAccountId;
    const client = await getSupabaseClient();
    const bucket = client.storage.from(bucketName);
    if (retry) {
        const result = await client.from(tableName).select('items').eq('owner_id', ownerId).eq('client_id', post.id).maybeSingle();
        if (result.error) throw result.error;
        if (result.data) {
            post.cloudImagePaths = result.data.items.map(item => item.path);
            return;
        }
    }
    const paths = [];
    let writingRow = false;
    try {
        const items = [];
        const uploadId = crypto.randomUUID();
        for (const [index, item] of post.mediaItems.entries()) {
            const response = await fetch(item.url);
            if (!response.ok) throw new Error('Could not read the selected image.');
            const image = await response.blob();
            if (!image.type.startsWith('image/')) throw new Error('Select a supported image.');
            const path = `${ownerId}/${uploadId}/${index}`;
            const uploaded = await bucket.upload(path, image, { contentType: image.type });
            if (uploaded.error) throw uploaded.error;
            paths.push(path);
            items.push({ path, settings: imageSettings(item) });
        }
        writingRow = true;
        const { error } = await client.from(tableName).insert({
            owner_id: ownerId, client_id: post.id, caption: post.caption, location: post.location,
            tags: post.taggedUsers, items, cover_index: post.coverIndex, is_public: post.public,
        });
        if (error) {
            writingRow = !error.code || error.code.startsWith('PGRST0');
            throw error;
        }
        post.cloudImagePaths = paths;
    } catch (error) {
        // Keep uploaded objects if the insert may have succeeded despite a lost response.
        if (!writingRow && paths.length) await bucket.remove(paths).catch(() => {});
        throw error;
    }
}

export async function loadCloudImagePosts() {
    const ownerId = state.signedInAccountId;
    if (!ownerId) return;
    const client = await getSupabaseClient();
    const { data, error } = await client.from(tableName).select('*').eq('owner_id', ownerId).order('client_id');
    if (error) throw error;
    const bucket = client.storage.from(bucketName);
    const cloudPosts = [];
    for (const row of data) {
        const paths = row.items.map(item => item.path);
        const signed = await bucket.createSignedUrls(paths, 3600);
        if (signed.error) throw signed.error;
        if (signed.data.some(item => !item.signedUrl)) throw new Error('A saved image is unavailable.');
        const mediaItems = row.items.map((item, index) => ({
            ...imageSettings(item.settings || {}), url: signed.data[index].signedUrl,
        }));
        const existing = posts.find(post => post.id === row.client_id && post.cloudImagePaths);
        cloudPosts.push({
            ...existing,
            id: row.client_id, handle: currentUser.handle, user: currentUser.name, avatar: currentUser.avatar,
            caption: row.caption, location: row.location, taggedUsers: row.tags, taggedHandles: row.tags,
            media: mediaItems[0].url, cover: mediaItems[row.cover_index]?.url || mediaItems[0].url,
            coverIndex: row.cover_index, mediaItems, cloudImagePaths: paths,
            createdAt: Date.parse(row.created_at), mediaType: 'photo', public: row.is_public,
            mine: true, reel: false, followed: true,
            likes: existing?.likes ?? 0, comments: existing?.comments ?? 0, commentItems: existing?.commentItems ?? [],
        });
    }
    const cloudIds = new Set(cloudPosts.map(post => post.id));
    posts.splice(0, posts.length, ...posts.filter(post => !post.cloudImagePaths && !cloudIds.has(post.id)), ...cloudPosts);
}

export async function updateCloudImagePost(post, fields) {
    const client = await getSupabaseClient();
    const { error } = await client.from(tableName).update(fields)
        .eq('owner_id', state.signedInAccountId).eq('client_id', post.id);
    if (error) throw error;
}

export async function deleteCloudImagePost(post) {
    const client = await getSupabaseClient();
    const { error } = await client.from(tableName).delete()
        .eq('owner_id', state.signedInAccountId).eq('client_id', post.id);
    if (error) throw error;
    await client.storage.from(bucketName).remove(post.cloudImagePaths).catch(() => {});
}
