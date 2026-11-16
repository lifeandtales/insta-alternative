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
import { closeComments, handleCommentSubmit, openComments, removeCloudComment, renderCommentsDialog } from './comments.js';
import { closeLikers } from './likes.js';
import { mayInteract, canViewMedia } from '../core/social.js';

export function handleCommentClick(event) {
    const remove = event.target.closest('[data-delete-cloud-comment]');
    if (remove) {
        const active = state.activeCommentEntity;
        const post = active?.type === 'post' ? findEntity('post', active.id) : null;
        if (post?.cloudClientId && !remove.disabled) {
            remove.disabled = true;
            void removeCloudComment(post, remove.dataset.deleteCloudComment)
                .catch(() => showShareFeedback('Could not delete this comment.'))
                .finally(() => { remove.disabled = false; });
        }
        return true;
    }
    const commentsButton = event.target.closest('[data-action="comments"]');
    if (commentsButton) {
        const type = commentsButton.dataset.entityType;
        const entity = findEntity(type, Number(commentsButton.dataset.entityId));
        if (entity && canViewMedia(entity))
            openComments(type, entity, commentsButton);
        return true;
    }
    const commentLikeButton = event.target.closest('[data-action="like-comment"]');
    if (commentLikeButton && state.activeCommentEntity) {
        const entity = findEntity(state.activeCommentEntity.type, state.activeCommentEntity.id);
        const comment = entity?.commentItems?.[Number(commentLikeButton.dataset.commentIndex)];
        if (!comment || !mayInteract() || !canViewMedia(entity))
            return true;
        comment.liked = !comment.liked;
        comment.likes = Math.max(0, (Number(comment.likes) || 0) + (comment.liked ? 1 : -1));
        renderCommentsDialog(entity);
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
    likersBackdrop.addEventListener("click", (event) => {
        if (event.target === likersBackdrop || event.target.closest(".likers-close"))
            closeLikers();
    });
}

export function registerCommentComposerEvents() {
    commentsDialogForm.addEventListener("submit", handleCommentSubmit);
}
