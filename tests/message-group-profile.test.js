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
