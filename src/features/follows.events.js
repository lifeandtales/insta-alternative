import { toggleSessionFollow } from './follows.js';

export function handleFollowClick(event) {
    const followButton = event.target.closest("[data-follow-kind]");
    if (followButton) {
        toggleSessionFollow(followButton.dataset.followKind, followButton.dataset.followValue);
        return true;
    }
    return false;
}
