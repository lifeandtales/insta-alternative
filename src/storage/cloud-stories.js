import { state } from '../core/state.js';
import { currentUser, posts } from '../data/sample-data.js';
import { avatarLookup, rememberCloudPerson } from '../features/cloud-people.js';
import { storyComposition } from '../features/story-composition.js';
import { persistActiveStories } from './browser-storage.js';
import { getSupabaseClient } from './supabase.js';

const maxStoryBytes = 50000000;
let feedRevision = 0;
const signedMedia = new Map();
let cacheOwner;

function storyEdits(value) {
    const edits = storyComposition(value && typeof value === 'object' ? value : {});
    edits.music = null;
    edits.layers = edits.layers.filter(layer => layer && typeof layer === 'object').map(layer => ({
        ...layer,
        points: Array.isArray(layer.points) ? layer.points.filter(Boolean) : [],
        mentions: Array.isArray(layer.mentions) ? layer.mentions.filter(item => typeof item?.handle === 'string') : [],
    }));
    return edits;
}

function storySource(story) {
    if (story.repostedStoryId) return { source_id: story.cloudSourceStoryId || null };
    if (story.sourceReelId || story.cloudSourceReelId) return { source_id: story.cloudSourceReelId || null };
    if (story.sourcePostId || story.cloudSourcePostId) {
        const post = posts.find(item => item.id === story.sourcePostId);
        return { post_owner: story.cloudSourcePostOwner || post?.cloudOwnerId, post_id: story.cloudSourcePostId || post?.cloudClientId };
    }
    return {};
}

function musicDetails(music) {
    if (!music?.src) return null;
    const { title, start, end, volume } = music;
    return { title: String(title || '').slice(0, 180), start, end, volume };
}

function restoreEdits(value, music, audio) {
    const edits = storyEdits(value);
    if (audio && music && typeof music === 'object') edits.music = { ...music, src: audio };
    return edits;
}

async function uploadStoryAsset(bucket, path, url, category, paths, importing) {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Could not read this Story file.');
    const file = await response.blob();
    const mime = file.type.split(';')[0];
    if (!category.test(mime)) throw new Error('Choose a supported Story file.');
    if (file.size > maxStoryBytes) throw new Error('Choose a Story file up to 50 MB.');
    const { error } = await bucket.upload(path, file, { contentType: mime });
    if (error && !(importing && (Number(error.statusCode ?? error.status) === 409 || error.error === 'Duplicate'))) throw error;
    if (!error) paths.push(path);
    return mime;
}

export async function publishCloudStory(story, scheduledAt, importing) {
    const owner = state.signedInAccountId;
    const source = storySource(story);
    const hasSource = Boolean(source.source_id || source.post_id);
    if (!hasSource && (story.repostedStoryId || story.sourcePostId || story.sourceReelId)) {
        throw new Error('The original must be available online before you can repost it.');
    }
    if (!hasSource && !/^(blob:|data:)/.test(story.media || '')) {
        throw new Error('Choose a photo or video from this device.');
    }
    const client = await getSupabaseClient();
    if (!owner || owner !== state.signedInAccountId) return false;
    const id = importing || crypto.randomUUID();
    if (importing) {
        const existing = await client.from('media_content').select('id').eq('id', id).eq('owner_id', owner).maybeSingle();
        if (existing.error) throw existing.error;
        if (existing.data) return owner === state.signedInAccountId;
    }
    const prefix = `${owner}/${id}/`;
    const bucket = client.storage.from('app-media');
    const paths = [];
    let mayHavePublished = false;
    try {
        const mime = hasSource ? null : await uploadStoryAsset(bucket, prefix + 'story', story.media, /^(image|video)\//, paths, importing);
        const music = musicDetails(story.edits?.music);
        if (music) await uploadStoryAsset(bucket, prefix + 'soundtrack', story.edits.music.src, /^audio\//, paths, importing);
        if (owner !== state.signedInAccountId) throw new Error('Your account changed. Try again.');
        const { error } = await client.rpc('publish_story_with_media', {
            story_id: id, caption_text: story.caption || '',
            story_audience: story.audience === 'close-friends' ? 'close_friends' : 'public',
            starts_at: scheduledAt ? new Date(scheduledAt).toISOString() : null, mime,
            composition: {
                edits: storyEdits(story.edits), music, sensitive: story.sensitive === true,
                repostSourceEdits: hasSource ? storyEdits(story.repostSourceEdits) : null,
                repostPosition: story.repostPosition, repostScale: story.repostScale,
                repostRotation: story.repostRotation, repostFullCanvas: story.repostFullCanvas === true,
            },
            soundtrack: Boolean(music), ...source,
            imported_expiry: importing ? new Date(story.expiresAt).toISOString() : null,
        });
        if (error && !(importing && error.code === '23505')) {
            mayHavePublished = !error.code || error.code.startsWith('PGRST0');
            throw error;
        }
    } catch (error) {
        if (!mayHavePublished && paths.length) await bucket.remove(paths).catch(() => {});
        throw error;
    }
    ++feedRevision;
    return owner === state.signedInAccountId;
}

let importingStories;
const attemptedImports = new Set();

async function legacyStoryId(owner, storyId) {
    const bytes = new TextEncoder().encode(`${owner}:${storyId}`);
    const hex = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
        .slice(0, 16).map(byte => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

function importLocalStories() {
    if (importingStories) return importingStories;
    const owner = state.signedInAccountId;
    if (!owner) return Promise.resolve();
    const stories = state.stories.filter(story => !story.cloudContentId && (story.mine || story.handle === currentUser.handle) &&
        story.expiresAt > Date.now() && ['all', 'close-friends', 'public', undefined].includes(story.audience));
    if (!stories.length) return Promise.resolve();
    importingStories = (async () => {
        const imported = new Set();
        const originalFirst = [...stories.filter(story => !story.repostedStoryId), ...stories.filter(story => story.repostedStoryId)];
        for (const story of originalFirst) {
            const id = await legacyStoryId(owner, story.id);
            if (owner !== state.signedInAccountId) break;
            if (attemptedImports.has(id)) continue;
            attemptedImports.add(id);
            const candidate = { ...story, cloudSourceStoryId: story.cloudSourceStoryId ||
                (story.repostedStoryId ? await legacyStoryId(owner, story.repostedStoryId) : null) };
            try {
                if (await publishCloudStory(candidate, story.createdAt, id)) imported.add(story.id);
            } catch { /* Keep the local Story when its assets or source are unavailable. */ }
        }
        if (owner !== state.signedInAccountId || !imported.size) return false;
        state.stories = state.stories.filter(story => !imported.has(story.id));
        await persistActiveStories().catch(() => {});
        return true;
    })().finally(() => { importingStories = null; });
    return importingStories;
}

export async function loadCloudStories() {
    const owner = state.signedInAccountId;
    if (!owner) return;
    let revision = ++feedRevision;
    const client = await getSupabaseClient();
    let result = await client.rpc('connected_story_feed_with_media');
    if (result.error?.code === 'PGRST202') result = await client.rpc('connected_story_feed');
    else if (!result.error && await importLocalStories() && owner === state.signedInAccountId) {
        revision = ++feedRevision;
        result = await client.rpc('connected_story_feed_with_media');
    }
    const { data, error } = result;
    if (error) throw error;
    if (owner !== state.signedInAccountId || revision !== feedRevision) return;
    const previous = new Map(state.stories.filter(story => story.cloudContentId).map(story => [story.id, story]));
    const fresh = await hydrateCloudStories(client, data.slice().reverse(), owner, previous);
    if (owner !== state.signedInAccountId || revision !== feedRevision) return;
    for (const story of fresh) previous.delete(story.id);
    for (const id of previous.keys()) {
        clearTimeout(state.storyExpiryTimers.get(id));
        state.storyExpiryTimers.delete(id);
    }
    state.stories = [...state.stories.filter(story => !story.cloudContentId), ...fresh];
    state.hasScheduledCloudStory = data.some(row => row.owner_id === owner && Date.parse(row.publish_at) > Date.now());
}

export async function hydrateCloudStories(client, data, owner, previous = new Map()) {
    if (owner !== state.signedInAccountId) return [];
    if (owner !== cacheOwner) {
        signedMedia.clear();
        cacheOwner = owner;
    }
    const now = Date.now();
    const assets = new Map();
    const track = (bucket, path) => { if (path) assets.set(bucket + ':' + path, { bucket, path }); };
    for (const row of data) {
        if (Date.parse(row.publish_at) > now) continue;
        track(row.media_bucket || 'app-media', row.object_path);
        track('app-media', row.audio_path);
        track('app-media', row.source_details?.audio_path);
    }
    for (const [key, entry] of signedMedia) {
        if (entry.expiresAt <= now) signedMedia.delete(key);
    }
    const [signed, avatars] = await Promise.all([
        Promise.all(['app-media', 'post-images'].map(async bucket => {
            const missing = [...assets].filter(([key, item]) => item.bucket === bucket && !signedMedia.has(key))
                .map(([,item]) => item.path);
            const result = missing.length ? await client.storage.from(bucket).createSignedUrls(missing, 300) : { data: [] };
            if (result.error) throw result.error;
            return result.data.map(item => ({ ...item, bucket }));
        })),
        avatarLookup(client, [...data, ...data.map(row => row.source_details).filter(Boolean)]),
    ]);
    if (owner !== state.signedInAccountId) return [];
    for (const item of signed.flat()) {
        if (item.signedUrl) signedMedia.set(item.bucket + ':' + item.path, { url: item.signedUrl, expiresAt: now + 240000 });
    }
    return data.flatMap(row => {
        const assetUrl = (bucket, path) => signedMedia.get(bucket + ':' + path)?.url;
        const media = assetUrl(row.media_bucket || 'app-media', row.object_path);
        if (!media) return [];
        const author = rememberCloudPerson({ ...row, id: row.owner_id }, avatars);
        const source = row.source_details;
        const original = source?.username && rememberCloudPerson({ ...source, id: source.owner_id }, avatars);
        const ownPath = `${row.owner_id}/${row.id}/story`;
        const metadata = row.metadata || {};
        const position = metadata.repostPosition;
        return [{
            ...previous.get(row.id),
            id: row.id, cloudContentId: row.id, cloudOwnerId: row.owner_id,
            objectPath: row.object_path === ownPath ? ownPath : null, audioPath: row.audio_path,
            handle: author.handle, user: author.name, avatar: author.avatar, mine: row.owner_id === owner,
            cloud: true, public: row.audience === 'public', audience: row.audience.replace('_', '-'),
            media, type: row.mime_type.startsWith('video/') ? 'video' : 'image', caption: row.caption,
            edits: restoreEdits(metadata.edits, metadata.music, assetUrl('app-media', row.audio_path)),
            sensitive: metadata.sensitive === true || source?.sensitive === true,
            ...(original ? {
                ...(source.kind === 'reel' ? {
                    cloudSourceReelId: source.id, repostedMediaType: 'reel', repostedMediaHash: '#reel-id-' + source.id,
                } : source.kind === 'post' ? {
                    cloudSourcePostOwner: source.owner_id, cloudSourcePostId: source.id,
                    repostedMediaType: 'post', repostedMediaHash: `#post-id-${source.owner_id}-${source.id}`,
                } : { repostedStoryId: source.id, cloudSourceStoryId: source.id }),
                repostedFromHandle: original.handle,
                repostedFromUser: original.name, repostedFromAvatar: original.avatar,
                repostSourceEdits: restoreEdits(metadata.repostSourceEdits, source.metadata?.music, assetUrl('app-media', source.audio_path)),
                repostPosition: Number.isFinite(position?.x) && Number.isFinite(position?.y) ? position : undefined,
                repostScale: Number.isFinite(metadata.repostScale) ? metadata.repostScale : undefined,
                repostRotation: Number.isFinite(metadata.repostRotation) ? metadata.repostRotation : undefined,
                repostFullCanvas: metadata.repostFullCanvas === true,
            } : {}),
            createdAt: Date.parse(row.publish_at), expiresAt: Date.parse(row.expires_at),
        }];
    });
}

export async function deleteCloudStory(story) {
    const client = await getSupabaseClient();
    const { error } = await client.from('media_content').delete().eq('id', story.cloudContentId)
        .eq('owner_id', state.signedInAccountId).eq('kind', 'story');
    if (error) throw error;
    ++feedRevision;
    const paths = [story.objectPath, story.audioPath].filter(Boolean);
    if (paths.length) await client.storage.from('app-media').remove(paths).catch(() => {});
}

export async function loadCloudStoryAudience() {
    const owner = state.signedInAccountId;
    const client = await getSupabaseClient();
    const [following, followers, friends] = await Promise.all([
        client.from('account_follows').select('person:profiles!account_follows_followed_id_fkey(id,username,display_name)')
            .eq('follower_id', owner).eq('status', 'accepted'),
        client.from('account_follows').select('person:profiles!account_follows_follower_id_fkey(id,username,display_name)')
            .eq('followed_id', owner).eq('status', 'accepted'),
        client.from('close_friends').select('friend_id,person:profiles!close_friends_friend_id_fkey(id,username,display_name)')
            .eq('owner_id', owner),
    ]);
    for (const result of [following, followers, friends]) if (result.error) throw result.error;
    const people = [...following.data, ...followers.data, ...friends.data].map(row => row.person).filter(Boolean);
    const selected = new Set(friends.data.map(row => row.friend_id));
    return [...new Map(people.map(person => [person.id, {
        id: person.id, handle: '@' + person.username, name: person.display_name, selected: selected.has(person.id),
    }])).values()].sort((left, right) => left.name.localeCompare(right.name));
}

export async function setCloudStoryFriend(id, selected) {
    const owner = state.signedInAccountId;
    const client = await getSupabaseClient();
    const table = client.from('close_friends');
    const { error } = await (selected
        ? table.upsert({ owner_id: owner, friend_id: id }, { ignoreDuplicates: true })
        : table.delete().eq('owner_id', owner).eq('friend_id', id));
    if (error) throw error;
}

export async function recordCloudStoryEngagement(story, action, enabled = true) {
    const client = await getSupabaseClient();
    const { error } = await client.rpc('record_story_engagement', {
        target: story.cloudContentId, action, enabled,
    });
    if (error) throw error;
}

export async function loadCloudStoryLiked(story) {
    const owner = state.signedInAccountId;
    const client = await getSupabaseClient();
    const { data, error } = await client.from('media_interactions').select('kind')
        .eq('content_id', story.cloudContentId).eq('user_id', owner).eq('kind', 'like').maybeSingle();
    if (error) throw error;
    return Boolean(data);
}

export async function loadCloudStoryViewCount(story) {
    const client = await getSupabaseClient();
    const { data, error } = await client.rpc('story_viewer_count', { target: story.cloudContentId });
    if (error) throw error;
    return Number(data);
}

export async function loadCloudStoryViewers(story, offset) {
    const client = await getSupabaseClient();
    const { data, error } = await client.rpc('story_viewers', { target: story.cloudContentId, page_offset: offset });
    if (error) throw error;
    const avatars = await avatarLookup(client, data);
    return data.map(row => ({
        ...rememberCloudPerson(row, avatars), liked: row.liked, viewedAt: Date.parse(row.viewed_at),
    }));
}

export async function loadCloudStorySettings() {
    const owner = state.signedInAccountId;
    const client = await getSupabaseClient();
    const { data, error } = await client.from('account_preferences').select('settings').eq('user_id', owner).maybeSingle();
    if (error) throw error;
    return {
        allowReplies: data?.settings?.story?.allowReplies !== false,
        saveToArchive: data?.settings?.story?.saveToArchive !== false,
    };
}

export async function saveCloudStorySettings(settings) {
    const client = await getSupabaseClient();
    const { error } = await client.rpc('set_story_settings', {
        allow_replies: settings.allowReplies, save_to_archive: settings.saveToArchive,
    });
    if (error) throw error;
}

export async function cloudStoryAllowsReplies(story) {
    const client = await getSupabaseClient();
    const { data, error } = await client.rpc('story_allows_replies', { target: story.cloudContentId });
    if (error) throw error;
    return data === true;
}

export async function sendCloudStoryReply(story, text) {
    const client = await getSupabaseClient();
    const { error } = await client.rpc('send_connected_story_reply', {
        target: story.cloudContentId, reply_text: text,
    });
    if (error) throw error;
}

export async function loadInboxStories() {
    const owner = state.signedInAccountId;
    if (!owner) return;
    const client = await getSupabaseClient();
    const { data, error } = await client.rpc('connected_inbox_story_feed');
    if (error) throw error;
    const stories = await hydrateCloudStories(client, data.slice().reverse(), owner);
    if (owner !== state.signedInAccountId) return;
    state.inboxStories = stories;
}
