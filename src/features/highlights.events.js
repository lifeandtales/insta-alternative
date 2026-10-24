import { showShareFeedback } from '../components/feedback.js';
import { state } from '../core/state.js';
import { currentUser } from '../data/sample-data.js';
import {
    closeHighlightDeleteConfirmation,
    closeHighlightPicker,
    deleteStoryHighlight,
    openHighlightPicker,
    openStoryHighlight,
} from './highlights.js';
import { renderProfile } from './profile.js';
import { persistStoryHighlights } from '../storage/browser-storage.js';
import { mayInteract } from '../core/social.js';

export function handleHighlightClick(event) {
    const reorder = event.target.closest('[data-highlight-move]');
    if (reorder) {
        if (!mayInteract()) return true;
        const own = state.storyHighlights.filter(item => item.handle === currentUser.handle && !item.archived);
        const index = own.findIndex(item => item.id === reorder.dataset.highlightMove);
        const other = own[index + Number(reorder.dataset.direction)];
        if (other) {
            const left = state.storyHighlights.indexOf(own[index]), right = state.storyHighlights.indexOf(other);
            [state.storyHighlights[left], state.storyHighlights[right]] = [state.storyHighlights[right], state.storyHighlights[left]];
            persistStoryHighlights().then(renderProfile).catch(() => showShareFeedback('Highlight order could not be saved.'));
        }
        return true;
    }
    if (event.target.closest("[data-highlight-create]")) {
        openHighlightPicker();
        return true;
    }
    if (event.target.closest("[data-highlight-archive-toggle]")) {
        state.showArchivedHighlights = !state.showArchivedHighlights;
        renderProfile();
        return true;
    }
    const highlightButton = event.target.closest("[data-highlight-id]");
    if (highlightButton) {
        openStoryHighlight(highlightButton.dataset.highlightId);
        return true;
    }
    if (event.target.closest(".highlight-create-close") || event.target === document.querySelector(".highlight-create-backdrop")) {
        closeHighlightPicker();
        return true;
    }
    return false;
}

export function registerHighlightEvents() {
    document.getElementById('highlight-existing').addEventListener('change', event => {
        const highlight = state.storyHighlights.find(item => item.id === event.target.value);
        const input = document.getElementById('highlight-title');
        input.value = highlight?.title || '';
        input.required = !highlight;
        if (highlight) document.getElementById('highlight-audience').value = highlight.audience || 'all';
    });
    document.querySelector(".highlight-create-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!mayInteract()) return;
        const targetId = state.editingStoryHighlightId || document.getElementById('highlight-existing').value;
        const title = document.getElementById("highlight-title").value.trim();
        if ([...title].length > 15) { showShareFeedback('Highlight names can contain up to 15 characters.'); return; }
        const selectedIds = new Set([...document.querySelectorAll('input[name="highlight-story"]:checked')].map((input) => input.value));
        const editingHighlight = targetId ? state.storyHighlights.find((item) => item.id === targetId && item.handle === currentUser.handle)
            : null;
        const availableStories = editingHighlight
            ? [...state.stories.filter((story) => story.handle === currentUser.handle), ...editingHighlight.stories]
            : state.stories.filter((story) => story.handle === currentUser.handle);
        const selectedStories = state.highlightStoryToAdd ? [...(editingHighlight?.stories || []).filter(item => item.id !== state.highlightStoryToAdd.id), state.highlightStoryToAdd]
            : [...new Map(availableStories
                    .filter((story) => selectedIds.has(String(story.id)))
                    .map((story) => [String(story.id), story])).values()];
        if (!title || !selectedStories.length) {
            showShareFeedback(!title ? "Add a name for your highlight." : "Choose at least one story for your highlight.");
            return;
        }
        if (state.editingStoryHighlightId && !editingHighlight) {
            closeHighlightPicker();
            showShareFeedback("This highlight is no longer available to edit.");
            return;
        }
        const previousHighlight = editingHighlight ? { ...editingHighlight, stories: [...editingHighlight.stories] } : null;
        const highlight = {
            ...(editingHighlight || {}),
            id: editingHighlight?.id || `highlight-${Date.now()}`,
            handle: currentUser.handle,
            title,
            audience: document.getElementById('highlight-audience').value,
            closeFriendHandles: [...state.closeFriendHandles],
            stories: selectedStories.map((story) => ({ ...story }))
        };
        const coverFile = document.getElementById('highlight-cover').files?.[0];
        if (coverFile) {
            try { highlight.cover = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(coverFile); }); }
            catch { showShareFeedback('The cover photo could not be read.'); return; }
        }
        if (editingHighlight) {
            Object.assign(editingHighlight, highlight);
        }
        else {
            state.storyHighlights.push(highlight);
        }
        const submitButton = document.querySelector(".highlight-create-submit");
        submitButton.disabled = true;
        try {
            await persistStoryHighlights();
        }
        catch (error) {
            if (editingHighlight && previousHighlight)
                Object.assign(editingHighlight, previousHighlight);
            else
                state.storyHighlights.pop();
            console.error("Could not save story highlight", error);
            showShareFeedback("This highlight couldn't be saved in browser storage.");
            return;
        }
        finally {
            submitButton.disabled = false;
        }
        closeHighlightPicker();
        renderProfile();
        showShareFeedback(editingHighlight ? "Your highlight was updated." : "Your story highlight was created.");
    });
    document.getElementById("highlight-delete-cancel").addEventListener("click", () => closeHighlightDeleteConfirmation());
    document.querySelector(".highlight-delete-confirm").addEventListener("click", deleteStoryHighlight);
    document.querySelector(".highlight-delete-backdrop").addEventListener("click", (event) => {
        if (event.target === event.currentTarget)
            closeHighlightDeleteConfirmation();
    });
}
