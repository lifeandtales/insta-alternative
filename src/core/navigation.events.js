import { openAccountSettings } from '../features/account-settings.js';
import { openNotifications } from '../features/notifications.js';
import { setView } from './navigation.js';
import { state } from './state.js';
import { currentUser } from '../data/sample-data.js';

export function registerMobileNavigationGestures(nav) {
    let start;
    nav.addEventListener('touchstart', event => {
        start = event.touches.length === 1 ? event.touches[0] : null;
    }, { passive: true });
    nav.addEventListener('touchmove', event => {
        if (!start || !event.cancelable) return;
        const touch = event.touches[0];
        if (Math.hypot(touch.clientX - start.clientX, touch.clientY - start.clientY) >= 8) {
            event.preventDefault();
        }
    }, { passive: false });
}

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
