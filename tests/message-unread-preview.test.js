import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './helpers/app-harness.js';

test('inbox replaces the preview at four unread messages and clears it on open', async () => {
    const app = await loadApp();
    const { state } = app.exportsOf('src/core/state.js');
    const { conversations } = app.exportsOf('src/data/sample-data.js');
    const { renderMessages } = app.exportsOf('src/features/messages.js');
    const chat = conversations[0];
    const inbox = app.element('#messages-list');
    chat.unread = true;
    chat.unreadCount = 3;
    renderMessages();
    assert.doesNotMatch(inbox.innerHTML, /conversation-unread-count/);
    chat.unreadCount = 4;
    renderMessages();
    assert.match(inbox.innerHTML, /aria-label="4 unread messages">\+4 new messages</);
    chat.unreadCount = 7;
    renderMessages();
    assert.match(inbox.innerHTML, /aria-label="7 unread messages">\+7 new messages</);
    state.activeConversationHandle = chat.handle;
    renderMessages();
    assert.equal(chat.unread, false);
    assert.equal(chat.unreadCount, 0);
    state.activeConversationHandle = null;
    renderMessages();
    assert.doesNotMatch(inbox.innerHTML, /conversation-unread-count/);
});
