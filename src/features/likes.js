import { likersBackdrop, likersList } from '../core/dom.js';
import { state } from '../core/state.js';
import { escapeHtml, formatCount } from '../core/utils.js';
import { findEntity } from '../data/entities.js';
import { currentUser, posts, reels } from '../data/sample-data.js';
import { mayInteract, canViewMedia } from '../core/social.js';

export function getSampleLikers(post) {
    const people = new Map();
    [currentUser, ...posts, ...reels].forEach((person) => {
        if (!people.has(person.handle)) {
            people.set(person.handle, {
                name: person.name || person.user,
                handle: person.handle,
                avatar: person.avatar
            });
        }
    });
    return (post.commentItems || [])
        .map((comment) => people.get(comment.handle) || {
        name: comment.user,
        handle: comment.handle,
        avatar: comment.avatar || currentUser.avatar
    })
        .filter((person, index, list) => list.findIndex((item) => item.handle === person.handle) === index);
}

export function openLikers(post, trigger) {
    state.activeLikersTrigger = trigger;
    state.activeLikersPostId = post.id;
    const entityType = trigger.dataset.entityType === "reel" ? "reel" : "post";
    document.getElementById("likers-dialog-title").textContent = `People who liked this ${entityType}`;
    const likers = getSampleLikers(post);
    likersList.innerHTML = `
    <p class="likers-total">${post.likes.toLocaleString()} likes</p>
    <p class="likers-sample-note">Representative demo accounts; complete liker data isn't available.</p>
    ${likers.length ? likers.map((person) => `
      <div class="liker-row">
        <img src="${escapeHtml(person.avatar)}" alt="" />
        <div><strong>${escapeHtml(person.name)}</strong><span>${escapeHtml(person.handle)}</span></div>
      </div>
    `).join("") : '<p class="likers-empty">No sample liker profiles are available for this post.</p>'}
  `;
    likersBackdrop.hidden = false;
    document.body.classList.add("likers-open");
    document.querySelector(".likers-close").focus();
}

export function closeLikers() {
    likersBackdrop.hidden = true;
    document.body.classList.remove("likers-open");
    if (state.activeLikersTrigger?.isConnected)
        state.activeLikersTrigger.focus();
    state.activeLikersTrigger = null;
    state.activeLikersPostId = null;
}

export function setEntityLiked(type, entity, isLiked) {
    if (!mayInteract() || !canViewMedia(entity)) return;
    entity.liked = isLiked;
    entity.likes = Math.max(0, entity.likes + (isLiked ? 1 : -1));
    document.querySelectorAll(`[data-action="like"][data-entity-type="${type}"][data-entity-id="${entity.id}"]`).forEach((button) => {
        button.classList.toggle("liked", entity.liked);
        button.setAttribute("aria-pressed", String(entity.liked));
        if (button.closest(".post-card")) {
            button.setAttribute("aria-label", `${entity.liked ? "Unlike" : "Like"} ${type}`);
            button.textContent = "♥";
        }
        else {
            button.innerHTML = `♥ ${formatCount(entity.likes)}`;
        }
    });
    document.querySelectorAll(`[data-action="show-likers"][data-entity-type="${type}"][data-entity-id="${entity.id}"]`).forEach((button) => {
        button.textContent = formatCount(entity.likes);
        button.setAttribute("aria-label", `Show ${entity.likes.toLocaleString()} people who liked this post`);
    });
    if (type === "post" && state.activeLikersPostId === entity.id) {
        likersList.querySelector(".likers-total").textContent = `${entity.likes.toLocaleString()} likes`;
    }
    document.querySelectorAll(`#explore-grid [data-id="${entity.id}"] [data-like-count], #profile-view [data-id="${entity.id}"] [data-like-count]`).forEach((count) => {
        count.textContent = `♥ ${formatCount(entity.likes)}`;
    });
}

export function doubleTapLike(media) {
    const type = media.dataset.likeableType;
    const entity = findEntity(type, Number(media.dataset.likeableId));
    if (!entity || !mayInteract() || !canViewMedia(entity))
        return;
    if (!entity.liked)
        setEntityLiked(type, entity, true);
    const heart = media.querySelector(".double-like-heart");
    heart.classList.remove("show");
    void heart.offsetWidth;
    heart.classList.add("show");
}
