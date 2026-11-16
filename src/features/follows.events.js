import { refreshConnectedView } from '../core/navigation.js';
import { cloudPerson, toggleCloudFollow } from './cloud-people.js';
import { renderExploreSearchResults } from './explore.js';
import { renderProfile } from './profile.js';
import { state } from '../core/state.js';
import { mayInteract } from '../core/social.js';
import { showShareFeedback } from '../components/feedback.js';
import { toggleSessionFollow } from './follows.js';

const pending = new Set();

async function followCloudPerson(person, button) {
    if (pending.has(person.id) || !mayInteract() || state.blockedHandles.has(person.handle)) return;
    pending.add(person.id);
    button.disabled = true;
    try {
        showShareFeedback(await toggleCloudFollow(person));
        if (state.currentView === 'profile' && state.profileHandle === person.handle) {
            if (!person.followStatus) person.mutual = false;
            renderProfile();
            void refreshConnectedView('profile').catch(() => {});
        }
        if (state.currentView === 'explore') renderExploreSearchResults();
    } catch {
        showShareFeedback('Could not update the follow request. Try again.');
    } finally {
        pending.delete(person.id);
        button.disabled = false;
    }
}

export function handleFollowClick(event) {
    const followButton = event.target.closest("[data-follow-kind]");
    if (followButton) {
        const person = followButton.dataset.followKind === 'account' && cloudPerson(followButton.dataset.followValue);
        if (person) {
            void followCloudPerson(person, followButton);
            return true;
        }
        toggleSessionFollow(followButton.dataset.followKind, followButton.dataset.followValue);
        return true;
    }
    return false;
}
