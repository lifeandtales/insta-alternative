import { showShareFeedback } from '../components/feedback.js';
import {
    commentsBackdrop,
    commentsDialogForm,
    exploreCommunityView,
    feed,
    likersBackdrop,
    profilePostViewerContent,
} from '../core/dom.js';
import { state } from '../core/state.js';
import { findEntity } from '../data/entities.js';
import { cancelCommentReply, closeComments, handleCommentSubmit, openComments, removeCloudComment, startCommentReply, toggleCommentLike } from './comments.js';
import { closeLikers } from './likes.js';
import { canViewMedia } from '../core/social.js';

export function handleCommentClick(event) {
    const reply = event.target.closest('[data-comment-reply]');
    if (reply) { startCommentReply(reply.dataset.commentReply); return true; }
    if (event.target.closest('[data-cancel-comment-reply]')) { cancelCommentReply(); return true; }
    const remove = event.target.closest('[data-delete-cloud-comment]');
    if (remove) {
        const active = state.activeCommentEntity;
        const entity = active && findEntity(active.type, active.id);
        if (entity && !remove.disabled) {
            remove.disabled = true;
            void removeCloudComment(active.type, entity, remove.dataset.deleteCloudComment)
                .catch(() => showShareFeedback('Could not delete this comment.'))
                .finally(() => { remove.disabled = false; });
        }
        return true;
    }
    const commentsButton = event.target.closest('[data-action="comment-preview"]') ||
        event.target.closest('[data-action="comments"]');
    if (commentsButton) {
        const type = commentsButton.dataset.entityType;
        const entity = findEntity(type, Number(commentsButton.dataset.entityId));
        if (entity && canViewMedia(entity))
            openComments(type, entity, commentsButton, commentsButton.dataset.commentTarget);
        return true;
    }
    const commentLikeButton = event.target.closest('[data-action="like-comment"]');
    if (commentLikeButton) {
        const { commentIndex, replyIndex } = commentLikeButton.dataset;
        void toggleCommentLike(Number(commentIndex), replyIndex === undefined ? undefined : Number(replyIndex));
        return true;
    }
    return false;
}

export function registerCommentEvents() {
    feed.addEventListener("submit", (event) => {
        handleCommentSubmit(event);
    });
    document.getElementById("explore-grid").addEventListener("submit", handleCommentSubmit);
    exploreCommunityView.addEventListener("submit", handleCommentSubmit);
    document.getElementById("profile-view").addEventListener("submit", handleCommentSubmit);
    profilePostViewerContent.addEventListener("submit", handleCommentSubmit);
    commentsBackdrop.addEventListener("click", (event) => {
        if (event.target === commentsBackdrop || event.target.closest(".comments-close"))
            closeComments();
    });
    commentsBackdrop.addEventListener("keydown", (event) => {
        if (event.key !== "Tab") return;
        const controls = Array.from(commentsBackdrop.querySelectorAll(':is(button, input):not(:disabled), [tabindex="0"]'));
        const visible = controls.filter(control => !control.closest('[hidden]'));
        const first = visible[0];
        const last = visible.at(-1);
        if (event.target !== (event.shiftKey ? first : last)) return;
        event.preventDefault();
        (event.shiftKey ? last : first).focus({ preventScroll: true });
    });
    likersBackdrop.addEventListener("click", (event) => {
        if (event.target === likersBackdrop || event.target.closest(".likers-close"))
            closeLikers();
    });
}

export function registerCommentComposerEvents() {
    commentsDialogForm.addEventListener("submit", handleCommentSubmit);
}
