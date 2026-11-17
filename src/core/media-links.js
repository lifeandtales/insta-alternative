import { setView } from './navigation.js';
import { getAccount } from './social.js';
import { profileReferenceFromHash, resolveProfileReference } from './profile-links.js';
import { state } from './state.js';
import { canViewMedia, canViewStory } from './social.js';
import { findEntity } from '../data/entities.js';
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
