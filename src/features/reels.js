import { renderSaveButton } from '../components/post-card.js';
import { escapeHtml, formatCount } from '../core/utils.js';
import { state } from '../core/state.js';
import { reels } from '../data/sample-data.js';
import { accountIsPublic, canViewMedia, getAccount } from '../core/social.js';
import { observePostVideos } from '../media/video.js';

const DAY = 24 * 60 * 60 * 1000;

// Trending has 70% influence; recency has 30%. Scores normalize views,
// watch-time per view, and likes against the current public Reel set.
export function rankRecommendedReels(items = reels, now = Date.now()) {
  const eligible = items.filter(reel => reel.public && accountIsPublic(reel.handle) && canViewMedia(reel));
  if (!eligible.length) return [];
  const maxViews = Math.max(1, ...eligible.map(reel => Number(reel.views) || 0));
  const maxWatch = Math.max(1, ...eligible.map(reel => (Number(reel.watchTimeSeconds) || (Number(reel.views) || 0) * 4) / Math.max(1, Number(reel.views) || 0)));
  const maxLikes = Math.max(1, ...eligible.map(reel => Number(reel.likes) || 0));
  const score = reel => {
    const views = Number(reel.views) || 0;
    const watchPerView = (Number(reel.watchTimeSeconds) || views * 4) / Math.max(1, views);
    const trending = ((views / maxViews) + (watchPerView / maxWatch) + ((Number(reel.likes) || 0) / maxLikes)) / 3;
    const ageDays = Math.max(0, (now - (reel.createdAt || now)) / DAY);
    const recent = Math.exp(-ageDays / 7);
    return trending * 0.7 + recent * 0.3;
  };
  return [...eligible].sort((a, b) => score(b) - score(a) || (b.createdAt || 0) - (a.createdAt || 0));
}

function warningNeeded(reel) {
  return Boolean(reel.sensitive || reel.audience === 'adult' || getAccount(reel.handle)?.contentAudience === 'adult');
}

export function renderReels() {
  const feed = document.getElementById('reels-feed');
  feed.innerHTML = rankRecommendedReels().map(reel => {
    const gated = warningNeeded(reel) && !state.revealedMediaKeys.has(`reel:${reel.id}`);
    const blockedForMinor = gated && state.viewerAgeBand === 'minor';
    return `
    <article class="reel-card ${gated ? 'reel-gated' : ''}" data-reel-id="${reel.id}" data-likeable-id="${reel.id}" data-likeable-type="reel">
      <div class="likeable-media reel-media" data-likeable-id="${reel.id}" data-likeable-type="reel">
        <video class="reel-video" tabindex="0" playsinline preload="none" loop poster="${escapeHtml(reel.poster)}" ${state.reelMuted ? 'muted' : ''}>
          <source src="${escapeHtml(reel.video)}" />Your browser does not support video playback.
        </video>
        ${gated ? `<div class="reel-content-warning"><strong>Sensitive content</strong><p>${blockedForMinor ? 'This content is not available for under-18 accounts.' : 'This Reel may contain sensitive content.'}</p>${blockedForMinor ? '' : `<button type="button" data-reel-reveal="${reel.id}">View content</button>`}</div>` : ''}
        <button class="video-sound-toggle" type="button" data-video-sound aria-label="Turn video sound ${state.reelMuted ? 'on' : 'off'}" aria-pressed="${!state.reelMuted}">${state.reelMuted ? '🔇' : '🔊'}</button>
        <button class="reel-play-state" type="button" data-reel-play aria-label="Pause reel">Ⅱ</button>
        <span class="double-like-heart" aria-hidden="true">♥</span>
      </div>
      <div class="reel-caption">
        <div class="post-user"><img src="${escapeHtml(reel.avatar)}" alt="${escapeHtml(reel.user)} avatar" />
          <div><button class="author-name reel-author-name" type="button" data-profile-handle="${escapeHtml(reel.handle)}">${escapeHtml(reel.user)}</button><span>Public reel</span></div>
        </div>
        <p>${escapeHtml(reel.caption)}</p>
        ${reel.demoVideoCredit ? `<small class="reel-demo-credit">${escapeHtml(reel.demoVideoCredit)}</small>` : ''}
        <div class="reel-actions">
          <button class="like-btn ${reel.liked ? 'liked' : ''}" type="button" data-action="like" data-entity-type="reel" data-entity-id="${reel.id}" aria-pressed="${reel.liked}">♥ ${formatCount(reel.likes)}</button>
          <button class="comment-btn" type="button" data-action="comments" data-entity-type="reel" data-entity-id="${reel.id}" aria-label="View ${reel.comments} comments" aria-expanded="false">💬 ${reel.comments}</button>
          <button class="share-btn" type="button" data-action="share-post" data-entity-type="reel" data-entity-id="${reel.id}" aria-label="Share ${escapeHtml(reel.user)}'s reel">↗</button>
          ${renderSaveButton('reel', reel)}
        </div>
      </div>
    </article>`;
  }).join('');
  observePostVideos(feed);
}
