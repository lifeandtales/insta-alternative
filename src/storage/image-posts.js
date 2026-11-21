import { mediaBucket } from './s3-media-access.js';
import { avatarLookup, rememberCloudPerson } from '../features/cloud-people.js';
import { remoteMediaId } from './remote-media-id.js';
import { state } from '../core/state.js';
import { currentUser, posts } from '../data/sample-data.js';
import { mediaEdits } from '../features/post-media.js';
import { getSupabaseClient } from './supabase.js';
import { loadVideoEngagement } from './video-engagement.js';
import { hydrateImageComments, imageCommentProjection } from './cloud-comments.js';

const bucketName = 'post-images';
const tableName = 'image_posts';

const signedMedia = new Map();
let cacheAccount;

async function signedImagePostUrls(client, paths, accountId, retry = false) {
    if (accountId !== state.signedInAccountId) return new Map();
    if (cacheAccount !== accountId) {
        signedMedia.clear();
        cacheAccount = accountId;
    }
    const now = Date.now();
    for (const [path, asset] of signedMedia) {
        if (asset.reuseUntil <= now) signedMedia.delete(path);
    }
    const missing = paths.filter(path => retry || !signedMedia.has(path));
    if (missing.length) {
        const { data, error } = await mediaBucket(client, bucketName).createSignedUrls(missing, 3600);
        if (error) throw error;
        if (accountId !== state.signedInAccountId) return new Map();
        for (const item of data || []) {
            if (item.signedUrl) signedMedia.set(item.path, { url: item.signedUrl, reuseUntil: now + 300000 });
            else signedMedia.delete(item.path);
        }
    }
    return new Map(paths.map(path => [path, signedMedia.get(path)?.url]));
}

export async function retryImagePostPhoto(path) {
    const accountId = state.signedInAccountId;
    if (!accountId || !path) return '';
    const client = await getSupabaseClient();
    const urls = await signedImagePostUrls(client, [path], accountId, true);
    return urls.get(path) || '';
}

function postMediaSettings(item) {
    return {
        ...mediaEdits(item),
        fit: item.fit === 'cover' ? 'cover' : 'contain',
        x: Number.isFinite(item.x) ? item.x : 50,
        y: Number.isFinite(item.y) ? item.y : 50,
        layout: 'post',
        type: item.type === 'video' ? 'video' : 'image',
        naturalRatio: Number.isFinite(item.naturalRatio) ? item.naturalRatio : undefined,
    };
}

export async function publishImagePost(post, { retry = false } = {}) {
    const ownerId = state.signedInAccountId;
    const client = await getSupabaseClient();
    post.cloudOwnerId = ownerId;
    post.cloudClientId = post.id;
    const bucket = mediaBucket(client, bucketName);
    if (retry) {
        const result = await client.from(tableName).select('items').eq('owner_id', ownerId).eq('client_id', post.id).maybeSingle();
        if (result.error) throw result.error;
        if (result.data) {
            post.cloudImagePaths = result.data.items.flatMap(item => [item.path, item.cover_path].filter(Boolean));
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
            if (!response.ok) throw new Error('Could not read the selected media.');
            const file = await response.blob();
            if (!file.type.startsWith(item.type === 'video' ? 'video/' : 'image/')) throw new Error('Select supported media.');
            const path = `${ownerId}/${uploadId}/${index}`;
            const uploaded = await bucket.upload(path, file, { contentType: file.type });
            if (uploaded.error) throw uploaded.error;
            paths.push(path);
            items.push({ path, settings: postMediaSettings(item), duration_seconds: item.duration });
        }
        if (post.cover && items.some(item => item.settings.type === 'video')) {
            const cover = await (await fetch(post.cover)).blob();
            const coverPath = `${ownerId}/${uploadId}/cover`;
            const upload = await bucket.upload(coverPath, cover, { contentType: cover.type });
            if (upload.error) throw upload.error;
            paths.push(coverPath);
            items[0].cover_path = coverPath;
        }
        if (ownerId !== state.signedInAccountId) throw new Error('Your account changed. Try again.');
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

export const cloudImageAuthorProjection = 'author:profiles!image_posts_owner_id_fkey!inner(username,display_name,avatar_path,is_private)';

export async function loadCloudImagePosts(targetId = null, taggedHandle = null) {
    const ownerId = state.signedInAccountId;
    if (!ownerId) return;
    const client = await getSupabaseClient();
    const rows = '*, ' + cloudImageAuthorProjection;
    const query = columns => client.from(tableName).select(columns);
    const load = (columns, withLikes = false, withPreviews = false) => {
        let request = (taggedHandle ? query(columns).contains('tags', [taggedHandle]) : query(columns).in('owner_id', scope))
            .order('created_at', { ascending: false }).limit(100);
        if (withPreviews) request = request.order('created_at', { referencedTable: 'preview_comments', ascending: false })
            .order('id', { referencedTable: 'preview_comments' }).limit(2, { referencedTable: 'preview_comments' });
        return withLikes ? request.eq('viewer_like.user_id', ownerId) : request;
    };
    const scope = targetId ? [targetId] : [ownerId, ...(state.cloudFollowingIds || [])];
    const withComments = rows + ', cloud_comments:image_post_comments(count)';
    const withLikes = withComments + ', cloud_likes:image_post_likes(count), viewer_like:image_post_likes(user_id)';
    let result = await load(withLikes + ', preview_comments:image_post_comments(' + imageCommentProjection + ')', true, true);
    if (result.error?.code === 'PGRST200') result = await load(withLikes, true);
    if (result.error?.code === 'PGRST200') result = await load(withComments);
    if (result.error?.code === 'PGRST200') result = await load(rows);
    const { data, error } = result;
    if (error) throw error;
    const cloudPosts = await hydrateCloudImagePosts(client, data, ownerId);
    if (state.signedInAccountId !== ownerId) return;
    if (taggedHandle) {
        (state.cloudTaggedPosts ||= new Map()).set(taggedHandle, cloudPosts);
        return;
    }
    const cloudIds = new Set(cloudPosts.map(post => post.id));
    const remaining = posts.filter(post => !cloudIds.has(post.id) &&
        (!post.cloudImagePaths || (targetId && (post.cloudOwnerId || ownerId) !== targetId)));
    posts.splice(0, posts.length, ...remaining, ...cloudPosts);
}

export async function hydrateCloudImagePosts(client, data, ownerId) {
    const paths = [...new Set(data.flatMap(row => row.items.flatMap(item => [item.path, item.cover_path].filter(Boolean))))];
    const videoTargets = data.filter(row => row.items.some(item => item.settings?.type === 'video'))
        .map(row => ({ owner: row.owner_id, id: row.client_id }));
    const [urls, engagement, avatars] = await Promise.all([
        signedImagePostUrls(client, paths, ownerId),
        loadVideoEngagement(client, { posts: videoTargets }),
        avatarLookup(client, data.flatMap(row => [row.author, ...(row.preview_comments || []).map(comment => comment.author)])),
    ]);
    if (state.signedInAccountId !== ownerId) return [];
    const cloudPosts = [];
    const totals = new Map(engagement.posts.map(item => [`${item.owner}:${item.id}`, item]));
    for (const row of data) {
        const mine = row.owner_id === ownerId;
        const author = rememberCloudPerson({ ...row.author, id: row.owner_id }, avatars);
        const id = mine ? row.client_id : remoteMediaId(row.owner_id + ':' + row.client_id);
        const mediaItems = row.items.map(item => ({
            ...postMediaSettings(item.settings || {}), duration: item.duration_seconds, url: urls.get(item.path),
            storagePath: item.path, poster: urls.get(item.cover_path),
        }));
        if (!mediaItems.length || mediaItems.some(item => item.type === 'video' && !item.url)) continue;
        const existing = posts.find(post => post.id === id && post.cloudImagePaths);
        const commentPreviews = Array.isArray(row.preview_comments) ? hydrateImageComments(row.preview_comments, avatars, existing?.commentItems) : undefined;
        const viewTotal = totals.get(`${row.owner_id}:${row.client_id}`);
        const cover = mediaItems[row.cover_index] || mediaItems[0];
        const firstVideo = mediaItems.find(item => item.type === 'video');
        cloudPosts.push({
            ...existing,
            id, handle: mine ? currentUser.handle : author.handle,
            user: mine ? currentUser.name : author.name,
            avatar: mine ? currentUser.avatar : author.avatar,
            caption: row.caption, location: row.location, taggedUsers: row.tags, taggedHandles: row.tags,
            media: mediaItems[0].url || '',
            cover: urls.get(row.items[0].cover_path) || (cover.type === 'image' ? cover.url : existing?.cover),
            coverIndex: row.cover_index, mediaItems, cloudImagePaths: row.items.flatMap(item => [item.path, item.cover_path].filter(Boolean)),
            cloudOwnerId: row.owner_id, cloudClientId: row.client_id, createdAt: Date.parse(row.created_at),
            mediaType: firstVideo ? 'video' : 'photo', videoUrl: firstVideo?.url, public: row.is_public,
            views: viewTotal?.views ?? existing?.views ?? 0, viewed: viewTotal?.viewed ?? false,
            mine, reel: false, followed: !mine && Boolean(state.cloudFollowingIds?.has(row.owner_id)),
            likes: row.cloud_likes?.[0]?.count ?? 0, liked: Boolean(row.viewer_like?.length), comments: row.cloud_comments?.[0]?.count ?? existing?.comments ?? 0,
            commentItems: existing?.commentItems?.length ? existing.commentItems : commentPreviews || [],
            commentPreviews,
        });
    }
    return cloudPosts;
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
    await mediaBucket(client, bucketName).remove(post.cloudImagePaths).catch(() => {});
}
