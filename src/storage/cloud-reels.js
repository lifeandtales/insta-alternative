import { state } from '../core/state.js';
import { avatarLookup, rememberCloudPerson } from '../features/cloud-people.js';
import { reels } from '../data/sample-data.js';
import { getSupabaseClient } from './supabase.js';
import { remoteMediaId } from './remote-media-id.js';

export async function loadCloudReels() {
    const accountId = state.signedInAccountId;
    if (!accountId) return;
    const client = await getSupabaseClient();
    const { data, error } = await client.from('media_content')
        .select('id,owner_id,caption,publish_at,metadata,author:profiles!inner(username,display_name,avatar_path),assets:media_assets(object_path,mime_type,position)')
        .eq('kind', 'reel').eq('audience', 'public').lte('publish_at', new Date().toISOString())
        .order('publish_at', { ascending: false }).limit(50);
    if (error) throw error;
    const videos = data.map(row => ({ row, video: row.assets.find(asset => asset.mime_type?.startsWith('video/')) })).filter(item => item.video);
    const paths = videos.map(item => item.video.object_path);
    const signed = paths.length ? await client.storage.from('app-media').createSignedUrls(paths, 3600) : { data: [] };
    if (signed.error) throw signed.error;
    if (state.signedInAccountId !== accountId) return;
    const urls = new Map(signed.data.map(item => [item.path, item.signedUrl]));
    const avatars = await avatarLookup(client, data.map(row => row.author));
    if (state.signedInAccountId !== accountId) return;
    const fresh = videos.flatMap(({ row, video }) => {
        const url = urls.get(video.object_path);
        if (!url) return [];
        const id = remoteMediaId(row.id);
        const previous = reels.find(reel => reel.id === id);
        const author = rememberCloudPerson({ ...row.author, id: row.owner_id }, avatars);
        return [{
            ...previous, id, cloudOwnerId: row.owner_id, handle: author.handle,
            user: author.name, avatar: author.avatar, caption: row.caption,
            createdAt: Date.parse(row.publish_at), video: url, poster: '', public: true, reel: true,
            mediaType: 'video', videoUrl: url, sensitive: row.metadata?.sensitive === true,
            likes: previous?.likes || 0, comments: previous?.comments || 0, commentItems: previous?.commentItems || [],
        }];
    });
    reels.splice(0, reels.length, ...reels.filter(reel => !reel.cloudOwnerId), ...fresh);
}
