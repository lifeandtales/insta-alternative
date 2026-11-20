import { showShareFeedback } from '../components/feedback.js';
import { readImagePostLikers, setImagePostLike } from '../storage/cloud-image-likes.js';
import { setCloudReelLike } from '../storage/video-engagement.js';
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
    likersBackdrop.hidden = false;
    if (post.cloudClientId) {
        likersList.innerHTML = '<p role="status">Loading likes…</p>';
        void refreshOpenImageLikers().catch(() => {
            if (state.activeLikersPostId === post.id) likersList.textContent = 'Could not load likes.';
        });
    } else {
        renderLikers(post.likes, getSampleLikers(post), true);
    }
    document.body.classList.add("likers-open");
    document.querySelector(".likers-close").focus();
}

function renderLikers(count, people, sample = false) {
    likersList.innerHTML = `
    <p class="likers-total">${count.toLocaleString()} likes</p>
    ${sample ? '<p class="likers-sample-note">Representative demo accounts; complete liker data isn’t available.</p>' : ''}
    ${people.length ? people.map(person => `
      <div class="liker-row">
        <img src="${escapeHtml(person.avatar)}" alt="" />
        <div><strong>${escapeHtml(person.name)}</strong><span>${escapeHtml(person.handle)}</span></div>
      </div>`).join('') : '<p class="likers-empty">No likes yet.</p>'}
    ${!sample && count > people.length ? '<p>Showing the latest 50 likes.</p>' : ''}`;
}

let likerRequest = 0;
export async function refreshOpenImageLikers() {
    const id = state.activeLikersPostId;
    const post = id == null ? null : findEntity('post', id);
    if (likersBackdrop.hidden || !post?.cloudClientId) return;
    const request = ++likerRequest;
    const result = await readImagePostLikers(post);
    if (request === likerRequest && state.activeLikersPostId === id && !likersBackdrop.hidden) {
        renderLikers(result.count, result.people);
    }
}

export function closeLikers() {
    likerRequest++;
    likersBackdrop.hidden = true;
    document.body.classList.remove("likers-open");
    if (state.activeLikersTrigger?.isConnected)
        state.activeLikersTrigger.focus();
    state.activeLikersTrigger = null;
    state.activeLikersPostId = null;
}

const pendingLikes = new Set();

export function setEntityLiked(type, entity, isLiked) {
    if (!mayInteract() || !canViewMedia(entity)) return;
    const save = type === 'post' && entity.cloudClientId ? setImagePostLike
        : type === 'reel' && entity.cloudContentId ? setCloudReelLike : null;
    if (save) {
        const owner = state.signedInAccountId;
        const key = `${owner}:${type}:${entity.id}`;
        if (pendingLikes.has(key)) return;
        pendingLikes.add(key);
        return save(entity, isLiked).then(({ liked, count }) => {
            if (owner !== state.signedInAccountId) return;
            const current = findEntity(type, entity.id);
            if (!current) return;
            current.liked = liked;
            current.likes = count;
            renderLikeState(type, current);
            void refreshOpenImageLikers().catch(() => {});
        }).catch(() => showShareFeedback('Could not save the like. Try again.'))
            .finally(() => pendingLikes.delete(key));
    }
    if (Boolean(entity.liked) === isLiked) return;
    entity.liked = isLiked;
    entity.likes = Math.max(0, (Number(entity.likes) || 0) + (isLiked ? 1 : -1));
    renderLikeState(type, entity);
}

export function syncVisibleImageLikes() {
    for (const post of posts) if (post.cloudClientId) renderLikeState('post', post);
}

function renderLikeState(type, entity) {
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
        const total = likersList.querySelector(".likers-total");
        if (total) total.textContent = `${entity.likes.toLocaleString()} likes`;
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
