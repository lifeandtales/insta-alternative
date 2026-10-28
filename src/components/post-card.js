import { renderCaption } from './caption.js';
import { renderEditedMedia } from '../features/post-media.js';
import { feed, profilePostViewerContent } from '../core/dom.js';
import { state } from '../core/state.js';
import { escapeHtml, formatCount } from '../core/utils.js';
import { isFollowing, mediaNeedsWarning } from '../core/social.js';
import { currentUser } from '../data/sample-data.js';
import { renderCommentSection } from '../features/comments.js';
import { observePostVideos } from '../media/video.js';
import { getSavedItemKey } from '../storage/browser-storage.js';

export function renderSaveButton(type, entity) {
    const saved = state.savedItems.has(getSavedItemKey(type, entity.id));
    return `<button class="save-btn ${saved ? "saved" : ""}" type="button" data-action="toggle-save" data-entity-type="${type}" data-entity-id="${entity.id}" aria-label="${saved ? "Remove from" : "Save to"} your collection" aria-pressed="${saved}" title="${saved ? "Remove from saved" : "Save"}">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.75h12v17l-6-4-6 4z" /></svg>
  </button>`;
}

export function renderMedia(post, className = "post-image", type = "post") {
    if (mediaNeedsWarning(post) && !state.revealedMediaKeys.has(`${type}:${post.id}`)) {
        return `<div class="sensitive-media" data-media-class="${escapeHtml(className)}"><img class="${className}" src="${escapeHtml(post.cover || post.poster || post.media || '')}" alt="Sensitive media obscured" /><div class="sensitive-media-warning"><strong>Sensitive content</strong><p>This media may contain sensitive content.</p>${state.viewerAgeBand === 'minor' ? '<p>Unavailable for under-18 accounts.</p>' : `<button type="button" data-media-reveal="${post.id}" data-entity-type="${type}">View content</button>`}</div></div>`;
    }
    if (post.mediaItems?.length) {
        return `<div class="post-carousel" aria-label="${post.mediaItems.length} media items"><div class="carousel-slides" tabindex="0">${post.mediaItems.map((item, index) => `<div class="carousel-slide likeable-media" data-likeable-id="${post.id}" data-likeable-type="${type}" role="group" aria-label="${index + 1} of ${post.mediaItems.length}">${renderEditedMedia(item,{className,alt:`${post.user} media ${index+1}`})}<span class="double-like-heart" aria-hidden="true">♥</span><span class="carousel-index">${index + 1}/${post.mediaItems.length}</span></div>`).join('')}</div><small>Swipe left or right · ${post.mediaItems.length} items</small></div>`;
    }
    if (post.mediaType === "video" || type === "reel") {
        const poster = type === "reel" ? post.poster : post.media;
        const video = type === "reel" ? post.video : post.videoUrl;
        return `<div class="likeable-media" data-likeable-id="${post.id}" data-likeable-type="${type}">
      <video class="${className}" tabindex="0" playsinline preload="auto" muted poster="${escapeHtml(poster)}"><source src="${escapeHtml(video)}">Your browser does not support video playback.</video>
      <button class="video-sound-toggle" type="button" data-video-sound aria-label="Turn video sound on" aria-pressed="false">🔇</button>
      <span class="double-like-heart" aria-hidden="true">♥</span>
    </div>`;
    }
    return `<div class="likeable-media" data-likeable-id="${post.id}" data-likeable-type="${type}">
    <img class="${className}" src="${escapeHtml(post.media)}" alt="${escapeHtml(post.user)}'s post" />
    <span class="double-like-heart" aria-hidden="true">♥</span>
  </div>`;
}

export function renderPostCards(items, target = feed) {
    const canManageMedia = target === profilePostViewerContent && !state.activeMediaViewerItems;
    target.innerHTML = items.length ? items.map((post) => `
    <article class="post-card" id="post-${post.id}" data-id="${post.id}" data-entity-type="${post.reel ? "reel" : "post"}">
      <header class="post-header">
        <div class="post-user">
          <img src="${escapeHtml(post.avatar)}" alt="${escapeHtml(post.user)} avatar" />
          <div>
            <button class="author-name" type="button" data-profile-handle="${escapeHtml(post.handle)}">${escapeHtml(post.user)}</button>
            <span>${escapeHtml(post.location || (post.reel ? "Reel" : ""))}</span>
          </div>
        </div>
        <div class="post-options-wrap">
          <button class="post-options" type="button" data-action="post-options" data-entity-type="${post.reel ? "reel" : "post"}" aria-label="${post.reel ? "Reel" : "Post"} options" aria-expanded="false">•••</button>
          <div class="post-options-menu" hidden>
            ${canManageMedia && post.handle === currentUser.handle ? '<button type="button" data-post-option="edit">Edit</button>' : ''}
            ${(canManageMedia || target === feed) && post.handle === currentUser.handle ? '<button type="button" data-post-option="delete">Delete</button>' : ''}
            <button type="button" data-post-option="download">Download</button>
            <button type="button" data-post-option="copy-link">Copy link</button>
            ${post.handle !== currentUser.handle ? `
            <button type="button" data-post-option="hide">Hide post</button>
            <button type="button" data-post-option="mute-posts">Mute posts</button>
            <button type="button" data-post-option="mute-stories">Mute stories</button>
            ${isFollowing(post.handle) ? '<button type="button" data-post-option="unfollow">Unfollow</button>' : ''}` : ""}
            <button type="button" data-post-option="report">Report</button>
          </div>
        </div>
      </header>
      ${renderMedia(post, "post-image", post.reel ? "reel" : "post")}
      <div class="post-body">
        <div class="post-meta">
          <div class="interactions">
            <div class="post-like-control">
              <button class="like-btn ${post.liked ? "liked" : ""}" type="button" data-action="like" data-entity-type="${post.reel ? "reel" : "post"}" data-entity-id="${post.id}" aria-label="${post.liked ? "Unlike" : "Like"} ${post.reel ? "reel" : "post"}" aria-pressed="${post.liked}">♥</button>
              <button class="like-count-btn" type="button" data-action="show-likers" data-entity-type="${post.reel ? "reel" : "post"}" data-entity-id="${post.id}" aria-label="Show ${post.likes.toLocaleString()} people who liked this ${post.reel ? "reel" : "post"}">${formatCount(post.likes)}</button>
            </div>
            <button class="comment-btn" type="button" data-action="comments" data-entity-type="${post.reel ? "reel" : "post"}" data-entity-id="${post.id}" aria-label="View ${post.comments} comments" aria-expanded="false">💬 ${post.comments}</button>
            <button class="share-btn" type="button" data-action="share-post" data-entity-type="${post.reel ? "reel" : "post"}" data-entity-id="${post.id}" aria-label="Share ${escapeHtml(post.user)}'s ${post.reel ? "reel" : "post"}" title="Share with friends">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V3m0 0L7 8m5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" /></svg>
            </button>
            ${renderSaveButton(post.reel ? "reel" : "post", post)}
          </div>
        </div>
        <p>${renderCaption(post.caption)}</p>
        ${renderCommentSection(post)}
      </div>
    </article>
  `).join("") : '<p class="feed-empty">You’re all caught up. New posts from people you follow will appear here.</p>';
    observePostVideos(target);
}
