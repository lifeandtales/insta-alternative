import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './helpers/app-harness.js';

test('group profile shows joined members and leaving removes inbox access', async () => {
    const app = await loadApp();
    const { state } = app.exportsOf('src/core/state.js');
    const { currentUser, conversations } = app.exportsOf('src/data/sample-data.js');
    const { renderMessages } = app.exportsOf('src/features/messages.js');
    const { leaveLocalGroup, isJoinedGroup } = app.exportsOf('src/features/message-access.js');
    const group = {
        isGroup: true, handle: 'group:test', user: 'Studio group',
        members: [currentUser.handle, '@aribloom'], pendingMembers: ['@noahvale'],
        admins: [currentUser.handle],
    };
    conversations.push(group);
    state.activeGroupProfileHandle = group.handle;
    renderMessages();
    const view = app.element('#messages-list');
    assert.match(view.innerHTML, /Studio group/);
    assert.match(view.innerHTML, /Members \(2\)/);
    assert.match(view.innerHTML, /Ari Bloom/);
    assert.doesNotMatch(view.innerHTML, /Noah Vale/);
    assert.equal(leaveLocalGroup(group), true);
    assert.equal(isJoinedGroup(group), false);
    assert.equal(conversations.includes(group), false);
    renderMessages();
    assert.doesNotMatch(view.innerHTML, /Studio group/);
});

test('admin transfer replaces the acting admin and protects group management afterward', async () => {
    const app = await loadApp();
    const { currentUser } = app.exportsOf('src/data/sample-data.js');
    const { isGroupAdmin, updateGroupMember } = app.exportsOf('src/features/message-access.js');
    const group = { isGroup: true, members: [currentUser.handle, '@aribloom', '@noahvale'], admins: [currentUser.handle] };
    assert.equal(updateGroupMember(group, '@not-a-member', 'make-admin'), false);
    assert.equal(updateGroupMember(group, '@aribloom', 'make-admin'), true);
    assert.deepEqual(Array.from(group.admins), ['@aribloom']);
    assert.equal(group.members.includes(currentUser.handle), true);
    assert.equal(isGroupAdmin(group), false);
    assert.equal(updateGroupMember(group, '@noahvale', 'remove'), false);
});

test('group admins can add eligible members and respect invitation review', async () => {
    const app = await loadApp();
    const { state } = app.exportsOf('src/core/state.js');
    const { currentUser, conversations } = app.exportsOf('src/data/sample-data.js');
    const { addLocalGroupMembers } = app.exportsOf('src/features/message-access.js');
    const { renderMessages } = app.exportsOf('src/features/messages.js');
    const group = { isGroup: true, handle: 'group:add-test', user: 'Test group', members: [currentUser.handle], admins: [currentUser.handle] };
    conversations.push(group);
    state.accountDirectory.push({ handle: '@direct-invite' }, { handle: '@review-invite', groupJoinMode: 'review' });
    state.activeGroupProfileHandle = group.handle;
    renderMessages();
    assert.match(app.element('#messages-list').innerHTML, /Add group member/);
    assert.equal(addLocalGroupMembers(group, ['@direct-invite', '@review-invite', '@direct-invite']), true);
    assert.deepEqual(Array.from(group.members), [currentUser.handle, '@direct-invite']);
    assert.deepEqual(Array.from(group.pendingMembers), ['@review-invite']);
    assert.equal(addLocalGroupMembers(group, ['@direct-invite', '@review-invite']), false);
    group.admins = ['@direct-invite'];
    assert.equal(addLocalGroupMembers(group, ['@aribloom']), false);
    renderMessages();
    assert.doesNotMatch(app.element('#messages-list').innerHTML, /Add group member/);
});

test('deleting a group chat hides history only for the current viewer', async () => {
    const app = await loadApp();
    const { state } = app.exportsOf('src/core/state.js');
    const { currentUser, conversations } = app.exportsOf('src/data/sample-data.js');
    const { handleMessageClick } = app.exportsOf('src/features/messages.events.js');
    const group = {
        isGroup: true, handle: 'group:clear-test', user: 'Test group',
        members: [currentUser.handle, '@aribloom'], admins: [currentUser.handle],
        messages: [{ text: 'Old message', from: 'them' }],
        lastMessage: 'Old message', unread: true, unreadCount: 1,
    };
    conversations.push(group);
    state.currentView = 'messages';
    state.activeConversationHandle = null;
    const button = { dataset: { inboxChatAction: 'confirm-delete', chatHandle: group.handle } };
    handleMessageClick({ target: { closest: selector => selector === '[data-inbox-chat-action]' ? button : null } });
    assert.equal(conversations.includes(group), true);
    assert.equal(group.members.includes(currentUser.handle), true);
    assert.equal(group.admins.includes(currentUser.handle), true);
    const { visibleConversationMessages } = app.exportsOf('src/features/message-access.js');
    assert.equal(group.messages.length, 1);
    assert.equal(visibleConversationMessages(group).length, 0);
    assert.equal(visibleConversationMessages(group, '@aribloom')[0].text, 'Old message');
    assert.doesNotMatch(app.element('#messages-list').innerHTML, /Old message/);
    group.messages.push({ text: 'New message', from: 'them' });
    assert.equal(visibleConversationMessages(group)[0].text, 'New message');
    assert.equal(group.unreadCount, 0);
});

test('deleting selected group messages only hides them for the selecting viewer', async () => {
    const app = await loadApp();
    const { hideConversationMessages, visibleConversationMessages } = app.exportsOf('src/features/message-access.js');
    const group = { isGroup: true, messages: [{ id: 'first' }, { id: 'second' }] };
    assert.equal(hideConversationMessages(group, ['first'], '@viewer'), true);
    assert.equal(hideConversationMessages(group, ['first', 'unknown'], '@viewer'), false);
    group.messages.push({ id: 'new' });
    assert.equal(visibleConversationMessages(group, '@viewer').map(message => message.id).join(','), 'second,new');
    assert.equal(visibleConversationMessages(group, '@other').map(message => message.id).join(','), 'first,second,new');
});

test('the 24-hour timer removes shared history only from the enabled conversation', async () => {
    const app = await loadApp();
    const { refreshConversationTimers, visibleConversationMessages } = app.exportsOf('src/features/message-access.js');
    const { reels } = app.exportsOf('src/data/sample-data.js');
    const reel = reels[0];
    const engagement = { liked: reel.liked, likes: reel.likes, views: reel.views };
    const day = 24 * 60 * 60 * 1000;
    const old = { id: 'old', sentAt: day, type: 'shared-post', entityType: 'reel', entityId: reel.id };
    const recent = { id: 'recent', sentAt: day + 1, type: 'text' };
    const chat = { chatTimerEnabled: true, messages: [old, recent] };
    const otherChat = { messages: [old] };
    assert.equal(refreshConversationTimers([chat, otherChat], 2 * day - 1).nextExpiry, 2 * day);
    assert.equal(refreshConversationTimers([chat, otherChat], 2 * day).changed, true);
    assert.equal(chat.messages.map(message => message.id).join(','), 'recent');
    assert.equal(visibleConversationMessages(chat, '@other').map(message => message.id).join(','), 'recent');
    assert.equal(otherChat.messages.length, 1);
    assert.deepEqual({ liked: reel.liked, likes: reel.likes, views: reel.views }, engagement);

    chat.chatTimerEnabled = false;
    assert.equal(refreshConversationTimers([chat, otherChat], 3 * day).nextExpiry, Infinity);
    assert.equal(chat.messages.map(message => message.id).join(','), 'recent');
});

test('clear chat hides all current messages only for the current viewer', async () => {
    const app = await loadApp();
    const { clearConversationForViewer, visibleConversationMessages } = app.exportsOf('src/features/message-access.js');
    for (const isGroup of [false, true]) {
        const chat = { isGroup, messages: [{ id: 'sent', from: 'me' }, { id: 'received', from: 'them' }] };
        assert.equal(clearConversationForViewer(chat), true);
        assert.equal(visibleConversationMessages(chat).length, 0);
        assert.equal(visibleConversationMessages(chat, '@other').length, 2);
        chat.messages.push({ id: 'new', from: 'them' });
        assert.equal(visibleConversationMessages(chat)[0].id, 'new');
    }
});
