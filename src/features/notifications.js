import { state } from '../core/state.js';
import { conversations, currentUser } from '../data/sample-data.js';
import { getAccount, canViewStory } from '../core/social.js';
import { escapeHtml } from '../core/utils.js';
import { persistPreferences } from '../storage/preferences.js';
import { openStoryGroup, showStoryAtIndex } from './stories.js';
import { storyComposition } from './story-composition.js';
import { persistSession } from '../storage/local-session.js';
import { showShareFeedback } from '../components/feedback.js';

let trigger;
const isolated = [];

export function availableLocalNotifications() {
    if (state.deletionRequestedAt) return [];
    const requests = state.incomingFollowRequests.filter(handle => !state.blockedHandles.has(handle)).map(handle => ({
        title: 'Follow request', text: `${getAccount(handle)?.name || handle} requested to follow you.`
    }));
    const unread = conversations.filter(chat => chat.unread && !state.blockedHandles.has(chat.handle)
        && (!chat.isGroup || chat.members?.includes(currentUser.handle))).map(chat => ({
        title: 'Unread conversation', text: `You have unread messages in ${chat.user || chat.handle}.`
    }));
    const approvals = (state.localApprovalNotices || []).filter(notice => notice.recipient === currentUser.handle).map(() => ({
        title: 'Follow request approved', text: 'A follow request was approved in this local preview.'
    }));
    const storyLikes = (state.localStoryNotifications || []).filter(notice => notice.recipient === currentUser.handle && !state.blockedHandles.has(notice.actor)).sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0)).map(notice => ({
        ...notice,
        title: notice.kind === 'story-mention' ? 'Story mention' : notice.demo ? 'Story like · demo' : 'Story like',
        text: notice.kind === 'story-mention' ? `${notice.actorName || notice.actor} mentioned you in their story.` : `${notice.actorName || notice.actor} liked your story.`
    }));
    return [...storyLikes, ...requests, ...unread, ...approvals];
}

export function recordStoryMentions(story) {
    if (!story?.id || !story.handle || state.deletionRequestedAt || state.blockedHandles.has(story.handle) || (story.expiresAt && story.expiresAt <= Date.now())) return 0;
    const recipients = new Set();
    for (const layer of storyComposition(story.edits).layers) {
        if (layer.type !== 'text') continue;
        const written = new Set((String(layer.text || '').match(/@[a-zA-Z0-9._]+/g) || []).map(handle => handle.toLowerCase()));
        for (const mention of layer.mentions || []) {
            const account = getAccount(mention.handle);
            if (account && written.has(account.handle.toLowerCase()) && account.handle !== story.handle && !state.blockedHandles.has(account.handle) && canViewStory(story, account.handle)) recipients.add(account.handle);
        }
    }
    let created = 0;
    state.localStoryNotifications ||= [];
    for (const recipient of recipients) {
        if (story.handle !== currentUser.handle && recipient !== currentUser.handle) continue;
        const incoming = recipient === currentUser.handle;
        const contactHandle = incoming ? story.handle : recipient;
        const account = getAccount(contactHandle);
        let chat = conversations.find(item => item.handle === contactHandle && !item.isGroup);
        if (!chat) {
            chat = { handle: contactHandle, user: account?.name || story.user || contactHandle, avatar: account?.avatar || story.avatar, messages: [] };
            conversations.push(chat);
        }
        chat.messages ||= [];
        if (!chat.messages.some(message => message.type === 'story-mention' && message.storyId === story.id && message.recipient === recipient)) {
            chat.messages.push({ id: `mention-${story.id}-${recipient}`, type: 'story-mention', storyId: story.id, recipient, actor: story.handle, from: incoming ? 'them' : 'me', sentAt: Date.now() });
            chat.lastActivity = Date.now();
            chat.lastMessage = incoming ? 'Mentioned you in a story' : `You mentioned ${recipient} in your story`;
            chat.unread = incoming && !(state.currentView === 'messages' && state.activeConversationHandle === chat.handle);
            created++;
        }
        if (!state.localStoryNotifications.some(notice => notice.kind === 'story-mention' && notice.storyId === story.id && notice.recipient === recipient)) {
            state.localStoryNotifications.push({ kind: 'story-mention', recipient, storyId: story.id, actor: story.handle, actorName: story.user || story.handle, createdAt: Date.now(), read: false });
            created++;
        }
    }
    if (created) {
        persistPreferences();
        persistSession().catch(() => showShareFeedback('The Story mention could not be saved on this device.'));
        updateNotificationBadge();
    }
    return created;
}

export function syncIncomingStoryMentions() {
    state.stories.filter(story => story.handle !== currentUser.handle).forEach(recordStoryMentions);
}

// Called by an incoming like event; this preview has no connected service that can generate one yet.
export function recordIncomingStoryLike(story, actor) {
    if (!story || story.handle !== currentUser.handle || !actor?.handle || actor.handle === currentUser.handle) return false;
    state.localStoryNotifications ||= [];
    if (state.localStoryNotifications.some(item => (item.kind || 'story-like') === 'story-like' && item.storyId === story.id && item.actor === actor.handle)) return false;
    state.localStoryNotifications.push({ recipient: currentUser.handle, storyId: story.id, actor: actor.handle,
        actorName: actor.name || actor.handle, createdAt: Date.now(), read: false });
    persistPreferences();
    updateNotificationBadge();
    return true;
}

function ensureDemoStoryLike() {
    const ownStory = state.stories.find(story => story.handle === currentUser.handle && !story.fromHighlight);
    if (!ownStory || (state.localStoryNotifications || []).some(notice => notice.demo && notice.recipient === currentUser.handle)) return;
    state.localStoryNotifications ||= [];
    state.localStoryNotifications.push({ recipient: currentUser.handle, storyId: ownStory.id, actor: '@aribloom',
        actorName: 'Ari Bloom', createdAt: Date.now(), read: false, demo: true });
    persistPreferences();
}

export function updateNotificationBadge() {
    const badge = document.querySelector('.home-notifications .notification-badge');
    if (!badge) return;
    const count = (state.localStoryNotifications || []).filter(notice => notice.recipient === currentUser.handle && !notice.read).length;
    badge.hidden = count === 0;
    badge.textContent = count > 9 ? '9+' : String(count);
    document.querySelector('.home-notifications')?.setAttribute('aria-label', count ? `Notifications, ${count} unread` : 'Notifications');
}

export function closeNotifications() {
    const backdrop = document.querySelector('.notifications-backdrop');
    if (backdrop.hidden) return;
    backdrop.hidden = true;
    document.body.classList.remove('notifications-open');
    while (isolated.length) isolated.pop().inert = false;
    trigger?.setAttribute('aria-expanded', 'false');
    if (!state.deletionRequestedAt && trigger?.isConnected) trigger.focus();
    trigger = null;
}

export function openNotifications(button) {
    if (state.deletionRequestedAt) return;
    ensureDemoStoryLike();
    updateNotificationBadge();
    const items = availableLocalNotifications();
    document.querySelector('.notifications-content').innerHTML = items.length
        ? `<ul class="notification-list">${items.map(item => item.storyId
            ? `<li><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.text)}</p><button type="button" class="notification-story-link" data-story-notice="${escapeHtml(item.storyId)}">View story</button></li>`
            : `<li><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.text)}</p></li>`).join('')}</ul>`
        : '<div class="notification-empty"><strong>You’re all caught up.</strong><p>No notifications are available in this local preview.</p></div>';
    trigger = button;
    trigger.setAttribute('aria-expanded', 'true');
    document.querySelectorAll('.app-shell, .mobile-nav').forEach(element => {
        if (!element.inert) { isolated.push(element); element.inert = true; }
    });
    document.body.classList.add('notifications-open');
    document.querySelector('.notifications-backdrop').hidden = false;
    document.querySelector('.notifications-close').focus();
}

export function registerNotificationEvents() {
    const backdrop = document.querySelector('.notifications-backdrop');
    updateNotificationBadge();
    backdrop.addEventListener('click', event => {
        const storyLink = event.target.closest('[data-story-notice]');
        if (storyLink) {
            const storyId = storyLink.dataset.storyNotice;
            const notices = (state.localStoryNotifications || []).filter(item => item.storyId === storyId && item.recipient === currentUser.handle);
            notices.forEach(notice => { notice.read = true; });
            if (notices.length) persistPreferences();
            closeNotifications();
            updateNotificationBadge();
            const story = state.stories.find(item => item.id === storyId);
            if (!story || !canViewStory(story) || story.expiresAt <= Date.now()) { showShareFeedback('This Story is no longer available.'); return; }
            openStoryGroup(story.handle);
            const index = state.activeStorySequence.findIndex(item => item.id === storyId);
            if (index >= 0) showStoryAtIndex(index);
            return;
        }
        if (event.target === backdrop || event.target.closest('.notifications-close')) closeNotifications();
    });
    document.addEventListener('keydown', event => {
        if (backdrop.hidden) return;
        if (event.key === 'Escape') {
            event.preventDefault(); event.stopImmediatePropagation(); closeNotifications();
        } else if (event.key === 'Tab') {
            const controls = [...backdrop.querySelectorAll('button')].filter(button => !button.hidden && !button.disabled);
            const first = controls[0], last = controls.at(-1);
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
    }, true);
    document.addEventListener('account-deletion-lock', closeNotifications);
}
