import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './helpers/app-harness.js';

test('inbox Stories require a visible chat and disappear when its history is hidden', async () => {
    const app = await loadApp();
    const { state } = app.exportsOf('src/core/state.js');
    const { conversations } = app.exportsOf('src/data/sample-data.js');
    const { renderMessages } = app.exportsOf('src/features/messages.js');
    const chat = conversations[0];
    state.signedInAccountId = 'fixture-owner';
    chat.cloudId = 'thread';
    chat.cloudHasMessages = true;
    state.stories = [];
    state.inboxStories = [{
        id: 'story', handle: chat.handle, user: chat.user, avatar: chat.avatar,
        cloudContentId: 'story', cloudOwnerId: 'friend', public: true,
        expiresAt: 1792738800000 + 60000,
    }];
    renderMessages();
    assert.match(app.element('#messages-list').innerHTML, /name="inboxSearch"[\s\S]+class="inbox-stories[\s\S]+data-inbox-story=/);
    chat.cloudHasMessages = false;
    renderMessages();
    const inbox = app.element('#messages-list').innerHTML;
    assert.doesNotMatch(inbox, /data-inbox-story=/);
    assert.match(inbox, /class="inbox-stories[\s\S]+data-story-owner=[\s\S]+<span>Add story<\/span>[\s\S]+class="conversation-list"/);
});

test('GIF and transparent sticker attachments render as original media, with sticker presentation retained', async () => {
    const app = await loadApp();
    const { state } = app.exportsOf('src/core/state.js');
    const { conversations } = app.exportsOf('src/data/sample-data.js');
    const { renderMessages } = app.exportsOf('src/features/messages.js');
    const chat = conversations[0];
    state.activeConversationHandle = chat.handle;
    chat.messages = [
        { id: 'gif', type: 'attachment', mediaKind: 'photo', animated: true, media: 'blob:original-gif', from: 'them' },
        { id: 'sticker', type: 'attachment', mediaKind: 'photo', sticker: true, media: 'blob:transparent-sticker', from: 'them' },
    ];
    renderMessages();
    const html = app.element('#messages-list').innerHTML;
    assert.match(html, /src="blob:original-gif"/);
    assert.match(html, /chat-sticker-message/);
    assert.match(html, /src="blob:transparent-sticker"/);
});
