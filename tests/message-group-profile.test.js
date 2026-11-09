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
