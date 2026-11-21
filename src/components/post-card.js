import { observePostPrefetch } from '../media/post-prefetch.js';
import { initializePostCarousels } from '../media/carousel.js';
import { renderCaption } from './caption.js';
import { renderEditedMedia } from '../features/post-media.js';
import { feed, profilePostViewerContent } from '../core/dom.js';
import { state } from '../core/state.js';
import { escapeHtml, formatCount } from '../core/utils.js';
import { isFollowing, mediaNeedsWarning, canViewMedia } from '../core/social.js';
import { currentUser } from '../data/sample-data.js';
import { renderCommentSection } from '../features/comments.js';
import { observePostVideos } from '../media/video.js';
import { isMediaSaved } from '../storage/cloud-saved-items.js';
import { canRepost } from '../storage/cloud-reposts.js';
import { actionIcon } from './action-icons.js';

export function renderRepostOption(entity) {
    return canRepost(entity) ? '<button type="button" data-post-option="repost">Repost</button>' : '';
}

export function renderSaveButton(type, entity) {
    const saved = isMediaSaved(type, entity);
    return `<button class="save-btn ${saved ? "saved" : ""}" type="button" data-action="toggle-save" data-entity-type="${type}" data-entity-id="${entity.id}" aria-label="${saved ? "Remove from" : "Save to"} your collection" aria-pressed="${saved}" title="${saved ? "Remove from saved" : "Save"}">
    ${actionIcon('save')}
  </button>`;
}

export function renderMedia(post, className = "post-image", type = "post", priority = false) {
    if (mediaNeedsWarning(post) && !state.revealedMediaKeys.has(`${type}:${post.id}`)) {
        return `<div class="sensitive-media" data-media-class="${escapeHtml(className)}"><img class="${className}" src="${escapeHtml(post.cover || post.poster || post.media || '')}" alt="Sensitive media obscured" /><div class="sensitive-media-warning"><strong>Sensitive content</strong><p>This media may contain sensitive content.</p>${state.viewerAgeBand === 'minor' ? '<p>Unavailable for under-18 accounts.</p>' : `<button type="button" data-media-reveal="${post.id}" data-entity-type="${type}">View content</button>`}</div></div>`;
    }
    const isLegacyVideo = post.mediaType === 'video' || type === 'reel';
    const items = post.mediaItems?.length ? post.mediaItems
        : isLegacyVideo ? [] : [{ type: 'image', url: post.media, naturalRatio: post.naturalRatio }];
    if (items.length) {
        return `<div class="post-carousel" data-fit-active-slide aria-label="${items.length} media items"><div class="carousel-slides" tabindex="0">${items.map((item, index) => `<div class="carousel-slide likeable-media" data-likeable-id="${post.id}" data-likeable-type="${type}" data-video-asset-index="${index}" role="group" aria-label="${index + 1} of ${items.length}">${renderEditedMedia(item, {
            className, alt: `${post.user} media ${index + 1}`, feedPriority: priority && index === 0,
        })}<span class="double-like-heart" aria-hidden="true">♥</span></div>`).join('')}</div>${items.length > 1 ? `<span class="carousel-index" role="status" aria-live="polite" aria-label="Item 1 of ${items.length}">1/${items.length}</span>` : ''}</div>`;
    }
    const poster = post.cover || (type === "reel" ? post.poster : post.media);
    const video = type === "reel" ? post.video : post.videoUrl;
    return `<div class="likeable-media" data-likeable-id="${post.id}" data-likeable-type="${type}">
      <video class="${className}" tabindex="0" playsinline preload="${priority ? 'metadata' : 'none'}" muted poster="${escapeHtml(poster || '')}"><source src="${escapeHtml(video)}">Your browser does not support video playback.</video>
      <button class="video-sound-toggle" type="button" data-video-sound aria-label="Turn video sound on" aria-pressed="false">🔇</button>
      <span class="double-like-heart" aria-hidden="true">♥</span>
    </div>`;
}

export function renderPostCards(items, target = feed) {
    const canManageMedia = target === profilePostViewerContent && !state.activeMediaViewerItems;
    target.innerHTML = items.length ? items.map((post, index) => `
    <article class="post-card" id="post-${post.id}" data-id="${post.id}" data-entity-type="${post.reel ? "reel" : "post"}">
      <header class="post-header">
        <div class="post-user">
          <button class="profile-avatar-link" type="button" data-profile-handle="${escapeHtml(post.handle)}" aria-label="Open ${escapeHtml(post.user)} profile"><img src="${escapeHtml(post.avatar)}" alt="${escapeHtml(post.user)} avatar" /></button>
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
            <button type="button" data-post-option="add-to-story">Add to story</button>
            <button type="button" data-post-option="copy-link">Copy link</button>
            ${renderRepostOption(post)}
            ${post.handle !== currentUser.handle ? `
            <button type="button" data-post-option="hide">Hide post</button>
            <button type="button" data-post-option="mute-posts">Mute posts</button>
            <button type="button" data-post-option="mute-stories">Mute stories</button>
            ${isFollowing(post.handle) ? '<button type="button" data-post-option="unfollow">Unfollow</button>' : ''}` : ""}
            <button type="button" data-post-option="report">Report</button>
          </div>
        </div>
      </header>
      ${renderMedia(post, "post-image", post.reel ? "reel" : "post", index === 0)}
      <div class="post-body">
        <div class="post-meta">
          <div class="interactions">
            <div class="post-like-control">
              <button class="like-btn ${post.liked ? "liked" : ""}" type="button" data-action="like" data-entity-type="${post.reel ? "reel" : "post"}" data-entity-id="${post.id}" aria-label="${post.liked ? "Unlike" : "Like"} ${post.reel ? "reel" : "post"}" aria-pressed="${Boolean(post.liked)}">${actionIcon('like')}</button>
              <button class="like-count-btn" type="button" data-action="show-likers" data-entity-type="${post.reel ? "reel" : "post"}" data-entity-id="${post.id}" aria-label="Show ${post.likes.toLocaleString()} people who liked this ${post.reel ? "reel" : "post"}">${formatCount(post.likes)}</button>
            </div>
            <button class="comment-btn" type="button" data-action="comments" data-entity-type="${post.reel ? "reel" : "post"}" data-entity-id="${post.id}" aria-label="View ${post.comments} comments" aria-expanded="false">${actionIcon('comment')}<span class="post-comment-count">${formatCount(post.comments)}</span></button>
            <button class="share-btn" type="button" data-action="share-post" data-entity-type="${post.reel ? "reel" : "post"}" data-entity-id="${post.id}" aria-label="Share ${escapeHtml(post.user)}'s ${post.reel ? "reel" : "post"}" title="Share with friends">
              ${actionIcon('share')}
            </button>
            ${renderSaveButton(post.reel ? "reel" : "post", post)}
          </div>
        </div>
        ${post.reel || post.mediaType === 'video' || post.mediaItems?.some(item => item.type === 'video')
            ? `<small data-media-view-count="${post.reel ? 'reel' : 'post'}:${post.id}">${formatCount(post.views || 0)} views</small>` : ''}
        <p>${renderCaption(post.caption)}</p>
        ${renderCommentSection(post)}
      </div>
    </article>
  `).join("") : '<p class="feed-empty">You’re all caught up. New posts from people you follow will appear here.</p>';
    initializePostCarousels(target);
    observePostVideos(target);
    const byId = new Map(items.map(post => [String(post.id), post]));
    observePostPrefetch(target, card => {
        const post = byId.get(card.dataset.id);
        const type = post?.reel ? 'reel' : 'post';
        return Boolean(post && canViewMedia(post) && (!mediaNeedsWarning(post) || state.revealedMediaKeys.has(`${type}:${post.id}`)));
    });
}
