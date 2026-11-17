import { state } from '../core/state.js';
import { avatarLookup, rememberCloudPerson } from '../features/cloud-people.js';
import { reels } from '../data/sample-data.js';
import { getSupabaseClient } from './supabase.js';
import { remoteMediaId } from './remote-media-id.js';

export async function loadCloudReels(targetId = null) {
    const accountId = state.signedInAccountId;
    if (!accountId) return;
    const client = await getSupabaseClient();
    const query = client.from('media_content')
        .select('id,owner_id,caption,audience,publish_at,metadata,author:profiles!inner(username,display_name,avatar_path),assets:media_assets(object_path,mime_type,position)')
        .eq('kind', 'reel').lte('publish_at', new Date().toISOString());
    const { data, error } = await (targetId ? query.eq('owner_id', targetId) : query.eq('audience', 'public'))
        .order('publish_at', { ascending: false }).limit(50);
    if (error) throw error;
    const fresh = await hydrateCloudReels(client, data, accountId);
    if (state.signedInAccountId !== accountId) return;
    reels.splice(0, reels.length, ...reels.filter(reel => !reel.cloudOwnerId || (targetId && reel.cloudOwnerId !== targetId)), ...fresh);
}


export async function hydrateCloudReels(client, data, accountId) {
    const videos = data.map(row => ({ row, video: row.assets.find(asset => asset.mime_type?.startsWith('video/')) })).filter(item => item.video);
    const paths = videos.map(item => item.video.object_path);
    const signed = paths.length ? await client.storage.from('app-media').createSignedUrls(paths, 3600) : { data: [] };
    if (signed.error) throw signed.error;
    if (state.signedInAccountId !== accountId) return [];
    const urls = new Map(signed.data.map(item => [item.path, item.signedUrl]));
    const avatars = await avatarLookup(client, data.map(row => row.author));
    if (state.signedInAccountId !== accountId) return [];
    const fresh = videos.flatMap(({ row, video }) => {
        const url = urls.get(video.object_path);
        if (!url) return [];
        const id = remoteMediaId(row.id);
        const previous = reels.find(reel => reel.id === id);
        const author = rememberCloudPerson({ ...row.author, id: row.owner_id }, avatars);
        return [{
            ...previous, id, cloudContentId: row.id, cloudOwnerId: row.owner_id, handle: author.handle,
            user: author.name, avatar: author.avatar, caption: row.caption,
            createdAt: Date.parse(row.publish_at), video: url, poster: '', public: !row.audience || row.audience === 'public', reel: true,
            taggedUsers: Array.isArray(row.metadata?.tags) ? row.metadata.tags.filter(tag => typeof tag === 'string') : [],
            mediaType: 'video', videoUrl: url, sensitive: row.metadata?.sensitive === true,
            likes: previous?.likes || 0, comments: previous?.comments || 0, commentItems: previous?.commentItems || [],
        }];
    });
    return fresh;
}
