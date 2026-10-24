import { canViewStory, mayInteract, visibleHighlightStories } from '../core/social.js';
import { showShareFeedback } from '../components/feedback.js';
import { state } from '../core/state.js';
import { escapeHtml } from '../core/utils.js';
import { currentUser } from '../data/sample-data.js';
import { renderProfile } from './profile.js';
import { closeStoryViewer, showStoryAtIndex, startStoryProgress } from './stories.js';
import { persistStoryHighlights } from '../storage/browser-storage.js';

export function renderProfileHighlights(handle = currentUser.handle, isOwnProfile = handle === currentUser.handle) {
    const highlights = state.storyHighlights.filter((highlight) => highlight.handle === handle && !highlight.archived && (isOwnProfile || visibleHighlightStories(highlight).length));
    const archivedHighlights = state.storyHighlights.filter((highlight) => highlight.handle === currentUser.handle && highlight.archived);
    if (!isOwnProfile && !highlights.length)
        return "";
    return `
    <section class="profile-highlights" aria-label="Story highlights">
      ${isOwnProfile ? `<button class="profile-highlight-item profile-highlight-add" type="button" data-highlight-create>
        <span class="profile-highlight-cover"><span aria-hidden="true">+</span></span>
        <span>New</span>
      </button>` : ""}
      ${highlights.map((highlight) => {
        const visibleStories = isOwnProfile ? highlight.stories : visibleHighlightStories(highlight);
        const story = visibleStories[visibleStories.length - 1];
        const cover = highlight.cover ? `<img src="${escapeHtml(highlight.cover)}" alt="" />` : story.type === "video"
            ? `<video src="${escapeHtml(story.media)}" muted playsinline preload="metadata"></video>`
            : `<img src="${escapeHtml(story.media)}" alt="" />`;
        return `
          <button class="profile-highlight-item" type="button" data-highlight-id="${escapeHtml(highlight.id)}" aria-label="View ${escapeHtml(highlight.title)} highlight">
            <span class="profile-highlight-cover">${cover}</span>
            <span>${escapeHtml(highlight.title)}</span>
          </button>${isOwnProfile ? `<span class="highlight-order-controls"><button type="button" data-highlight-move="${escapeHtml(highlight.id)}" data-direction="-1" aria-label="Move ${escapeHtml(highlight.title)} earlier">←</button><button type="button" data-highlight-move="${escapeHtml(highlight.id)}" data-direction="1" aria-label="Move ${escapeHtml(highlight.title)} later">→</button></span>` : ''}
        `;
    }).join("")}
      ${isOwnProfile && archivedHighlights.length ? `
        <button class="profile-highlight-item profile-highlight-archive-toggle" type="button" data-highlight-archive-toggle aria-expanded="${state.showArchivedHighlights}">
          <span class="profile-highlight-cover"><span aria-hidden="true">▣</span></span>
          <span>Archive ${archivedHighlights.length}</span>
        </button>` : ""}
    </section>
    ${isOwnProfile && state.showArchivedHighlights && archivedHighlights.length ? `
      <section class="profile-highlights profile-highlights-archived" aria-label="Archived story highlights">
        ${archivedHighlights.map((highlight) => {
        const story = highlight.stories[highlight.stories.length - 1];
        const cover = highlight.cover ? `<img src="${escapeHtml(highlight.cover)}" alt="" />` : story.type === "video"
            ? `<video src="${escapeHtml(story.media)}" muted playsinline preload="metadata"></video>`
            : `<img src="${escapeHtml(story.media)}" alt="" />`;
        return `<button class="profile-highlight-item" type="button" data-highlight-id="${escapeHtml(highlight.id)}" aria-label="View archived ${escapeHtml(highlight.title)} highlight">
            <span class="profile-highlight-cover">${cover}</span><span>${escapeHtml(highlight.title)}</span>
          </button>`;
    }).join("")}
      </section>` : ""}
  `;
}

export function renderHighlightPicker(selectedIds = new Set(), additionalStories = []) {
    const storyMap = new Map();
    [...state.stories.filter((story) => story.handle === currentUser.handle), ...additionalStories].forEach((story) => {
        storyMap.set(String(story.id), story);
    });
    const ownStories = [...storyMap.values()];
    document.querySelector(".highlight-story-list").innerHTML = ownStories.length
        ? ownStories.map((story) => {
            const preview = story.type === "video"
                ? `<video src="${escapeHtml(story.media)}" muted playsinline preload="metadata"></video>`
                : `<img src="${escapeHtml(story.media)}" alt="" />`;
            return `
        <label class="highlight-story-choice">
          <input type="checkbox" name="highlight-story" value="${escapeHtml(String(story.id))}" ${selectedIds.has(String(story.id)) ? "checked" : ""} />
          ${preview}
          <span>${escapeHtml(story.caption || "Your story")}</span>
        </label>
      `;
        }).join("")
        : '<p class="highlight-story-empty">You have no active stories to add yet.</p>';
}

export function openHighlightPicker(story = null) {
    if (!mayInteract()) return;
    state.highlightStoryToAdd = story;
    state.editingStoryHighlightId = null;
    if (story && story.handle !== currentUser.handle)
        return;
    if (!story && !state.stories.some((item) => item.handle === currentUser.handle)) {
        showShareFeedback("Add a story first, then you can save it to a highlight.");
        return;
    }
    const existing = document.getElementById('highlight-existing');
    existing.hidden = !story;
    existing.innerHTML = '<option value="">Create new highlight</option>' + state.storyHighlights.filter(item => item.handle === currentUser.handle && !item.archived).map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.title)}</option>`).join('');
    document.getElementById('highlight-audience').value = story?.audience || 'all';
    document.getElementById('highlight-cover').value = '';
    const picker = document.querySelector(".highlight-story-picker");
    const title = document.getElementById("highlight-title");
    const isSingleStory = Boolean(story);
    document.getElementById("highlight-create-title").textContent = isSingleStory ? "Add to highlight" : "New story highlight";
    document.querySelector(".highlight-title-label").textContent = "Highlight name (up to 15 characters)";
    title.maxLength = 15;
    title.value = "";
    picker.hidden = isSingleStory;
    document.querySelector(".highlight-create-submit").textContent = isSingleStory ? "Save highlight" : "Create highlight";
    if (!isSingleStory)
        renderHighlightPicker();
    if (isSingleStory) {
        clearTimeout(state.storyAdvanceTimer);
        document.querySelector(".story-viewer-stage video")?.pause();
    }
    const backdrop = document.querySelector(".highlight-create-backdrop");
    backdrop.hidden = false;
    document.body.classList.add("story-overlay-open");
    title.focus();
}

export function openHighlightEditor(highlight) {
    if (!mayInteract()) return;
    document.getElementById('highlight-existing').hidden = true;
    document.getElementById('highlight-existing').value = '';
    document.getElementById('highlight-audience').value = highlight.audience || 'all';
    document.getElementById('highlight-cover').value = '';
    state.editingStoryHighlightId = highlight.id;
    state.highlightStoryToAdd = null;
    const title = document.getElementById("highlight-title");
    document.getElementById("highlight-create-title").textContent = "Edit highlight";
    document.querySelector(".highlight-title-label").textContent = "Highlight name (up to 15 characters)";
    title.maxLength = 15;
    title.value = highlight.title;
    const picker = document.querySelector(".highlight-story-picker");
    picker.hidden = false;
    renderHighlightPicker(new Set(highlight.stories.map((story) => String(story.id))), highlight.stories);
    document.querySelector(".highlight-create-submit").textContent = "Save changes";
    clearTimeout(state.storyAdvanceTimer);
    document.querySelector(".story-viewer-stage video")?.pause();
    document.querySelector(".highlight-create-backdrop").hidden = false;
    document.body.classList.add("story-overlay-open");
    title.focus();
}

export function closeHighlightPicker() {
    document.querySelector(".highlight-create-backdrop").hidden = true;
    state.highlightStoryToAdd = null;
    state.editingStoryHighlightId = null;
    if (document.querySelector(".story-viewer-backdrop").hidden) {
        document.body.classList.remove("story-overlay-open");
    }
    else if (state.activeStoryIndex >= 0) {
        const video = document.querySelector(".story-viewer-stage video");
        if (video) {
            video.play().catch((error) => {
                if (error.name !== "AbortError")
                    showShareFeedback("This story video couldn't resume.");
            });
        }
        startStoryProgress(state.activeStoryIndex);
    }
}

export function openStoryHighlight(id) {
    const highlight = state.storyHighlights.find((item) => item.id === id);
    if (!highlight)
        return;
    const visibleStories = visibleHighlightStories(highlight);
    const firstStory = visibleStories[0];
    if (!firstStory)
        return;
    state.activeStoryHighlightId = highlight.id;
    state.activeStoryGroups = [{
            handle: highlight.handle || firstStory.handle,
            user: firstStory.user,
            avatar: firstStory.avatar,
            stories: visibleStories.map((story) => ({ ...story, fromHighlight: true }))
        }];
    state.activeStoryGroupIndex = 0;
    state.activeStorySequence = state.activeStoryGroups[0].stories;
    state.activeStoryIndex = 0;
    document.querySelector(".story-viewer-backdrop").hidden = false;
    document.body.classList.add("story-overlay-open");
    showStoryAtIndex(0);
}

export async function archiveStoryHighlight(id) {
    if (!mayInteract()) return;
    const highlight = state.storyHighlights.find((item) => item.id === id && item.handle === currentUser.handle);
    if (!highlight)
        return;
    const previousArchived = Boolean(highlight.archived);
    clearTimeout(state.storyAdvanceTimer);
    document.querySelector(".story-viewer-stage video")?.pause();
    highlight.archived = !previousArchived;
    try {
        await persistStoryHighlights();
    }
    catch (error) {
        highlight.archived = previousArchived;
        const video = document.querySelector(".story-viewer-stage video");
        if (video) {
            video.play().catch((playError) => {
                if (playError.name !== "AbortError")
                    showShareFeedback("This highlight story couldn't resume.");
            });
        }
        startStoryProgress(state.activeStoryIndex);
        console.error("Could not update archived highlight", error);
        showShareFeedback("This highlight couldn't be updated in browser storage.");
        return;
    }
    state.showArchivedHighlights = highlight.archived || state.showArchivedHighlights;
    renderProfile();
    closeStoryViewer();
    showShareFeedback(highlight.archived ? "Highlight moved to your archive." : "Highlight restored to your profile.");
}

export function openHighlightDeleteConfirmation(id) {
    if (!mayInteract()) return;
    const highlight = state.storyHighlights.find((item) => item.id === id && item.handle === currentUser.handle);
    if (!highlight)
        return;
    state.deletingStoryHighlightId = id;
    document.getElementById("highlight-delete-name").textContent = `Delete "${highlight.title}" from your highlights?`;
    document.querySelector(".highlight-delete-backdrop").hidden = false;
    clearTimeout(state.storyAdvanceTimer);
    document.querySelector(".story-viewer-stage video")?.pause();
    document.getElementById("highlight-delete-cancel").focus();
}

export function closeHighlightDeleteConfirmation(resumeStory = true) {
    document.querySelector(".highlight-delete-backdrop").hidden = true;
    state.deletingStoryHighlightId = null;
    if (resumeStory && !document.querySelector(".story-viewer-backdrop").hidden && state.activeStoryIndex >= 0) {
        const video = document.querySelector(".story-viewer-stage video");
        if (video) {
            video.play().catch((error) => {
                if (error.name !== "AbortError")
                    showShareFeedback("This highlight story couldn't resume.");
            });
        }
        startStoryProgress(state.activeStoryIndex);
    }
}

export async function deleteStoryHighlight() {
    if (!mayInteract()) return;
    if (!state.deletingStoryHighlightId)
        return;
    const highlight = state.storyHighlights.find((item) => item.id === state.deletingStoryHighlightId && item.handle === currentUser.handle);
    if (!highlight) {
        closeHighlightDeleteConfirmation(false);
        return;
    }
    const index = state.storyHighlights.indexOf(highlight);
    state.storyHighlights.splice(index, 1);
    try {
        await persistStoryHighlights();
    }
    catch (error) {
        state.storyHighlights.splice(index, 0, highlight);
        console.error("Could not delete story highlight", error);
        showShareFeedback("This highlight couldn't be deleted from browser storage.");
        closeHighlightDeleteConfirmation();
        return;
    }
    closeHighlightDeleteConfirmation(false);
    renderProfile();
    closeStoryViewer();
    showShareFeedback("Highlight deleted.");
}
