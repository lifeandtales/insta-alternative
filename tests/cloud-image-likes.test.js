import assert from 'node:assert/strict';
import test from 'node:test';
import { loadApp } from './helpers/app-harness.js';

test('cloud image likes apply the server count and wait for confirmation', async () => {
    const app = await loadApp();
    const { state } = app.exportsOf('src/core/state.js');
    const { posts, currentUser } = app.exportsOf('src/data/sample-data.js');
    const { setEntityLiked } = app.exportsOf('src/features/likes.js');
    const post = { id: 991, cloudClientId: 42, cloudOwnerId: 'owner', handle: currentUser.handle, likes: 3, liked: false };
    posts.push(post);
    state.signedInAccountId = 'owner';
    let respond;
    const createElement = app.document.createElement;
    app.document.createElement = tag => Object.assign(createElement(tag), { remove() {} });
    app.document.head = { append: script => script.onload() };
    app.context.window.supabase = { createClient: () => ({
        rpc(name, payload) {
            assert.equal(name, 'set_image_post_like');
            assert.equal(payload.target_post, 42);
            assert.equal(payload.target_owner, 'owner');
            assert.equal(payload.desired, true);
            return new Promise(resolve => { respond = resolve; });
        }
    }) };
    const pending = setEntityLiked('post', post, true);
    assert.equal(post.likes, 3);
    assert.equal(post.liked, false);
    await new Promise(resolve => setImmediate(resolve));
    respond({ data: { count: 6, liked: true } });
    await pending;
    assert.equal(post.likes, 6);
    assert.equal(post.liked, true);
});
