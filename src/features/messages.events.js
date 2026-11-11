import { TEMPORARY_ATTACHMENT_BYTES, expireChatAttachments } from './chat-attachment-expiry.js';
import { openChatWallpaper, registerChatWallpaperEvents } from './chat-wallpaper.js';
import { openGroupPhotoPicker, openGroupPhotoViewer, registerGroupPhotoEvents } from './group-photo.js';
import { persistPreferences } from '../storage/preferences.js';
import { canViewMedia, canViewStory, getAccount, mayInteract } from '../core/social.js';
import { openProfileMedia } from './profile.js';
import { showShareFeedback } from '../components/feedback.js';
import { openSharedPostPage, pushConversationHistory, pushGroupProfileHistory, returnToConversationList } from '../core/navigation.js';
import { state } from '../core/state.js';
import { escapeHtml } from '../core/utils.js';
import { findEntity } from '../data/entities.js';
import { conversations, currentUser } from '../data/sample-data.js';
import { appendChatMessage, renderMessages, renderReplyQuote, conversationAvatar, markInboxChatRead } from './messages.js';
import { canSendToConversation, createLocalGroup, respondToGroupInvitation, isJoinedGroup, leaveLocalGroup, isGroupAdmin, updateGroupMember, availableGroupInvitees, addLocalGroupMembers, visibleConversationMessages, hideConversationMessages, clearConversationForViewer, refreshConversationTimers } from './message-access.js';
import { closeHomePanel, openReportPanel, showHomePanel } from './home-controls.js';
import { persistSession } from '../storage/local-session.js';
import { openStoryRepostEditor } from './stories.events.js';
import { openStoryGroup, showStoryAtIndex } from './stories.js';

let expiryTimer;
let pendingPostTap;
const POST_DOUBLE_TAP_MS = 300;
const MESSAGE_HOLD_MS = 750;
const MESSAGE_REACTIONS = [['❤️', 'Like'], ['😂', 'Laugh'], ['😮', 'Surprised'], ['😢', 'Sad'], ['😡', 'Angry'], ['👍', 'Thumbs up']];
let recorder, recordingStream, recordingTimer, recordingGeneration = 0, pendingAttachment;
let voiceComposer, voiceDraft, stopVoiceMeter;
let copiedVoice;
const activeConversation = () => conversations.find(item => item.handle === state.activeConversationHandle);
const closePanel = () => { document.querySelector('.home-controls-backdrop').hidden = true; };
const replyTargets = new WeakMap();

function findMessageForBubble(bubble) {
    const chat = activeConversation();
    const id = bubble?.dataset.reactableMessage;
    return chat && id ? visibleConversationMessages(chat).find(item => String(item.id) === id) : undefined;
}

function isGalleryAttachment(message) {
    return message?.type === 'attachment' && (message.mediaKind === 'photo' || message.mediaKind === 'video');
}

function downloadGalleryAttachment(message) {
    if (!isGalleryAttachment(message) || !message.media?.startsWith('blob:')) return;
    if (Number.isFinite(message.expiresAt) && message.expiresAt <= Date.now()) {
        refreshChatAttachmentExpiry();
        return;
    }
    const link = document.createElement('a');
    link.href = message.media;
    link.download = message.fileName || (message.mediaKind === 'photo' ? 'Photo' : 'Video');
    document.body.append(link);
    link.click();
    link.remove();
}

async function copyMessageText(bubble) {
    const message = findMessageForBubble(bubble);
    if (message?.type !== 'text' || typeof message.text !== 'string') return;
    try {
        await navigator.clipboard.writeText(message.text);
        showShareFeedback('Message copied.');
    } catch {
        showShareFeedback('Could not copy the message.');
    }
}

async function copyVoiceMessage(message) {
    if (message?.type !== 'voice' || !message.media) return;
    try {
        const response = await fetch(message.media);
        if (!response.ok) throw new Error('Audio unavailable');
        copiedVoice = { blob: await response.blob(), durationSeconds: message.durationSeconds };
        showShareFeedback('Audio copied. Use + → Paste audio in a chat.');
    } catch {
        showShareFeedback('Could not copy the audio.');
    }
}

function canForwardMessage(message) {
    return message && !['call', 'story-mention'].includes(message.type)
        && (message.type !== 'attachment' || (message.media && !(message.expiresAt <= Date.now())));
}

function openForwardMessage(message) {
    const targets = conversations.filter(canSendToConversation);
    if (!canForwardMessage(message) || !targets.length) return;
    showHomePanel('Forward message', `<form class="chat-forward-form" data-message-id="${escapeHtml(String(message.id))}">
      <label>Choose chat<select name="recipient" required><option value="">Select a conversation</option>
        ${targets.map(chat => `<option value="${escapeHtml(chat.handle)}">${escapeHtml(chat.user)}</option>`).join('')}
      </select></label><button type="submit">Forward</button>
    </form>`);
}

function setMessageReaction(bubble, reaction) {
    const message = findMessageForBubble(bubble);
    if (!message) return;
    message.reactionsBy = { ...message.reactionsBy, [currentUser.handle]: reaction };
    const badge = bubble.querySelector('.chat-message-reaction');
    badge.textContent = reaction;
    badge.hidden = false;
    persistSession().catch(() => showShareFeedback('This message reaction could not be saved on this device.'));
}

function startChatReply(bubble) {
    const chat = activeConversation();
    const message = findMessageForBubble(bubble);
    const form = bubble?.closest('.chat-window')?.querySelector('.chat-composer');
    if (!message || !form || bubble.closest('.selecting-messages')) return false;
    clearTimeout(pendingPostTap?.timer);
    pendingPostTap = null;
    replyTargets.set(form, message.id);
    form.querySelector('.chat-reply-draft')?.remove();
    form.insertAdjacentHTML('afterbegin', `<div class="chat-reply-draft">
        ${renderReplyQuote(message, chat)}
        <button type="button" data-cancel-chat-reply aria-label="Cancel reply">×</button>
    </div>`);
    form.elements.message.focus();
    return true;
}

function registerMessageReactionGestures(list) {
    let hold, suppressedBubble, openBubble;
    const closeTray = () => { list.querySelector('.chat-reaction-tray')?.remove(); openBubble = null; };
    const cancelHold = () => {
        clearTimeout(hold?.timer);
        hold?.bubble.style.removeProperty('--chat-reply-offset');
        hold = null;
    };
    list.addEventListener('pointerdown', event => {
        if (event.target.closest('.chat-reaction-tray')) return;
        closeTray();
        cancelHold();
        suppressedBubble = null;
        const history = event.target.closest('.chat-history');
        if (!history || history.classList.contains('selecting-messages') || event.target.closest('input, audio, video[controls]') || !event.isPrimary || event.button !== 0) return;
        const pressedBubble = event.target.closest('[data-reactable-message]');
        const bubble = pressedBubble || [...history.children].find(row => {
            if (!row.hasAttribute('data-reactable-message')) return false;
            const { top, bottom } = row.getBoundingClientRect();
            return event.clientY >= top && event.clientY < bottom;
        });
        if (!bubble) return;
        hold = { bubble, x: event.clientX, y: event.clientY, pointerId: event.pointerId };
        if (!pressedBubble) return;
        hold.timer = window.setTimeout(() => {
            if (!bubble.isConnected || bubble.closest('.selecting-messages') || state.currentView !== 'messages') return;
            suppressedBubble = openBubble = bubble;
            clearTimeout(pendingPostTap?.timer);
            pendingPostTap = null;
            const message = findMessageForBubble(bubble);
            const canCopy = message?.type === 'text';
            const canDownload = isGalleryAttachment(message) && message.media?.startsWith('blob:')
                && (!Number.isFinite(message.expiresAt) || message.expiresAt > Date.now());
            bubble.closest('.chat-window').insertAdjacentHTML('beforeend', `<div class="chat-reaction-tray" role="group" aria-label="React to message">
              ${MESSAGE_REACTIONS.map(([emoji, label]) => `<button type="button" data-message-reaction="${emoji}" aria-label="${label}">${emoji}</button>`).join('')}
              ${message && bubble.closest('.chat-window').querySelector('.chat-composer') ? '<button type="button" data-reply-to-message>Reply</button>' : ''}
              ${canCopy ? '<button type="button" data-copy-message>Copy</button>' : ''}
              ${message?.type === 'voice' && message.media ? '<button type="button" data-copy-voice>Copy audio</button>' : ''}
              ${canDownload ? '<button type="button" data-download-gallery>Download</button>' : ''}
              ${canForwardMessage(message) ? '<button type="button" data-forward-message>Forward</button>' : ''}
              ${message ? '<button type="button" data-delete-one-message>Delete</button>' : ''}
            </div>`);
            const tray = list.querySelector('.chat-reaction-tray');
            const bounds = bubble.getBoundingClientRect();
            const frame = list.getBoundingClientRect();
            tray.style.left = `${Math.max(frame.left + 4, Math.min(bounds.left, frame.right - tray.offsetWidth - 4))}px`;
            tray.style.top = `${bounds.top - tray.offsetHeight - 6 >= frame.top ? bounds.top - tray.offsetHeight - 6 : bounds.bottom + 6}px`;
        }, MESSAGE_HOLD_MS);
    });
    list.addEventListener('pointermove', event => {
        if (hold?.pointerId !== event.pointerId) return;
        const x = event.clientX - hold.x;
        const y = Math.abs(event.clientY - hold.y);
        if (Math.hypot(x, y) <= 10) return;
        const form = hold.bubble.closest('.chat-window')?.querySelector('.chat-composer');
        if (x <= y || !form) { cancelHold(); return; }
        clearTimeout(hold.timer);
        closeTray();
        hold.bubble.setPointerCapture?.(event.pointerId);
        hold.bubble.style.setProperty('--chat-reply-offset', `${Math.min(x, 40)}px`);
    });
    list.addEventListener('pointerup', event => {
        if (hold?.pointerId !== event.pointerId) return;
        const { bubble, x, y } = hold;
        const distance = event.clientX - x;
        if (distance >= 48 && distance > Math.abs(event.clientY - y)) {
            if (startChatReply(bubble)) {
                suppressedBubble = bubble;
                closeTray();
            }
        }
        cancelHold();
    });
    for (const type of ['pointercancel', 'pointerleave']) list.addEventListener(type, cancelHold);
    list.addEventListener('dragstart', event => {
        if (event.target.closest('[data-reactable-message]')) event.preventDefault();
    });
    list.addEventListener('contextmenu', event => {
        if (event.target.closest('[data-reactable-message]') && !event.target.closest('.selecting-messages')) event.preventDefault();
    });
    list.addEventListener('click', event => {
        const reaction = event.target.closest('[data-message-reaction]');
        if (event.target.closest('[data-reply-to-message]')) {
            startChatReply(openBubble);
            closeTray();
        } else if (event.target.closest('[data-copy-message]')) {
            void copyMessageText(openBubble);
            closeTray();
        } else if (event.target.closest('[data-copy-voice]')) {
            void copyVoiceMessage(findMessageForBubble(openBubble));
            closeTray();
        } else if (event.target.closest('[data-forward-message]')) {
            openForwardMessage(findMessageForBubble(openBubble));
            closeTray();
        } else if (event.target.closest('[data-delete-one-message]')) {
            const message = findMessageForBubble(openBubble);
            closeTray();
            if (message && hideConversationMessages(activeConversation(), [message.id])) {
                renderMessages({ preserveComposer: true });
                persistSession().catch(() => showShareFeedback('This device could not save the chat deletion.'));
            }
        } else if (event.target.closest('[data-download-gallery]')) {
            downloadGalleryAttachment(findMessageForBubble(openBubble));
            closeTray();
        } else if (reaction) {
            setMessageReaction(openBubble, reaction.dataset.messageReaction);
            closeTray();
        } else if (suppressedBubble && suppressedBubble.contains(event.target)) {
            suppressedBubble = null;
        } else {
            closeTray();
            return;
        }
        event.preventDefault();
        event.stopPropagation();
    }, true);
    document.addEventListener('keydown', event => { if (event.key === 'Escape') closeTray(); });
}

function handleSharedPostTap(card, postId, keyboardActivated) {
    const previousTap = pendingPostTap;
    clearTimeout(previousTap?.timer);
    pendingPostTap = null;
    if (keyboardActivated) { openSharedPostPage(postId); return; }

    const chat = activeConversation();
    if (previousTap?.card === card && Date.now() - previousTap.at <= POST_DOUBLE_TAP_MS) {
        setMessageReaction(card.closest('[data-reactable-message]'), '❤️');
        return;
    }

    pendingPostTap = {
        card, at: Date.now(),
        timer: window.setTimeout(() => {
            pendingPostTap = null;
            if (state.currentView === 'messages' && activeConversation() === chat && card.isConnected && !card.inert) {
                openSharedPostPage(postId);
            }
        }, POST_DOUBLE_TAP_MS),
    };
}
function closeChatOptions() {
    document.querySelector('.chat-options-menu')?.setAttribute('hidden', '');
    document.querySelector('[data-chat-options]')?.setAttribute('aria-expanded', 'false');
    document.querySelector('.chat-more-menu')?.setAttribute('hidden', '');
    document.querySelector('[data-chat-more]')?.setAttribute('aria-expanded', 'false');
}
export function refreshChatAttachmentExpiry() {
    clearTimeout(expiryTimer);
    const attachments = expireChatAttachments(conversations);
    const chats = refreshConversationTimers(conversations);
    const nextExpiry = Math.min(attachments.nextExpiry, chats.nextExpiry);
    if (attachments.changed || chats.changed) {
        closeMessageDeletion();
        if (state.currentView === 'messages') renderMessages({ preserveComposer: true });
        persistSession().catch(() => showShareFeedback('Expiry changes could not be saved on this device.'));
    }
    if (Number.isFinite(nextExpiry)) {
        expiryTimer = window.setTimeout(refreshChatAttachmentExpiry, Math.min(2_147_483_647, Math.max(1, nextExpiry - Date.now())));
    }
}

function saveMessage(conversation, message, options) {
    if (!canSendToConversation(conversation)) { showShareFeedback('Messaging is unavailable for this conversation.'); return false; }
    appendChatMessage(conversation, message, options);
    if (message.type === 'attachment' || conversation.chatTimerEnabled) refreshChatAttachmentExpiry();
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
function resetVoiceComposer() {
    voiceComposer?.classList.remove('chat-composer-voice');
    voiceComposer?.querySelector('.chat-voice-composer-row')?.remove();
    voiceComposer = null;
}

function cancelRecording() {
    recordingGeneration += 1;
    clearTimeout(recordingTimer);
    stopVoiceMeter?.();
    stopVoiceMeter = null;
    if (recorder?.state === 'recording') recorder.stop();
    recorder = null;
    recordingStream?.getTracks().forEach(track => track.stop());
    recordingStream = null;
    if (voiceDraft) URL.revokeObjectURL(voiceDraft.media);
    voiceDraft = null;
    resetVoiceComposer();
}

function voiceClock(seconds) {
    return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

function startVoiceMeter(form, stream, startedAt) {
    form.classList.add('chat-composer-voice');
    form.insertAdjacentHTML('beforeend', `<div class="chat-voice-composer-row">
        <span class="chat-recording-time" aria-label="Recording time">0:00</span>
        <div class="chat-recording-wave" aria-hidden="true">${'<i></i>'.repeat(22)}</div>
        <button type="button" class="chat-recording-stop" data-stop-voice aria-label="Stop recording">■</button>
    </div>`);
    const timer = form.querySelector('.chat-recording-time');
    const bars = [...form.querySelectorAll('.chat-recording-wave i')];
    let context, analyser, samples;
    try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) {
            context = new AudioContextClass();
            analyser = context.createAnalyser();
            analyser.fftSize = 512;
            context.createMediaStreamSource(stream).connect(analyser);
            samples = new Uint8Array(analyser.fftSize);
            context.resume().catch(() => {});
        }
    } catch {
        analyser = null;
    }
    const levels = bars.map(() => 0);
    const interval = window.setInterval(() => {
        if (!form.isConnected) { cancelRecording(); return; }
        timer.textContent = voiceClock((Date.now() - startedAt) / 1000);
        if (!analyser) return;
        analyser.getByteTimeDomainData(samples);
        let peak = 0;
        for (const sample of samples) peak = Math.max(peak, Math.abs(sample - 128) / 128);
        levels.shift();
        levels.push(peak);
        bars.forEach((bar, index) => { bar.style.height = `${3 + Math.min(1, levels[index] * 2) * 23}px`; });
    }, 80);
    return () => {
        window.clearInterval(interval);
        if (context && context.state !== 'closed') context.close().catch(() => {});
    };
}

function syncVoicePlayer(audio) {
    const player = audio.closest('.chat-voice-player');
    if (!player) return;
    const button = player.querySelector('[data-voice-play]');
    const seek = player.querySelector('[data-voice-seek]');
    const playing = !audio.paused && !audio.ended;
    button.setAttribute('aria-label', playing ? 'Pause voice message' : 'Play voice message');
    button.firstElementChild.textContent = playing ? '❚❚' : '▶';
    const duration = Number.isFinite(audio.duration) ? audio.duration
        : Number(seek.dataset.recordedDuration) || (audio.ended ? audio.currentTime : Number(seek.max));
    seek.max = String(duration);
    seek.disabled = duration <= 0;
    seek.value = String(audio.currentTime);
    const clock = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
    player.querySelector('.chat-voice-time').textContent = `${clock(audio.currentTime)} / ${duration > 0 ? clock(duration) : '–:––'}`;
}

function prepareVoiceDraft(form, conversation, blob, durationSeconds) {
    voiceComposer = form;
    voiceDraft = { conversation, type: 'voice', durationSeconds, media: URL.createObjectURL(blob) };
    form.classList.add('chat-composer-voice');
    form.querySelector('.chat-voice-composer-row')?.remove();
    form.insertAdjacentHTML('beforeend', `<div class="chat-voice-composer-row">
        <button type="button" data-discard-voice aria-label="Discard recording">×</button>
        <span class="chat-voice-ready">Voice message${durationSeconds ? ` · ${voiceClock(durationSeconds)}` : ''}</span>
        <button type="submit" class="chat-send-button">Send</button>
    </div>`);
}

async function toggleRecording(button) {
    const conversation = activeConversation();
    const form = button.form;
    if (voiceComposer && !voiceComposer.isConnected) cancelRecording();
    if (!canSendToConversation(conversation) || !form || recorder || voiceDraft) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        showShareFeedback('Voice recording is unavailable in this browser.');
        return;
    }
    button.disabled = true;
    const generation = ++recordingGeneration;
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (generation !== recordingGeneration || !form.isConnected || activeConversation() !== conversation || !canSendToConversation(conversation)) {
            stream.getTracks().forEach(track => track.stop());
            return;
        }
        recordingStream = stream;
        const chunks = [];
        const recording = new MediaRecorder(stream);
        const startedAt = Date.now();
        recorder = recording;
        voiceComposer = form;
        recording.addEventListener('dataavailable', event => { if (event.data.size) chunks.push(event.data); });
        recording.addEventListener('stop', () => {
            stream.getTracks().forEach(track => track.stop());
            if (generation !== recordingGeneration) return;
            clearTimeout(recordingTimer);
            stopVoiceMeter?.();
            stopVoiceMeter = null;
            recordingStream = null;
            recorder = null;
            if (!form.isConnected || !chunks.length) { resetVoiceComposer(); return; }
            const durationSeconds = Math.max(0.01, (Date.now() - startedAt) / 1000);
            prepareVoiceDraft(form, conversation, new Blob(chunks, { type: recording.mimeType }), durationSeconds);
        });
        recording.addEventListener('error', () => {
            if (generation !== recordingGeneration) return;
            cancelRecording();
            showShareFeedback('The recording could not be saved.');
        });
        recording.start();
        form.elements.message.blur();
        stopVoiceMeter = startVoiceMeter(form, stream, startedAt);
        recordingTimer = window.setTimeout(() => { if (recording.state === 'recording') recording.stop(); }, 120000);
    } catch {
        if (generation === recordingGeneration) cancelRecording();
        showShareFeedback('Microphone access was unavailable. You can still send text or gallery attachments.');
    } finally {
        button.disabled = false;
    }
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

function openChatTimer(chat) {
    const enabled = chat.chatTimerEnabled === true;
    showHomePanel('Chat timer', `
      <form class="chat-timer-form" data-handle="${escapeHtml(chat.handle)}">
        <fieldset><legend>Keep messages</legend>
          <label><input type="radio" name="retention" value="off"${enabled ? '' : ' checked'} /> Keep history</label>
          <label><input type="radio" name="retention" value="24-hours"${enabled ? ' checked' : ''} /> Last 24 hours</label>
        </fieldset>
        <p>Messages and shares in this conversation are removed for both participants 24 hours after sending. Older items are removed when you turn the timer on. Turning it off keeps the remaining history.</p>
        <button type="submit">Save</button>
      </form>`);
}

function openMessageDeletion(chat) {
    const history = document.querySelector('.chat-history');
    const messages = visibleConversationMessages(chat);
    if (!messages.length) { showShareFeedback('There are no messages to delete.'); return; }

    history.classList.add('selecting-messages');
    history.querySelectorAll(':scope > article').forEach((bubble, index) => {
        for (const child of bubble.children) child.inert = true;
        bubble.insertAdjacentHTML('beforeend', `<button type="button" class="chat-message-select"
            data-select-chat-message="${escapeHtml(String(messages[index].id))}" aria-pressed="false"
            aria-label="Select message ${index + 1}"><span aria-hidden="true">✓</span></button>`);
    });
    history.insertAdjacentHTML('afterend', `<div class="chat-selection-actions">
      <span class="chat-selection-hint" role="status">Tap messages to select</span>
      <button type="button" data-cancel-message-deletion>Cancel</button>
      <button type="button" data-confirm-message-deletion="selected" disabled>Delete</button>
      <button type="button" data-confirm-message-deletion="clear">Clear chat</button>
    </div>`);
    history.querySelector('.chat-message-select')?.focus({ preventScroll: true });
}

function closeMessageDeletion() {
    const history = document.querySelector('.chat-history.selecting-messages');
    if (!history) return;
    history.classList.remove('selecting-messages');
    for (const button of history.querySelectorAll('.chat-message-select')) {
        const bubble = button.parentElement;
        button.remove();
        for (const child of bubble.children) child.inert = false;
    }
    document.querySelector('.chat-selection-actions')?.remove();
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

async function pickChatContact(conversation) {
    if (!navigator.contacts?.select) {
        showHomePanel('Share a contact', '<p>This browser cannot open your contacts. You can share a .vcf contact file using Share a file.</p>');
        return;
    }
    try {
        const [contact] = await navigator.contacts.select(['name', 'tel'], { multiple: false });
        if (!contact || state.currentView !== 'messages' || activeConversation() !== conversation) return;
        const phone = (contact.tel || []).find(number => /[0-9]/.test(number))?.trim();
        if (!phone) { showShareFeedback('Choose a contact with a phone number.'); return; }
        const contactName = contact.name?.[0]?.trim() || phone;
        showHomePanel('Share a contact', `
            <form class="chat-share-contact" data-handle="${escapeHtml(conversation.handle)}">
              <p><strong>${escapeHtml(contactName)}</strong> · ${escapeHtml(phone)}</p>
              <input type="hidden" name="contactName" value="${escapeHtml(contactName)}" />
              <input type="hidden" name="phone" value="${escapeHtml(phone)}" />
              <button type="submit">Send contact</button>
            </form>`);
    } catch (error) {
        if (error.name !== 'AbortError') showShareFeedback('Could not open contacts. You can share a .vcf contact file using Share a file.');
    }
}

export function handleMessageClick(event) {
    const cancelReply = event.target.closest('[data-cancel-chat-reply]');
    if (cancelReply) {
        const form = cancelReply.form;
        replyTargets.delete(form);
        cancelReply.closest('.chat-reply-draft').remove();
        form.elements.message.focus();
        return true;
    }
    const gallery = event.target.closest('[data-open-gallery-attachment]');
    if (gallery) {
        const message = findMessageForBubble(gallery.closest('[data-reactable-message]'));
        if (!isGalleryAttachment(message) || !message.media) return true;
        if (Number.isFinite(message.expiresAt) && message.expiresAt <= Date.now()) {
            refreshChatAttachmentExpiry();
            return true;
        }
        const source = escapeHtml(message.media);
        const video = message.mediaKind === 'video';
        showHomePanel(video ? 'Video' : 'Photo', `<div class="attachment-preview">${video
            ? `<video controls playsinline preload="metadata" src="${source}"></video>`
            : `<img src="${source}" alt="Photo attachment" />`}</div>`);
        return true;
    }
    if (event.target.closest('[data-shared-post-back]')) {
        window.history.back();
        return true;
    }
    const voicePlay = event.target.closest('[data-voice-play]');
    if (voicePlay) {
        const audio = voicePlay.closest('.chat-voice-player').querySelector('audio');
        if (audio.paused || audio.ended) {
            if (audio.ended) audio.currentTime = 0;
            audio.play().catch(() => showShareFeedback('This voice message could not be played.'));
        } else audio.pause();
        return true;
    }
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
        if (shared.dataset.sharedType === 'post') handleSharedPostTap(shared, entity.id, event.detail === 0);
        else openProfileMedia(shared.dataset.sharedType, entity.id, shared, { singleItem: true });
        return true;
    }
    if (!event.target.closest('.chat-options-wrap')) closeChatOptions();
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
    if (options) {
        const menu = document.querySelector('.chat-options-menu');
        if (menu.hidden) { menu.hidden = false; options.setAttribute('aria-expanded', 'true'); }
        else closeChatOptions();
        return true;
    }
    const more = event.target.closest('[data-chat-more]');
    if (more) {
        const menu = document.querySelector('.chat-more-menu');
        menu.hidden = !menu.hidden;
        more.setAttribute('aria-expanded', String(!menu.hidden));
        if (!menu.hidden) menu.querySelector('button').focus();
        return true;
    }
    if (event.target.closest('[data-chat-report]')) {
        const chat = activeConversation();
        if (chat && !chat.isGroup) {
            closeChatOptions();
            openReportPanel({ id: chat.handle }, 'profile');
        }
        return true;
    }
    const option = event.target.closest('[data-chat-option]');
    if (option) {
        const conversation = activeConversation(); if (!conversation) return true;
        const action = option.dataset.chatOption;
        if (action === 'pin') conversation.pinned = !conversation.pinned;
        if (action === 'mute' || action === 'wallpaper' || action === 'delete' || action === 'timer') {
            closeChatOptions();
            if (action === 'mute') openChatMuteOptions(conversation);
            else if (action === 'wallpaper') openChatWallpaper(conversation);
            else if (action === 'timer' && !conversation.isGroup) openChatTimer(conversation);
            else if (action === 'delete' && (!conversation.isGroup || isJoinedGroup(conversation))) openMessageDeletion(conversation);
            return true;
        }
        if (action === 'group-profile') { openGroupProfile(conversation); return true; }
        if (action === 'leave-group') { confirmLeaveGroup(conversation); return true; }
        if (action === 'manage-group') { openGroupManager(conversation); return true; }
        renderMessages(); return true;
    }
    const selectMessage = event.target.closest('[data-select-chat-message]');
    if (selectMessage) {
        selectMessage.setAttribute('aria-pressed', String(selectMessage.getAttribute('aria-pressed') !== 'true'));
        const selected = [...document.querySelectorAll('[data-select-chat-message][aria-pressed="true"]')];
        document.querySelector('[data-confirm-message-deletion="selected"]').disabled = !selected.length;
        document.querySelector('.chat-selection-hint').textContent = selected.length ? `${selected.length} selected` : 'Tap messages to select';
        return true;
    }
    if (event.target.closest('[data-cancel-message-deletion]')) {
        closeMessageDeletion();
        document.querySelector('[data-chat-options]')?.focus();
        return true;
    }
    const deleteSelection = event.target.closest('[data-confirm-message-deletion]');
    if (deleteSelection) {
        const chat = activeConversation();
        const history = document.querySelector('.chat-history.selecting-messages');
        if (!chat || !history || (chat.isGroup && !isJoinedGroup(chat))) return true;
        const ids = [...history.querySelectorAll('[data-select-chat-message][aria-pressed="true"]')]
            .map(button => button.dataset.selectChatMessage);
        const selectedIds = new Set(ids);
        const deleted = deleteSelection.dataset.confirmMessageDeletion === 'clear'
            ? clearConversationForViewer(chat)
            : hideConversationMessages(chat, visibleConversationMessages(chat)
                .filter(message => selectedIds.has(String(message.id))).map(message => message.id));
        if (deleted) {
            const scrollTop = history.scrollTop;
            closeMessageDeletion();
            renderMessages({ preserveComposer: true });
            history.scrollTop = scrollTop;
            document.querySelector('[data-chat-options]')?.focus({ preventScroll: true });
            persistSession().catch(() => showShareFeedback('This device could not save the chat deletion.'));
        }
        return true;
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
              ${copiedVoice ? '<button type="button" data-chat-share-kind="paste-audio">Paste audio</button>' : ''}
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
        if (kind === 'paste-audio') {
            const form = document.querySelector('.chat-composer');
            if (form && copiedVoice && !recorder && !voiceDraft) {
                closeHomePanel();
                prepareVoiceDraft(form, conversation, copiedVoice.blob, copiedVoice.durationSeconds);
            }
        } else if (kind === 'file') {
            closeHomePanel();
            document.querySelector('.chat-file-input')?.click();
        } else if (kind === 'location') {
            showHomePanel('Share your location', `
                <form class="chat-share-details" data-handle="${escapeHtml(conversation.handle)}">
                  <label>Current coordinates<input name="place" readonly placeholder="Location not yet fetched" /></label>
                  <button type="button" data-chat-current-location>Use current location</button>
                  <p class="chat-location-status" role="status"></p>
                  <button type="submit" disabled>Send location</button>
                </form>`);
        } else if (kind === 'contact') {
            closeHomePanel();
            void pickChatContact(conversation);
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
    const stopVoice = event.target.closest('[data-stop-voice]');
    if (stopVoice) {
        if (recorder?.state === 'recording') { stopVoice.disabled = true; recorder.stop(); }
        return true;
    }
    if (event.target.closest('[data-discard-voice]')) { cancelRecording(); return true; }
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
async function forwardChatMessage(form) {
    const source = activeConversation();
    const target = conversations.find(chat => chat.handle === form.elements.recipient.value);
    const original = source && visibleConversationMessages(source).find(message => String(message.id) === form.dataset.messageId);
    if (!canForwardMessage(original) || !canSendToConversation(target)) return;
    const submit = form.querySelector('button[type="submit"]');
    if (submit.disabled) return;
    submit.disabled = true;
    const { id, sentAt, from, reactionsBy, likedBy, replyToId, expiresAt, ...message } = original;
    let copiedMedia;
    try {
        if (typeof message.media === 'string' && message.media.startsWith('blob:')) {
            const response = await fetch(message.media);
            if (!response.ok) throw new Error('Attachment unavailable');
            copiedMedia = URL.createObjectURL(await response.blob());
            message.media = copiedMedia;
        }
        if (!form.isConnected || form.closest('.home-controls-backdrop')?.hidden || activeConversation() !== source || !canForwardMessage(original)) return;
        if (saveMessage(target, { ...message, from: 'me' }, { preserveComposer: true })) {
            copiedMedia = null;
            closeHomePanel();
            showShareFeedback('Message forwarded.');
        }
    } catch {
        showShareFeedback('Could not forward the message.');
    } finally {
        if (copiedMedia) URL.revokeObjectURL(copiedMedia);
        submit.disabled = false;
    }
}

export function registerMessageFormEvents() {
    const messagesList = document.getElementById('messages-list');
    registerMessageReactionGestures(messagesList);
    for (const type of ['loadedmetadata', 'durationchange', 'timeupdate', 'play', 'pause', 'ended']) {
        messagesList.addEventListener(type, event => {
            if (event.target.matches('.chat-voice-player audio')) syncVoicePlayer(event.target);
        }, true);
    }
    messagesList.addEventListener('input', event => {
        const seek = event.target;
        if (!seek.matches('[data-voice-seek]')) return;
        const audio = seek.closest('.chat-voice-player').querySelector('audio');
        audio.currentTime = Number(seek.value);
        syncVoicePlayer(audio);
    });
    registerChatWallpaperEvents();
    window.addEventListener('pageshow', refreshChatAttachmentExpiry);
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) refreshChatAttachmentExpiry();
    });
    registerGroupPhotoEvents();
    registerInboxChatOptions(document.getElementById('messages-list'));
    document.addEventListener('account-deletion-lock', () => {
        cancelRecording();
        copiedVoice = null;
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
        if (form === voiceComposer) {
            if (voiceDraft && voiceDraft.conversation === conversation) {
                const { conversation: target, ...message } = voiceDraft;
                if (saveMessage(target, { ...message, from: 'me' }, { preserveComposer: true })) {
                    voiceDraft = null;
                    resetVoiceComposer();
                }
            }
            return;
        }
        const input = form.elements.message;
        const text = input.value.trim();
        const replyToId = replyTargets.get(form);
        if (conversation && text && saveMessage(conversation, { type: 'text', from: 'me', text, ...(replyToId != null ? { replyToId } : {}) }, { preserveComposer: true })) {
            input.value = '';
            replyTargets.delete(form);
            form.querySelector('.chat-reply-draft')?.remove();
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
        if (form.matches('.chat-timer-form')) {
            event.preventDefault();
            const chat = activeConversation();
            if (!chat || chat.handle !== form.dataset.handle || chat.isGroup) return;
            const enabled = form.elements.retention.value === '24-hours';
            if (!enabled && chat.chatTimerEnabled) refreshChatAttachmentExpiry();
            chat.chatTimerEnabled = enabled;
            closeHomePanel();
            refreshChatAttachmentExpiry();
            persistSession().catch(() => showShareFeedback('Chat timer could not be saved on this device.'));
            return;
        }
        if (form.matches('.chat-forward-form')) {
            event.preventDefault();
            void forwardChatMessage(form);
            return;
        }
        if (form.matches('.chat-share-details, .chat-share-contact')) {
            event.preventDefault();
            const conversation = activeConversation();
            if (!conversation || conversation.handle !== form.dataset.handle) return;
            const message = form.matches('.chat-share-contact')
                ? { type: 'contact', contactName: form.elements.contactName.value, phone: form.elements.phone.value }
                : { type: 'location', place: form.elements.place.value.trim() };
            if (Object.values(message).every(Boolean) && saveMessage(conversation, { ...message, from: 'me' })) closeHomePanel();
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
