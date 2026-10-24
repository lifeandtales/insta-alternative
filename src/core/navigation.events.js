import { openAccountSettings } from '../features/account-settings.js';
import { openNotifications } from '../features/notifications.js';
import { setView } from './navigation.js';
import { state } from './state.js';
import { currentUser } from '../data/sample-data.js';

export function handleNavigationClick(event) {
    const viewButton = event.target.closest("[data-view]");
    if (viewButton) {
        if (viewButton.dataset.view === "profile") {
            state.profileHandle = currentUser.handle;
            state.activeProfileSection = "posts";
        }
        setView(viewButton.dataset.view);
        return true;
    }
    return false;
}

export function handlePlaceholderClick(event) {
    if (event.target.closest(".home-notifications")) {
        openNotifications(event.target.closest('.home-notifications'));
        return true;
    }
    if (event.target.closest(".profile-settings-button")) {
        openAccountSettings();
        return true;
    }
    return false;
}
