import { cloudPerson } from './cloud-people.js';
import { renderCaption } from '../components/caption.js';
import { actionIcon } from '../components/action-icons.js';
import { accountStorageKey } from '../storage/browser-storage.js';
import { renderRepostOption, renderSaveButton } from '../components/post-card.js';
import { escapeHtml, formatCount } from '../core/utils.js';
import { state } from '../core/state.js';
import { reels } from '../data/sample-data.js';
import { accountIsPublic, canViewMedia, getAccount } from '../core/social.js';
import { observePostVideos } from '../media/video.js';

function preferenceKey(reel) {
  return accountStorageKey('insta-reel-interest:' + (reel.cloudContentId || reel.id));
}

export function saveReelInterest(reel, interest) {
  try {
    localStorage.setItem(preferenceKey(reel), interest);
    return true;
  } catch {
    return false;
  }
}

function interestOption(reel, value, label) {
  let selected = false;
  try { selected = localStorage.getItem(preferenceKey(reel)) === value; } catch {}
  return `<button type="button" data-post-option="${value}" aria-pressed="${selected}">${label}</button>`;
}

const DAY = 24 * 60 * 60 * 1000;
const publicReel = reel => reel.public && accountIsPublic(reel.handle);

function authorizedReel(reel) {
  const owner = state.signedInAccountId;
  if (!owner || !reel.cloudOwnerId) return false;
  if (reel.cloudOwnerId === owner) return true;
  if (!reel.public && reel.cloudAudience !== 'followers') return false;
  return state.cloudFollowingIds?.has(reel.cloudOwnerId) ?? (cloudPerson(reel.handle)?.followStatus === 'accepted');
}

// Trending has 70% influence; recency has 30%. Scores normalize views,
// watch-time per view, and likes against the current public Reel set.
export function rankRecommendedReels(items = reels, now = Date.now()) {
  const eligible = items.filter(reel => (!state.signedInAccountId || reel.cloudOwnerId) && publicReel(reel) && canViewMedia(reel));
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

export function renderReelsStatus(status) {
  const message = status === 'loading' ? 'Loading Reels…' : status === 'error'
    ? 'Could not load Reels.' : 'No Reels to show yet.';
  document.getElementById('reels-feed').innerHTML = `<div class="reels-status"><p role="status">${message}</p>
    ${status === 'error' ? '<button type="button" data-reels-retry>Try again</button>' : ''}</div>`;
}

export function renderReels({ status = 'ready' } = {}) {
  const feed = document.getElementById('reels-feed');
  const recommended = rankRecommendedReels();
  const personal = reels.filter(reel => !publicReel(reel) && authorizedReel(reel) && canViewMedia(reel))
    .sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0));
  const visible = [...recommended, ...personal];
  if (!visible.length) {
    renderReelsStatus(status);
    return;
  }
  feed.innerHTML = visible.map(reel => {
    const gated = warningNeeded(reel) && !state.revealedMediaKeys.has(`reel:${reel.id}`);
    const blockedForMinor = gated && state.viewerAgeBand === 'minor';
    const muted = state.reelMuted || reel.originalAudioMuted;
    const audience = publicReel(reel) ? 'Public reel'
      : reel.cloudOwnerId === state.signedInAccountId ? 'Your reel' : 'Followers only';
    return `
    <article class="reel-card ${gated ? 'reel-gated' : ''}" data-reel-id="${reel.id}" data-likeable-id="${reel.id}" data-likeable-type="reel">
      <div class="likeable-media reel-media" data-likeable-id="${reel.id}" data-likeable-type="reel">
        <video class="reel-video" tabindex="0" playsinline preload="none" loop poster="${escapeHtml(reel.poster)}" ${muted ? 'muted' : ''} ${reel.originalAudioMuted ? 'data-original-audio-muted="true"' : ''}>
          <source src="${escapeHtml(reel.video)}" />Your browser does not support video playback.
        </video>
        ${gated ? `<div class="reel-content-warning"><strong>Sensitive content</strong><p>${blockedForMinor ? 'This content is not available for under-18 accounts.' : 'This Reel may contain sensitive content.'}</p>${blockedForMinor ? '' : `<button type="button" data-reel-reveal="${reel.id}">View content</button>`}</div>` : ''}
        <button class="reel-play-state" type="button" data-reel-play aria-label="Pause reel">Ⅱ</button>
        <span class="double-like-heart" aria-hidden="true">♥</span>
      </div>
      <div class="reel-caption">
        <div class="post-user"><button class="profile-avatar-link" type="button" data-profile-handle="${escapeHtml(reel.handle)}" aria-label="Open ${escapeHtml(reel.user)} profile"><img src="${escapeHtml(reel.avatar)}" alt="${escapeHtml(reel.user)} avatar" /></button>
          <div><button class="author-name reel-author-name" type="button" data-profile-handle="${escapeHtml(reel.handle)}">${escapeHtml(reel.user)}</button><span>${audience}</span></div>
        </div>
        <p>${renderCaption(reel.caption)}</p>
        <small data-media-view-count="reel:${reel.id}">${formatCount(reel.views || 0)} views</small>
        ${reel.demoVideoCredit ? `<small class="reel-demo-credit">${escapeHtml(reel.demoVideoCredit)}</small>` : ''}
        <div class="reel-actions">
          <button class="like-btn ${reel.liked ? 'liked' : ''}" type="button" data-action="like" data-entity-type="reel" data-entity-id="${reel.id}" aria-label="${reel.liked ? 'Unlike' : 'Like'} reel" aria-pressed="${Boolean(reel.liked)}">${actionIcon('like')}<span data-reel-like-count>${formatCount(reel.likes)}</span></button>
          <button class="comment-btn" type="button" data-action="comments" data-entity-type="reel" data-entity-id="${reel.id}" aria-label="View ${reel.comments} comments" aria-expanded="false">${actionIcon('comment')}<span class="post-comment-count">${formatCount(reel.comments)}</span></button>
          <button class="share-btn" type="button" data-action="share-post" data-entity-type="reel" data-entity-id="${reel.id}" aria-label="Share ${escapeHtml(reel.user)}'s reel">${actionIcon('share')}</button>
          ${renderSaveButton('reel', reel)}
          <div class="post-options-wrap reel-options-wrap" data-id="${reel.id}" data-entity-type="reel">
            <button class="post-options" type="button" data-action="post-options" aria-label="Reel options" aria-expanded="false">${actionIcon('options')}</button>
            <div class="post-options-menu" hidden>
              ${renderRepostOption(reel)}
              <button type="button" data-post-option="download">Download</button>
              <button type="button" data-post-option="add-to-story">Add to story</button>
              <button type="button" data-post-option="copy-link">Copy link</button>
              ${interestOption(reel, 'interested', 'Interested')}
              ${interestOption(reel, 'not-interested', 'Not interested')}
              <button type="button" data-post-option="report">Report</button>
            </div>
          </div>
        </div>
      </div>
      <button class="video-sound-toggle reel-sound-toggle" type="button" ${reel.originalAudioMuted ? 'disabled' : ''} data-video-sound aria-label="${reel.originalAudioMuted ? 'Original audio is disabled' : `Turn video sound ${muted ? 'on' : 'off'}`}" aria-pressed="${!muted}">${actionIcon(muted ? 'sound-off' : 'sound-on')}</button>
    </article>`;
  }).join('');
  observePostVideos(feed);
}
