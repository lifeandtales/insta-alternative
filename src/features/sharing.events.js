import { showShareFeedback } from '../components/feedback.js';
import { shareBackdrop, shareSendButton } from '../core/dom.js';
import { state } from '../core/state.js';
import { findEntity } from '../data/entities.js';
import { copyPostLink, handlePostOption } from './media-options.js';
import { shareOutsideApp } from './media-sharing-actions.js';
import { canViewMedia, mayInteract, mediaNeedsWarning } from '../core/social.js';
import { loadNextShareRecipients, sendCloudSharedMedia, sendSharedPost, closeShareDialog, openShareDialog } from './sharing.js';

export function handleSharingClick(event) {
    const shareButton = event.target.closest('[data-action="share-post"]');
    if (shareButton) {
        const type = shareButton.dataset.entityType || "post";
        const entity = findEntity(type, Number(shareButton.dataset.entityId));
        if (entity)
            openShareDialog(entity, type);
        return true;
    }
    if (event.target.closest('[data-share-load-more]')) {
        loadNextShareRecipients();
        return true;
    }
    const shortcut = event.target.closest('[data-share-shortcut]');
    if (shortcut) {
        const entity = state.activeSharePost, type = state.activeShareType;
        if (!mayInteract() || !canViewMedia(entity)) return true;
        if (shortcut.dataset.shareShortcut === 'copy-link') void copyPostLink(entity, type);
        if (shortcut.dataset.shareShortcut === 'share') void shareOutsideApp(entity, type);
        if (shortcut.dataset.shareShortcut === 'add-to-story') {
            if (!mediaNeedsWarning(entity) || state.revealedMediaKeys.has(`${type}:${entity.id}`)) closeShareDialog();
            handlePostOption('add-to-story', entity, type, shortcut);
        }
        return true;
    }
    const shareFriend = event.target.closest("[data-share-handle]");
    if (shareFriend) {
        const handle = shareFriend.dataset.shareHandle;
        if (state.selectedShareRecipients.has(handle))
            state.selectedShareRecipients.delete(handle);
        else
            state.selectedShareRecipients.add(handle);
        shareFriend.classList.toggle("selected", state.selectedShareRecipients.has(handle));
        shareFriend.setAttribute("aria-pressed", String(state.selectedShareRecipients.has(handle)));
        shareSendButton.disabled = state.selectedShareRecipients.size === 0;
        return true;
    }
    if (event.target.closest(".share-close") || event.target === shareBackdrop) {
        closeShareDialog();
        return true;
    }
    if (event.target.closest(".share-send-button")) {
        const selected = state.activeShareConnections.filter(friend => state.selectedShareRecipients.has(friend.handle));
        const entity = state.activeSharePost, type = state.activeShareType;
        const owner = state.signedInAccountId;
        if (owner && entity && selected.some(person => person.id) && (entity.cloudClientId || entity.cloudContentId)) {
            if (shareSendButton.disabled) return true;
            shareSendButton.disabled = true;
            for (const button of shareBackdrop.querySelectorAll('[data-share-handle]')) button.disabled = true;
            void sendCloudSharedMedia(entity, type, selected).then(sent => {
                if (shareBackdrop.hidden || owner !== state.signedInAccountId || state.activeSharePost !== entity) return;
                sent.forEach(handle => state.selectedShareRecipients.delete(handle));
                for (const button of shareBackdrop.querySelectorAll('[data-share-handle]')) {
                    const chosen = state.selectedShareRecipients.has(button.dataset.shareHandle);
                    button.disabled = false;
                    button.classList.toggle('selected', chosen);
                    button.setAttribute('aria-pressed', String(chosen));
                }
                shareSendButton.disabled = !state.selectedShareRecipients.size;
                if (sent.length === selected.length) closeShareDialog();
                showShareFeedback(sent.length === selected.length ? 'Sent to ' + sent.length + (sent.length === 1 ? ' friend.' : ' friends.')
                    : 'Some friends could not receive this item. Try again.');
            });
            return true;
        }
        const names = selected.map(friend => friend.user);
        if (state.activeShareHighlight && names.length) {
            showShareFeedback('Highlight sharing is a preview only. No chat message was added.');
        }
        else if (state.activeSharePost && names.length) {
            const sent = sendSharedPost();
            showShareFeedback(`${sent} ${state.activeShareType === 'story' ? 'story share' : 'chat preview'}${sent === 1 ? "" : "s"} added on this device.`);
        }
        closeShareDialog();
        return true;
    }
    return false;
}
