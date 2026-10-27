import { handleStoryDraftManagement } from './story-drafts.js';
import { closeHomePanel, showHomePanel } from './home-controls.js';
import { escapeHtml } from '../core/utils.js';
import { persistSession, unexpiredDrafts } from '../storage/local-session.js';
import { persistPreferences } from '../storage/preferences.js';
import { conversations } from '../data/sample-data.js';
import { mayInteract, canViewMedia, canViewStory, getAccount } from '../core/social.js';
import { setView } from '../core/navigation.js';
import { appendChatMessage } from './messages.js';
import { showShareFeedback } from '../components/feedback.js';
import { storyViewer } from '../core/dom.js';
import { state } from '../core/state.js';
import { currentUser, posts } from '../data/sample-data.js';
import { getSupportedStoryFileType } from './create.js';
import { prepareStoryTools } from './story-tools.js';
import { setStoryDraftSaving } from './story-options.js';
import { applyStoryComposition, storyComposition, storyNeedsFullCanvasRepost } from './story-composition.js';
import { captureStoryPhoto, openStoryCamera, startStoryVideoRecording, stopStoryCamera, stopStoryVideoRecording, switchStoryCamera } from './story-camera.js';
import {
    archiveStoryHighlight,
    openHighlightDeleteConfirmation,
    openHighlightEditor,
    openHighlightPicker,
} from './highlights.js';
import { openHighlightShareDialog } from './sharing.js';
import { openShareDialog } from './sharing.js';
import { openReportPanel } from './home-controls.js';
import { copyStoryLink, openMediaFromHash } from '../core/media-links.js';
import {
    pauseStory,
    resumeStory,
    closeStoryCreator,
    closeStorySettings,
    closeStoryViewer,
    renderStories,
    openStoryCreator,
    openStoryGroup,
    openStorySettings,
    removeOwnStory,
    scheduleOrPublishStory,
    showStoryAtIndex,
    showStoryOptions,
    setStoryCreationStep,
    fitRepostMediaFrame,
    getRepostMediaFrameSize,
    createStoryRepostCredit,
} from './stories.js';

export function openStoryRepostEditor(activeStory) {
    if (!mayInteract() || !activeStory || !canViewStory(activeStory) || (activeStory.expiresAt && activeStory.expiresAt <= Date.now())) return false;
    const isOpenSource = state.activeStorySequence[state.activeStoryIndex]?.id === activeStory.id;
    const activeStoryMedia = isOpenSource ? document.querySelector('.story-viewer-stage img, .story-viewer-stage video') : null;
    const activeStoryCanvas = isOpenSource ? document.querySelector('.story-viewer-stage') : null;
    closeStoryViewer();
    openStoryCreator();
    const {
        id, handle, user, avatar, mine, likes, reactions, viewers, seen,
        createdAt, expiresAt, audience, closeFriendHandles, fromHighlight,
        archived, archivedAt, ...originalStory
    } = activeStory;
    state.pendingStoryMedia = {
        ...originalStory,
        repostSourceEdits: storyComposition(activeStory.edits),
        edits: storyComposition(),
        caption: activeStory.caption || '',
        repostFrameSize: storyNeedsFullCanvasRepost(activeStory, activeStoryMedia, activeStoryCanvas)
            ? null
            : getRepostMediaFrameSize(activeStoryMedia, .58),
        repostedStoryId: activeStory.id,
        repostedFromHandle: activeStory.handle,
        repostedFromUser: activeStory.user,
        repostedFromAvatar: activeStory.avatar,
        repostedSourcePostId: activeStory.sourcePostId || null,
        repostedFromCaption: activeStory.caption || '',
        repostFullCanvas: storyNeedsFullCanvasRepost(activeStory, activeStoryMedia, activeStoryCanvas),
    };
    state.activeStoryDraftId = null;
    document.getElementById('story-caption').value = state.pendingStoryMedia.caption;
    renderSelectedStory();
    document.querySelector('.story-create-back').focus();
    return true;
}

export function handleStoryMenuClick(event) {
    const reactionPicker = document.querySelector('.story-reaction-picker');
    const reactionButton = document.querySelector('.story-reaction-trigger');
    if (!reactionPicker.hidden && !event.target.closest('.story-reaction-picker, .story-reaction-trigger')) {
        reactionPicker.hidden = true;
        reactionButton.setAttribute('aria-expanded', 'false');
        resumeStory();
    }
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
        const activeStory = state.activeStorySequence[state.activeStoryIndex];
        document.querySelector(".story-options-menu").hidden = true;
        document.querySelector(".story-viewer .story-options-toggle").setAttribute("aria-expanded", "false");
        if (storyOption.dataset.storyOption === "share") {
            openShareDialog(activeStory, 'story');
        }
        else if (storyOption.dataset.storyOption === "copy-link") {
            copyStoryLink(activeStory);
        }
        else if (storyOption.dataset.storyOption === "repost") {
            openStoryRepostEditor(activeStory);
        }
        else if (storyOption.dataset.storyOption === "report") {
            pauseStory();
            openReportPanel(activeStory, 'story');
        }
        else if (storyOption.dataset.storyOption === "mute") {
            const wasMuted = state.mutedStoryHandles.has(activeStory.handle);
            if (wasMuted) state.mutedStoryHandles.delete(activeStory.handle);
            else state.mutedStoryHandles.add(activeStory.handle);
            persistPreferences();
            closeStoryViewer();
            renderStories();
            showShareFeedback(wasMuted ? `Stories from ${activeStory.user} are unmuted.` : `Stories from ${activeStory.user} are muted. You can unmute them in Story and feed settings.`);
        }
        else if (storyOption.dataset.storyOption === "remove") {
            removeOwnStory();
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
    const mention = event.target.closest('[data-story-mention-handle]');
    if (mention) {
        const handle = mention.dataset.storyMentionHandle;
        if (!getAccount(handle) || state.blockedHandles.has(handle)) return true;
        pauseStory();
        showHomePanel('Visit profile', `<button type="button" data-story-mention-profile="${escapeHtml(handle)}">Visit profile</button>`, { minimal: true, anchor: mention });
        return true;
    }
    const mentionProfile = event.target.closest('[data-story-mention-profile]');
    if (mentionProfile) {
        const handle = mentionProfile.dataset.storyMentionProfile;
        if (!getAccount(handle) || state.blockedHandles.has(handle)) return true;
        closeHomePanel();
        closeStoryViewer({ fromHistory: true });
        state.profileHandle = handle;
        state.activeProfileSection = 'posts';
        setView('profile');
        return true;
    }
    const repostVisit = event.target.closest('.story-repost-visit, .story-reposted-card');
    if (repostVisit) {
        const story = state.activeStorySequence[state.activeStoryIndex];
        if (!story?.repostedFromUser) return true;
        const targetType = story.repostedSourcePostId ? 'post' : 'story';
        const destination = targetType === 'post' ? `#post-${Number(story.repostedSourcePostId)}` : `#story-${encodeURIComponent(story.repostedStoryId || '')}`;
        pauseStory();
        showHomePanel('',
            `<button type="button" class="primary-btn" data-reposted-open="${escapeHtml(destination)}">Visit original story</button>`,
            { minimal: true });
        return true;
    }
    const visitOriginal = event.target.closest('[data-reposted-open]');
    if (visitOriginal) {
        const destination = visitOriginal.dataset.repostedOpen;
        closeHomePanel();
        if (!destination.startsWith('#story-')) closeStoryViewer({ fromHistory: true });
        openMediaFromHash(destination);
        return true;
    }
    const openCamera = event.target.closest('.story-open-camera');
    if (openCamera) {
        if (!mayInteract()) return true;
        const choices = document.querySelector('.story-media-choices'), panel = document.querySelector('.story-camera-panel');
        const video = panel.querySelector('.story-camera-preview');
        choices.hidden = true;
        panel.hidden = false;
        panel.querySelector('.story-camera-status').textContent='Photos and videos stay on this device until you choose to share. Video recording may ask for microphone access and is limited to 4 minutes.';
        openStoryCamera(video).then(stream => { if (stream && !panel.hidden) panel.querySelector('.story-camera-capture').focus(); }).catch(error => {
            stopStoryCamera();panel.hidden = true;choices.hidden = false;
            showShareFeedback(error?.name === 'NotAllowedError'
                ? 'Allow camera access in your browser to take a Story photo.'
                : 'The camera could not open. Check camera availability and try again.');
            if (!document.querySelector('.story-create-backdrop').hidden) document.querySelector('.story-open-camera').focus();
        });
        return true;
    }
    if (event.target.closest('.story-camera-cancel')) {
        stopStoryCamera();document.querySelector('.story-camera-panel').hidden = true;
        const panel=document.querySelector('.story-camera-panel'),record=panel.querySelector('.story-camera-record');
        record.disabled=false;record.dataset.recording='false';record.textContent='Record video';
        panel.querySelector('.story-camera-capture').disabled=false;panel.querySelector('.story-camera-switch').disabled=false;
        panel.querySelector('.story-camera-status').textContent='Photos and videos stay on this device until you choose to share. Video recording may ask for microphone access and is limited to 4 minutes.';
        document.querySelector('.story-media-choices').hidden = false;document.querySelector('.story-open-camera').focus();
        return true;
    }
    if (event.target.closest('.story-camera-switch')) {
        const panel=document.querySelector('.story-camera-panel'),video=panel.querySelector('.story-camera-preview');
        switchStoryCamera(video).catch(()=>showShareFeedback('The other camera is unavailable.'));
        return true;
    }
    if (event.target.closest('.story-camera-capture')) {
        const panel=document.querySelector('.story-camera-panel'),video=panel.querySelector('.story-camera-preview'),button=event.target.closest('.story-camera-capture');
        button.disabled=true;
        captureStoryPhoto(video).then(story=>{
            if (panel.hidden || document.querySelector('.story-create-backdrop').hidden) { URL.revokeObjectURL(story.media);return; }
            stopStoryCamera();panel.hidden=true;document.querySelector('.story-media-choices').hidden=false;
            state.pendingStoryMedia=story;state.activeStoryDraftId=null;renderSelectedStory();document.querySelector('.story-create-back').focus();
        }).catch(()=>{
            showShareFeedback('The camera is not ready yet. Wait for the preview, then try again.');
            button.disabled=false;button.focus();
        });
        return true;
    }
    if (event.target.closest('.story-camera-record')) {
        const panel=document.querySelector('.story-camera-panel'),button=event.target.closest('.story-camera-record');
        const photoButton=panel.querySelector('.story-camera-capture'),switchButton=panel.querySelector('.story-camera-switch'),status=panel.querySelector('.story-camera-status');
        if(button.dataset.recording==='true'){
            button.disabled=true;button.textContent='Finishing video…';status.textContent='Finishing your Story video…';stopStoryVideoRecording();return true;
        }
        button.disabled=true;button.dataset.recording='starting';status.textContent='Allow microphone access to record video with sound.';
        startStoryVideoRecording({onStarted:()=>{
            if(panel.hidden||document.querySelector('.story-create-backdrop').hidden){stopStoryVideoRecording();return;}
            button.dataset.recording='true';button.disabled=false;button.textContent='Stop recording';
            photoButton.disabled=true;switchButton.disabled=true;status.textContent='Recording… up to 4 minutes. Tap Stop recording when you are done.';
        }}).then(story=>{
            button.dataset.recording='false';
            if(panel.hidden||document.querySelector('.story-create-backdrop').hidden){URL.revokeObjectURL(story.media);return;}
            stopStoryCamera();panel.hidden=true;document.querySelector('.story-media-choices').hidden=false;
            state.pendingStoryMedia=story;state.activeStoryDraftId=null;renderSelectedStory();document.querySelector('.story-create-back').focus();
        }).catch(error=>{
            if(panel.hidden||document.querySelector('.story-create-backdrop').hidden)return;
            button.dataset.recording='false';button.disabled=false;button.textContent='Record video';
            photoButton.disabled=false;switchButton.disabled=false;
            status.textContent='Photos stay on this device until you share. Video recording may ask for microphone access and is limited to 4 minutes.';
            if(error?.name==='NotAllowedError')showShareFeedback('Allow microphone access to record video with sound.');
            else if(error?.message==='unsupported')showShareFeedback('Video recording is unavailable in this browser.');
            else showShareFeedback('The video could not be recorded. Check microphone access and try again.');
        });
        return true;
    }
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
    if (event.target.closest('.story-settings-toggle')) {
        if (!mayInteract()) return true;
        openStorySettings();
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
    if (event.target.closest('.story-share-button')) {
        const story = state.activeStorySequence[state.activeStoryIndex];
        if (story) openShareDialog(story, 'story');
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
        button.setAttribute('aria-pressed', String(story.liked));
        return true;
    }
    if (event.target.closest('.story-viewers-button')) {
        const story = state.activeStorySequence[state.activeStoryIndex];
        if (story.handle === currentUser.handle) {
            pauseStory();
            const likes = Array.isArray(story.likes) ? story.likes : [];
            const viewers = [...(Array.isArray(story.viewers) ? story.viewers : [])].sort((a, b) => {
                const aLiked = likes.some(person => person.handle === a.handle);
                const bLiked = likes.some(person => person.handle === b.handle);
                return Number(bLiked) - Number(aLiked) || (b.viewedAt || 0) - (a.viewedAt || 0);
            });
            const list = viewers.map(person => {
                const liked = likes.some(like => like.handle === person.handle);
                const name = escapeHtml(person.name || person.handle || 'Viewer');
                const avatar = person.avatar ? `<img src="${escapeHtml(person.avatar)}" alt="" />` : '';
                return `<li class="story-viewer-row">${avatar}<span>${name}</span>${liked ? '<span class="story-viewer-liked" aria-label="Liked your story">♥</span>' : ''}</li>`;
            }).join('');
            showHomePanel(`${viewers.length} ${viewers.length === 1 ? 'view' : 'views'}`, `<ul class="story-viewers-list">${list || '<li>No viewers yet.</li>'}</ul>`);
        }
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
    const reactionButton = document.querySelector('.story-reaction-trigger');
    const reactionPicker = document.querySelector('.story-reaction-picker');
    reactionButton.addEventListener('click', event => {
        event.stopPropagation();
        reactionPicker.hidden = !reactionPicker.hidden;
        const isOpen = !reactionPicker.hidden;
        reactionButton.setAttribute('aria-expanded', String(isOpen));
        if (isOpen) {
            pauseStory();
            reactionPicker.querySelector('button')?.focus();
        } else {
            reactionButton.focus();
            resumeStory();
        }
    });
    reactionPicker.addEventListener('click', event => {
        const option = event.target.closest('[data-story-reaction]');
        if (!option) return;
        event.stopPropagation();
        if (!mayInteract()) { showShareFeedback('Approval is required to react to a story.'); return; }
        const story = state.activeStorySequence[state.activeStoryIndex];
        if (!story || story.handle === currentUser.handle) return;
        story.reactions = story.reactions || [];
        const existingIndex = story.reactions.findIndex(person => person.handle === currentUser.handle);
        const emoji = option.dataset.storyReaction;
        const existing = existingIndex >= 0 ? story.reactions[existingIndex] : null;
        if (existing) story.reactions[existingIndex] = { ...existing, emoji };
        else story.reactions.push({handle:currentUser.handle,name:currentUser.name,avatar:currentUser.avatar,emoji});
        let chat = conversations.find(item => item.handle === story.handle);
        if (!chat) {
            chat = { handle: story.handle, user: story.user, avatar: story.avatar, messages: [] };
            conversations.push(chat);
        }
        appendChatMessage(chat, { from: 'me', type: 'text', text: `You reacted with ${emoji} to ${story.user}'s story.`, storyId: story.id, storyReaction: emoji });
        persistSession().catch(() => showShareFeedback('The story reaction message could not be saved on this device.'));
        reactionButton.firstChild.textContent = '☺';
        reactionButton.setAttribute('aria-pressed', 'false');
        reactionButton.setAttribute('aria-label', 'React to story');
        reactionPicker.hidden = true;
        reactionButton.setAttribute('aria-expanded', 'false');
        reactionButton.focus();
        resumeStory();
    });
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
    const upload = document.getElementById("story-upload");
    const acceptStoryFile = (file, input) => {
        const key = [file.name, file.size, file.lastModified, file.type].join('\u0000');
        const previous = state.storyUploadSelection;
        const now = Date.now();
        // Mobile browsers may emit both input and change for one picker return.
        // Treat that pair as one selection while allowing a later same-file retry.
        if (previous?.key === key && now - previous.at < 750)
            return;
        state.storyUploadSelection = { key, at: now };
        if (!getSupportedStoryFileType(file)) {
            input.value = '';
            showShareFeedback("Choose a supported image or video file for your story.");
            return;
        }
        const type = getSupportedStoryFileType(file);
        let media;
        try {
            media = URL.createObjectURL(file);
        } catch {
            input.value = '';
            state.storyUploadSelection = null;
            showShareFeedback("This file couldn't be opened. Please choose it again.");
            return;
        }
        state.pendingStoryMedia = { type, media, caption: '', durationMs: type === 'image' ? 30000 : undefined };
        state.activeStoryDraftId = null;
        renderSelectedStory();
        document.querySelector('.story-create-back').focus();
        // Keep the native input untouched during picker return; it is cleared
        // when a fresh creator opens, or when a rejected file is retried.
    };
    const handleStoryFileSelection = (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        if (event.type === 'input') {
            if (state.storyUploadInputFallback?.timer) window.clearTimeout(state.storyUploadInputFallback.timer);
            const pending = {file, input: event.target, timer: 0};
            state.storyUploadInputFallback = pending;
            // Some mobile pickers send input before change. Let the picker return
            // completely before replacing its view, and use input as a fallback
            // only if the browser never sends change.
            pending.timer = window.setTimeout(() => {
                if (state.storyUploadInputFallback !== pending) return;
                state.storyUploadInputFallback = null;
                acceptStoryFile(file, event.target);
            }, 150);
            return;
        }
        if (state.storyUploadInputFallback?.timer) window.clearTimeout(state.storyUploadInputFallback.timer);
        state.storyUploadInputFallback = null;
        acceptStoryFile(file, event.target);
    };
    upload.addEventListener('input', handleStoryFileSelection);
    upload.addEventListener('change', handleStoryFileSelection);
}

function renderSelectedStory() {
    const story = state.pendingStoryMedia;
    setStoryCreationStep(Boolean(story));
    const container = document.querySelector('.story-selected-preview');
    container.classList.toggle('story-reposted-preview', Boolean(story?.repostedFromUser));
    container.classList.toggle('story-repost-full-canvas', Boolean(story?.repostFullCanvas));
    container.replaceChildren();
    const repostFrame = story?.repostedFromUser ? document.createElement('div') : null;
    if (repostFrame) {
        repostFrame.className = `story-repost-drag-frame${story.repostFullCanvas ? ' story-repost-full-canvas-frame' : ''}`;
        if (story.repostFrameSize) {
            repostFrame.style.width = `${story.repostFrameSize.width}px`;
            repostFrame.style.height = `${story.repostFrameSize.height}px`;
            repostFrame.dataset.frameLocked = 'true';
        } else if (story.repostFullCanvas) repostFrame.dataset.frameLocked = 'true';
        container.append(repostFrame);
    }
    const mediaFrame = repostFrame || container;
    if (story) {
        const media = document.createElement(story.type === 'video' ? 'video' : 'img');
        media.alt = 'Selected story';
        media.setAttribute('aria-label', 'Selected story preview');
        media.className = story.type === 'video' ? 'story-viewer-video' : 'story-viewer-image';
        media.addEventListener('error', () => {
            if (!media.isConnected || state.pendingStoryMedia !== story) return;
            let error = container.querySelector('.story-media-preview-error');
            if (!error) {
                error = document.createElement('p');
                error.className = 'story-media-preview-error';
                error.setAttribute('role', 'alert');
                container.append(error);
            }
            error.textContent = 'This file could not be previewed here. Go back and choose a JPG, PNG, MP4, or WebM file.';
            document.querySelector('.story-publish-selected').disabled = true;
            document.querySelector('.story-save-draft').disabled = true;
        }, { once: true });
        if (story.type === 'video') {
            media.controls = true; media.playsInline = true; media.preload = 'metadata';
            if (story.poster) media.poster = story.poster;
            if (story.repostedFromUser && !story.repostFullCanvas) media.addEventListener('loadedmetadata', () => {
                if (!story.repostFrameSize) story.repostFrameSize = fitRepostMediaFrame(mediaFrame, media, .58);
                if (story.repostFrameSize) mediaFrame.dataset.frameLocked = 'true';
            }, { once: true });
            const update = () => {
                const button = document.querySelector('.story-preview-play');
                button.textContent = media.paused ? '▶' : 'Ⅱ';
                button.setAttribute('aria-label', media.paused ? 'Play video preview' : 'Pause video preview');
            };
            media.addEventListener('play', update); media.addEventListener('pause', update); media.addEventListener('ended', update);
        }
        else if (story.repostedFromUser && !story.repostFullCanvas) {
            media.addEventListener('load', () => {
                if (!story.repostFrameSize) story.repostFrameSize = fitRepostMediaFrame(mediaFrame, media, .58);
                if (story.repostFrameSize) mediaFrame.dataset.frameLocked = 'true';
            }, { once: true });
        }
        mediaFrame.append(media);
        media.src = story.media;
    }
    const playButton = document.querySelector('.story-preview-play');
    playButton.hidden = !story || story.type !== 'video';
    playButton.textContent = '▶';
    playButton.setAttribute('aria-label', 'Play video preview');
    if (repostFrame && story.repostSourceEdits)
        applyStoryComposition(repostFrame, { ...story, edits: story.repostSourceEdits }, { editing: true });
    prepareStoryTools();
    if (story?.repostedFromUser && story.repostedFromHandle) {
        const credit = createStoryRepostCredit(story);
        repostFrame.append(credit);
        repostFrame.style.setProperty('--repost-scale', String(story.repostScale || 1));
        repostFrame.style.setProperty('--repost-rotation', `${story.repostRotation || 0}deg`);
        if (story.repostPosition) {
            repostFrame.style.setProperty('--repost-x', `${story.repostPosition.x}%`);
            repostFrame.style.setProperty('--repost-y', `${story.repostPosition.y}%`);
        }
        const initialBounds = container.getBoundingClientRect();
        const initialX = story.repostPosition ? initialBounds.width * story.repostPosition.x / 100 : initialBounds.width / 2;
        const initialY = story.repostPosition ? initialBounds.height * story.repostPosition.y / 100 : initialBounds.height / 2;
        repostFrame.style.setProperty('--repost-tx', `${initialX - initialBounds.width / 2}px`);
        repostFrame.style.setProperty('--repost-ty', `${initialY - initialBounds.height / 2}px`);
        const pointers = new Map();
        let gesture = null;
        const midpoint = () => {
            const [a, b] = [...pointers.values()];
            return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.hypot(b.x - a.x, b.y - a.y), angle: Math.atan2(b.y - a.y, b.x - a.x) };
        };
        const setRepostPose = (centerX, centerY, scale, rotation, bounds) => {
            if (state.pendingStoryMedia !== story) return;
            const maxScale = Math.max(.45, Math.min(1.8, (bounds.width - 20) / repostFrame.offsetWidth, (bounds.height - 20) / repostFrame.offsetHeight));
            scale = Math.max(.45, Math.min(maxScale, scale));
            const radians = rotation * Math.PI / 180, cosine = Math.abs(Math.cos(radians)), sine = Math.abs(Math.sin(radians));
            const visualWidth = (repostFrame.offsetWidth * cosine + repostFrame.offsetHeight * sine) * scale;
            const visualHeight = (repostFrame.offsetWidth * sine + repostFrame.offsetHeight * cosine) * scale;
            const halfWidth = Math.min(visualWidth, bounds.width) / 2, halfHeight = Math.min(visualHeight, bounds.height) / 2;
            const x = Math.max(halfWidth, Math.min(bounds.width - halfWidth, centerX - bounds.left));
            const y = Math.max(halfHeight, Math.min(bounds.height - halfHeight, centerY - bounds.top));
            story.repostScale = scale;
            story.repostRotation = ((rotation + 180) % 360 + 360) % 360 - 180;
            story.repostPosition = { x: x / bounds.width * 100, y: y / bounds.height * 100 };
            repostFrame.style.setProperty('--repost-scale', String(scale));
            repostFrame.style.setProperty('--repost-rotation', `${story.repostRotation}deg`);
            repostFrame.style.setProperty('--repost-x', `${story.repostPosition.x}%`);
            repostFrame.style.setProperty('--repost-y', `${story.repostPosition.y}%`);
            repostFrame.style.setProperty('--repost-tx', `${x - bounds.width / 2}px`);
            repostFrame.style.setProperty('--repost-ty', `${y - bounds.height / 2}px`);
        };
        const beginGesture = () => {
            const bounds = repostFrame.parentElement.getBoundingClientRect();
            const frameRect = repostFrame.getBoundingClientRect();
            const center = { x: frameRect.left + frameRect.width / 2, y: frameRect.top + frameRect.height / 2 };
            const scale = story.repostScale || 1;
            const rotation = story.repostRotation || 0;
            if (pointers.size === 1) {
                const [pointerId, point] = [...pointers.entries()][0];
                gesture = { mode: 'drag', bounds, center, scale, rotation, pointerId, start: point };
            } else if (pointers.size === 2) {
                gesture = { mode: 'pinch', bounds, center, scale, rotation, start: midpoint() };
            }
        };
        repostFrame.onpointerdown = event => {
            if (event.pointerType === 'mouse' && event.button !== 0) return;
            if (repostFrame.dataset.frameLocked !== 'true') return;
            event.preventDefault();
            event.stopPropagation();
            repostFrame.setPointerCapture(event.pointerId);
            pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
            beginGesture();
            repostFrame.classList.add('story-repost-dragging');
        };
        repostFrame.onpointermove = event => {
            if (!pointers.has(event.pointerId) || !gesture || state.pendingStoryMedia !== story) return;
            event.preventDefault();
            event.stopPropagation();
            pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
            if (pointers.size === 2 && gesture.mode === 'pinch') {
                const now = midpoint();
                setRepostPose(
                    gesture.center.x + now.x - gesture.start.x,
                    gesture.center.y + now.y - gesture.start.y,
                    gesture.scale * now.distance / Math.max(1, gesture.start.distance),
                    gesture.rotation + Math.atan2(Math.sin(now.angle - gesture.start.angle), Math.cos(now.angle - gesture.start.angle)) * 180 / Math.PI,
                    gesture.bounds
                );
            } else if (pointers.size === 1 && gesture.mode === 'drag') {
                setRepostPose(
                    gesture.center.x + event.clientX - gesture.start.x,
                    gesture.center.y + event.clientY - gesture.start.y,
                    gesture.scale,
                    gesture.rotation,
                    gesture.bounds
                );
            }
        };
        const finishPointer = event => {
            if (!pointers.has(event.pointerId)) return;
            event.stopPropagation();
            pointers.delete(event.pointerId);
            if (pointers.size === 1) beginGesture();
            else if (!pointers.size) {
                gesture = null;
                repostFrame.classList.remove('story-repost-dragging');
            }
        };
        repostFrame.onpointerup = finishPointer;
        repostFrame.onpointercancel = finishPointer;
    }
    document.querySelector('.story-publish-selected').disabled = !story;
    document.querySelector('.story-save-draft').disabled = !story;
}
