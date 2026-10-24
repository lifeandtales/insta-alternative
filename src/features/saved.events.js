import { showShareFeedback } from '../components/feedback.js';
import { state } from '../core/state.js';
import { findEntity } from '../data/entities.js';
import { currentUser, posts, reels } from '../data/sample-data.js';
import { renderProfile } from './profile.js';
import { getSavedItemKey, persistSavedItems } from '../storage/browser-storage.js';
import { mayInteract, canViewMedia } from '../core/social.js';

export function handleSaveClick(event) {
    const saveButton = event.target.closest('[data-action="toggle-save"]');
    if (saveButton) {
        const type = saveButton.dataset.entityType;
        const entity = findEntity(type, Number(saveButton.dataset.entityId));
        if (!entity || !mayInteract() || !canViewMedia(entity))
            return true;
        const key = getSavedItemKey(type, entity.id);
        if (state.savedItems.has(key))
            state.savedItems.delete(key);
        else
            state.savedItems.add(key);
        const persisted = persistSavedItems();
        document.querySelectorAll(`[data-action="toggle-save"][data-entity-type="${type}"][data-entity-id="${entity.id}"]`).forEach((button) => {
            const saved = state.savedItems.has(key);
            button.classList.toggle("saved", saved);
            button.setAttribute("aria-pressed", String(saved));
            button.setAttribute("aria-label", `${saved ? "Remove from" : "Save to"} your collection`);
            button.title = saved ? "Remove from saved" : "Save";
        });
        if (state.currentView === "profile" && state.profileHandle === currentUser.handle && state.activeProfileSection === "saved")
            renderProfile();
        else if (state.currentView === "profile" && state.profileHandle === currentUser.handle) {
            const tabCount = document.querySelector('[data-profile-section="saved"] span');
            const count = posts.filter((post) => state.savedItems.has(getSavedItemKey("post", post.id))).length
                + reels.filter((reel) => state.savedItems.has(getSavedItemKey("reel", reel.id))).length;
            if (tabCount)
                tabCount.textContent = String(count);
        }
        const action = state.savedItems.has(key) ? "Added to your saved collection." : "Removed from your saved collection.";
        showShareFeedback(persisted ? action : `${action} It will last for this session only because browser storage is unavailable.`);
        return true;
    }
    return false;
}
