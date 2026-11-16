import { cloudSavedKey, isMediaSaved, loadCloudSavedCollection, loadCloudSavedKeys, setCloudSaved } from '../storage/cloud-saved-items.js';
import { showShareFeedback } from '../components/feedback.js';
import { state } from '../core/state.js';
import { findEntity } from '../data/entities.js';
import { currentUser } from '../data/sample-data.js';
import { getSavedCollection, renderProfile } from './profile.js';
import { getSavedItemKey, persistSavedItems } from '../storage/browser-storage.js';
import { mayInteract, canViewMedia } from '../core/social.js';

export function syncVisibleSaveButtons() {
    document.querySelectorAll('[data-action="toggle-save"]').forEach(button => {
        const type = button.dataset.entityType;
        const entity = findEntity(type, Number(button.dataset.entityId));
        if (!entity) return;
        const saved = isMediaSaved(type, entity);
        button.classList.toggle('saved', saved);
        button.setAttribute('aria-pressed', String(saved));
        button.setAttribute('aria-label', `${saved ? 'Remove from' : 'Save to'} your collection`);
        button.title = saved ? 'Remove from saved' : 'Save';
    });
}

function renderSavedChange() {
    if (state.currentView === 'profile' && state.profileHandle === currentUser.handle) {
        if (state.activeProfileSection === 'saved') renderProfile();
        else {
            const count = document.querySelector('[data-profile-section="saved"] span');
            if (count) count.textContent = String(getSavedCollection().length);
        }
    }
    syncVisibleSaveButtons();
}

export async function refreshSavedState() {
    const refreshes = [loadCloudSavedKeys()];
    if (state.currentView === 'profile' && state.profileHandle === currentUser.handle) refreshes.push(loadCloudSavedCollection());
    await Promise.all(refreshes);
    renderSavedChange();
}

const pending = new Set();

async function saveConnectedMedia(entity, desired, key, button) {
    if (pending.has(key)) return;
    pending.add(key);
    button.disabled = true;
    try {
        await setCloudSaved(entity, desired);
        renderSavedChange();
        showShareFeedback(desired ? 'Added to your private Saved collection.' : 'Removed from your Saved collection.');
    } catch {
        showShareFeedback('Could not update Saved. Try again.');
    } finally {
        pending.delete(key);
        button.disabled = false;
    }
}

export function handleSaveClick(event) {
    const button = event.target.closest('[data-action="toggle-save"]');
    if (!button) return false;
    const type = button.dataset.entityType;
    const entity = findEntity(type, Number(button.dataset.entityId));
    if (!entity || !mayInteract() || !canViewMedia(entity)) return true;
    const desired = !isMediaSaved(type, entity);
    const cloudKey = cloudSavedKey(entity);
    if (state.signedInAccountId && cloudKey) {
        void saveConnectedMedia(entity, desired, cloudKey, button);
        return true;
    }
    const key = getSavedItemKey(type, entity.id);
    if (desired) state.savedItems.add(key);
    else state.savedItems.delete(key);
    const persisted = persistSavedItems();
    renderSavedChange();
    const action = desired ? 'Added to your saved collection.' : 'Removed from your saved collection.';
    showShareFeedback(persisted ? action : `${action} It will last for this session only because browser storage is unavailable.`);
    return true;
}
