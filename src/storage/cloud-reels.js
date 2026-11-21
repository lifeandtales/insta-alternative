import { state } from '../core/state.js';
import { avatarLookup, rememberCloudPerson } from '../features/cloud-people.js';
import { reels } from '../data/sample-data.js';
import { getSupabaseClient } from './supabase.js';
import { remoteMediaId } from './remote-media-id.js';
import { mediaEdits } from '../features/post-media.js';
import { cloudMediaCommentCounts } from './cloud-comments.js';
import { loadVideoEngagement } from './video-engagement.js';
import { isS3ReelAsset, requestReelStorage, signS3Reels } from './s3-reel-access.js';

export const cloudReelProjection = 'id,owner_id,caption,audience,publish_at,metadata,author:profiles!media_content_owner_id_fkey!inner(username,display_name,avatar_path,is_private),assets:media_assets(object_path,mime_type,position),' + cloudMediaCommentCounts;

async function readReelFile(url, kind, limit) {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Could not read the selected media.');
    const blob = await response.blob();
    if (!blob.type.startsWith(kind + '/') || !blob.size) throw new Error('Select supported media.');
    if (blob.size > limit) throw new Error(kind === 'video'
        ? 'This Reel exceeds the 50 MB upload limit.' : 'This thumbnail exceeds the 10 MB upload limit.');
    return blob;
}

export async function publishCloudReel(reel, id) {
    const owner = state.signedInAccountId;
    if (!owner) throw new Error('Sign in to publish your Reel online.');
    const client = await getSupabaseClient();
    const [video, cover] = await Promise.all([
        readReelFile(reel.video, 'video', 50_000_000),
        readReelFile(reel.cover, 'image', 10_000_000),
    ]);
    if (owner !== state.signedInAccountId) throw new Error('Your account changed. Try again.');
    const files = { video, cover };
    const media = { video: { size: video.size, mime: video.type }, cover: { size: cover.size, mime: cover.type } };
    const prepared = await requestReelStorage(client, { action: 'prepare', id, media });
    let paths = prepared.paths;
    if (!paths) {
        for (const upload of prepared.uploads) {
            if (owner !== state.signedInAccountId) throw new Error('Your account changed. Try again.');
            const form = new FormData();
            for (const [name, value] of Object.entries(upload.fields)) form.append(name, value);
            form.append('file', files[upload.role]);
            const response = await fetch(upload.url, { method: 'POST', body: form });
            if (!response.ok) throw new Error('Could not upload the Reel to storage. Try again.');
        }
        if (owner !== state.signedInAccountId) throw new Error('Your account changed. Try again.');
        const item = reel.mediaItems[0];
        ({ paths } = await requestReelStorage(client, {
            action: 'publish', id, ticket: prepared.ticket, media, caption: reel.caption || '',
            audience: reel.public ? 'public' : 'followers',
            details: { client_id: reel.id, tags: reel.taggedUsers,
                edits: mediaEdits(item), naturalRatio: item.naturalRatio, x: item.x, y: item.y, fit: item.fit },
            duration: item.duration ?? null,
        }));
    }
    Object.assign(reel, { cloudContentId: id, cloudOwnerId: owner, cloudVideoPaths: paths });
}

export async function updateCloudReelCaption(reel, caption) {
    const client = await getSupabaseClient();
    const { error } = await client.from('media_content').update({ caption })
        .eq('id', reel.cloudContentId).eq('owner_id', state.signedInAccountId);
    if (error) throw error;
}

export async function deleteCloudReel(reel) {
    const owner = state.signedInAccountId;
    if (!owner || owner !== reel.cloudOwnerId) throw new Error('This Reel is unavailable to delete.');
    const client = await getSupabaseClient();
    if (owner !== state.signedInAccountId) throw new Error('Your account changed. Try again.');
    if (reel.cloudVideoPaths?.some(isS3ReelAsset)) {
        const { filesRemoved } = await requestReelStorage(client, { action: 'delete', id: reel.cloudContentId });
        return filesRemoved;
    }
    const { error } = await client.from('media_content').delete()
        .eq('id', reel.cloudContentId).eq('owner_id', owner);
    if (error) throw error;

    if (!reel.cloudVideoPaths?.length || owner !== state.signedInAccountId) return false;
    try {
        const { error: cleanupError } = await client.storage.from('app-media').remove(reel.cloudVideoPaths);
        return !cleanupError;
    } catch {
        return false;
    }
}

export async function loadCloudReels(targetId = null) {
    const accountId = state.signedInAccountId;
    if (!accountId) return;
    const client = await getSupabaseClient();
    const query = client.from('media_content')
        .select(cloudReelProjection)
        .eq('kind', 'reel').lte('publish_at', new Date().toISOString());
    const { data, error } = await (targetId ? query.eq('owner_id', targetId) : query)
        .order('publish_at', { ascending: false }).limit(50);
    if (error) throw error;
    const fresh = await hydrateCloudReels(client, data, accountId);
    if (state.signedInAccountId !== accountId) return;
    const publishedIds = new Set(fresh.map(reel => reel.cloudContentId));
    const retained = reels.filter(reel => reel.cloudOwnerId
        ? targetId && reel.cloudOwnerId !== targetId
        : !publishedIds.has(reel.pendingCloudId));
    reels.splice(0, reels.length, ...retained, ...fresh);
}


export async function hydrateCloudReels(client, data, accountId) {
    const videos = data.map(row => ({ row, video: row.assets.find(asset => asset.mime_type?.startsWith('video/')) })).filter(item => item.video);
    const paths = videos.flatMap(item => item.row.assets.map(asset => asset.object_path)).filter(path => !isS3ReelAsset(path));
    const s3Ids = videos.filter(({ row }) => row.assets.some(asset => isS3ReelAsset(asset.object_path))).map(({ row }) => row.id);
    const legacyUrls = async () => paths.length
        ? (await client.storage.from('app-media').createSignedUrls(paths, 3600)).data || [] : [];
    const [legacy, s3, engagement, avatars] = await Promise.all([
        legacyUrls().catch(() => []),
        signS3Reels(client, s3Ids),
        loadVideoEngagement(client, { reels: videos.map(({ row }) => row.id) }).catch(() => null),
        avatarLookup(client, videos.map(({ row }) => row.author)).catch(() => undefined),
    ]);
    if (state.signedInAccountId !== accountId) return [];
    const urls = new Map([...legacy, ...s3].map(item => [item.path, item.signedUrl]));
    if (videos.length && !videos.some(({ video }) => urls.get(video.object_path))) {
        throw new Error('The Reel videos could not be loaded.');
    }
    const totals = new Map((engagement?.reels || []).map(item => [item.id, item]));
    const fresh = videos.flatMap(({ row, video }) => {
        const url = urls.get(video.object_path);
        if (!url) return [];
        const mine = row.owner_id === accountId;
        const clientId = row.metadata?.client_id;
        const id = mine && Number.isSafeInteger(clientId) && clientId > 0 ? clientId : remoteMediaId(row.id);
        const previous = reels.find(reel => reel.id === id && reel.cloudContentId === row.id);
        const author = rememberCloudPerson({ ...row.author, id: row.owner_id }, avatars);
        const metrics = totals.get(row.id);
        const cover = urls.get(row.assets.find(asset => asset.mime_type?.startsWith('image/'))?.object_path) || '';
        const edits = row.metadata?.edits;
        return [{
            ...previous, id, cloudContentId: row.id, cloudOwnerId: row.owner_id, handle: author.handle,
            user: author.name, avatar: author.avatar, caption: row.caption,
            createdAt: Date.parse(row.publish_at), video: url, poster: cover, cover, mine,
            public: !row.audience || row.audience === 'public', cloudAudience: row.audience, reel: true,
            cloudVideoPaths: row.assets.map(asset => asset.object_path),
            mediaItems: edits ? [{ ...mediaEdits(edits), type: 'video', layout: 'reel', url,
                naturalRatio: row.metadata.naturalRatio, x: row.metadata.x, y: row.metadata.y, fit: row.metadata.fit }] : undefined,
            originalAudioMuted: edits?.originalAudioMuted === true,
            taggedUsers: Array.isArray(row.metadata?.tags) ? row.metadata.tags.filter(tag => typeof tag === 'string') : [],
            mediaType: 'video', videoUrl: url, sensitive: row.metadata?.sensitive === true,
            views: metrics?.views ?? previous?.views ?? 0, viewed: metrics?.viewed ?? previous?.viewed ?? false,
            likes: metrics?.likes ?? previous?.likes ?? 0, liked: metrics?.liked ?? previous?.liked ?? false,
            comments: row.cloud_comments?.[0]?.count ?? previous?.comments ?? 0, commentItems: previous?.commentItems || [],
        }];
    });
    return fresh;
}
