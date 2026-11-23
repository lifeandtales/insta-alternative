import { cloudPerson } from './cloud-people.js';
import { renderCaption } from '../components/caption.js';
import { actionIcon } from '../components/action-icons.js';
import { accountStorageKey } from '../storage/browser-storage.js';
import { renderRepostOption, renderSaveButton } from '../components/post-card.js';
import { escapeHtml, formatCount } from '../core/utils.js';
import { state } from '../core/state.js';
import { reels } from '../data/sample-data.js';
import { accountIsPublic, canViewMedia, getAccount } from '../core/social.js';
import { observePostVideos, releaseReelPlayback } from '../media/video.js';
import { REEL_PREFETCH_COUNT } from '../media/reel-prefetch.js';
import { loadMoreCloudReels } from '../storage/cloud-reels.js';

let renderedQueue = { owner: null, ids: [] };
let releasePagination = () => {};

export function getReelQueueIds() {
  return renderedQueue.owner === state.signedInAccountId ? [...renderedQueue.ids] : [];
}

export function getReelRefreshExclusions() {
  const ids = getReelQueueIds();
  const feed = document.getElementById('reels-feed');
  const bounds = feed.getBoundingClientRect();
  const middle = bounds.top + bounds.height / 2;
  const cards = [...feed.querySelectorAll('.reel-card')];
  const index = Math.max(0, cards.findIndex(card => {
    const rect = card.getBoundingClientRect();
    return rect.top <= middle && rect.bottom > middle;
  }));
  return ids.slice(index, index + REEL_PREFETCH_COUNT + 1);
}

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

export function canShowReelInFeed(reel) {
  return (!state.signedInAccountId || reel.cloudOwnerId) && canViewMedia(reel)
    && (publicReel(reel) || authorizedReel(reel));
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
  releasePagination();
  releaseReelPlayback();
  renderedQueue = { owner: state.signedInAccountId, ids: [] };
  const message = status === 'loading' ? 'Loading Reels…' : status === 'error'
    ? 'Could not load Reels.' : 'No Reels to show yet.';
  document.getElementById('reels-feed').innerHTML = `<div class="reels-status"><p role="status">${message}</p>
    ${status === 'error' ? '<button type="button" data-reels-retry>Try again</button>' : ''}</div>`;
}

export function renderReels({ status = 'ready', excludeIds = null, preserveOnEmpty = false } = {}) {
  const feed = document.getElementById('reels-feed');
  const selection = state.reelFeedSelection;
  const excluded = excludeIds && new Set(excludeIds);
  const selected = selection && selection.owner === state.signedInAccountId ? new Set(selection.ids) : null;
  const items = reels.filter(reel => {
    const id = reel.cloudContentId || String(reel.id);
    return excluded ? !excluded.has(id) : !selected || selected.has(id);
  });
  const recommended = rankRecommendedReels(items);
  const personal = items.filter(reel => !publicReel(reel) && authorizedReel(reel) && canViewMedia(reel))
    .sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0));
  const visible = [...recommended, ...personal];
  if (!visible.length) {
    if (preserveOnEmpty) return false;
    renderReelsStatus(status);
    return false;
  }
  releaseReelPlayback();
  renderedQueue = { owner: state.signedInAccountId, ids: visible.map(reel => reel.cloudContentId || String(reel.id)) };
  if (excluded) state.reelFeedSelection = { owner: renderedQueue.owner, ids: [...renderedQueue.ids] };
  feed.scrollTop = 0;
  releasePagination();
  feed.innerHTML = renderReelCards(visible) + '<div class="reel-pagination" data-reel-pagination role="status" aria-live="polite"></div>';
  observePostVideos(feed);
  observeReelPagination(feed);
  return true;
}

function observeReelPagination(feed) {
  const owner = state.signedInAccountId;
  const footer = feed.querySelector('[data-reel-pagination]');
  if (!footer) return;
  let released = false;
  let loading = false;
  let failed = false;
  const currentPage = () => state.reelPaging?.owner === owner && state.signedInAccountId === owner;
  const showFooter = () => {
    footer.hidden = !owner || !currentPage();
    footer.innerHTML = loading ? 'Loading more Reels…' : failed
      ? '<span>Could not load more Reels.</span><button type="button" data-reel-load-more>Try again</button>'
      : state.reelPaging?.hasMore ? '' : 'You’re caught up.';
  };
  const load = async () => {
    if (released || loading || document.hidden || !currentPage() || !state.reelPaging?.hasMore || state.currentView !== 'reels') return;
    loading = true;
    failed = false;
    showFooter();
    try {
      const { items } = await loadMoreCloudReels(canShowReelInFeed);
      if (released || !currentPage() || state.currentView !== 'reels') return;
      const existing = new Set(renderedQueue.ids);
      const incoming = items.filter(reel => !existing.has(reel.cloudContentId) && canShowReelInFeed(reel));
      const ordered = [...rankRecommendedReels(incoming), ...incoming.filter(reel => !publicReel(reel))];
      if (ordered.length) {
        const scrollTop = feed.scrollTop;
        footer.insertAdjacentHTML('beforebegin', renderReelCards(ordered));
        feed.scrollTop = scrollTop;
        renderedQueue.ids.push(...ordered.map(reel => reel.cloudContentId));
        observePostVideos(feed);
      }
    } catch {
      failed = true;
    } finally {
      loading = false;
      if (!released) {
        showFooter();
        if (!failed) window.setTimeout(checkPosition, 0);
      }
    }
  };
  const checkPosition = () => {
    if (failed || !feed.clientHeight) return;
    if (feed.scrollHeight - feed.scrollTop - feed.clientHeight < feed.clientHeight * 5) void load();
  };
  const retry = event => { if (event.target.closest('[data-reel-load-more]')) void load(); };
  feed.addEventListener('scroll', checkPosition, { passive: true });
  document.addEventListener('visibilitychange', checkPosition);
  footer.addEventListener('click', retry);
  releasePagination = () => {
    released = true;
    feed.removeEventListener?.('scroll', checkPosition);
    document.removeEventListener?.('visibilitychange', checkPosition);
    footer.removeEventListener?.('click', retry);
  };
  showFooter();
  checkPosition();
}

function renderReelCards(items) {
  return items.map(reel => {
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
        <div class="reel-loading" data-reel-loading role="status" hidden><span aria-hidden="true"></span>Loading video…</div>
        <div class="reel-video-error" data-reel-error hidden><p role="status">Video could not load. Check your connection and try again.</p><button type="button" data-reel-video-retry>Try again</button><button type="button" data-reels-retry>Refresh Reels</button></div>
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
}
