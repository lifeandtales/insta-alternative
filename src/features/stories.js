import { renderStoryDrafts } from './story-drafts.js';
import { canViewStory, isFollowing, mayInteract, canViewMedia, mediaNeedsWarning } from '../core/social.js';
import { showShareFeedback } from '../components/feedback.js';
import { state } from '../core/state.js';
import { escapeHtml, toDateTimeLocalValue } from '../core/utils.js';
import { currentUser, posts } from '../data/sample-data.js';
import { updateSoundButton } from '../media/video.js';
import { persistActiveStories } from '../storage/browser-storage.js';
import { applyStoryComposition, storyVideoRange } from './story-composition.js';
import { syncStoryOptionButtons, openStoryExitDialog, closeStoryExitDialog } from './story-options.js';
import { stopStoryCamera } from './story-camera.js';
let storyCreatorTrigger;

export function getStoryGroups() {
    const groupedStories = new Map();
    state.stories.forEach((story) => {
        if (!Number.isFinite(story.expiresAt)) {
            story.createdAt = Date.now();
            story.expiresAt = story.createdAt + state.storyLifetimeMs;
        }
        if (!state.storyExpiryTimers.has(story.id)) {
            state.storyExpiryTimers.set(story.id, window.setTimeout(() => expireStory(story.id), Math.max(0, story.expiresAt - Date.now())));
        }
        if (!canViewStory(story) || state.mutedStoryHandles.has(story.handle)) return;
        if (story.expiresAt <= Date.now())
            return;
        if (!story.mine && story.handle !== currentUser.handle && !isFollowing(story.handle))
            return;
        const group = groupedStories.get(story.handle) || { handle: story.handle, user: story.user, avatar: story.avatar, stories: [] };
        group.stories.push(story);
        groupedStories.set(story.handle, group);
    });
    return [...groupedStories.values()];
}

export function expireStory(id) {
    state.storyExpiryTimers.delete(id);
    const story = state.stories.find((item) => item.id === id);
    if (!story || story.expiresAt > Date.now())
        return;
    state.stories = state.stories.filter((item) => item.id !== id);
    const highlightedMedia = new Set(state.storyHighlights.flatMap((highlight) => highlight.stories.map((item) => item.media)));
    if (story.media.startsWith("blob:") && !highlightedMedia.has(story.media))
        URL.revokeObjectURL(story.media);
    if (state.activeStorySequence[state.activeStoryIndex]?.id === id && !state.activeStorySequence[state.activeStoryIndex]?.fromHighlight) {
        closeStoryViewer();
    }
    persistActiveStories().catch((error) => {
        console.error("Could not update expired stories in browser storage", error);
        showShareFeedback("An expired story couldn't be removed from browser storage.");
    });
    renderStories();
    showShareFeedback(story.handle === currentUser.handle
        ? "Your story expired after 24 hours."
        : `${story.user}'s story expired after 24 hours.`);
}

export function renderStories() {
    const list = document.getElementById("stories-list");
    const groups = getStoryGroups();
    const ownStories = groups.find((group) => group.handle === currentUser.handle);
    const otherStories = groups.filter((group) => group.handle !== currentUser.handle);
    list.innerHTML = `
    <div class="story-own-group"><button class="story-item story-own" type="button" data-story-owner="${currentUser.handle}">
      <span class="story-ring ${ownStories ? "has-story" : ""}">
        <img src="${currentUser.avatar}" alt="" />
        ${ownStories ? "" : '<span class="story-add-badge" aria-hidden="true">+</span>'}
      </span>
      <span>${ownStories ? "Your story" : state.scheduledStories.size ? "Scheduled story" : "Add story"}</span>
    </button>${ownStories ? '<button class="story-add-control" type="button" aria-label="Add story"><span aria-hidden="true">+</span></button>' : ''}</div>
    ${otherStories.map((group) => `
      <button class="story-item" type="button" data-story-owner="${group.handle}">
        <span class="story-ring has-story"><img src="${group.avatar}" alt="" /></span>
        <span>${escapeHtml(group.user)}</span>
      </button>
    `).join("")}
  `;
}

export function openStoryCreator() {
    if (!mayInteract()) { showShareFeedback('Approval is required to publish stories.'); return; }
    stopStoryCamera();
    storyCreatorTrigger = document.activeElement;
    state.pendingStoryMedia = null;
    state.storyUploadSelection = null;
    if (state.storyUploadInputFallback?.timer) window.clearTimeout(state.storyUploadInputFallback.timer);
    state.storyUploadInputFallback = null;
    state.activeStoryDraftId = null;
    setStoryCreationStep(false);
    document.getElementById('story-upload').value = '';
    document.getElementById('story-schedule-time').value = '';
    document.getElementById('story-audience').value = 'all';
    syncStoryOptionButtons();
    document.querySelector('.story-draft-list').hidden = true;
    document.querySelector('.story-choose-drafts').setAttribute('aria-expanded', 'false');
    document.querySelector('.story-media-choices').hidden = false;
    document.querySelector('.story-camera-panel').hidden = true;
    const recordButton=document.querySelector('.story-camera-record');
    recordButton.disabled=false;recordButton.dataset.recording='false';recordButton.textContent='Record video';
    document.querySelector('.story-camera-capture').disabled=false;document.querySelector('.story-camera-switch').disabled=false;
    document.querySelector('.story-selected-preview').replaceChildren();
    document.getElementById('story-caption').value = '';
    document.querySelector('.story-publish-selected').disabled = true;
    document.querySelector('.story-save-draft').disabled = true;
    renderStoryDrafts(true);
    renderStoryPostPicker();
    document.querySelector(".story-create-backdrop").hidden = false;
    document.body.classList.add("story-overlay-open");
    document.querySelector(".story-create-close").focus();
    const scheduleInput = document.getElementById("story-schedule-time");
    scheduleInput.min = toDateTimeLocalValue(new Date(Date.now() + 60000));
}

export function setStoryCreationStep(editing) {
    syncStoryOptionButtons();
    const hasMedia = Boolean(editing && state.pendingStoryMedia);
    document.querySelector('.story-media-step').hidden = hasMedia;
    document.querySelector('.story-editor-step').hidden = !hasMedia;
    document.querySelector('.story-editor-settings-toggle').hidden = !hasMedia;
    document.querySelector('.story-create-dialog').classList.toggle('story-editing', hasMedia);
    document.querySelector('.story-create-backdrop').classList.toggle('story-editor-open', hasMedia);
    if (!hasMedia) document.querySelector('.story-selected-preview video')?.pause();
    if (!hasMedia) document.querySelectorAll('.story-selected-preview audio').forEach(audio=>audio.pause());
    document.getElementById('story-create-title').textContent = hasMedia ? 'Edit your story' : 'Choose a photo or video';
}

export function closeStoryCreator() {
    if (state.pendingStoryMedia) {
        openStoryExitDialog();
        return;
    }
    stopStoryCamera();
    closeStoryExitDialog();
    document.querySelector('.story-selected-preview video')?.pause();
    document.querySelectorAll('.story-selected-preview audio').forEach(audio=>audio.pause());
    document.querySelector(".story-create-backdrop").hidden = true;
    if (storyCreatorTrigger?.isConnected) storyCreatorTrigger.focus();
    if (document.querySelector(".story-viewer-backdrop").hidden &&
        document.querySelector(".story-settings-backdrop").hidden)
        document.body.classList.remove("story-overlay-open");
}

export function renderStoryPostPicker() {
    const availablePosts = posts.filter((post) => !post.reel && canViewMedia(post) && (post.mine || post.followed || post.public));
    document.querySelector(".story-post-list").innerHTML = availablePosts.map((post) => `
    <button class="story-post-choice" type="button" data-story-post-id="${post.id}">
      <img class="${mediaNeedsWarning(post) ? 'sensitive-picker-image' : ''}" src="${escapeHtml(post.cover || post.media)}" alt="${mediaNeedsWarning(post) ? 'Sensitive content obscured' : ''}" />
      <span><strong>${escapeHtml(post.user)}</strong><small>${escapeHtml(post.caption)}</small></span>
      <span class="story-post-share-icon" aria-hidden="true">＋</span>
    </button>
  `).join("");
}

export function scheduleOrPublishStory(story) {
    if (!mayInteract()) return false;
    story = { ...story, audience: document.getElementById('story-audience').value, closeFriendHandles: [...state.closeFriendHandles] };
    const scheduleInput = document.getElementById("story-schedule-time");
    if (!scheduleInput.value) {
        state.pendingStoryMedia = null;
        addStory(story);
        return true;
    }
    const scheduledAt = new Date(scheduleInput.value).getTime();
    if (!Number.isFinite(scheduledAt) || scheduledAt <= Date.now()) {
        showShareFeedback("Choose a future time to schedule your story.");
        return false;
    }
    const id = story.id || `scheduled-story-${Date.now()}`;
    const scheduledStory = { ...story, id, handle: currentUser.handle, user: currentUser.name, avatar: currentUser.avatar, mine: true };
    const publishWhenReady = () => {
        const remaining = scheduledAt - Date.now();
        if (remaining > 0) {
            state.scheduledStories.get(id).timer = window.setTimeout(publishWhenReady, Math.min(remaining, 2147000000));
            return;
        }
        state.scheduledStories.delete(id);
        const publishedAt = Date.now();
        state.stories.push({ ...scheduledStory, createdAt: publishedAt, expiresAt: publishedAt + state.storyLifetimeMs });
        renderStories();
        persistActiveStories().then(() => {
            showShareFeedback("Your scheduled story is now live.");
        }).catch((error) => {
            console.error("Could not save scheduled story", error);
            showShareFeedback("Your story is live, but couldn't be saved in browser storage.");
        });
    };
    state.scheduledStories.set(id, { story: scheduledStory, timer: 0, scheduledAt });
    state.pendingStoryMedia = null;
    state.scheduledStories.get(id).timer = window.setTimeout(publishWhenReady, Math.min(scheduledAt - Date.now(), 2147000000));
    renderStories();
    closeStoryCreator();
    scheduleInput.value = "";
    showShareFeedback(`Story scheduled for ${new Date(scheduledAt).toLocaleString()}.`);
    return true;
}

export async function addStory(story) {
    if (!mayInteract()) return;
    const createdAt = Date.now();
    state.stories.push({
        ...story,
        id: story.id || `story-${createdAt}`,
        handle: currentUser.handle,
        user: currentUser.name,
        avatar: currentUser.avatar,
        mine: true,
        createdAt,
        expiresAt: createdAt + state.storyLifetimeMs
    });
    renderStories();
    closeStoryCreator();
    document.getElementById("story-schedule-time").value = "";
    try {
        await persistActiveStories();
        showShareFeedback("Added to your story.");
    }
    catch (error) {
        console.error("Could not save story", error);
        showShareFeedback("Your story is live, but couldn't be saved in browser storage.");
    }
}

export function openStorySettings() {
    document.querySelector(".story-settings-backdrop").hidden = false;
    document.getElementById("story-allow-replies").checked = state.storySettings.allowReplies;
    document.getElementById("story-save-archive").checked = state.storySettings.saveToArchive;
    document.querySelector(".story-settings-close").focus();
}

export function closeStorySettings() {
    document.querySelector(".story-settings-backdrop").hidden = true;
    if (document.querySelector(".story-create-backdrop").hidden &&
        document.querySelector(".story-viewer-backdrop").hidden)
        document.body.classList.remove("story-overlay-open");
}

export function removeOwnStories() {
    if (!mayInteract()) return;
    const wasViewingOwnStories = state.activeStoryGroups[state.activeStoryGroupIndex]?.handle === currentUser.handle;
    const highlightedMedia = new Set(state.storyHighlights.flatMap((highlight) => highlight.stories.map((story) => story.media)));
    state.stories = state.stories.filter((story) => {
        if (story.handle !== currentUser.handle)
            return true;
        clearTimeout(state.storyExpiryTimers.get(story.id));
        state.storyExpiryTimers.delete(story.id);
        if (story.media.startsWith("blob:") && !highlightedMedia.has(story.media))
            URL.revokeObjectURL(story.media);
        return false;
    });
    state.scheduledStories.forEach(({ story, timer }) => {
        clearTimeout(timer);
        if (story.media.startsWith("blob:"))
            URL.revokeObjectURL(story.media);
    });
    state.scheduledStories.clear();
    persistActiveStories().catch(() => showShareFeedback('Story removal could not be saved.'));
    renderStories();
    if (wasViewingOwnStories)
        closeStoryViewer();
    showShareFeedback("Your stories were removed.");
}

export function showStoryOptions(toggle) {
    const menu = document.querySelector(".story-options-menu");
    const rect = toggle.getBoundingClientRect();
    const menuHeight = menu.scrollHeight || 184;
    menu.style.top = `${Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - menuHeight - 8))}px`;
    menu.style.left = `${Math.min(rect.right - 180, window.innerWidth - 188)}px`;
    menu.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
}

export function openStoryGroup(handle) {
    state.activeStoryHighlightId = null;
    if (handle === currentUser.handle && !getStoryGroups().some(group => group.handle === handle)) {
        openStoryCreator();
        return;
    }
    state.activeStoryGroups = getStoryGroups();
    state.activeStoryGroupIndex = state.activeStoryGroups.findIndex((item) => item.handle === handle);
    if (state.activeStoryGroupIndex < 0)
        return;
    state.activeStorySequence = state.activeStoryGroups[state.activeStoryGroupIndex].stories;
    state.activeStoryIndex = 0;
    document.querySelector(".story-viewer-backdrop").hidden = false;
    document.body.classList.add("story-overlay-open");
    showStoryAtIndex(0);
}

export function showStoryAtIndex(index) {
    if (state.deletionRequestedAt) { closeStoryViewer(); return; }
    if (index < 0 || index >= state.activeStorySequence.length) {
        const nextGroupIndex = state.activeStoryGroupIndex + (index < 0 ? -1 : 1);
        if (nextGroupIndex < 0 || nextGroupIndex >= state.activeStoryGroups.length) {
            if (index >= state.activeStorySequence.length)
                closeStoryViewer();
            return;
        }
        state.activeStoryGroupIndex = nextGroupIndex;
        state.activeStorySequence = state.activeStoryGroups[state.activeStoryGroupIndex].stories;
        index = index < 0 ? state.activeStorySequence.length - 1 : 0;
    }
    clearTimeout(state.storyAdvanceTimer);
    state.storyPaused = false;
    state.activeStoryIndex = index;
    const story = state.activeStorySequence[index];
    const isOwner = story.handle === currentUser.handle;
    const replyForm = document.querySelector('.story-reply-form');
    replyForm.hidden = isOwner || !state.storySettings.allowReplies;
    replyForm.reset();
    document.querySelector('.story-direct-highlight').hidden = !isOwner;
    document.querySelector('.story-viewers-button').hidden = !isOwner;
    const likeButton = document.querySelector('.story-like-button');
    likeButton.hidden = isOwner;
    story.likes = story.likes || [];
    story.liked = story.likes.some(person => person.handle === currentUser.handle);
    likeButton.setAttribute('aria-pressed', String(Boolean(story.liked)));
    likeButton.firstChild.textContent = story.liked ? '♥ ' : '♡ ';
    likeButton.querySelector('.story-like-count').textContent = story.likes.length ? String(story.likes.length) : '';
    const viewer = document.querySelector(".story-viewer");
    const stage = viewer.querySelector(".story-viewer-stage");
    stage.querySelectorAll('audio, video').forEach(media=>media.pause());
    const storySoundButton = viewer.querySelector(".story-sound-toggle");
    const storyOptionsToggle = viewer.querySelector(".story-options-toggle");
    const storySettingsToggle = viewer.querySelector(".story-settings-toggle");
    const storyOptionsMenu = viewer.querySelector(".story-options-menu");
    const highlight = state.activeStoryHighlightId ? state.storyHighlights.find((item) => item.id === state.activeStoryHighlightId)
        : null;
    const ownsActiveHighlight = Boolean(highlight && highlight.handle === currentUser.handle);
    storyOptionsMenu.hidden = true;
    storyOptionsToggle.setAttribute("aria-expanded", "false");
    storyOptionsToggle.hidden = story.handle !== currentUser.handle && !ownsActiveHighlight;
    storySettingsToggle.hidden = !isOwner || Boolean(story.fromHighlight);
    viewer.querySelector(".story-highlight-share").hidden = !ownsActiveHighlight;
    storyOptionsMenu.querySelectorAll("[data-story-option]").forEach((button) => {
        button.hidden = story.handle !== currentUser.handle || Boolean(story.fromHighlight);
    });
    storyOptionsMenu.querySelectorAll("[data-highlight-option]").forEach((button) => {
        button.hidden = !ownsActiveHighlight;
    });
    const archiveButton = storyOptionsMenu.querySelector('[data-highlight-option="archive"]');
    if (archiveButton)
        archiveButton.textContent = highlight?.archived ? "Restore to highlights" : "Archive";
    stage.querySelector("video")?.pause();
    storySoundButton.hidden = story.type !== "video";
    updateSoundButton(storySoundButton, true, "story");
    viewer.querySelector(".story-viewer-avatar").src = story.avatar;
    viewer.querySelector(".story-viewer-avatar").alt = `${story.user} profile`;
    viewer.querySelector(".story-viewer-user").textContent = story.user;
    viewer.querySelector(".story-viewer-caption").textContent = story.caption || "";
    viewer.querySelector(".story-progress-list").innerHTML = state.activeStorySequence.map((item, itemIndex) => `
    <span class="story-progress-track"><span class="story-progress-fill ${itemIndex < index ? "complete" : ""}"></span></span>
  `).join("");
    if (story.type === "video") {
        const video = document.createElement("video");
        video.className = "story-viewer-video";
        video.src = story.media;
        video.poster = story.poster || "";
        video.autoplay = true;
        video.muted = true;
        video.playsInline = true;
        stage.replaceChildren(video);
        video.play().catch((error) => {
            if (error.name !== "AbortError")
                showShareFeedback("This story video couldn't play.");
        });
        state.storyDurationMs = 15000;
        startStoryProgress(index);
        video.addEventListener("loadedmetadata", () => {
            if (index !== state.activeStoryIndex || !Number.isFinite(video.duration) || video.duration <= 0)
                return;
            state.storyDurationMs = storyVideoRange(story, video.duration).duration * 1000;
            startStoryProgress(index);
        }, { once: true });
        video.addEventListener("ended", () => {
            if (index === state.activeStoryIndex)
                showStoryAtIndex(index + 1);
        }, { once: true });
        video.addEventListener("error", () => {
            if (index === state.activeStoryIndex)
                startStoryProgress(index);
        }, { once: true });
    }
    else {
        const image = document.createElement("img");
        image.className = "story-viewer-image";
        image.src = story.media;
        image.alt = story.caption || `${story.user}'s story`;
        stage.replaceChildren(image);
        state.storyDurationMs = story.durationMs || 30000;
        startStoryProgress(index);
    }
    applyStoryComposition(stage, story);
    if (story.edits?.video?.muted) storySoundButton.hidden = true;
}

export function startStoryProgress(index) {
    if (index !== state.activeStoryIndex)
        return;
    clearTimeout(state.storyAdvanceTimer);
    state.storyProgressStartedAt = Date.now();
    state.storyRemainingMs = state.storyDurationMs;
    state.storyPaused = false;
    const fill = document.querySelectorAll(".story-progress-fill")[index];
    if (fill) {
        fill.classList.remove("complete");
        fill.style.transition = "none";
        fill.style.width = "0%";
        requestAnimationFrame(() => {
            fill.style.transition = `width ${state.storyDurationMs}ms linear`;
            fill.style.width = "100%";
        });
    }
    state.storyAdvanceTimer = window.setTimeout(() => showStoryAtIndex(index + 1), state.storyDurationMs);
}

export function closeStoryViewer() {
    clearTimeout(state.storyAdvanceTimer);
    document.querySelector(".story-viewer-backdrop").hidden = true;
    document.querySelector(".story-viewer-stage video")?.pause();
    document.querySelectorAll('.story-viewer-stage audio').forEach(audio=>audio.pause());
    document.querySelector(".story-sound-toggle").hidden = true;
    document.querySelector(".story-viewer-stage").replaceChildren();
    document.body.classList.remove("story-overlay-open");
    state.activeStorySequence = [];
    state.activeStoryGroups = [];
    state.activeStoryGroupIndex = -1;
    state.activeStoryIndex = -1;
    state.activeStoryHighlightId = null;
}

// Hold pauses both the visual progress and playback without restarting the story.
export function pauseStory() {
    if (state.storyPaused || !state.activeStorySequence.length) return;
    state.storyRemainingMs = Math.max(0, state.storyRemainingMs - (Date.now() - state.storyProgressStartedAt));
    state.storyPaused = true;
    clearTimeout(state.storyAdvanceTimer);
    const fill = document.querySelectorAll('.story-progress-fill')[state.activeStoryIndex];
    if (fill) {
        fill.style.transition = 'none';
        fill.style.width = `${100 * (1 - state.storyRemainingMs / state.storyDurationMs)}%`;
    }
    document.querySelector('.story-viewer-stage video')?.pause();
    document.querySelectorAll('.story-viewer-stage audio').forEach(audio=>audio.pause());
}
export function resumeStory() {
    if (state.deletionRequestedAt) { closeStoryViewer(); return; }
    if (!state.storyPaused || !state.activeStorySequence.length) return;
    state.storyPaused = false;
    state.storyProgressStartedAt = Date.now();
    const fill = document.querySelectorAll('.story-progress-fill')[state.activeStoryIndex];
    if (fill) requestAnimationFrame(() => {
        fill.style.transition = `width ${state.storyRemainingMs}ms linear`;
        fill.style.width = '100%';
    });
    document.querySelector('.story-viewer-stage video')?.play().catch(() => {});
    document.querySelectorAll('.story-viewer-stage audio').forEach(audio=>{
        if (!audio.ended && (!audio.dataset.segmentEnd || audio.currentTime<Number(audio.dataset.segmentEnd))) audio.play().catch(()=>{});
    });
    state.storyAdvanceTimer = window.setTimeout(() => showStoryAtIndex(state.activeStoryIndex + 1), state.storyRemainingMs);
}
