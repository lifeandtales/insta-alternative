import { state } from '../core/state.js';
import { conversations, currentUser } from '../data/sample-data.js';
import { getAccount } from '../core/social.js';
import { escapeHtml } from '../core/utils.js';
import { persistPreferences } from '../storage/preferences.js';
import { openStoryGroup, showStoryAtIndex } from './stories.js';

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
    const storyLikes = (state.localStoryNotifications || []).filter(notice => notice.recipient === currentUser.handle).map(notice => ({
        ...notice, title: notice.demo ? 'Story like · demo' : 'Story like', text: `${notice.actorName || notice.actor} liked your story.`
    }));
    return [...storyLikes, ...requests, ...unread, ...approvals];
}

// Called by an incoming like event; this preview has no connected service that can generate one yet.
export function recordIncomingStoryLike(story, actor) {
    if (!story || story.handle !== currentUser.handle || !actor?.handle || actor.handle === currentUser.handle) return false;
    state.localStoryNotifications ||= [];
    if (state.localStoryNotifications.some(item => item.storyId === story.id && item.actor === actor.handle)) return false;
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
            const notice = (state.localStoryNotifications || []).find(item => item.storyId === storyId && item.recipient === currentUser.handle);
            if (notice) { notice.read = true; persistPreferences(); }
            closeNotifications();
            updateNotificationBadge();
            const group = state.stories.filter(story => story.handle === currentUser.handle && !story.fromHighlight);
            const index = group.findIndex(story => story.id === storyId);
            if (index >= 0) { openStoryGroup(currentUser.handle); showStoryAtIndex(index); }
            return;
        }
        if (event.target === backdrop || event.target.closest('.notifications-close')) closeNotifications();
    });
    document.addEventListener('keydown', event => {
        if (backdrop.hidden) return;
        if (event.key === 'Escape') {
            event.preventDefault(); event.stopImmediatePropagation(); closeNotifications();
        } else if (event.key === 'Tab') {
            // The close control is the dialog's only interactive element.
            event.preventDefault(); document.querySelector('.notifications-close').focus();
        }
    }, true);
    document.addEventListener('account-deletion-lock', closeNotifications);
}
