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

export function setView(view) {
    if (syncDeletionLock()) return;
    if (!viewSections[view])
        return;
    const previousView = state.currentView;
    if (previousView !== view) {
        document.querySelectorAll('video').forEach(video => video.pause());
        if (state.pendingVideoTap) { clearTimeout(state.pendingVideoTap.timer); state.pendingVideoTap = null; }
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
