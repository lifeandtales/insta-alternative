import { renderPostCards } from '../components/post-card.js';
import { appShell, viewHeading, viewSections } from './dom.js';
import { state } from './state.js';
import { renderExplore } from '../features/explore.js';
import { getHomeFeedItems } from '../features/home.js';
import { renderMessages } from '../features/messages.js';
import { renderProfile } from '../features/profile.js';
import { renderReels } from '../features/reels.js';
import { renderStories } from '../features/stories.js';
import { syncDeletionLock } from './account-lock.js';

const currentAppHistory = () => window.history.state && typeof window.history.state === 'object'
    ? window.history.state : {};

function writeAppHistory(view, conversation = null, replace = false) {
    const next = { ...currentAppHistory(), instaApp: { view, conversation } };
    window.history[replace ? 'replaceState' : 'pushState'](next, '', window.location.href);
}

export function pushConversationHistory(handle) {
    writeAppHistory('messages', handle);
}

export function returnToConversationList(handle) {
    const route = currentAppHistory().instaApp;
    if (route?.view === 'messages' && route.conversation === handle) {
        window.history.back();
        return true;
    }
    return false;
}

window.addEventListener('popstate', event => {
    const route = event.state?.instaApp;
    const view = viewSections[route?.view] ? route.view : 'home';
    const conversation = view === 'messages' ? route?.conversation || null : null;
    if (state.activeConversationHandle !== conversation)
        state.activeConversationHandle = conversation;
    if (state.currentView !== view) setView(view, { fromHistory: true });
    else if (view === 'messages') renderMessages();
});

export function setView(view, { fromHistory = false } = {}) {
    if (syncDeletionLock()) return;
    if (!viewSections[view])
        return;
    const previousView = state.currentView;
    if (!fromHistory) {
        if (previousView !== view) writeAppHistory(view, null);
        else if (!currentAppHistory().instaApp) writeAppHistory(view, state.activeConversationHandle, true);
    }
    if (previousView !== view) {
        document.querySelectorAll('video').forEach(video => video.pause());
        if (state.pendingVideoTap) { clearTimeout(state.pendingVideoTap.timer); state.pendingVideoTap = null; }
        if (view !== 'messages') state.activeConversationHandle = null;
    }
    state.currentView = view;
    const accessNotice = document.getElementById('account-access-notice');
    accessNotice.hidden = state.verificationStatus === 'approved' && !state.deletionRequestedAt;
    accessNotice.innerHTML = state.deletionRequestedAt ? 'Deletion request pending. <button type="button" data-settings-page="deletion">Review request</button>' : 'Verification pending · browsing only. <button type="button" data-settings-page="verification">Check status</button>';
    appShell.className = `app-shell view-${view}`;
    document.querySelectorAll("[data-view]").forEach((button) => {
        const isActive = button.dataset.view === view;
        if (button.matches(".nav-item, .mobile-nav-item"))
            button.classList.toggle("active", isActive);
        if (button.matches(".nav-item, .mobile-nav-item")) {
            if (isActive)
                button.setAttribute("aria-current", "page");
            else
                button.removeAttribute("aria-current");
        }
    });
    Object.entries(viewSections).forEach(([name, sections]) => {
        sections.forEach((section) => { section.hidden = name !== view; });
    });
    const titles = { explore: "Explore public posts", reels: "Reels", messages: "Messages", profile: "Profile" };
    viewHeading.hidden = view === 'home' || view === 'messages' || view === 'profile';
    viewHeading.textContent = titles[view] || "";
    if (view === "home") {
        renderStories();
        renderPostCards(getHomeFeedItems());
    }
    if (view === "explore" && previousView !== "explore")
        state.explorePostOrder = null;
    if (view === "explore")
        renderExplore();
    if (view === "reels")
        renderReels();
    if (view === "messages")
        renderMessages();
    if (view === "profile")
        renderProfile();
}
