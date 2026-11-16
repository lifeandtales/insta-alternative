import { avatarLookup, rememberCloudPerson } from '../features/cloud-people.js';
import { remoteMediaId } from './remote-media-id.js';
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
    post.cloudOwnerId = ownerId;
    post.cloudClientId = post.id;
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

export async function loadCloudImagePosts(targetId = null) {
    const ownerId = state.signedInAccountId;
    if (!ownerId) return;
    const client = await getSupabaseClient();
    const author = 'author:profiles!image_posts_owner_id_fkey!inner(username,display_name,avatar_path)';
    const rows = '*, ' + author;
    const query = columns => client.from(tableName).select(columns);
    const load = (columns, withLikes = false) => {
        const request = query(columns).in('owner_id', scope).order('created_at', { ascending: false }).limit(100);
        return withLikes ? request.eq('viewer_like.user_id', ownerId) : request;
    };
    const scope = targetId ? [targetId] : [ownerId, ...(state.cloudFollowingIds || [])];
    const withComments = rows + ', cloud_comments:image_post_comments(count)';
    let result = await load(withComments + ', cloud_likes:image_post_likes(count), viewer_like:image_post_likes(user_id)', true);
    if (result.error?.code === 'PGRST200') result = await load(withComments);
    if (result.error?.code === 'PGRST200') result = await load(rows);
    const { data, error } = result;
    if (error) throw error;
    const bucket = client.storage.from(bucketName);
    const paths = [...new Set(data.flatMap(row => row.items.map(item => item.path)))];
    const signed = paths.length ? await bucket.createSignedUrls(paths, 3600) : { data: [] };
    if (signed.error) throw signed.error;
    const urls = new Map(signed.data.map(item => [item.path, item.signedUrl]));
    if (state.signedInAccountId !== ownerId) return;
    const avatars = await avatarLookup(client, data.map(row => row.author));
    if (state.signedInAccountId !== ownerId) return;
    const cloudPosts = [];
    for (const row of data) {
        const mine = row.owner_id === ownerId;
        const author = rememberCloudPerson({ ...row.author, id: row.owner_id }, avatars);
        const id = mine ? row.client_id : remoteMediaId(row.owner_id + ':' + row.client_id);
        const mediaItems = row.items.map(item => ({
            ...imageSettings(item.settings || {}), url: urls.get(item.path),
        }));
        if (mediaItems.some(item => !item.url)) continue;
        const existing = posts.find(post => post.id === id && post.cloudImagePaths);
        cloudPosts.push({
            ...existing,
            id, handle: mine ? currentUser.handle : author.handle,
            user: mine ? currentUser.name : author.name,
            avatar: mine ? currentUser.avatar : author.avatar,
            caption: row.caption, location: row.location, taggedUsers: row.tags, taggedHandles: row.tags,
            media: mediaItems[0].url, cover: mediaItems[row.cover_index]?.url || mediaItems[0].url,
            coverIndex: row.cover_index, mediaItems, cloudImagePaths: row.items.map(item => item.path),
            cloudOwnerId: row.owner_id, cloudClientId: row.client_id, createdAt: Date.parse(row.created_at), mediaType: 'photo', public: row.is_public,
            mine, reel: false, followed: !mine && Boolean(state.cloudFollowingIds?.has(row.owner_id)),
            likes: row.cloud_likes?.[0]?.count ?? 0, liked: Boolean(row.viewer_like?.length), comments: row.cloud_comments?.[0]?.count ?? existing?.comments ?? 0, commentItems: existing?.commentItems ?? [],
        });
    }
    const cloudIds = new Set(cloudPosts.map(post => post.id));
    const remaining = posts.filter(post => !cloudIds.has(post.id) &&
        (!post.cloudImagePaths || (targetId && (post.cloudOwnerId || ownerId) !== targetId)));
    posts.splice(0, posts.length, ...remaining, ...cloudPosts);
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
