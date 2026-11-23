import { deleteCloudComment, hasCloudComments, readCloudComments, setCloudCommentLike, writeCloudComment } from '../storage/cloud-comments.js';
import { showShareFeedback } from '../components/feedback.js';
import { isFollowing, mayInteract, canViewMedia } from '../core/social.js';
import { commentsBackdrop, commentsDialogForm, commentsDialogList } from '../core/dom.js';
import { state } from '../core/state.js';
import { escapeHtml, formatCount } from '../core/utils.js';
import { findEntity } from '../data/entities.js';
import { currentUser } from '../data/sample-data.js';

export function prioritizedComments(post) {
    return [...(post.commentPreviews ?? post.commentItems ?? [])].sort((a, b) => {
        const aPriority = Number(isFollowing(a.handle));
        const bPriority = Number(isFollowing(b.handle));
        return bPriority - aPriority || (b.createdAt || 0) - (a.createdAt || 0);
    });
}

const commentKey = (comment, index) => comment.id == null ? `index:${index}` : `id:${comment.id}`;
const commentTriggers = '[data-action="comments"], [data-action="comment-preview"]';

function mayReplyToComments(entity) {
    const ownsMedia = hasCloudComments(entity)
        ? entity.cloudOwnerId === state.signedInAccountId && entity.cloudCommentRepliesAvailable === true
        : entity.handle === currentUser.handle;
    return ownsMedia && mayInteract() && canViewMedia(entity);
}

function renderCommentLike(comment, index, replyIndex = null) {
    const likeCount = Number(comment.likes) || 0;
    return `<button class="comment-like-button ${comment.liked ? 'liked' : ''}" type="button"
        data-action="like-comment" data-comment-index="${index}" ${replyIndex === null ? '' : `data-reply-index="${replyIndex}"`}
        aria-pressed="${Boolean(comment.liked)}" aria-label="${comment.liked ? 'Unlike' : 'Like'} ${replyIndex === null ? 'comment' : 'reply'} by ${escapeHtml(comment.handle)}">
        <span aria-hidden="true">${comment.liked ? '♥' : '♡'}</span>
        <span class="comment-like-count">${likeCount || ''}</span>
      </button>`;
}

function renderComment(comment, interactive, commentIndex, canDelete, canReply) {
    return `
    <article class="post-comment" data-comment-target="${escapeHtml(commentKey(comment, commentIndex))}" tabindex="-1">
      <img class="comment-avatar" src="${escapeHtml(comment.avatar || currentUser.avatar)}" alt="" />
      <div class="comment-content">
        <p><strong>${escapeHtml(comment.handle)}</strong> ${escapeHtml(comment.text)}</p>
        <div class="comment-meta">
          <span class="comment-age">Just now</span>
          ${comment.cloudAuthorId ? `<button type="button" class="comment-reply-button" data-comment-report="${commentIndex}">Report</button>` : ''}
          ${canReply ? `<button type="button" class="comment-reply-button" data-comment-reply="${escapeHtml(commentKey(comment, commentIndex))}">Reply</button>` : ''}
        </div>
      </div>
      ${canDelete ? `<button type="button" class="comment-like-button" data-delete-cloud-comment="${escapeHtml(comment.id)}" aria-label="Delete comment">×</button>` : ''}
      ${interactive ? renderCommentLike(comment, commentIndex) : ''}
    </article>
  `;
}

function commentListLabel(count, compact) {
    return compact && count > 0
        ? `View all ${count.toLocaleString()} comments`
        : `View comments (${count})`;
}

export function renderCommentSection(post, previewLimit = 2) {
    const comments = prioritizedComments(post);
    const entityType = post.reel ? "reel" : "post";
    return `
    <div class="post-comments-preview">
      ${comments.slice(0, previewLimit).map(comment => `
        <button class="post-comment post-comment-preview" type="button" data-action="comment-preview"
          data-entity-type="${entityType}" data-entity-id="${post.id}"
          data-comment-target="${escapeHtml(commentKey(comment, post.commentItems.indexOf(comment)))}"
          aria-haspopup="dialog" aria-expanded="false">
          <img class="comment-avatar" src="${escapeHtml(comment.avatar || currentUser.avatar)}" alt="" />
          <span class="comment-content"><strong>${escapeHtml(comment.handle)}</strong> ${escapeHtml(comment.text)}</span>
        </button>`).join("")}
      <button class="view-comments-btn" type="button" data-action="comments" data-entity-type="${entityType}" data-entity-id="${post.id}" aria-label="View ${post.comments} comments" aria-expanded="false">
        ${commentListLabel(post.comments, previewLimit === 0)}
      </button>
    </div>
  `;
}

export function renderCommentsDialog(entity) {
    const wasFocused = commentsDialogList.contains?.(document.activeElement);
    const allowReply = mayReplyToComments(entity);
    const items = entity.commentItems || [];
    commentsDialogList.innerHTML = [...items].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).map(comment => {
        const canDelete = Boolean(comment.cloudAuthorId && ((!entity.reel && entity.mine) || comment.cloudAuthorId === state.signedInAccountId));
        const index = items.indexOf(comment);
        const interactive = !hasCloudComments(entity) || entity.cloudCommentRepliesAvailable === true;
        const replies = (comment.replies || []).map((reply, replyIndex) => `
            <div class="comment-reply">
              <img class="comment-avatar" src="${escapeHtml(reply.avatar || currentUser.avatar)}" alt="" />
              <p><strong>${escapeHtml(reply.handle)}</strong> ${escapeHtml(reply.text)}</p>
              ${reply.cloudAuthorId ? `<button type="button" class="comment-reply-button" data-comment-report="${index}" data-report-reply-index="${replyIndex}">Report reply</button>` : ''}
              ${interactive ? renderCommentLike(reply, index, replyIndex) : ''}
            </div>`).join('');
        return `<div class="comment-thread">${renderComment(comment, interactive, index, canDelete, allowReply)}
            ${replies ? `<div class="comment-replies" aria-label="Replies">${replies}</div>` : ''}</div>`;
    }).join("");
    if (wasFocused) commentsDialogList.focus({ preventScroll: true });
}

function clearReply(selection, restoreDraft = false) {
    const context = commentsDialogForm.querySelector('.comment-reply-context');
    if (restoreDraft && selection?.replyTo) commentsDialogForm.elements.comment.value = selection.commentDraft || '';
    if (selection) {
        selection.replyTo = null;
        selection.commentDraft = '';
    }
    context.hidden = true;
    context.querySelector('span').textContent = '';
}

function findComment(entity, key) {
    return (entity.commentItems || []).find((comment, index) => commentKey(comment, index) === key);
}

export function startCommentReply(key) {
    const selection = state.activeCommentEntity;
    if (!selection) return;
    const entity = findEntity(selection.type, selection.id);
    if (!entity || !mayReplyToComments(entity)) return;
    const comment = findComment(entity, key);
    if (!comment) return;
    const input = commentsDialogForm.elements.comment;
    if (selection.replyTo !== key) {
        if (!selection.replyTo) selection.commentDraft = input.value;
        selection.replyTo = key;
        input.value = '';
    }
    const context = commentsDialogForm.querySelector('.comment-reply-context');
    context.querySelector('span').textContent = `Replying to ${comment.handle}`;
    context.hidden = false;
    input.focus({ preventScroll: true });
}

export function cancelCommentReply() {
    clearReply(state.activeCommentEntity, true);
    commentsDialogForm.elements.comment.focus({ preventScroll: true });
}

function jumpToComment(target) {
    if (!target) return false;
    const row = Array.from(commentsDialogList.querySelectorAll('[data-comment-target]'))
        .find(comment => comment.dataset.commentTarget === target);
    if (!row) return false;
    row.classList.add('comment-jump-target');
    row.focus({ preventScroll: true });
    const listBounds = commentsDialogList.getBoundingClientRect();
    const rowBounds = row.getBoundingClientRect();
    commentsDialogList.scrollTop += rowBounds.top - listBounds.top - (listBounds.height - rowBounds.height) / 2;
    return true;
}

export function refreshEntityComments(type, entity) {
    const active = state.activeCommentEntity?.type === type && state.activeCommentEntity?.id === entity.id;
    document.querySelectorAll(`.post-card[data-entity-type="${type}"][data-id="${entity.id}"] .post-comments-preview`).forEach(preview => {
        preview.outerHTML = renderCommentSection(entity, preview.closest('#feed') ? 0 : 2);
    });
    const buttons = document.querySelectorAll(`[data-action="comments"][data-entity-type="${type}"][data-entity-id="${entity.id}"]`);
    if (active && !state.activeCommentsTrigger?.isConnected && state.activeCommentEntity.target) {
        const previews = document.querySelectorAll(`[data-action="comment-preview"][data-entity-type="${type}"][data-entity-id="${entity.id}"]`);
        const preview = Array.from(previews).find(button => button.dataset.commentTarget === state.activeCommentEntity.target);
        if (preview) {
            preview.setAttribute('aria-expanded', 'true');
            state.activeCommentsTrigger = preview;
        }
    }
    buttons.forEach(button => {
        const count = button.querySelector('.post-comment-count');
        if (button.matches('.view-comments-btn')) button.textContent = commentListLabel(entity.comments, Boolean(button.closest('#feed')));
        else if (count) count.textContent = formatCount(entity.comments);
        else button.textContent = `💬 ${entity.comments}`;
        button.setAttribute('aria-label', `View ${entity.comments} comments`);
        button.setAttribute('aria-expanded', String(active));
        if (active && !state.activeCommentsTrigger?.isConnected) state.activeCommentsTrigger = button;
    });
    if (active) renderCommentsDialog(entity);
}

export function openComments(type, entity, trigger, target = null) {
    clearReply(state.activeCommentEntity, true);
    const selection = { type, id: entity.id, target };
    state.activeCommentEntity = selection;
    state.activeCommentsTrigger = trigger;
    commentsDialogList.dataset.entityId = String(entity.id);
    commentsDialogList.dataset.entityType = type;
    renderCommentsDialog(entity);
    commentsBackdrop.hidden = false;
    document.body.classList.add("comments-open");
    document.querySelectorAll(commentTriggers).forEach((button) => button.setAttribute("aria-expanded", "false"));
    trigger.setAttribute("aria-expanded", "true");
    commentsBackdrop.querySelector(".comments-close").focus({ preventScroll: true });
    commentsDialogList.scrollTop = 0;
    jumpToComment(target);
    if (hasCloudComments(entity)) {
        void refreshCloudComments(type, entity, selection).catch(() => showShareFeedback('Could not load comments.'));
    }
}

export function closeComments() {
    commentsBackdrop.hidden = true;
    document.body.classList.remove("comments-open");
    document.querySelectorAll(commentTriggers).forEach((button) => button.setAttribute("aria-expanded", "false"));
    clearReply(state.activeCommentEntity, true);
    state.activeCommentEntity = null;
    if (state.activeCommentsTrigger?.isConnected)
        state.activeCommentsTrigger.focus({ preventScroll: true });
    state.activeCommentsTrigger = null;
}

const pendingLikes = new Set();

export async function toggleCommentLike(index, replyIndex) {
    const selection = state.activeCommentEntity;
    const entity = selection && findEntity(selection.type, selection.id);
    const parent = entity?.commentItems?.[index];
    const comment = replyIndex === undefined ? parent : parent?.replies?.[replyIndex];
    if (!comment || !mayInteract() || !canViewMedia(entity)) return;
    if (!hasCloudComments(entity)) {
        comment.liked = !comment.liked;
        comment.likes = Math.max(0, (Number(comment.likes) || 0) + (comment.liked ? 1 : -1));
        renderCommentsDialog(entity);
        return;
    }
    if (!entity.cloudCommentRepliesAvailable) return;
    const key = `${state.signedInAccountId}:${selection.type}:${entity.id}:${comment.id}`;
    if (pendingLikes.has(key)) return;
    pendingLikes.add(key);
    try {
        const liked = !comment.liked;
        await setCloudCommentLike(entity, comment, replyIndex !== undefined, liked);
        comment.liked = liked;
        comment.likes = Math.max(0, (Number(comment.likes) || 0) + (liked ? 1 : -1));
        if (state.activeCommentEntity === selection) renderCommentsDialog(entity);
        await refreshCloudComments(selection.type, entity).catch(() => {});
    } catch {
        showShareFeedback('Could not update the like. Try again.');
    } finally {
        pendingLikes.delete(key);
    }
}

const commentLoads = new WeakMap();
const pendingComments = new WeakMap();

async function refreshCloudComments(type, entity, selection) {
    const accountId = state.signedInAccountId;
    const revision = (commentLoads.get(entity) || 0) + 1;
    commentLoads.set(entity, revision);
    const target = selection?.target;
    const result = await readCloudComments(entity, target?.startsWith('id:') ? target.slice(3) : null);
    if (state.signedInAccountId !== accountId || commentLoads.get(entity) !== revision) return;
    const current = findEntity(type, entity.id);
    if (!current) return;
    current.commentItems = result.items;
    current.commentPreviews = undefined;
    current.comments = result.count;
    current.cloudCommentRepliesAvailable = result.supportsReplies;
    refreshEntityComments(type, current);
    if (selection && state.activeCommentEntity === selection) jumpToComment(target);
}

export function refreshOpenCloudComments() {
    const active = state.activeCommentEntity;
    const entity = active && findEntity(active.type, active.id);
    return entity && hasCloudComments(entity) ? refreshCloudComments(active.type, entity) : Promise.resolve();
}

export async function removeCloudComment(type, entity, id) {
    await deleteCloudComment(entity, id);
    await refreshCloudComments(type, entity);
}

async function submitCloudComment(form, input, type, entity, text, selection, parent) {
    const prior = pendingComments.get(form);
    if (prior?.sending) return;
    const parentId = parent?.id ?? null;
    const id = prior?.text === text && prior?.entity === entity && prior?.parentId === parentId
        ? prior.id : crypto.randomUUID();
    const draft = { text, id, entity, parentId, sending: true };
    const replyTo = selection?.replyTo;
    pendingComments.set(form, draft);
    try {
        await writeCloudComment(entity, text, id, parentId);
        pendingComments.delete(form);
        if ((!selection || (state.activeCommentEntity === selection && selection.replyTo === replyTo))
            && input.value.trim() === text) {
            if (parent) clearReply(selection, true);
            else input.value = '';
        }
        await refreshCloudComments(type, entity).catch(() => showShareFeedback('Saved. Reopen comments to refresh.'));
    } catch {
        draft.sending = false;
        showShareFeedback(parent ? 'Could not send the reply. Try again.' : 'Could not save the comment. Try again.');
    }
}

export function handleCommentSubmit(event) {
    const form = event.target.closest(".comment-form");
    if (!form) return;
    event.preventDefault();
    const postElement = form.closest("[data-id]");
    const selection = postElement ? null : state.activeCommentEntity;
    const entityType = postElement ? postElement.dataset.entityType || "post" : selection?.type;
    const entityId = postElement ? Number(postElement.dataset.id) : selection?.id;
    const entity = entityType && entityId !== undefined ? findEntity(entityType, entityId) : undefined;
    const input = form.elements.comment;
    const text = input.value.trim();
    if (!entity || !text || !mayInteract() || !canViewMedia(entity)) return;
    const parent = selection?.replyTo ? findComment(entity, selection.replyTo) : null;
    if (selection?.replyTo && (!parent || !mayReplyToComments(entity) || (hasCloudComments(entity) && !parent.id))) {
        showShareFeedback('This comment is unavailable for replies.');
        return;
    }
    if (hasCloudComments(entity)) {
        void submitCloudComment(form, input, entityType, entity, text, selection, parent);
        return;
    }
    const comment = {
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
    };
    if (parent) {
        (parent.replies ||= []).push(comment);
        clearReply(selection, true);
    } else {
        (entity.commentItems ||= []).push(comment);
        entity.comments = (Number(entity.comments) || 0) + 1;
        form.reset();
    }
    refreshEntityComments(entityType, entity);
}
