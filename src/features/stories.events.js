import { handleStoryDraftManagement } from './story-drafts.js';
import { showHomePanel } from './home-controls.js';
import { escapeHtml } from '../core/utils.js';
import { persistSession, unexpiredDrafts } from '../storage/local-session.js';
import { conversations } from '../data/sample-data.js';
import { mayInteract, canViewMedia } from '../core/social.js';
import { appendChatMessage } from './messages.js';
import { showShareFeedback } from '../components/feedback.js';
import { storyViewer } from '../core/dom.js';
import { state } from '../core/state.js';
import { currentUser, posts } from '../data/sample-data.js';
import { getSupportedStoryFileType } from './create.js';
import { prepareStoryTools } from './story-tools.js';
import { setStoryDraftSaving } from './story-options.js';
import {
    archiveStoryHighlight,
    openHighlightDeleteConfirmation,
    openHighlightEditor,
    openHighlightPicker,
} from './highlights.js';
import { openHighlightShareDialog } from './sharing.js';
import {
    pauseStory,
    resumeStory,
    closeStoryCreator,
    closeStorySettings,
    closeStoryViewer,
    openStoryCreator,
    openStoryGroup,
    openStorySettings,
    removeOwnStories,
    scheduleOrPublishStory,
    showStoryAtIndex,
    showStoryOptions,
    setStoryCreationStep,
} from './stories.js';

export function handleStoryMenuClick(event) {
    const storyOptionsToggle = event.target.closest(".story-options-toggle");
    if (storyOptionsToggle) {
        const menu = document.querySelector(".story-options-menu");
        if (menu.hidden)
            showStoryOptions(storyOptionsToggle);
        else {
            menu.hidden = true;
            storyOptionsToggle.setAttribute("aria-expanded", "false");
        }
        return true;
    }
    const storyOption = event.target.closest("[data-story-option]");
    if (storyOption) {
        if (!mayInteract()) return true;
        document.querySelector(".story-options-menu").hidden = true;
        document.querySelector(".story-viewer .story-options-toggle").setAttribute("aria-expanded", "false");
        if (storyOption.dataset.storyOption === "remove") {
            removeOwnStories();
        }
        else if (storyOption.dataset.storyOption === "schedule") {
            openStoryCreator();
            document.getElementById("story-upload").focus();
        }
        else if (storyOption.dataset.storyOption === "settings") {
            document.body.classList.add("story-overlay-open");
            openStorySettings();
        }
        else if (storyOption.dataset.storyOption === "highlight") {
            openHighlightPicker(state.activeStorySequence[state.activeStoryIndex]);
        }
        return true;
    }
    const highlightOption = event.target.closest("[data-highlight-option]");
    if (highlightOption) {
        if (!mayInteract()) return true;
        const highlight = state.storyHighlights.find((item) => item.id === state.activeStoryHighlightId && item.handle === currentUser.handle);
        document.querySelector(".story-options-menu").hidden = true;
        document.querySelector(".story-viewer .story-options-toggle").setAttribute("aria-expanded", "false");
        if (!highlight)
            return true;
        if (highlightOption.dataset.highlightOption === "edit")
            openHighlightEditor(highlight);
        else if (highlightOption.dataset.highlightOption === "delete")
            openHighlightDeleteConfirmation(highlight.id);
        else if (highlightOption.dataset.highlightOption === "archive")
            archiveStoryHighlight(highlight.id);
        return true;
    }
    if (event.target.closest(".story-highlight-share")) {
        const highlight = state.storyHighlights.find((item) => item.id === state.activeStoryHighlightId && item.handle === currentUser.handle);
        document.querySelector(".story-options-menu").hidden = true;
        document.querySelector(".story-viewer .story-options-toggle").setAttribute("aria-expanded", "false");
        if (highlight)
            openHighlightShareDialog(highlight);
        return true;
    }
    return false;
}

export function handleStoryOwnerClick(event) {
    if (event.target.closest('.story-add-control')) {
        openStoryCreator();
        return true;
    }
    const storyOwner = event.target.closest("[data-story-owner]");
    if (storyOwner) {
        openStoryGroup(storyOwner.dataset.storyOwner);
        return true;
    }
    return false;
}

export function handleStoryClick(event) {
    if(handleStoryDraftManagement(event))return true;
    const draftPicker = event.target.closest('.story-choose-drafts');
    if (draftPicker) {
        const list = document.querySelector('.story-draft-list');
        list.hidden = !list.hidden;
        draftPicker.setAttribute('aria-expanded', String(!list.hidden));
        return true;
    }
    if (event.target.closest('.story-preview-play')) {
        const video = document.querySelector('.story-selected-preview video');
        if (video && mayInteract()) {
            if (video.paused) video.play().catch(() => showShareFeedback('This video could not play. Try another supported video.'));
            else video.pause();
        }
        return true;
    }
    if (event.target.closest('.story-create-back')) {
        closeStoryCreator();
        return true;
    }
    const resumeDraft = event.target.closest('[data-story-draft], [data-resume-story-draft]');
    if (resumeDraft) {
        if (!mayInteract()) return true;
        const draft = unexpiredDrafts(state.draftItems).find(item => item.type === 'story' && item.id === (resumeDraft.dataset.storyDraft || resumeDraft.dataset.resumeStoryDraft));
        if (draft) {
            if (resumeDraft.dataset.resumeStoryDraft) {
                document.querySelector('.create-menu-backdrop').hidden = true;
                openStoryCreator();
            }
            state.pendingStoryMedia = { ...draft.story };
            state.activeStoryDraftId = draft.id;
            document.getElementById('story-caption').value = draft.story.caption || '';
            document.getElementById('story-audience').value = draft.story.audience || 'all';
            document.getElementById('story-schedule-time').value = draft.story.scheduledFor || '';
            renderSelectedStory();
        }
        return true;
    }
    if (event.target.closest('.story-save-draft')) {
        if (!state.pendingStoryMedia || !mayInteract()) return true;
        setStoryDraftSaving(true);
        const id = state.activeStoryDraftId || `story-draft-${Date.now()}`;
        const previousDrafts = state.draftItems;
        state.draftItems = state.draftItems.filter(item => item.id !== id);
        state.draftItems.push({ id, type: 'story', savedAt: Date.now(), story: { ...state.pendingStoryMedia, caption: document.getElementById('story-caption').value, audience: document.getElementById('story-audience').value, scheduledFor: document.getElementById('story-schedule-time').value } });
        persistSession().then(() => {
            setStoryDraftSaving(false);
            state.pendingStoryMedia = null;
            closeStoryCreator();
            showShareFeedback('Story draft saved for 7 days.');
        }).catch(() => {
            state.draftItems = previousDrafts;
            setStoryDraftSaving(false, 'Draft could not be saved. Keep editing or try again.');
            showShareFeedback('Draft could not be saved. Keep the editor open.');
        });
        return true;
    }
    if (event.target.closest('.story-publish-selected')) {
        if (!state.pendingStoryMedia) return true;
        if (!scheduleOrPublishStory({ ...state.pendingStoryMedia, caption: document.getElementById('story-caption').value })) return true;
        state.draftItems = state.draftItems.filter(item => item.id !== state.activeStoryDraftId);
        state.pendingStoryMedia = null;
        persistSession().catch(() => {});
        return true;
    }
    if (event.target.closest('.story-discard')) {
        state.pendingStoryMedia = null;
        state.activeStoryDraftId = null;
        document.getElementById('story-schedule-time').value = '';
        document.getElementById('story-audience').value = 'all';
        document.getElementById('story-caption').value = '';
        closeStoryCreator();
        document.querySelector('.story-selected-preview').replaceChildren();
        return true;
    }
    const storyPostChoice = event.target.closest("[data-story-post-id]");
    if (storyPostChoice) {
        const post = posts.find((item) => item.id === Number(storyPostChoice.dataset.storyPostId));
        if (!post || !canViewMedia(post))
            return true;
        scheduleOrPublishStory({
            sourcePostId: post.id,
            sensitive: Boolean(post.sensitive),
            audience: post.audience,
            type: post.mediaType === "video" ? "video" : "image",
            media: post.mediaType === "video" ? post.videoUrl : post.media,
            poster: post.media,
            caption: post.caption
        });
        return true;
    }
    if (event.target.closest(".story-create-close")) {
        closeStoryCreator();
        return true;
    }
    const settingsBackdrop = document.querySelector(".story-settings-backdrop");
    if (event.target.closest(".story-settings-close") || event.target === settingsBackdrop) {
        closeStorySettings();
        return true;
    }
    if (event.target.closest(".story-settings-save")) {
        if (!mayInteract()) return true;
        state.storySettings.allowReplies = document.getElementById("story-allow-replies").checked;
        state.storySettings.saveToArchive = document.getElementById("story-save-archive").checked;
        closeStorySettings();
        showShareFeedback("Story settings saved.");
        return true;
    }
    if (event.target.closest(".story-viewer-close") || event.target === document.querySelector(".story-viewer-backdrop")) {
        closeStoryViewer();
        return true;
    }
    if (event.target.closest('.story-nav') && Date.now() < (state.suppressStoryNavigationUntil || 0)) return true;
    if (event.target.closest('.story-like-button')) {
        if (!mayInteract()) { showShareFeedback('Approval is required to like a story.'); return true; }
        const story = state.activeStorySequence[state.activeStoryIndex];
        story.likes = story.likes || [];
        const liked = story.likes.some(person => person.handle === currentUser.handle);
        story.likes = liked ? story.likes.filter(person => person.handle !== currentUser.handle) : [...story.likes, {handle:currentUser.handle,name:currentUser.name,avatar:currentUser.avatar}];
        story.liked = !liked;
        const button = document.querySelector('.story-like-button');
        button.firstChild.textContent = story.liked ? '♥ ' : '♡ ';
        button.querySelector('.story-like-count').textContent = story.likes.length ? String(story.likes.length) : '';
        button.setAttribute('aria-pressed', String(story.liked));
        return true;
    }
    if (event.target.closest('.story-viewers-button')) {
        const story = state.activeStorySequence[state.activeStoryIndex];
        if (story.handle === currentUser.handle) { pauseStory(); showHomePanel('Story viewers and likes', `<h3>Viewers</h3>${(story.viewers || []).map(person => `<p>${escapeHtml(person.name || person.handle)}</p>`).join('') || '<p>No viewers yet.</p>'}<h3>Likes (${(story.likes || []).length})</h3>${(story.likes || []).map(person => `<p>${escapeHtml(person.name || person.handle)}</p>`).join('') || '<p>No likes yet.</p>'}`); }
        return true;
    }
    if (event.target.closest(".story-nav-previous")) {
        showStoryAtIndex(state.activeStoryIndex - 1);
        return true;
    }
    if (event.target.closest(".story-nav-next")) {
        showStoryAtIndex(state.activeStoryIndex + 1);
        return true;
    }
    return false;
}

export function registerStoryGestureEvents() {
    document.querySelector('.story-reply-form').addEventListener('submit', event => {
        event.preventDefault();
        const story = state.activeStorySequence[state.activeStoryIndex];
        const input = document.getElementById('story-reply');
        const text = input.value.trim();
        if (!story || !text || story.handle === currentUser.handle) return;
        if (!mayInteract()) { showShareFeedback('Approval is required to send messages.'); return; }
        let chat = conversations.find(item => item.handle === story.handle);
        if (!chat) {
            chat = { handle: story.handle, user: story.user, avatar: story.avatar, messages: [] };
            conversations.push(chat);
        }
        appendChatMessage(chat, { from: 'me', type: 'text', text: `Reply to story: ${text}`, storyId: story.id });
        input.value = '';
        input.blur();
        resumeStory();
        showShareFeedback('Story reply added to your conversation on this device.');
    });
    document.getElementById('story-reply').addEventListener('focus', pauseStory);
    document.getElementById('story-reply').addEventListener('blur', resumeStory);
    storyViewer.addEventListener("pointerdown", (event) => {
        if (event.target.closest('input, form, .story-actions, .story-viewer-header, .story-options-menu')) return;
        if (event.isPrimary) {
            state.storyTouchStart = { x: event.clientX, y: event.clientY, time: Date.now() };
            pauseStory();
        }
    });
    storyViewer.addEventListener("pointerup", (event) => {
        if (!state.storyTouchStart)
            return;
        const deltaX = event.clientX - state.storyTouchStart.x;
        const deltaY = event.clientY - state.storyTouchStart.y;
        const held = Date.now() - state.storyTouchStart.time > 250;
        state.storyTouchStart = null;
        resumeStory();
        if (held) {
            state.suppressStoryNavigationUntil = Date.now() + 350;
            return;
        }
        if (Math.abs(deltaX) < 60 || Math.abs(deltaX) <= Math.abs(deltaY) * 1.2)
            return;
        event.preventDefault();
        event.stopPropagation();
        showStoryAtIndex(state.activeStoryIndex + (deltaX < 0 ? 1 : -1));
    });
    storyViewer.addEventListener("pointercancel", () => { state.storyTouchStart = null; resumeStory(); });
}

export function registerStoryUploadEvents() {
    document.addEventListener('keydown', event => {
        const backdrop = document.querySelector('.story-create-backdrop');
        if (backdrop.hidden || !document.querySelector('.story-tools-backdrop').hidden || !document.querySelector('.story-option-backdrop').hidden || !document.querySelector('.story-exit-backdrop').hidden || event.key !== 'Tab') return;
        const controls = [...backdrop.querySelectorAll('button, input, select, summary, [tabindex="0"]')]
            .filter(control => !control.disabled && control.getClientRects().length);
        const first = controls[0], last = controls.at(-1);
        if (!first) return;
        if (event.shiftKey && (document.activeElement === first || !backdrop.contains(document.activeElement))) {
            event.preventDefault(); last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !backdrop.contains(document.activeElement))) {
            event.preventDefault(); first.focus();
        }
    });
    document.getElementById("story-upload").addEventListener("change", (event) => {
        const [file] = event.target.files;
        if (!file)
            return;
        if (!getSupportedStoryFileType(file)) {
            event.target.value = '';
            showShareFeedback("Choose a supported image or video file for your story.");
            return;
        }
        const type = getSupportedStoryFileType(file);
        state.pendingStoryMedia = { type, media: URL.createObjectURL(file), caption: '', durationMs: type === 'image' ? 30000 : undefined };
        state.activeStoryDraftId = null;
        renderSelectedStory();
        document.querySelector('.story-create-back').focus();
        event.target.value = "";
    });
}

function renderSelectedStory() {
    const story = state.pendingStoryMedia;
    setStoryCreationStep(Boolean(story));
    const container = document.querySelector('.story-selected-preview');
    container.replaceChildren();
    if (story) {
        const media = document.createElement(story.type === 'video' ? 'video' : 'img');
        media.src = story.media;
        media.alt = 'Selected story';
        media.setAttribute('aria-label', 'Selected story preview');
        media.className = story.type === 'video' ? 'story-viewer-video' : 'story-viewer-image';
        if (story.type === 'video') {
            media.controls = true; media.playsInline = true; media.preload = 'metadata';
            if (story.poster) media.poster = story.poster;
            const update = () => {
                const button = document.querySelector('.story-preview-play');
                button.textContent = media.paused ? '▶' : 'Ⅱ';
                button.setAttribute('aria-label', media.paused ? 'Play video preview' : 'Pause video preview');
            };
            media.addEventListener('play', update); media.addEventListener('pause', update); media.addEventListener('ended', update);
        }
        container.append(media);
    }
    const playButton = document.querySelector('.story-preview-play');
    playButton.hidden = !story || story.type !== 'video';
    playButton.textContent = '▶';
    playButton.setAttribute('aria-label', 'Play video preview');
    prepareStoryTools();
    document.querySelector('.story-publish-selected').disabled = !story;
    document.querySelector('.story-save-draft').disabled = !story;
}
