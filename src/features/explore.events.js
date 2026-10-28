import { closeProfileMedia } from './profile.js';
import { showShareFeedback } from '../components/feedback.js';
import { exploreSearchInput, exploreSearchResults } from '../core/dom.js';
import { setView } from '../core/navigation.js';
import { state } from '../core/state.js';
import { handleExploreSearchInput, renderExplore, renderExploreSearchResults } from './explore.js';
import { persistJoinedCommunities } from '../storage/browser-storage.js';
import { mayInteract } from '../core/social.js';
import { openHashtagStories } from './stories.js';

export function handleExploreClick(event) {
    const hashtagStory = event.target.closest('[data-hashtag-stories]');
    if (hashtagStory) {
        openHashtagStories(hashtagStory.dataset.hashtagStories, renderExplore);
        return true;
    }
    const searchCategory = event.target.closest("[data-search-kind]");
    if (searchCategory) {
        if(searchCategory.classList.contains('caption-hashtag'))closeProfileMedia();
        if (searchCategory.dataset.searchKind === "community") {
            state.activeCommunityId = searchCategory.dataset.searchValue;
            state.activeExploreFilter = null;
        }
        else {
            state.activeCommunityId = null;
            state.activeExploreFilter = {
                type: searchCategory.dataset.searchKind,
                value: searchCategory.dataset.searchValue
            };
        }
        setView("explore");
        exploreSearchResults.hidden = true;
        exploreSearchInput.setAttribute("aria-expanded", "false");
        return true;
    }
    if (event.target.closest("[data-community-back]")) {
        state.activeCommunityId = null;
        state.activeExploreFilter = null;
        renderExplore();
        exploreSearchResults.hidden = true;
        exploreSearchInput.setAttribute("aria-expanded", "false");
        return true;
    }
    const communityJoinButton = event.target.closest("[data-community-join]");
    if (communityJoinButton) {
        if (!mayInteract()) { showShareFeedback('Approval is required to change community membership.'); return true; }
        const communityId = communityJoinButton.dataset.communityJoin;
        const wasMember = state.joinedCommunityIds.has(communityId);
        if (wasMember)
            state.joinedCommunityIds.delete(communityId);
        else
            state.joinedCommunityIds.add(communityId);
        if (!persistJoinedCommunities()) {
            if (wasMember)
                state.joinedCommunityIds.add(communityId);
            else
                state.joinedCommunityIds.delete(communityId);
            showShareFeedback("Your community membership couldn't be saved in this browser.");
            return true;
        }
        renderExplore();
        exploreSearchResults.hidden = true;
        exploreSearchInput.setAttribute("aria-expanded", "false");
        showShareFeedback(wasMember ? "You left the community." : "You joined the community.");
        return true;
    }
    return false;
}

export function registerExploreSearchEvents() {
    exploreSearchInput.addEventListener("input", handleExploreSearchInput);
    exploreSearchInput.addEventListener("focus", renderExploreSearchResults);
    document.addEventListener("click", (event) => {
        if (!event.target.closest(".search-wrap") && !event.target.closest("[data-follow-kind]")) {
            exploreSearchResults.hidden = true;
            exploreSearchInput.setAttribute("aria-expanded", "false");
        }
    });
}
