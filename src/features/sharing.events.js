import { showShareFeedback } from '../components/feedback.js';
import { shareBackdrop, shareSendButton } from '../core/dom.js';
import { state } from '../core/state.js';
import { findEntity } from '../data/entities.js';
import { sendSharedPost, closeShareDialog, openShareDialog } from './sharing.js';

export function handleSharingClick(event) {
    const shareButton = event.target.closest('[data-action="share-post"]');
    if (shareButton) {
        const type = shareButton.dataset.entityType || "post";
        const entity = findEntity(type, Number(shareButton.dataset.entityId));
        if (entity)
            openShareDialog(entity, type);
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
        const names = state.activeShareConnections.filter((friend) => state.selectedShareRecipients.has(friend.handle))
            .map((friend) => friend.user);
        if (state.activeShareHighlight && names.length) {
            showShareFeedback('Highlight sharing is a preview only. No chat message was added.');
        }
        else if (state.activeSharePost && names.length) {
            const sent = sendSharedPost();
            showShareFeedback(`${sent} chat preview${sent === 1 ? "" : "s"} added on this device.`);
        }
        closeShareDialog();
    }
    return false;
}
