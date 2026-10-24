import { state } from '../core/state.js';
import { conversations, currentUser } from '../data/sample-data.js';
import { getAccount } from '../core/social.js';
import { escapeHtml } from '../core/utils.js';

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
    return [...requests, ...unread, ...approvals];
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
    const items = availableLocalNotifications();
    document.querySelector('.notifications-content').innerHTML = items.length
        ? `<ul class="notification-list">${items.map(item => `<li><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.text)}</p></li>`).join('')}</ul>`
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
    backdrop.addEventListener('click', event => {
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
