import { deleteImageComment, readImageComments, writeImageComment } from '../storage/cloud-image-comments.js';
import { showShareFeedback } from '../components/feedback.js';
import { isFollowing, mayInteract, canViewMedia } from '../core/social.js';
import { commentsBackdrop, commentsDialogList } from '../core/dom.js';
import { state } from '../core/state.js';
import { escapeHtml } from '../core/utils.js';
import { findEntity } from '../data/entities.js';
import { currentUser } from '../data/sample-data.js';

export function prioritizedComments(post) {
    return [...(post.commentItems || [])].sort((a, b) => {
        const aPriority = Number(isFollowing(a.handle));
        const bPriority = Number(isFollowing(b.handle));
        return bPriority - aPriority || (b.createdAt || 0) - (a.createdAt || 0);
    });
}

export function renderComment(comment, interactive = false, commentIndex = -1, canDelete = false) {
    const likeCount = Number(comment.likes) || 0;
    return `
    <article class="post-comment">
      <img class="comment-avatar" src="${escapeHtml(comment.avatar || currentUser.avatar)}" alt="" />
      <div class="comment-content">
        <p><strong>${escapeHtml(comment.handle)}</strong> ${escapeHtml(comment.text)}</p>
        <span class="comment-age">Just now</span>
      </div>
      ${canDelete ? `<button type="button" class="comment-like-button" data-delete-cloud-comment="${escapeHtml(comment.id)}" aria-label="Delete comment">×</button>` : ''}
      ${interactive ? `
        <button class="comment-like-button ${comment.liked ? "liked" : ""}" type="button" data-action="like-comment" data-comment-index="${commentIndex}" aria-pressed="${Boolean(comment.liked)}" aria-label="${comment.liked ? "Unlike" : "Like"} comment by ${escapeHtml(comment.handle)}">
          <span aria-hidden="true">${comment.liked ? "♥" : "♡"}</span>
          <span class="comment-like-count">${likeCount || ""}</span>
        </button>
      ` : ""}
    </article>
  `;
}

export function renderCommentSection(post, previewLimit = 2) {
    const comments = prioritizedComments(post);
    const entityType = post.reel ? "reel" : "post";
    return `
    <div class="post-comments-preview">
      ${comments.slice(0, previewLimit).map((comment) => renderComment(comment)).join("")}
      <button class="view-comments-btn" type="button" data-action="comments" data-entity-type="${entityType}" data-entity-id="${post.id}" aria-label="View ${post.comments} comments" aria-expanded="false">
        View comments (${post.comments})
      </button>
    </div>
  `;
}

export function renderCommentsDialog(entity) {
    commentsDialogList.innerHTML = [...(entity.commentItems || [])].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).map((comment) => renderComment(comment, !comment.cloudAuthorId, entity.commentItems.indexOf(comment), Boolean(comment.cloudAuthorId && (entity.mine || comment.cloudAuthorId === state.signedInAccountId)))).join("");
}

export function refreshEntityComments(type, entity) {
    const active = state.activeCommentEntity?.type === type && state.activeCommentEntity?.id === entity.id;
    document.querySelectorAll(`.post-card[data-entity-type="${type}"][data-id="${entity.id}"] .post-comments-preview`).forEach(preview => {
        preview.outerHTML = renderCommentSection(entity);
    });
    document.querySelectorAll(`[data-action="comments"][data-entity-type="${type}"][data-entity-id="${entity.id}"]`).forEach(button => {
        button.textContent = button.matches('.view-comments-btn') ? `View comments (${entity.comments})` : `💬 ${entity.comments}`;
        button.setAttribute('aria-label', `View ${entity.comments} comments`);
        button.setAttribute('aria-expanded', String(active));
        if (active && !state.activeCommentsTrigger?.isConnected) state.activeCommentsTrigger = button;
    });
    if (active) renderCommentsDialog(entity);
}

export function openComments(type, entity, trigger) {
    state.activeCommentEntity = { type, id: entity.id };
    state.activeCommentsTrigger = trigger;
    commentsDialogList.dataset.entityId = String(entity.id);
    commentsDialogList.dataset.entityType = type;
    renderCommentsDialog(entity);
    commentsBackdrop.hidden = false;
    document.body.classList.add("comments-open");
    document.querySelectorAll('[data-action="comments"]').forEach((button) => button.setAttribute("aria-expanded", "false"));
    trigger.setAttribute("aria-expanded", "true");
    commentsBackdrop.querySelector(".comments-close").focus();
    if (entity.cloudClientId) void refreshCloudPostComments(entity).catch(() => showShareFeedback('Could not load comments.'));

}

export function closeComments() {
    commentsBackdrop.hidden = true;
    document.body.classList.remove("comments-open");
    document.querySelectorAll('[data-action="comments"]').forEach((button) => button.setAttribute("aria-expanded", "false"));
    state.activeCommentEntity = null;
    if (state.activeCommentsTrigger?.isConnected)
        state.activeCommentsTrigger.focus();
    state.activeCommentsTrigger = null;
}

const commentLoads = new WeakMap();
const pendingComments = new WeakMap();

async function refreshCloudPostComments(post) {
    const revision = (commentLoads.get(post) || 0) + 1;
    commentLoads.set(post, revision);
    const result = await readImageComments(post);
    if (commentLoads.get(post) !== revision) return;
    const current = findEntity('post', post.id);
    if (!current) return;
    current.commentItems = result.items;
    current.comments = result.count;
    refreshEntityComments('post', current);
}

export function refreshOpenCloudComments() {
    const active = state.activeCommentEntity;
    const post = active?.type === 'post' ? findEntity('post', active.id) : null;
    if (post?.cloudClientId) return refreshCloudPostComments(post);
    return Promise.resolve();
}

export async function removeCloudComment(post, id) {
    await deleteImageComment(id);
    await refreshCloudPostComments(post);
}

async function submitCloudComment(form, input, post, text) {
    const prior = pendingComments.get(form);
    if (prior?.sending) return;
    const draft = { text, id: prior?.text === text && prior?.postId === post.id ? prior.id : crypto.randomUUID(), postId: post.id, sending: true };
    pendingComments.set(form, draft);
    try {
        await writeImageComment(post, text, draft.id);
        pendingComments.delete(form);
        if (input.value.trim() === text) input.value = '';
        await refreshCloudPostComments(post).catch(() => showShareFeedback('Comment saved. Reopen comments to refresh.'));
    } catch {
        draft.sending = false;
        showShareFeedback('Could not save the comment. Try again.');
    }
}

export function handleCommentSubmit(event) {
    const form = event.target.closest(".comment-form");
    if (!form)
        return;
    event.preventDefault();
    const postElement = form.closest("[data-id]");
    const entityType = postElement ? postElement.dataset.entityType || "post" : state.activeCommentEntity?.type;
    const entityId = postElement ? Number(postElement.dataset.id) : state.activeCommentEntity?.id;
    const entity = entityType && entityId !== undefined ? findEntity(entityType, entityId) : undefined;
    const input = form.elements.comment;
    const text = input.value.trim();
    if (!entity || !text || !mayInteract() || !canViewMedia(entity))
        return;
    if (entity.cloudClientId) {
        void submitCloudComment(form, input, entity, text);
        return;
    }
    entity.commentItems = entity.commentItems || [];
    entity.commentItems.push({
        user: currentUser.name,
        handle: currentUser.handle,
        avatar: currentUser.avatar,
        text,
        id: `comment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: Date.now(),
        followsMe: true,
        following: true,
        likes: 0,
        liked: false
    });
    entity.comments = (Number(entity.comments) || 0) + 1;
    form.reset();
    refreshEntityComments(entityType, entity);
}
