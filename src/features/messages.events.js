import { TEMPORARY_ATTACHMENT_BYTES, expireChatAttachments } from './chat-attachment-expiry.js';
import { openChatWallpaper, registerChatWallpaperEvents } from './chat-wallpaper.js';
import { openGroupPhotoPicker, openGroupPhotoViewer, registerGroupPhotoEvents } from './group-photo.js';
import { persistPreferences } from '../storage/preferences.js';
import { canViewMedia, canViewStory, getAccount, mayInteract } from '../core/social.js';
import { openProfileMedia } from './profile.js';
import { showShareFeedback } from '../components/feedback.js';
import { pushConversationHistory, pushGroupProfileHistory, returnToConversationList } from '../core/navigation.js';
import { state } from '../core/state.js';
import { escapeHtml } from '../core/utils.js';
import { findEntity } from '../data/entities.js';
import { conversations, currentUser } from '../data/sample-data.js';
import { appendChatMessage, renderMessages, conversationAvatar, markInboxChatRead } from './messages.js';
import { canSendToConversation, createLocalGroup, respondToGroupInvitation, isJoinedGroup, leaveLocalGroup, isGroupAdmin, updateGroupMember, availableGroupInvitees, addLocalGroupMembers } from './message-access.js';
import { closeHomePanel, showHomePanel } from './home-controls.js';
import { persistSession } from '../storage/local-session.js';
import { openStoryRepostEditor } from './stories.events.js';
import { openStoryGroup, showStoryAtIndex } from './stories.js';

let expiryTimer;
let recorder, recordingStream, recordingTimer, recordingGeneration = 0, pendingAttachment;
const activeConversation = () => conversations.find(item => item.handle === state.activeConversationHandle);
const closePanel = () => { document.querySelector('.home-controls-backdrop').hidden = true; };
export function refreshChatAttachmentExpiry() {
    clearTimeout(expiryTimer);
    const { changed, nextExpiry } = expireChatAttachments(conversations);
    if (changed) {
        if (state.currentView === 'messages') renderMessages({ preserveComposer: true });
        persistSession().catch(() => showShareFeedback('Expired attachments could not be removed from storage.'));
    }
    if (Number.isFinite(nextExpiry)) {
        expiryTimer = window.setTimeout(refreshChatAttachmentExpiry, Math.max(1, nextExpiry - Date.now()));
    }
}

function saveMessage(conversation, message, options) {
    if (!canSendToConversation(conversation)) { showShareFeedback('Messaging is unavailable for this conversation.'); return false; }
    appendChatMessage(conversation, message, options);
    if (message.type === 'attachment') refreshChatAttachmentExpiry();
    persistSession().catch(() => showShareFeedback('The message is visible, but could not be saved on this device.'));
    return true;
}
function openGroupCreator() {
    if (!mayInteract()) { showShareFeedback('Group creation is unavailable while verification is pending.'); return; }
    const people = state.accountDirectory.filter(person => person.handle !== currentUser.handle && !state.blockedHandles.has(person.handle));
    showHomePanel('New group', `<form class="create-group-form"><label>Group name<input name="groupName" required maxlength="60" autocomplete="off" /></label><fieldset><legend>Choose participants</legend>${people.map(person => `<label><input type="checkbox" name="member" value="${escapeHtml(person.handle)}" /> ${escapeHtml(person.name)} <small>${escapeHtml(person.handle)}${person.groupJoinMode === 'review' ? ' · Invitation review' : ''}</small></label>`).join('')}</fieldset><p>You will be the first admin. Each participant's invitation preference is respected.</p><button type="submit">Create group</button></form>`);
}
function openGroupManager(group) {
    if (!mayInteract() || !group.members?.includes(currentUser.handle) || !group.admins?.includes(currentUser.handle)) return;
    const members = [...new Set([...(group.members || []), ...(group.pendingMembers || [])])].filter(handle => handle !== currentUser.handle);
    showHomePanel('Manage group', `<form class="manage-group-form" data-group-handle="${escapeHtml(group.handle)}"><label>Group name<input name="groupName" maxlength="60" required value="${escapeHtml(group.user)}" /></label><fieldset><legend>Remove members or cancel invitations</legend>${members.map(handle => `<label><input type="checkbox" name="removeMember" value="${escapeHtml(handle)}" /> ${escapeHtml(getAccount(handle)?.name || handle)}${group.pendingMembers?.includes(handle) ? ' · Invited' : ''}</label>`).join('') || '<p>No other members.</p>'}</fieldset><button type="submit">Save group</button></form>`);
}
function cancelRecording() {
    recordingGeneration += 1; clearTimeout(recordingTimer);
    if (recorder?.state === 'recording') recorder.stop();
    recordingStream?.getTracks().forEach(track => track.stop());
}
async function toggleRecording(button) {
    if (recorder?.state === 'recording') { recorder.stop(); return; }
    const conversation = activeConversation();
    if (!canSendToConversation(conversation)) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { showShareFeedback('Voice recording is unavailable in this browser.'); return; }
    button.disabled = true;
    try {
        recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (activeConversation() !== conversation || !canSendToConversation(conversation)) { recordingStream.getTracks().forEach(track => track.stop()); return; }
        const chunks = [], generation = ++recordingGeneration, stream = recordingStream;
        const recording = new MediaRecorder(stream);
        recorder = recording;
        recorder.addEventListener('dataavailable', event => { if (event.data.size) chunks.push(event.data); });
        recorder.addEventListener('stop', () => {
            stream.getTracks().forEach(track => track.stop());
            const mimeType = recording.mimeType;
            if (recorder === recording) recorder = null;
            if (generation !== recordingGeneration || !chunks.length) return;
            clearTimeout(recordingTimer);
            pendingAttachment = { conversation, type: 'voice', media: URL.createObjectURL(new Blob(chunks, { type: mimeType })) };
            showHomePanel('Voice message', `<audio controls src="${escapeHtml(pendingAttachment.media)}"></audio><p>Listen before adding this recording to the local conversation.</p><div class="panel-actions"><button type="button" data-attachment-send>Send voice message</button><button type="button" data-attachment-discard>Discard</button></div>`);
            renderMessages();
        });
        recorder.start(); button.textContent = '■'; button.setAttribute('aria-label', 'Stop voice recording'); button.classList.add('recording');
        recordingTimer = window.setTimeout(() => { if (recorder?.state === 'recording') recorder.stop(); }, 120000);
    } catch { recordingStream?.getTracks().forEach(track => track.stop()); showShareFeedback('Microphone access was unavailable. You can still send text or gallery attachments.'); }
    finally { button.disabled = false; }
}
let heldTarget = null;
const inboxHoldSelector = '[data-open-conversation], [data-group-photo][data-has-photo]';

function openInboxChatOptions(row) {
    if (!row.isConnected || state.currentView !== 'messages' || state.activeConversationHandle) return false;
    const chat = conversations.find(item => item.handle === row.dataset.openConversation);
    if (!chat) return false;
    const action = (value, label) => `<button type="button" data-inbox-chat-action="${value}" data-chat-handle="${escapeHtml(chat.handle)}">${label}</button>`;
    showHomePanel(chat.user, `<div class="profile-options-list">
      ${action('pin', chat.pinned ? 'Unpin chat' : 'Pin chat')}
      ${action('mute', chat.muted ? 'Unmute chat' : 'Mute chat')}
      ${action('read', chat.unread ? 'Mark as read' : 'Mark as unread')}
      ${!chat.isGroup ? `<button type="button" data-inbox-visit-profile data-profile-handle="${escapeHtml(chat.handle)}">Visit profile</button>` : ''}
      ${isJoinedGroup(chat) ? action('group-profile', 'View group profile') + action('leave-group', 'Leave group') : ''}
      ${action('delete', 'Delete chat')}
    </div>`);
    return true;
}

function openInboxHoldTarget(target) {
    return target.matches('[data-group-photo]')
        ? target.isConnected && openGroupPhotoViewer(selectedGroupProfile())
        : openInboxChatOptions(target);
}

function registerInboxChatOptions(list) {
    let press, timer;
    function cancelPress() {
        clearTimeout(timer);
        press = null;
    }
    list.addEventListener('pointerdown', event => {
        cancelPress();
        heldTarget = null;
        const row = event.target.closest(inboxHoldSelector);
        if (!row || event.button !== 0 || event.isPrimary === false) return;
        press = { row, id: event.pointerId, x: event.clientX, y: event.clientY, pointerType: event.pointerType };
        timer = window.setTimeout(() => {
            if (press && openInboxHoldTarget(row)) heldTarget = row;
            cancelPress();
        }, 1250);
    });
    window.addEventListener('pointermove', event => {
        if (press?.id === event.pointerId && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 10) cancelPress();
    }, { passive: true });
    for (const type of ['pointerup', 'pointercancel']) {
        window.addEventListener(type, event => { if (press?.id === event.pointerId) cancelPress(); });
    }
    window.addEventListener('blur', cancelPress);
    function openContextMenu(event) {
        const row = event.target.closest(inboxHoldSelector);
        if (!row) return;
        event.preventDefault();
        if (event.pointerType === 'touch' || press?.pointerType === 'touch') return;
        cancelPress();
        openInboxHoldTarget(row);
    }
    list.addEventListener('contextmenu', openContextMenu);
    list.addEventListener('keydown', event => {
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) openContextMenu(event);
    });
}

function confirmInboxChatDeletion(chat) {
    const name = escapeHtml(chat.user);
    const prompt = chat.isGroup
        ? `Hide the chat history for ${name} from your view? Other members can still see the conversation.`
        : `Delete your conversation with ${name} from this device?`;
    showHomePanel('Delete chat?', `<p>${prompt}</p>
      <div class="panel-actions">
        <button type="button" data-inbox-chat-action="cancel-delete" data-chat-handle="${escapeHtml(chat.handle)}">Cancel</button>
        <button type="button" data-inbox-chat-action="confirm-delete" data-chat-handle="${escapeHtml(chat.handle)}">Delete chat</button>
      </div>`);
}

function deleteInboxChat(chat) {
    const index = conversations.indexOf(chat);
    if (index < 0) return;
    if (chat.isGroup) {
        chat.clearedMessageCount = { ...chat.clearedMessageCount, [currentUser.handle]: chat.messages?.length || 0 };
        markInboxChatRead(chat);
    } else {
        // Prevent Story sync from recreating deleted direct messages.
        for (const message of chat.messages || []) {
            if (message.type === 'story-mention') state.deletedChatMentionIds.add(message.id);
        }
        conversations.splice(index, 1);
    }
    closeHomePanel();
    renderMessages();
    persistSession().catch(() => showShareFeedback('This device could not save the chat deletion.'));
}

function openGroupProfile(group) {
    if (!isJoinedGroup(group)) return;
    closeHomePanel();
    cancelRecording();
    state.activeGroupProfileHandle = group.handle;
    pushGroupProfileHistory(group.handle);
    renderMessages();
    document.querySelector('[data-group-profile-back]')?.focus();
}

function confirmLeaveGroup(group) {
    if (!isJoinedGroup(group) || !mayInteract()) return;
    showHomePanel('Leave group?', `<p>Leave ${escapeHtml(group.user)} and remove it from your inbox?</p>
      <div class="panel-actions">
        <button type="button" data-inbox-chat-action="cancel-delete" data-chat-handle="${escapeHtml(group.handle)}">Cancel</button>
        <button type="button" data-inbox-chat-action="confirm-leave" data-chat-handle="${escapeHtml(group.handle)}">Leave group</button>
      </div>`);
}

function selectedGroupProfile() {
    return state.currentView === 'messages' && conversations.find(chat => chat.handle === state.activeGroupProfileHandle);
}

function openGroupMemberPicker(group) {
    if (!mayInteract() || !isGroupAdmin(group)) return;
    const people = availableGroupInvitees(group);
    showHomePanel('Add group member', people.length ? `
      <form class="add-group-members-form" data-group-handle="${escapeHtml(group.handle)}">
        <fieldset><legend>Choose people</legend>
          ${people.map(person => `<label><input type="checkbox" name="member" value="${escapeHtml(person.handle)}" />
            ${escapeHtml(person.name || person.handle)} <small>${escapeHtml(person.handle)}${person.groupJoinMode === 'review' ? ' · Invitation review' : ''}</small></label>`).join('')}
        </fieldset>
        <button type="submit">Add selected</button>
      </form>` : '<p>Everyone available is already in the group or invited.</p>');
}

function showGroupMemberOptions(group, handle) {
    if (!mayInteract() || !isGroupAdmin(group) || handle === currentUser.handle || !group.members.includes(handle)) return;
    const name = getAccount(handle)?.name || handle;
    const muted = state.mutedPostHandles.has(handle) && state.mutedStoryHandles.has(handle);
    const action = (value, label) => `<button type="button" data-group-member-action="${value}" data-member-handle="${escapeHtml(handle)}">${label}</button>`;
    showHomePanel(name, `<div class="profile-options-list">
      ${action('make-admin', 'Make admin')}
      ${action('mute', muted ? 'Unmute profile' : 'Mute profile')}
      ${action('remove', 'Remove from group')}
    </div>`);
}

function handleGroupMemberAction(group, button) {
    const handle = button.dataset.memberHandle;
    if (!mayInteract() || !isGroupAdmin(group) || handle === currentUser.handle || !group.members.includes(handle)) return;
    const action = button.dataset.groupMemberAction;
    if (action === 'remove') {
        const name = getAccount(handle)?.name || handle;
        showHomePanel('Remove from group?', `<p>Remove ${escapeHtml(name)} from ${escapeHtml(group.user)}?</p>
          <div class="panel-actions">
            <button type="button" data-group-member-options="${escapeHtml(handle)}">Cancel</button>
            <button type="button" data-group-member-action="confirm-remove" data-member-handle="${escapeHtml(handle)}">Remove</button>
          </div>`);
        return;
    }
    if (action === 'mute') {
        const muted = state.mutedPostHandles.has(handle) && state.mutedStoryHandles.has(handle);
        for (const set of [state.mutedPostHandles, state.mutedStoryHandles]) {
            if (muted) set.delete(handle);
            else set.add(handle);
        }
        if (!persistPreferences()) {
            showShareFeedback('This mute preference could not be saved.');
            return;
        }
    } else if (!updateGroupMember(group, handle, action === 'confirm-remove' ? 'remove' : action)) {
        return;
    } else {
        persistSession().catch(() => showShareFeedback('The group change could not be saved on this device.'));
    }
    closeHomePanel();
    renderMessages();
}

function openChatMuteOptions(conversation) {
    const action = (kind, muted) => `<button type="button" data-chat-mute="${kind.toLowerCase()}" aria-pressed="${Boolean(muted)}">${muted ? 'Unmute' : 'Mute'} ${kind.toLowerCase()}</button>`;
    showHomePanel('Mute', `<div class="profile-options-list">
      ${action('Messages', conversation.muted)}
      ${action('Calls', conversation.callsMuted)}
      ${conversation.isGroup ? '' : action('Story', state.mutedStoryHandles.has(conversation.handle))}
    </div>`);
}

export function handleMessageClick(event) {
    const download = event.target.closest('[data-attachment-expires]');
    if (download?.dataset.attachmentExpires && Number(download.dataset.attachmentExpires) <= Date.now()) {
        event.preventDefault();
        refreshChatAttachmentExpiry();
        return true;
    }
    const mute = event.target.closest('[data-chat-mute]');
    if (mute) {
        const chat = activeConversation();
        if (!chat || state.currentView !== 'messages') return true;
        switch (mute.dataset.chatMute) {
            case 'messages': chat.muted = !chat.muted; break;
            case 'calls': chat.callsMuted = !chat.callsMuted; break;
            case 'story':
                if (chat.isGroup) return true;
                if (state.mutedStoryHandles.has(chat.handle)) state.mutedStoryHandles.delete(chat.handle);
                else state.mutedStoryHandles.add(chat.handle);
                if (!persistPreferences()) showShareFeedback('The story mute preference could not be saved.');
                break;
            default: return true;
        }
        persistSession().catch(() => showShareFeedback('The mute preference could not be saved.'));
        openChatMuteOptions(chat);
        return true;
    }
    if (event.target.closest('[data-chat-profile]')) {
        cancelRecording();
        return false; // Shared profile navigation remembers the open chat.
    }
    if (event.target.closest('[data-group-add-member]')) {
        openGroupMemberPicker(selectedGroupProfile());
        return true;
    }
    if (heldTarget && event.detail > 0 && event.target.closest(inboxHoldSelector) === heldTarget) {
        heldTarget = null;
        return true;
    }
    const memberOptions = event.target.closest('[data-group-member-options]');
    if (memberOptions) {
        showGroupMemberOptions(selectedGroupProfile(), memberOptions.dataset.groupMemberOptions);
        return true;
    }
    const memberAction = event.target.closest('[data-group-member-action]');
    if (memberAction) {
        handleGroupMemberAction(selectedGroupProfile(), memberAction);
        return true;
    }
    if (event.target.closest('[data-group-photo]')) {
        openGroupPhotoPicker(selectedGroupProfile());
        return true;
    }
    if (event.target.closest('[data-group-profile-back]')) {
        window.history.back();
        return true;
    }
    if (event.target.closest('[data-inbox-visit-profile]')) {
        closeHomePanel();
        return false; // Let the shared profile navigation remember the inbox for Back.
    }
    const inboxAction = event.target.closest('[data-inbox-chat-action]');
    if (inboxAction) {
        const chat = conversations.find(item => item.handle === inboxAction.dataset.chatHandle);
        if (!chat || state.currentView !== 'messages' ||
            (state.activeConversationHandle && inboxAction.dataset.inboxChatAction !== 'cancel-delete' &&
                inboxAction.dataset.inboxChatAction !== 'confirm-leave')) return true;
        switch (inboxAction.dataset.inboxChatAction) {
            case 'group-profile': openGroupProfile(chat); return true;
            case 'leave-group': confirmLeaveGroup(chat); return true;
            case 'confirm-leave':
                if (leaveLocalGroup(chat)) {
                    closeHomePanel();
                    const wasOpen = state.activeConversationHandle === chat.handle;
                    state.activeConversationHandle = null;
                    if (!wasOpen || !returnToConversationList(chat.handle)) renderMessages();
                    persistSession().catch(() => showShareFeedback('Leaving the group could not be saved on this device.'));
                }
                return true;
            case 'delete': confirmInboxChatDeletion(chat); return true;
            case 'cancel-delete': closeHomePanel(); return true;
            case 'confirm-delete': deleteInboxChat(chat); return true;
            case 'pin': chat.pinned = !chat.pinned; break;
            case 'mute': chat.muted = !chat.muted; break;
            case 'read':
                if (chat.unread) markInboxChatRead(chat);
                else chat.unread = true;
                break;
            default: return true;
        }
        closeHomePanel();
        renderMessages();
        persistSession().catch(() => showShareFeedback('Chat preferences could not be saved.'));
        return true;
    }
    const mentionAction = event.target.closest('[data-story-mention-view], [data-story-mention-repost]');
    if (mentionAction) {
        const storyId = mentionAction.dataset.storyMentionView || mentionAction.dataset.storyMentionRepost;
        const chat = activeConversation();
        const message = chat?.messages?.find(item => item.type === 'story-mention' && item.storyId === storyId);
        const story = state.stories.find(item => item.id === storyId && item.handle === message?.actor);
        if (!message || !story || !canViewStory(story) || story.expiresAt <= Date.now()) { showShareFeedback('This Story is no longer available.'); return true; }
        if (mentionAction.dataset.storyMentionRepost) {
            if (message.recipient === currentUser.handle && message.from !== 'me') openStoryRepostEditor(story);
        } else {
            openStoryGroup(story.handle, { allowUnfollowed: true });
            const index = state.activeStorySequence.findIndex(item => item.id === storyId);
            if (index >= 0) showStoryAtIndex(index);
        }
        return true;
    }
    if (event.target.closest('[data-create-group]')) { openGroupCreator(); return true; }
    const shared = event.target.closest('[data-shared-id]');
    if (shared) {
        const entity = findEntity(shared.dataset.sharedType, Number(shared.dataset.sharedId));
        if (!entity || !canViewMedia(entity)) { showShareFeedback('This post is no longer available to you.'); return true; }
        openProfileMedia(shared.dataset.sharedType, entity.id, shared); return true;
    }
    if (!event.target.closest('.chat-options-wrap')) { document.querySelector('.chat-options-menu')?.setAttribute('hidden', ''); document.querySelector('[data-chat-options]')?.setAttribute('aria-expanded', 'false'); }
    const conversationButton = event.target.closest('[data-open-conversation]');
    if (conversationButton) {
        heldTarget = null;
        cancelRecording(); state.activeConversationHandle = conversationButton.dataset.openConversation;
        pushConversationHistory(state.activeConversationHandle);
        renderMessages(); document.querySelector('.chat-composer input[name="message"]')?.focus(); return true;
    }
    if (event.target.closest('[data-chat-back]')) {
        cancelRecording();
        if (!returnToConversationList(state.activeConversationHandle)) {
            state.activeConversationHandle = null;
            renderMessages();
        }
        return true;
    }
    const options = event.target.closest('[data-chat-options]');
    if (options) { const menu = document.querySelector('.chat-options-menu'); menu.hidden = !menu.hidden; options.setAttribute('aria-expanded', String(!menu.hidden)); return true; }
    const option = event.target.closest('[data-chat-option]');
    if (option) {
        const conversation = activeConversation(); if (!conversation) return true;
        const action = option.dataset.chatOption;
        if (action === 'pin') conversation.pinned = !conversation.pinned;
        if (action === 'mute' || action === 'wallpaper') {
            document.querySelector('.chat-options-menu').hidden = true;
            document.querySelector('[data-chat-options]').setAttribute('aria-expanded', 'false');
            if (action === 'mute') openChatMuteOptions(conversation);
            else openChatWallpaper(conversation);
            return true;
        }
        if (action === 'group-profile') { openGroupProfile(conversation); return true; }
        if (action === 'leave-group') { confirmLeaveGroup(conversation); return true; }
        if (action === 'manage-group') { openGroupManager(conversation); return true; }
        renderMessages(); return true;
    }
    const invite = event.target.closest('[data-group-invite]');
    if (invite) {
        const conversation = activeConversation();
        if (conversation && respondToGroupInvitation(conversation, invite.dataset.groupInvite === 'accept')) {
            if (invite.dataset.groupInvite === 'decline') {
                if (!returnToConversationList(state.activeConversationHandle)) state.activeConversationHandle = null;
            }
            renderMessages(); persistSession().catch(() => showShareFeedback('The invitation response could not be saved.'));
        }
        return true;
    }
    if (event.target.closest('[data-chat-attach]')) {
        if (canSendToConversation(activeConversation())) {
            showHomePanel('Share in chat', `<div class="profile-options-list">
              <button type="button" data-chat-share-kind="file">Share a file</button>
              <button type="button" data-chat-share-kind="location">Share your location</button>
              <button type="button" data-chat-share-kind="contact">Share a contact</button>
            </div>`);
        }
        return true;
    }
    if (event.target.closest('[data-chat-gallery]')) {
        if (canSendToConversation(activeConversation())) document.querySelector('.chat-gallery-input')?.click();
        return true;
    }
    const share = event.target.closest('[data-chat-share-kind]');
    if (share) {
        const conversation = activeConversation();
        if (!canSendToConversation(conversation)) return true;
        const kind = share.dataset.chatShareKind;
        if (kind === 'file') {
            closeHomePanel();
            document.querySelector('.chat-file-input')?.click();
        } else if (kind === 'location' || kind === 'contact') {
            const location = kind === 'location';
            showHomePanel(location ? 'Share your location' : 'Share a contact', `
                <form class="chat-share-details" data-kind="${kind}" data-handle="${escapeHtml(conversation.handle)}">
                  ${location ? `<label>Current coordinates<input name="place" readonly placeholder="Location not yet fetched" /></label>
                    <button type="button" data-chat-current-location>Use current location</button>
                    <p class="chat-location-status" role="status"></p>`
                    : `<label>Name<input name="contactName" required maxlength="100" /></label>
                    <label>Phone number<input name="phone" type="tel" required maxlength="60" /></label>`}
                  <button type="submit"${location ? ' disabled' : ''}>${location ? 'Send location' : 'Send contact'}</button>
                </form>`);
        }
        return true;
    }
    const locationButton = event.target.closest('[data-chat-current-location]');
    if (locationButton) {
        const form = locationButton.form;
        const status = form.querySelector('.chat-location-status');
        const send = form.querySelector('button[type="submit"]');
        form.elements.place.value = '';
        send.disabled = true;
        if (!navigator.geolocation) {
            status.textContent = 'Current location is unavailable in this browser.';
            return true;
        }
        locationButton.disabled = true;
        status.textContent = 'Getting your location…';
        const onPosition = ({ coords }) => {
            if (!form.isConnected) return;
            form.elements.place.value = `${coords.latitude.toFixed(6)}, ${coords.longitude.toFixed(6)}`;
            locationButton.disabled = false;
            send.disabled = false;
            const accuracy = Number.isFinite(coords.accuracy) ? ` Estimated accuracy: ±${Math.ceil(coords.accuracy)} m.` : '';
            status.textContent = `Review your coordinates before sending.${accuracy}`;
        };
        function requestPosition(highAccuracy) {
            navigator.geolocation.getCurrentPosition(onPosition, error => {
                if (!form.isConnected) return;
                if (highAccuracy && (error.code === 2 || error.code === 3)) {
                    status.textContent = 'Trying standard location accuracy…';
                    requestPosition(false);
                    return;
                }
                locationButton.disabled = false;
                if (error.code === 1) {
                    status.textContent = 'Location access is blocked here. Check the site and device settings.';
                } else if (error.code === 3) {
                    status.textContent = 'The location request timed out. Try again.';
                } else {
                    status.textContent = 'This device could not determine its location. Try opening the app directly in your phone browser.';
                }
            }, { timeout: highAccuracy ? 8000 : 12000, enableHighAccuracy: highAccuracy, maximumAge: 0 });
        }
        requestPosition(true);
        return true;
    }
    const voice = event.target.closest('[data-chat-voice]'); if (voice) { void toggleRecording(voice); return true; }
    if (event.target.closest('[data-attachment-send]')) {
        if (!pendingAttachment) return true;
        const { conversation, ...message } = pendingAttachment;
        const sent = saveMessage(conversation, { ...message, from: 'me' });
        pendingAttachment = null;
        if (!sent) URL.revokeObjectURL(message.media);
        closeHomePanel();
        return true;
    }
    if (event.target.closest('[data-attachment-discard]')) { if (pendingAttachment) URL.revokeObjectURL(pendingAttachment.media); pendingAttachment = null; closePanel(); return true; }
    const call = event.target.closest('[data-chat-call]');
    if (call) {
        const conversation = activeConversation(); if (!canSendToConversation(conversation)) return true;
        showHomePanel(`${call.dataset.chatCall === 'video' ? 'Video' : 'Audio'} call preview`, `<div class="call-preview"><img src="${escapeHtml(conversationAvatar(conversation))}" alt="" /><h3>${escapeHtml(conversation.user)}</h3><p>Preview only. Nobody is being called.</p><p>Connected calls will be available after realtime calling is added.</p><div class="panel-actions"><button type="button" data-call-toggle aria-pressed="false">Microphone on</button>${call.dataset.chatCall === 'video' ? '<button type="button" data-call-toggle aria-pressed="false">Camera on</button>' : ''}<button type="button" data-call-end>End preview</button></div></div>`); return true;
    }
    const callToggle = event.target.closest('[data-call-toggle]');
    if (callToggle) { const muted = callToggle.getAttribute('aria-pressed') !== 'true'; callToggle.setAttribute('aria-pressed', String(muted)); callToggle.textContent = `${callToggle.textContent.startsWith('Microphone') ? 'Microphone' : 'Camera'} ${muted ? 'off' : 'on'}`; return true; }
    if (event.target.closest('[data-call-end]')) { closePanel(); return true; }
    return false;
}
export function registerMessageFormEvents() {
    registerChatWallpaperEvents();
    window.addEventListener('pageshow', refreshChatAttachmentExpiry);
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) refreshChatAttachmentExpiry();
    });
    registerGroupPhotoEvents();
    registerInboxChatOptions(document.getElementById('messages-list'));
    document.addEventListener('account-deletion-lock', () => {
        cancelRecording();
        if (pendingAttachment?.media?.startsWith('blob:')) URL.revokeObjectURL(pendingAttachment.media);
        pendingAttachment = null;
    });
    document.addEventListener('click', event => { if (event.target.closest('[data-view]')) cancelRecording(); });
    document.addEventListener('pointerdown', event => {
        const input = document.activeElement;
        const composer = input?.closest?.('.chat-composer');
        if (!composer || input.name !== 'message') return;
        if (event.target.closest('.chat-send-button')?.form === composer) {
            // Keep the same focused input while the button's click submits the form.
            event.preventDefault();
        } else if (!composer.contains(event.target)) {
            input.blur();
        }
    });
    document.getElementById('messages-list').addEventListener('submit', event => {
        const form = event.target.closest('.chat-composer');
        if (!form) return;
        event.preventDefault();
        const conversation = activeConversation();
        const input = form.elements.message;
        const text = input.value.trim();
        if (conversation && text && saveMessage(conversation, { type: 'text', from: 'me', text }, { preserveComposer: true })) {
            input.value = '';
        }
    });
    document.getElementById('messages-list').addEventListener('change', event => {
        if (!event.target.matches('.chat-gallery-input, .chat-file-input')) return;
        const conversation = activeConversation();
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file || !canSendToConversation(conversation)) return;
        const mediaKind = event.target.matches('.chat-file-input') ? 'file'
            : file.type.startsWith('video/') ? 'video'
                : file.type.startsWith('image/') ? 'photo' : null;
        if (!mediaKind) {
            showShareFeedback('Choose a photo or video.');
            return;
        }
        if (pendingAttachment) URL.revokeObjectURL(pendingAttachment.media);
        pendingAttachment = {
            conversation, type: 'attachment', mediaKind,
            fileName: file.name, fileSize: file.size, media: URL.createObjectURL(file),
        };
        const url = escapeHtml(pendingAttachment.media);
        const preview = mediaKind === 'video' ? `<video controls playsinline src="${url}"></video>`
            : mediaKind === 'photo' ? `<img src="${url}" alt="Attachment preview" />`
                : `<p class="attachment-file-name">${escapeHtml(file.name)}</p>`;
        const temporary = file.size > TEMPORARY_ATTACHMENT_BYTES;
        showHomePanel('Attachment', `<div class="attachment-preview">${preview}</div>
          ${temporary ? '<p>This attachment is over 200 MB and will be deleted automatically 24 hours after sending. Download it before it expires.</p>' : ''}
          <div class="panel-actions"><button type="button" data-attachment-send>${temporary ? 'Send' : `Send ${mediaKind}`}</button>
          <button type="button" data-attachment-discard>${temporary ? 'Cancel' : 'Discard'}</button></div>`);
    });
    document.addEventListener('submit', event => {
        const form = event.target;
        if (form.matches('.chat-share-details')) {
            event.preventDefault();
            const conversation = activeConversation();
            if (!conversation || conversation.handle !== form.dataset.handle) return;
            const kind = form.dataset.kind;
            const details = kind === 'location'
                ? { place: form.elements.place.value.trim() }
                : { contactName: form.elements.contactName.value.trim(), phone: form.elements.phone.value.trim() };
            if (Object.values(details).every(Boolean) && saveMessage(conversation, { type: kind, from: 'me', ...details })) closeHomePanel();
            return;
        }
        if (form.matches('.add-group-members-form')) {
            event.preventDefault();
            const group = selectedGroupProfile();
            if (!group || group.handle !== form.dataset.groupHandle) return;
            const handles = [...form.querySelectorAll('input[name="member"]:checked')].map(input => input.value);
            if (!addLocalGroupMembers(group, handles)) {
                showShareFeedback('Choose at least one eligible account.');
                return;
            }
            closeHomePanel();
            renderMessages();
            persistSession().catch(() => showShareFeedback('The new group members could not be saved on this device.'));
            return;
        }
        if (form.matches('.create-group-form')) {
            event.preventDefault();
            const group = createLocalGroup(form.elements.groupName.value, [...form.querySelectorAll('input[name="member"]:checked')].map(input => input.value));
            if (!group) { showShareFeedback('Enter a name and choose at least one participant.'); return; }
            state.activeConversationHandle = group.handle; pushConversationHistory(group.handle); closePanel(); renderMessages(); persistSession().catch(() => showShareFeedback('The group could not be saved on this device.'));
        }
        if (form.matches('.manage-group-form')) {
            event.preventDefault(); const group = conversations.find(item => item.handle === form.dataset.groupHandle);
            if (!mayInteract() || !group?.admins?.includes(currentUser.handle) || !group.members?.includes(currentUser.handle)) return;
            const name = form.elements.groupName.value.trim(); if (!name) return;
            const removed = [...form.querySelectorAll('input[name="removeMember"]:checked')].map(input => input.value);
            group.user = name.slice(0, 60);
            for (const handle of removed) updateGroupMember(group, handle, 'remove');
            group.pendingMembers = (group.pendingMembers || []).filter(handle => !removed.includes(handle));
            closePanel(); renderMessages(); persistSession().catch(() => showShareFeedback('The group changes could not be saved.'));
        }
    });
}
