import { changeFollow, mayInteract } from '../core/social.js';
import { persistPreferences } from '../storage/preferences.js';
import { showShareFeedback } from '../components/feedback.js';
import { renderPostCards } from '../components/post-card.js';
import { state } from '../core/state.js';
import { normalizeSearchText } from '../core/utils.js';
import { currentUser, posts, reels } from '../data/sample-data.js';
import { renderExplore, renderExploreSearchResults } from './explore.js';
import { getHomeFeedItems } from './home.js';
import { renderProfile } from './profile.js';

export function isAccountFollowed(handle) {
    return state.followedAccountHandles.has(handle) ||
        [...posts, ...reels].some((item) => item.handle === handle && item.followed);
}

export function isFollowed(kind, value) {
    if (kind === "account")
        return isAccountFollowed(value);
    if (kind === "hashtag")
        return state.followedHashtags.has(normalizeSearchText(value.replace(/^#/, "")));
    if (kind === "community")
        return state.followedCommunityIds.has(value);
    return false;
}

export function toggleSessionFollow(kind, value) {
    if (!mayInteract()) return false;
    const followed = isFollowed(kind, value);
    if (kind === "account") {
        const result = changeFollow(value);
        if (result === 'unavailable') return false;
        persistPreferences();
    }
    else if (kind === "hashtag") {
        const hashtag = normalizeSearchText(value.replace(/^#/, ""));
        if (followed)
            state.followedHashtags.delete(hashtag);
        else
            state.followedHashtags.add(hashtag);
    }
    else if (kind === "community") {
        if (followed)
            state.followedCommunityIds.delete(value);
        else
            state.followedCommunityIds.add(value);
    }
    else {
        return false;
    }
    if (state.currentView === "home")
        renderPostCards(getHomeFeedItems());
    if (state.currentView === "explore")
        renderExplore();
    if (state.currentView === "profile" && kind === "account" && state.profileHandle === value)
        renderProfile();
    renderExploreSearchResults();
    showShareFeedback(followed ? "Updates unfollowed." : "Following preference saved.");
    return true;
}

export function getFollowedConnections() {
    const followedAccounts = new Map();
    [...posts, ...reels].filter((item) => isAccountFollowed(item.handle) && item.handle !== currentUser.handle).forEach((item) => {
        if (!followedAccounts.has(item.handle)) {
            followedAccounts.set(item.handle, { user: item.user, handle: item.handle, avatar: item.avatar });
        }
    });
    return [...followedAccounts.values()];
}
