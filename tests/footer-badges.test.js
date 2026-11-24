import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './helpers/app-harness.js';

test('footer totals direct and group messages, caps at 9+, and decrements only as chats are read', async () => {
    const app = await loadApp();
    const { conversations } = app.exportsOf('src/data/sample-data.js');
    const { updateMessageFooterBadge, markInboxChatRead } = app.exportsOf('src/features/messages.js');
    conversations.splice(0, conversations.length,
        { handle: '@one', unread: true, unreadCount: 2 },
        { handle: '@two', unread: true, unreadCount: 1 },
        { handle: 'group:one', isGroup: true, unread: true, unreadCount: 6 },
        { handle: 'group:pending', isGroup: true, membershipStatus: 'pending', unread: true, unreadCount: 10 });
    conversations.forEach(chat => Object.assign(chat, { user: 'Test user', avatar: 'avatar.jpg', messages: [], lastMessage: '', members: [] }));
    const badge = app.element('.mobile-message-badge');
    updateMessageFooterBadge();
    assert.equal(badge.textContent, '9');
    conversations[0].unreadCount++;
    updateMessageFooterBadge();
    assert.equal(badge.textContent, '9+');
    app.exportsOf('src/core/navigation.js').setView('messages', { refresh: false });
    assert.equal(badge.textContent, '9+');
    markInboxChatRead(conversations[2]);
    assert.equal(badge.textContent, '4');
    markInboxChatRead(conversations[0]);
    assert.equal(badge.textContent, '1');
    markInboxChatRead(conversations[1]);
    assert.equal(badge.hidden, true);
    assert.equal(app.element('.mobile-nav-item[data-view="messages"]').getAttribute('aria-label'), 'Messages');
});

test('Home dot acknowledges activity on Home visit and lights for a new event with the same unread count', async () => {
    const app = await loadApp();
    const { state } = app.exportsOf('src/core/state.js');
    const { currentUser } = app.exportsOf('src/data/sample-data.js');
    const { updateNotificationBadge } = app.exportsOf('src/features/notifications.js');
    const { setView } = app.exportsOf('src/core/navigation.js');
    state.localStoryNotifications = [];
    setView('explore', { refresh: false });
    const notice = { recipient: currentUser.handle, actor: '@aribloom', kind: 'story-mention',
        storyId: 'a', createdAt: Date.now(), read: false };
    state.localStoryNotifications.push(notice);
    updateNotificationBadge();
    const dot = app.element('.mobile-home-dot');
    assert.equal(dot.hidden, false);
    setView('home', { refresh: false });
    assert.equal(dot.hidden, true);
    assert.equal(notice.read, false);
    setView('explore', { refresh: false });
    updateNotificationBadge();
    assert.equal(dot.hidden, true);
    state.localStoryNotifications = [{ ...notice, storyId: 'b' }];
    updateNotificationBadge();
    assert.equal(dot.hidden, false);
});
