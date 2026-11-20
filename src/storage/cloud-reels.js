import { state } from '../core/state.js';
import { avatarLookup, rememberCloudPerson } from '../features/cloud-people.js';
import { reels } from '../data/sample-data.js';
import { getSupabaseClient } from './supabase.js';
import { remoteMediaId } from './remote-media-id.js';
import { mediaEdits } from '../features/post-media.js';
import { loadVideoEngagement } from './video-engagement.js';

export async function publishCloudReel(reel, id) {
    const owner = state.signedInAccountId;
    const client = await getSupabaseClient();
    const bucket = client.storage.from('app-media');
    const prefix = `${owner}/${id}/`;
    const paths = [];
    let uncertain = false;
    try {
        const upload = async (name, url, kind) => {
            const response = await fetch(url);
            if (!response.ok) throw new Error('Could not read the selected media.');
            const blob = await response.blob();
            if (!blob.type.startsWith(kind + '/')) throw new Error('Select supported media.');
            const path = prefix + name;
            const { error } = await bucket.upload(path, blob, { contentType: blob.type });
            if (error && String(error.statusCode) !== '409') throw error;
            if (!error) paths.push(path);
            return blob.type;
        };
        const videoMime = await upload('video', reel.video, 'video');
        const coverMime = await upload('cover', reel.cover, 'image');
        if (owner !== state.signedInAccountId) throw new Error('Your account changed. Try again.');
        const item = reel.mediaItems[0];
        const { error } = await client.rpc('publish_video_reel', {
            target: id, caption_text: reel.caption, reel_audience: reel.public ? 'public' : 'followers',
            details: { client_id: reel.id, tags: reel.taggedUsers,
                edits: mediaEdits(item), naturalRatio: item.naturalRatio, x: item.x, y: item.y, fit: item.fit },
            video_mime: videoMime, cover_mime: coverMime, duration_seconds: item.duration ?? null,
        });
        if (error) {
            uncertain = !error.code || error.code.startsWith('PGRST0');
            throw error;
        }
    } catch (error) {
        if (!uncertain && paths.length && owner === state.signedInAccountId) await bucket.remove(paths).catch(() => {});
        throw error;
    }
    Object.assign(reel, { cloudContentId: id, cloudOwnerId: owner, cloudVideoPaths: [prefix + 'video', prefix + 'cover'] });
}

export async function updateCloudReelCaption(reel, caption) {
    const client = await getSupabaseClient();
    const { error } = await client.from('media_content').update({ caption })
        .eq('id', reel.cloudContentId).eq('owner_id', state.signedInAccountId);
    if (error) throw error;
}

export async function deleteCloudReel(reel) {
    const client = await getSupabaseClient();
    const { error } = await client.from('media_content').delete()
        .eq('id', reel.cloudContentId).eq('owner_id', state.signedInAccountId);
    if (error) throw error;
    if (reel.cloudVideoPaths?.length) {
        await client.storage.from('app-media').remove(reel.cloudVideoPaths).catch(() => {});
    }
}

export async function loadCloudReels(targetId = null) {
    const accountId = state.signedInAccountId;
    if (!accountId) return;
    const client = await getSupabaseClient();
    const query = client.from('media_content')
        .select('id,owner_id,caption,audience,publish_at,metadata,author:profiles!inner(username,display_name,avatar_path),assets:media_assets(object_path,mime_type,position)')
        .eq('kind', 'reel').lte('publish_at', new Date().toISOString());
    const { data, error } = await (targetId ? query.eq('owner_id', targetId) : query)
        .order('publish_at', { ascending: false }).limit(50);
    if (error) throw error;
    const fresh = await hydrateCloudReels(client, data, accountId);
    if (state.signedInAccountId !== accountId) return;
    reels.splice(0, reels.length, ...reels.filter(reel => !reel.cloudOwnerId || (targetId && reel.cloudOwnerId !== targetId)), ...fresh);
}


export async function hydrateCloudReels(client, data, accountId) {
    const videos = data.map(row => ({ row, video: row.assets.find(asset => asset.mime_type?.startsWith('video/')) })).filter(item => item.video);
    const paths = videos.flatMap(item => item.row.assets.map(asset => asset.object_path));
    const [signed, engagement] = await Promise.all([
        paths.length ? client.storage.from('app-media').createSignedUrls(paths, 3600) : { data: [] },
        loadVideoEngagement(client, { reels: videos.map(({ row }) => row.id) }),
    ]);
    if (signed.error) throw signed.error;
    if (state.signedInAccountId !== accountId) return [];
    const urls = new Map(signed.data.map(item => [item.path, item.signedUrl]));
    const avatars = await avatarLookup(client, data.map(row => row.author));
    if (state.signedInAccountId !== accountId) return [];
    const totals = new Map(engagement.reels.map(item => [item.id, item]));
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
            public: !row.audience || row.audience === 'public', reel: true,
            cloudVideoPaths: row.assets.map(asset => asset.object_path),
            mediaItems: edits ? [{ ...mediaEdits(edits), type: 'video', layout: 'reel', url,
                naturalRatio: row.metadata.naturalRatio, x: row.metadata.x, y: row.metadata.y, fit: row.metadata.fit }] : undefined,
            originalAudioMuted: edits?.originalAudioMuted === true,
            taggedUsers: Array.isArray(row.metadata?.tags) ? row.metadata.tags.filter(tag => typeof tag === 'string') : [],
            mediaType: 'video', videoUrl: url, sensitive: row.metadata?.sensitive === true,
            views: metrics?.views ?? previous?.views ?? 0, viewed: metrics?.viewed ?? false,
            likes: metrics?.likes ?? previous?.likes ?? 0, liked: metrics?.liked ?? previous?.liked ?? false,
            comments: previous?.comments || 0, commentItems: previous?.commentItems || [],
        }];
    });
    return fresh;
}
