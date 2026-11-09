import test from 'node:test';
import assert from 'node:assert/strict';
import { attachmentExpiryForSize, expireChatAttachments } from '../src/features/chat-attachment-expiry.js';
import { loadApp } from './helpers/app-harness.js';

test('only attachments over 200 MB expire, exactly 24 hours after send', () => {
    const sentAt = 1000;
    assert.equal(attachmentExpiryForSize(200_000_000, sentAt), undefined);
    const expiresAt = attachmentExpiryForSize(200_000_001, sentAt);
    assert.equal(expiresAt, sentAt + 86_400_000);
    const ordinary = { type: 'attachment', media: new Blob(['small']) };
    const temporary = { type: 'attachment', fileName: 'archive.zip', media: new Blob(['large file stand-in']), sentAt, expiresAt };
    const conversations = [{ messages: [ordinary, temporary] }];
    assert.deepEqual(expireChatAttachments(conversations, expiresAt - 1), { changed: false, nextExpiry: expiresAt });
    assert.deepEqual(expireChatAttachments(conversations, expiresAt), { changed: true, nextExpiry: Infinity });
    assert.equal(temporary.media, undefined);
    assert.equal(temporary.fileName, 'archive.zip');
    assert.equal(temporary.sentAt, sentAt);
    assert.equal(conversations[0].messages.length, 2);
    assert.ok(ordinary.media);
});

test('expired attachments keep their filename and remove the download link', async () => {
    const app = await loadApp();
    const { state } = app.exportsOf('src/core/state.js');
    const { conversations } = app.exportsOf('src/data/sample-data.js');
    const { renderMessages } = app.exportsOf('src/features/messages.js');
    const chat = conversations[0];
    state.activeConversationHandle = chat.handle;
    const now = app.context.Date.now();
    chat.messages = [{ type: 'attachment', mediaKind: 'file', from: 'them', fileName: 'archive.zip',
        media: 'blob:expired-file', sentAt: now - 90_000_000, expiresAt: now - 1 }];
    renderMessages();
    const markup = app.element('#messages-list').innerHTML;
    assert.match(markup, /archive\.zip/);
    assert.match(markup, /Expired · Ask the sender to resend/);
    assert.doesNotMatch(markup, /blob:expired-file|chat-file-download/);
});
