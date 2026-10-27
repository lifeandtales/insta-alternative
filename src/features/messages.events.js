import { canViewMedia, getAccount, mayInteract } from '../core/social.js';
import { openProfileMedia } from './profile.js';
import { showShareFeedback } from '../components/feedback.js';
import { setView, pushConversationHistory, returnToConversationList } from '../core/navigation.js';
import { state } from '../core/state.js';
import { escapeHtml } from '../core/utils.js';
import { findEntity } from '../data/entities.js';
import { conversations, currentUser } from '../data/sample-data.js';
import { appendChatMessage, renderMessages, conversationAvatar } from './messages.js';
import { canSendToConversation, canShareToConversation, createLocalGroup, respondToGroupInvitation } from './message-access.js';
import { showHomePanel } from './home-controls.js';
import { persistSession } from '../storage/local-session.js';

let recorder, recordingStream, recordingTimer, recordingGeneration = 0, pendingAttachment;
const activeConversation = () => conversations.find(item => item.handle === state.activeConversationHandle);
const closePanel = () => { document.querySelector('.home-controls-backdrop').hidden = true; };
function saveMessage(conversation, message) {
    if (!canSendToConversation(conversation)) { showShareFeedback('Messaging is unavailable for this conversation.'); return; }
    appendChatMessage(conversation, message);
    persistSession().catch(() => showShareFeedback('The message is visible, but could not be saved on this device.'));
}
function openGroupCreator() {
    if (!mayInteract()) { showShareFeedback('Group creation is unavailable while verification is pending.'); return; }
    const people = state.accountDirectory.filter(person => person.handle !== currentUser.handle && !state.blockedHandles.has(person.handle));
    showHomePanel('New group', `<form class="create-group-form"><label>Group name<input name="groupName" required maxlength="60" autocomplete="off" /></label><fieldset><legend>Choose participants</legend>${people.map(person => `<label><input type="checkbox" name="member" value="${escapeHtml(person.handle)}" /> ${escapeHtml(person.name)} <small>${escapeHtml(person.handle)}${person.groupJoinMode === 'review' ? ' · Invitation review' : ''}</small></label>`).join('')}</fieldset><p>You will be the first admin. Each participant's invitation preference is respected.</p><button type="submit">Create group</button></form>`);
}
function openGroupManager(group) {
    if (!mayInteract() || !group.members?.includes(currentUser.handle) || !group.admins?.includes(currentUser.handle)) return;
    const members = [...new Set([...(group.members || []), ...(group.pendingMembers || [])])].filter(handle => handle !== currentUser.handle);
    showHomePanel('Manage group', `<form class="manage-group-form" data-group-handle="${escapeHtml(group.handle)}"><label>Group name<input name="groupName" maxlength="60" required value="${escapeHtml(group.user)}" /></label><label>Group photo<input name="groupPhoto" type="file" accept="image/jpeg,image/png,image/webp" /></label><fieldset><legend>Remove members or cancel invitations</legend>${members.map(handle => `<label><input type="checkbox" name="removeMember" value="${escapeHtml(handle)}" /> ${escapeHtml(getAccount(handle)?.name || handle)}${group.pendingMembers?.includes(handle) ? ' · Invited' : ''}</label>`).join('') || '<p>No other members.</p>'}</fieldset><button type="submit">Save group</button></form>`);
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
export function handleMessageClick(event) {
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
        cancelRecording(); state.activeConversationHandle = conversationButton.dataset.openConversation; state.chatAttachmentPickerOpen = false;
        pushConversationHistory(state.activeConversationHandle);
        renderMessages(); document.querySelector('.chat-composer input[name="message"]')?.focus(); return true;
    }
    if (event.target.closest('[data-chat-back]')) {
        cancelRecording(); state.chatAttachmentPickerOpen = false;
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
        if (action === 'mute') conversation.muted = !conversation.muted;
        if (action === 'unread') {
            conversation.unread = true;
            if (returnToConversationList(state.activeConversationHandle)) return true;
            state.activeConversationHandle = null;
        }
        if (action === 'manage-group') { openGroupManager(conversation); return true; }
        if (action === 'profile' && !conversation.isGroup) { state.profileHandle = conversation.handle; state.activeProfileSection = 'posts'; setView('profile'); return true; }
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
    if (event.target.closest('[data-chat-attach]')) { if (canSendToConversation(activeConversation())) { state.chatAttachmentPickerOpen = !state.chatAttachmentPickerOpen; renderMessages(); } return true; }
    if (event.target.closest('[data-chat-gallery]')) { if (canSendToConversation(activeConversation())) document.querySelector('.chat-gallery-input')?.click(); return true; }
    const voice = event.target.closest('[data-chat-voice]'); if (voice) { void toggleRecording(voice); return true; }
    const share = event.target.closest('[data-chat-share-id]');
    if (share) {
        const entity = findEntity(share.dataset.chatShareType, Number(share.dataset.chatShareId)), conversation = activeConversation();
        if (!canShareToConversation(entity, conversation)) { showShareFeedback('Every recipient must have access to this post.'); return true; }
        state.chatAttachmentPickerOpen = false;
        saveMessage(conversation, { type: 'shared-post', from: 'me', entityType: share.dataset.chatShareType, entityId: entity.id }); return true;
    }
    if (event.target.closest('[data-attachment-send]')) {
        if (pendingAttachment) { const { conversation, ...message } = pendingAttachment; saveMessage(conversation, { ...message, from: 'me' }); pendingAttachment = null; closePanel(); }
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
    document.addEventListener('account-deletion-lock', () => {
        cancelRecording();
        if (pendingAttachment?.media?.startsWith('blob:')) URL.revokeObjectURL(pendingAttachment.media);
        pendingAttachment = null;
    });
    document.addEventListener('click', event => { if (event.target.closest('[data-view]')) cancelRecording(); });
    document.getElementById('messages-list').addEventListener('submit', event => {
        const form = event.target.closest('.chat-composer'); if (!form) return;
        event.preventDefault(); const conversation = activeConversation(), text = form.elements.message.value.trim();
        if (conversation && text) saveMessage(conversation, { type: 'text', from: 'me', text });
    });
    document.getElementById('messages-list').addEventListener('change', event => {
        if (!event.target.matches('.chat-gallery-input')) return;
        const conversation = activeConversation(), file = event.target.files?.[0];
        if (!file || !canSendToConversation(conversation)) return;
        if ((!file.type.startsWith('image/') && !file.type.startsWith('video/')) || file.size > 20 * 1024 * 1024) { showShareFeedback('Choose a photo or video up to 20 MB.'); return; }
        const mediaKind = file.type.startsWith('video/') ? 'video' : 'photo';
        pendingAttachment = { conversation, type: 'attachment', mediaKind, media: URL.createObjectURL(file) };
        const media = mediaKind === 'video' ? `<video controls playsinline src="${escapeHtml(pendingAttachment.media)}"></video>` : `<img src="${escapeHtml(pendingAttachment.media)}" alt="Attachment preview" />`;
        showHomePanel('Gallery attachment', `<div class="attachment-preview">${media}</div><div class="panel-actions"><button type="button" data-attachment-send>Send ${mediaKind}</button><button type="button" data-attachment-discard>Discard</button></div>`);
    });
    document.addEventListener('submit', event => {
        const form = event.target;
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
            const file = form.elements.groupPhoto.files?.[0];
            if (file && (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 20 * 1024 * 1024)) { showShareFeedback('Choose a JPG, PNG or WebP image up to 20 MB.'); return; }
            const removed = [...form.querySelectorAll('input[name="removeMember"]:checked')].map(input => input.value);
            group.user = name.slice(0, 60); group.members = group.members.filter(handle => !removed.includes(handle)); group.pendingMembers = (group.pendingMembers || []).filter(handle => !removed.includes(handle));
            if (file) group.photo = URL.createObjectURL(file);
            closePanel(); renderMessages(); persistSession().catch(() => showShareFeedback('The group changes could not be saved.'));
        }
    });
}
