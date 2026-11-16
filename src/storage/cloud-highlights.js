import { state } from '../core/state.js';
import { hydrateCloudStories } from './cloud-stories.js';
import { getSupabaseClient } from './supabase.js';

export async function loadCloudHighlights(profileOwner, handle) {
    const owner = state.signedInAccountId;
    const client = await getSupabaseClient();
    const { data, error } = await client.rpc('connected_story_highlights', { profile_owner: profileOwner });
    if (error) throw error;
    const storyRows = [...new Map(data.flatMap(highlight => highlight.stories.map(story => [story.id, story]))).values()];
    const paths = data.map(highlight => highlight.cover_path).filter(Boolean);
    const [stories, covers] = await Promise.all([
        hydrateCloudStories(client, storyRows, owner),
        paths.length ? client.storage.from('app-media').createSignedUrls(paths, 300) : { data: [] },
    ]);
    if (owner !== state.signedInAccountId) return;
    const storyById = new Map(stories.map(story => [story.id, story]));
    const coverByPath = new Map((covers.data || []).map(item => [item.path, item.signedUrl]));
    const fresh = data.flatMap(row => {
        const items = row.stories.map(story => storyById.get(story.id)).filter(Boolean);
        if (!items.length) return [];
        return [{
            id: row.id, cloudHighlightId: row.id, cloudOwnerId: row.owner_id, handle,
            title: row.title, stories: items, audience: row.audience === 'close_friends' ? 'close-friends' : 'all',
            archived: row.archived, position: row.position, coverPath: row.cover_path, cover: coverByPath.get(row.cover_path),
        }];
    });
    state.storyHighlights = [...state.storyHighlights.filter(item => item.cloudOwnerId !== profileOwner), ...fresh];
}

export async function loadCloudStoryArchive() {
    const owner = state.signedInAccountId;
    const client = await getSupabaseClient();
    const { data, error } = await client.rpc('connected_story_archive');
    if (error) throw error;
    const stories = await hydrateCloudStories(client, data, owner);
    if (owner === state.signedInAccountId) state.cloudArchivedStories = stories;
}

export async function saveCloudHighlight(highlight, coverFile) {
    const owner = state.signedInAccountId;
    if (!owner || highlight.stories.some(story => !story.cloudContentId || story.cloudOwnerId !== owner)) {
        throw new Error('Choose Stories that have synced to your account.');
    }
    const client = await getSupabaseClient();
    const bucket = client.storage.from('app-media');
    const id = highlight.cloudHighlightId || crypto.randomUUID();
    const oldCover = highlight.coverPath || null;
    let coverPath = oldCover;
    if (coverFile) {
        if (!coverFile.type.startsWith('image/') || coverFile.size > 50000000) throw new Error('Choose a cover image up to 50 MB.');
        coverPath = `${owner}/${id}/cover/${crypto.randomUUID()}`;
        const upload = await bucket.upload(coverPath, coverFile, { contentType: coverFile.type });
        if (upload.error) throw upload.error;
    }
    const result = await client.from('story_highlights').upsert({
        id, owner_id: owner, title: highlight.title, story_ids: highlight.stories.map(story => story.cloudContentId),
        audience: highlight.audience === 'close-friends' ? 'close_friends' : 'public',
        archived: Boolean(highlight.archived), position: highlight.position ?? state.storyHighlights.length,
        cover_path: coverPath,
    });
    if (result.error) {
        if (coverFile && result.error.code && !result.error.code.startsWith('PGRST0')) await bucket.remove([coverPath]).catch(() => {});
        throw result.error;
    }
    if (coverFile && oldCover) await bucket.remove([oldCover]).catch(() => {});
    if (owner !== state.signedInAccountId) return;
    Object.assign(highlight, { id, cloudHighlightId: id, cloudOwnerId: owner, coverPath });
    if (coverFile) {
        const signed = await bucket.createSignedUrl(coverPath, 300).catch(() => null);
        highlight.cover = signed?.data?.signedUrl;
    }
}

export async function setCloudHighlightArchived(highlight) {
    const client = await getSupabaseClient();
    const { error } = await client.from('story_highlights').update({ archived: highlight.archived })
        .eq('id', highlight.cloudHighlightId).eq('owner_id', state.signedInAccountId);
    if (error) throw error;
}

export async function deleteCloudHighlight(highlight) {
    const client = await getSupabaseClient();
    const { error } = await client.from('story_highlights').delete().eq('id', highlight.cloudHighlightId)
        .eq('owner_id', state.signedInAccountId);
    if (error) throw error;
    if (highlight.coverPath) await client.storage.from('app-media').remove([highlight.coverPath]).catch(() => {});
}

export async function reorderCloudHighlights(highlights) {
    const client = await getSupabaseClient();
    const { error } = await client.rpc('reorder_connected_story_highlights', {
        highlight_ids: highlights.filter(item => item.cloudHighlightId).map(item => item.cloudHighlightId),
    });
    if (error) throw error;
}
