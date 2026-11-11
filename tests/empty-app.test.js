import assert from 'node:assert/strict';
import test from 'node:test';
import { loadApp } from './helpers/app-harness.js';

test('normal startup starts empty and removes only known demo entries from saved content', async () => {
    const app = await loadApp({ demoFixtures: false });
    const data = app.exportsOf('src/data/sample-data.js');
    for (const collection of [data.posts, data.reels, data.initialStories, data.conversations, data.communities]) {
        assert.equal(collection.length, 0);
    }

    const createdMessage = { id: 'chat-user-created', text: 'Keep my message', sentAt: 42 };
    const saved = {
        posts: [{ id: 1 }, { id: 100001 }],
        conversations: [
            { handle: '@laia.m', messages: [{ id: 'laia-1' }, createdMessage] },
            { handle: '@noahvale', messages: [{ id: 'noah-1' }] },
        ],
    };
    assert.equal(data.removeDemoContent(saved), true);
    assert.deepEqual(saved.posts.map(post => post.id), [100001]);
    assert.equal(saved.conversations.length, 1);
    assert.deepEqual(saved.conversations[0].messages, [createdMessage]);
    assert.equal(data.removeDemoContent(saved), false);
});
