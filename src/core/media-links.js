import { setView } from './navigation.js';
import { getAccount } from './social.js';
import { profileReferenceFromHash, resolveProfileReference } from './profile-links.js';
import { state } from './state.js';
import { canViewMedia, canViewStory } from './social.js';
import { findEntity } from '../data/entities.js';
import { getSupabaseClient } from '../storage/supabase.js';
import { cloudImageAuthorProjection, hydrateCloudImagePosts } from '../storage/image-posts.js';
import { cloudReelProjection, hydrateCloudReels } from '../storage/cloud-reels.js';
import { posts, reels } from '../data/sample-data.js';
import { openProfileMedia } from '../features/profile.js';
import { openStoryGroup, showStoryAtIndex } from '../features/stories.js';
import { showShareFeedback } from '../components/feedback.js';

export function openMediaFromHash(hash = window.location.hash) {
    if (state.deletionRequestedAt || !document.getElementById('welcome-screen').hidden) return false;
    if (hash?.startsWith('#profile-')) {
        const reference = profileReferenceFromHash(hash);
        if (!reference) return false;
        const openProfile = handle => {
            state.profileHandle = handle;
            state.activeProfileSection = 'posts';
            setView('profile');
        };
        if (state.signedInAccountId) {
            const owner = state.signedInAccountId;
            const currentHash = window.location.hash;
            void resolveProfileReference(reference).then(handle => {
                if (state.signedInAccountId !== owner || currentHash !== window.location.hash) return;
                if (handle) openProfile(handle);
                else showShareFeedback('This profile is unavailable.');
            }).catch(() => showShareFeedback('Could not load the profile. Check your connection.'));
            return true;
        }
        if (!getAccount(reference.handle)) { showShareFeedback('This profile is unavailable.'); return false; }
        openProfile(reference.handle);
        return true;
    }
    const storyMatch = /^#story-(.+)$/.exec(hash);
    if (storyMatch) {
        let storyId;
        try { storyId = decodeURIComponent(storyMatch[1]); }
        catch { return false; }
        const story = state.stories.find(item => item.id === storyId);
        if (!story || !canViewStory(story) || (story.expiresAt && story.expiresAt <= Date.now())) {
            showShareFeedback('This story is unavailable or you do not have access.');
            return false;
        }
        openStoryGroup(story.handle, { allowUnfollowed: true });
        const storyIndex = state.activeStorySequence.findIndex(item => item.id === storyId);
        if (storyIndex >= 0) showStoryAtIndex(storyIndex);
        return storyIndex >= 0;
    }
    const address = /^#reel-id-([0-9a-f-]{36})$/i.exec(hash) || /^#post-id-([0-9a-f-]{36})-(\d+)$/i.exec(hash);
    if (address && state.signedInAccountId) {
        const owner = state.signedInAccountId;
        const previous = window.location.hash;
        const type = address[2] ? 'post' : 'reel';
        void readLinkedMedia(type, address[1], address[2], owner).then(entity => {
            if (owner !== state.signedInAccountId || window.location.hash !== previous) return;
            if (entity && canViewMedia(entity)) openProfileMedia(type, entity.id, null, { singleItem: true });
            else showShareFeedback('This item is unavailable or you do not have access.');
        }).catch(() => showShareFeedback('Could not load the shared item.'));
        return true;
    }
    const match = /^#(post|reel)-(\d+)$/.exec(hash);
    if (!match) return false;
    let type = match[1];
    const id = Number(match[2]);
    let entity = findEntity(type, id);
    // Older copied Reel links used the post prefix.
    if (!entity && type === 'post') { type = 'reel'; entity = findEntity(type, id); }
    if (!entity || !canViewMedia(entity)) {
        showShareFeedback('This item is unavailable or you do not have access. Local uploads are only available on the device where they were created.');
        return false;
    }
    openProfileMedia(type, id, null, { singleItem: true });
    return true;
}

async function readLinkedMedia(type, id, clientId, owner) {
    const client = await getSupabaseClient();
    const request = type === 'reel'
        ? client.from('media_content').select(cloudReelProjection).eq('id', id).eq('kind', 'reel')
        : client.from('image_posts').select('*, ' + cloudImageAuthorProjection + ', cloud_comments:image_post_comments(count), cloud_likes:image_post_likes(count), viewer_like:image_post_likes(user_id)')
            .eq('owner_id', id).eq('client_id', clientId).eq('viewer_like.user_id', owner);
    const { data, error } = await request.maybeSingle();
    if (error) throw error;
    if (!data || owner !== state.signedInAccountId) return null;
    const hydrate = type === 'reel' ? hydrateCloudReels : hydrateCloudImagePosts;
    const [result] = await hydrate(client, [data], owner);
    if (!result || owner !== state.signedInAccountId) return null;
    const collection = type === 'reel' ? reels : posts;
    const index = collection.findIndex(item => item.id === result.id);
    if (index === -1) collection.push(result);
    else collection[index] = result;
    return result;
}

export function mediaHash(entity, type = entity.reel ? 'reel' : 'post') {
    if (type === 'reel' && entity.cloudContentId) return '#reel-id-' + entity.cloudContentId;
    if (type === 'post' && entity.cloudOwnerId && entity.cloudClientId) return `#post-id-${entity.cloudOwnerId}-${entity.cloudClientId}`;
    return `#${type}-${entity.id}`;
}

const sharedMediaBase = 'https://lifeandtales.github.io/insta-alternative/';

export function mediaUrl(entity, type) {
    const hash = mediaHash(entity, type);
    const url = new URL(hash.includes('-id-') ? sharedMediaBase : window.location.href);
    url.hash = hash;
    return url.toString();
}

export function sharedMediaReference(text) {
    if (!text?.startsWith(sharedMediaBase)) return null;
    const hash = text.slice(sharedMediaBase.length);
    if (/^#reel-id-[0-9a-f-]{36}$/i.test(hash)) return { type: 'reel', hash };
    if (/^#post-id-[0-9a-f-]{36}-\d+$/i.test(hash)) return { type: 'post', hash };
    return null;
}

export function storyUrl(story) {
    const url = new URL(window.location.href);
    url.hash = `story-${encodeURIComponent(story.id)}`;
    return url.toString();
}

export async function copyStoryLink(story) {
    if (!story || !navigator.clipboard?.writeText) {
        showShareFeedback("Copying story links isn't available in this browser.");
        return false;
    }
    try {
        await navigator.clipboard.writeText(storyUrl(story));
        showShareFeedback('Story link copied. It opens this local story in the preview.');
        return true;
    } catch {
        showShareFeedback("Couldn't copy the story link. Please try again.");
        return false;
    }
}
