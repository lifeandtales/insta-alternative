import { openMediaStoryEditor } from './stories.events.js';
import { downloadSilentReel } from './media-sharing-actions.js';
import { saveReelInterest } from './reels.js';
import { mediaUrl } from '../core/media-links.js';
import { canRepost, setRepost } from '../storage/cloud-reposts.js';
import { feed } from '../core/dom.js';
import { currentUser } from '../data/sample-data.js';
import { openReportPanel } from './home-controls.js';
import { state } from '../core/state.js';
import { changeFollow, isFollowing, mediaKey, mayInteract, canViewMedia, mediaNeedsWarning } from '../core/social.js';
import { persistPreferences } from '../storage/preferences.js';
import { setView } from '../core/navigation.js';
import { showShareFeedback } from '../components/feedback.js';
import { canManageProfileMedia, openMediaDeleteConfirmation, openMediaEditor } from './profile.js';

export function handlePostOption(option, post, type, control) {
    if (!mayInteract() || !canViewMedia(post)) { showShareFeedback('This action is unavailable while account access is restricted.'); return; }
    if (['hide', 'mute-posts', 'mute-stories', 'unfollow'].includes(option)) {
        if (option === 'hide') state.hiddenPostKeys.add(mediaKey(type, post.id));
        if (option === 'mute-posts') state.mutedPostHandles.add(post.handle);
        if (option === 'mute-stories') state.mutedStoryHandles.add(post.handle);
        if (option === 'unfollow' && isFollowing(post.handle)) changeFollow(post.handle);
        persistPreferences();
        setView(state.currentView);
        showShareFeedback('Preference saved.');
        return;
    }
    if (option === "edit" || option === "delete") {
        const fromHome=option==='delete'&&state.currentView==='home'&&post.handle===currentUser.handle&&feed.contains(control);
        if (!fromHome&&!canManageProfileMedia(type, post, control))return;
        if (option === "edit")
            openMediaEditor(type, post);
        else
            openMediaDeleteConfirmation(type, post, { fromHome });
        return;
    }
    if (option === 'repost') {
        if (!canRepost(post) || control.disabled) return;
        control.disabled = true;
        const desired = control.dataset.reposted !== 'true';
        void setRepost(post, desired).then(() => {
            if (state.currentView === 'profile') setView('profile');
            showShareFeedback(desired ? 'Added to your profile’s Reposts.' : 'Repost removed.');
        }).catch(() => showShareFeedback('Could not update the repost. Check that you can still open the original.'))
            .finally(() => { control.disabled = false; });
        return;
    }
    if (option === 'interested' || option === 'not-interested') {
        if (saveReelInterest(post, option)) {
            control.parentElement.querySelectorAll('[aria-pressed]').forEach(button =>
                button.setAttribute('aria-pressed', String(button === control)));
            showShareFeedback('Preference saved.');
        } else showShareFeedback('Could not save your preference.');
        return;
    }
    if (option === 'report') { openReportPanel(post, type); return; }
    if (option === 'copy-link') { void copyPostLink(post, type); return; }
    if (mediaNeedsWarning(post) && !state.revealedMediaKeys.has(`${type}:${post.id}`)) {
        showShareFeedback('View the content before downloading or adding it to a Story.');
        return;
    }
    if (option === 'add-to-story') {
        if (!openMediaStoryEditor(post, type)) showShareFeedback('This item could not be added to a Story.');
        return;
    }
    if (option === 'download') {
        if (type === 'reel') void downloadSilentReel(post);
        else void downloadPost(post);
    }
}

export async function downloadPost(post) {
    const mediaUrl = post.reel ? post.video : post.mediaType === "video" ? post.videoUrl : post.media;
    try {
        const response = await fetch(mediaUrl);
        if (!response.ok)
            throw new Error(`Download request failed (${response.status}).`);
        const objectUrl = URL.createObjectURL(await response.blob());
        const link = document.createElement("a");
        const extension = post.reel ? "mp4" : post.mediaType === "video" ? "mp4" : "jpg";
        link.href = objectUrl;
        link.download = `${post.handle.replace(/^@/, "")}-${post.reel ? "reel" : "post"}-${post.id}.${extension}`;
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
        showShareFeedback("Post download started.");
    }
    catch (error) {
        showShareFeedback(`Couldn't download this post: ${error.message}`);
    }
}

export async function copyPostLink(post, type = post.reel ? 'reel' : 'post') {
    if (navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(mediaUrl(post, type));
            showShareFeedback(type === 'reel' ? 'Reel link copied.' : 'Post link copied.');
            return true;
        }
        catch {
            showShareFeedback("Couldn't copy the post link. Please try again.");
        }
        return false;
    }
    showShareFeedback("Copying links isn't available in this browser.");
    return false;
}
