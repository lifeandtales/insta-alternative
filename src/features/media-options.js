import { openReportPanel } from './home-controls.js';
import { state } from '../core/state.js';
import { changeFollow, isFollowing, mediaKey, mayInteract, canViewMedia } from '../core/social.js';
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
        if (!canManageProfileMedia(type, post, control))
            return;
        if (option === "edit")
            openMediaEditor(type, post);
        else
            openMediaDeleteConfirmation(type, post);
        return;
    }
    if (option === "download") {
        downloadPost(post);
    }
    else if (option === "copy-link") {
        copyPostLink(post);
    }
    else if (option === "report") {
        openReportPanel(post, type);
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

export function postUrl(post) {
    const url = new URL(window.location.href);
    url.hash = `${post.reel ? 'reel' : 'post'}-${post.id}`;
    return url.toString();
}

export async function copyPostLink(post) {
    if (navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(postUrl(post));
            showShareFeedback("Post link copied.");
        }
        catch {
            showShareFeedback("Couldn't copy the post link. Please try again.");
        }
        return;
    }
    showShareFeedback("Copying links isn't available in this browser.");
}
