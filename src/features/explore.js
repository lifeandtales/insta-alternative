import { renderMedia } from '../components/post-card.js';
import { exploreCommunityView, exploreSearchInput, exploreSearchResults, viewHeading } from '../core/dom.js';
import { state } from '../core/state.js';
import { escapeHtml, formatCount, newestFirst, normalizeSearchText } from '../core/utils.js';
import { communities, conversations, currentUser, demoViewCounts, posts, reels } from '../data/sample-data.js';
import { isFollowed } from './follows.js';
import { observePostVideos } from '../media/video.js';
import { visibleAvatar, canViewMedia, mediaNeedsWarning } from '../core/social.js';

const HOUR_MS = 60 * 60 * 1000;

function postViews(post) {
    const demoCount = demoViewCounts.get(post.id);
    return Math.max(0, Number(demoCount ?? post.views ?? post.viewCount ?? 0) || 0);
}

function getHourlyTrendingPosts(publicPosts) {
    const hour = Math.floor(Date.now() / HOUR_MS);
    const ids = new Set(publicPosts.map(post => post.id));
    if (state.exploreRankingHour !== hour || !state.hourlyExploreIds ||
        state.hourlyExploreIds.length !== ids.size || state.hourlyExploreIds.some(id => !ids.has(id))) {
        state.exploreRankingHour = hour;
        state.hourlyExploreIds = [...publicPosts]
            .sort((left, right) => postViews(right) - postViews(left) || right.createdAt - left.createdAt || left.id - right.id)
            .map(post => post.id);
    }
    const postById = new Map(publicPosts.map(post => [post.id, post]));
    return state.hourlyExploreIds.map(id => postById.get(id)).filter(Boolean);
}

function scheduleHourlyRankingRefresh() {
    window.clearTimeout(state.exploreRankingTimer);
    const delay = HOUR_MS - Date.now() % HOUR_MS + 20;
    state.exploreRankingTimer = window.setTimeout(() => {
        state.exploreRankingHour = null;
        state.hourlyExploreIds = null;
        if (state.currentView === 'explore' && !state.activeExploreFilter && !state.activeCommunityId)
            renderExplore();
        else
            scheduleHourlyRankingRefresh();
    }, delay);
}

export function renderExplore() {
    const exploreGrid = document.getElementById("explore-grid");
    const community = communities.find((item) => item.id === state.activeCommunityId);
    const matchingPosts = posts.filter((post) => {
        if (!post.public || post.reel || !canViewMedia(post))
            return false;
        if (community)
            return community.postIds.includes(post.id);
        if (!state.activeExploreFilter)
            return true;
        if (state.activeExploreFilter.type === "location") {
            return normalizeSearchText(post.location || "") === normalizeSearchText(state.activeExploreFilter.value);
        }
        return (post.caption.match(/#[\p{L}\p{N}_]+/gu) || [])
            .some((tag) => normalizeSearchText(tag.slice(1)) === normalizeSearchText(state.activeExploreFilter.value));
    });
    if (!state.activeExploreFilter && !community) {
        state.activeExplorePosts = getHourlyTrendingPosts(matchingPosts);
        scheduleHourlyRankingRefresh();
    }
    else {
        state.activeExplorePosts = newestFirst(matchingPosts);
    }
    const publicPosts = state.activeExplorePosts;
    exploreGrid.innerHTML = publicPosts.map(renderExploreTile).join("");
    exploreGrid.hidden = Boolean(community);
    exploreCommunityView.hidden = !community;
    if (community) {
        const isMember = state.joinedCommunityIds.has(community.id);
        exploreCommunityView.innerHTML = `
      <header class="community-header">
        <button class="community-back" type="button" data-community-back>← Explore</button>
        <h2>${escapeHtml(community.name)}</h2>
        <p>${escapeHtml(community.description)}</p>
        <div class="community-meta">
          <span>${formatCount(community.members + (isMember ? 1 : 0))} members</span>
          <button class="community-follow-button ${isFollowed("community", community.id) ? "following" : ""}" type="button" data-follow-kind="community" data-follow-value="${escapeHtml(community.id)}" aria-pressed="${isFollowed("community", community.id)}">
            ${isFollowed("community", community.id) ? "Following updates" : "Follow updates"}
          </button>
          <button class="community-join-button ${isMember ? "joined" : ""}" type="button" data-community-join="${escapeHtml(community.id)}" aria-pressed="${isMember}">
            ${isMember ? "Joined" : "Join community"}
          </button>
        </div>
      </header>
      <div class="media-grid community-post-grid" aria-label="Public community posts">
        ${publicPosts.length ? publicPosts.map(renderExploreTile).join("") : '<p class="community-empty">No public posts in this community yet.</p>'}
      </div>
    `;
        viewHeading.textContent = community.name;
        observePostVideos(exploreCommunityView);
    }
    else {
        viewHeading.textContent = state.activeExploreFilter ? state.activeExploreFilter.type === "hashtag"
            ? `#${state.activeExploreFilter.value} · ${publicPosts.length} public ${publicPosts.length === 1 ? "post" : "posts"}`
            : `${state.activeExploreFilter.value} · ${publicPosts.length} public ${publicPosts.length === 1 ? "post" : "posts"}`
            : "Trending · ranked by views · updates hourly";
    }
    observePostVideos(exploreGrid);
    renderExploreSearchResults();
}

export function renderExploreTile(post) {
    const warning = mediaNeedsWarning(post) && !state.revealedMediaKeys.has(`post:${post.id}`);
    return `
    <article class="explore-tile explore-thumbnail" data-id="${post.id}" data-profile-media-type="post" data-profile-media-id="${post.id}" tabindex="0" role="button" aria-label="Open ${escapeHtml(post.user)}'s post">
      <div class="explore-tile-media-wrap">
        ${warning ? `<div class="sensitive-thumbnail"><img class="explore-media" src="${escapeHtml(post.cover || post.poster || post.media)}" alt="Sensitive content obscured" /><span>Sensitive content</span></div>` : post.cover ? `<img class="explore-media" src="${escapeHtml(post.cover)}" alt="${escapeHtml(post.user)} cover" />` : renderMedia(post, "explore-media")}
        <span class="explore-tile-overlay"><img src="${escapeHtml(visibleAvatar(post.handle, post.avatar))}" alt="" /><span>${escapeHtml(post.user)}</span><span class="explore-view-count">◉ ${formatCount(postViews(post))}</span></span>
      </div>
    </article>
  `;
}

export function getSearchableAccounts() {
    const accounts = new Map();
    const addAccount = ({ handle, name, user, avatar }) => {
        if (!handle || handle.startsWith('group:') || handle === currentUser.handle || state.blockedHandles.has(handle))
            return;
        const key = handle.toLocaleLowerCase();
        if (!accounts.has(key)) {
            accounts.set(key, { handle, name: name || user || handle, avatar: visibleAvatar(handle, avatar || currentUser.avatar) });
        }
    };
    addAccount({ handle: currentUser.handle, name: currentUser.name, avatar: currentUser.avatar });
    [...posts, ...reels, ...conversations, ...state.stories].forEach((item) => {
        addAccount({ handle: item.handle, name: item.name || item.user, avatar: item.avatar });
        (item.commentItems || []).forEach((comment) => {
            addAccount({ handle: comment.handle, name: comment.name || comment.user, avatar: comment.avatar });
        });
    });
    return [...accounts.values()];
}

export function getPublicHashtags() {
    const hashtags = new Map();
    posts.filter((post) => post.public && !post.reel && canViewMedia(post)).forEach((post) => {
        const postTags = new Set(post.caption.match(/#[\p{L}\p{N}_]+/gu) || []);
        postTags.forEach((tag) => {
            const key = normalizeSearchText(tag.slice(1));
            const entry = hashtags.get(key) || { name: tag.slice(1), count: 0 };
            entry.count += 1;
            hashtags.set(key, entry);
        });
    });
    return [...hashtags.values()];
}

export function renderSearchGroup(title, content) {
    return content ? `<div class="search-result-group"><p class="search-result-heading">${title}</p>${content}</div>` : "";
}

export function renderExploreSearchResults() {
    const rawQuery = exploreSearchInput.value.trim();
    if (!rawQuery) {
        exploreSearchResults.hidden = true;
        exploreSearchResults.replaceChildren();
        exploreSearchInput.setAttribute("aria-expanded", "false");
        return;
    }
    const isHashtagSearch = rawQuery.startsWith("#");
    const isUsernameSearch = rawQuery.startsWith("@");
    const query = normalizeSearchText(rawQuery.replace(/^[@#]/, ""));
    const sections = [];
    if (!isHashtagSearch) {
        const matchingAccounts = getSearchableAccounts()
            .map((account) => {
            const handle = normalizeSearchText(account.handle.replace(/^@/, ""));
            const name = normalizeSearchText(account.name);
            const rank = handle === query ? 0
                : handle.startsWith(query) ? 1
                    : name.startsWith(query) ? 2
                        : handle.includes(query) ? 3
                            : name.includes(query) ? 4
                                : Infinity;
            return { ...account, rank };
        })
            .filter((account) => Number.isFinite(account.rank))
            .sort((left, right) => left.rank - right.rank || left.name.localeCompare(right.name))
            .slice(0, 6);
        const peopleMarkup = matchingAccounts.map((account) => `
      <div class="search-result-row">
        <button class="search-result search-result-main" type="button" role="option" data-profile-handle="${escapeHtml(account.handle)}">
          <img src="${escapeHtml(account.avatar)}" alt="" />
          <span><strong>${escapeHtml(account.name)}</strong><small>${escapeHtml(account.handle)}</small></span>
        </button>
        <button class="search-follow-button" type="button" data-follow-kind="account" data-follow-value="${escapeHtml(account.handle)}" aria-pressed="${isFollowed("account", account.handle)}">
          ${isFollowed("account", account.handle) ? "Following" : "Follow"}
        </button>
      </div>
    `).join("");
        sections.push(renderSearchGroup("People", peopleMarkup));
    }
    if (isHashtagSearch) {
        const matchingHashtags = getPublicHashtags()
            .filter((tag) => normalizeSearchText(tag.name).includes(query))
            .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
            .slice(0, 6);
        const hashtagsMarkup = matchingHashtags.map((tag) => `
      <div class="search-result-row">
        <button class="search-result search-category-result search-result-main" type="button" role="option" data-search-kind="hashtag" data-search-value="${escapeHtml(tag.name)}">
          <span class="search-result-icon">#</span>
            <span><strong>#${escapeHtml(tag.name)}</strong><small>${tag.count} public ${tag.count === 1 ? "post" : "posts"}</small></span>
        </button>
        <button class="search-follow-button" type="button" data-follow-kind="hashtag" data-follow-value="${escapeHtml(tag.name)}" aria-pressed="${isFollowed("hashtag", tag.name)}">
          ${isFollowed("hashtag", tag.name) ? "Following" : "Follow"}
        </button>
      </div>
    `).join("");
        sections.push(renderSearchGroup("Hashtags", hashtagsMarkup));
    }
    else if (!isUsernameSearch) {
        const locations = new Map();
        posts.filter((post) => post.public && !post.reel && canViewMedia(post) && post.location?.trim()).forEach((post) => {
            const key = normalizeSearchText(post.location.trim());
            const entry = locations.get(key) || { name: post.location.trim(), count: 0 };
            entry.count += 1;
            locations.set(key, entry);
        });
        const locationMarkup = [...locations.values()]
            .filter((location) => normalizeSearchText(location.name).includes(query))
            .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
            .slice(0, 4)
            .map((location) => `
        <button class="search-result search-category-result" type="button" role="option" data-search-kind="location" data-search-value="${escapeHtml(location.name)}">
          <span class="search-result-icon">⌖</span>
          <span><strong>${escapeHtml(location.name)}</strong><small>${location.count} public ${location.count === 1 ? "post" : "posts"}</small></span>
        </button>
      `).join("");
        sections.push(renderSearchGroup("Places", locationMarkup));
        const communityMarkup = communities
            .filter((community) => normalizeSearchText(`${community.name} ${community.description}`).includes(query))
            .slice(0, 4)
            .map((community) => `
        <div class="search-result-row">
          <button class="search-result search-category-result search-result-main" type="button" role="option" data-search-kind="community" data-search-value="${escapeHtml(community.id)}">
            <span class="search-result-icon">◎</span>
            <span><strong>${escapeHtml(community.name)}</strong><small>${formatCount(community.members + (state.joinedCommunityIds.has(community.id) ? 1 : 0))} members · ${state.joinedCommunityIds.has(community.id) ? "Joined" : "Community"}</small></span>
          </button>
          <button class="search-follow-button" type="button" data-follow-kind="community" data-follow-value="${escapeHtml(community.id)}" aria-pressed="${isFollowed("community", community.id)}">
            ${isFollowed("community", community.id) ? "Following" : "Follow"}
          </button>
        </div>
      `).join("");
        sections.push(renderSearchGroup("Communities", communityMarkup));
    }
    exploreSearchResults.innerHTML = sections.some(Boolean)
        ? sections.join("")
        : '<p class="search-results-empty" role="option" aria-disabled="true">No matching people, places, hashtags, or communities.</p>';
    exploreSearchResults.hidden = false;
    exploreSearchInput.setAttribute("aria-expanded", "true");
}

export function handleExploreSearchInput() {
    state.activeExploreFilter = null;
    state.activeCommunityId = null;
    if (state.currentView === "explore")
        renderExplore();
    else
        renderExploreSearchResults();
}
