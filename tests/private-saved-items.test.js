import assert from 'node:assert/strict';
import test from 'node:test';
import { loadApp } from './helpers/app-harness.js';

test('saved cloud posts are collected from Supabase and displayed only on your own profile', async () => {
    const app = await loadApp();
    const { state } = app.exportsOf('src/core/state.js');
    const { currentUser } = app.exportsOf('src/data/sample-data.js');
    const { getSavedCollection } = app.exportsOf('src/features/profile.js');
    const { cloudSavedKey, isMediaSaved, setCloudSaved } = app.exportsOf('src/storage/cloud-saved-items.js');
    const cloud = { id: -42, cloudOwnerId: 'author', cloudClientId: 42, handle: '@photoauthor', public: true };
    state.signedInAccountId = 'reader';
    state.profileHandle = currentUser.handle;
    state.cloudSavedMedia = { post: [cloud], reel: [] };

    const originalCreateElement = app.document.createElement;
    app.document.createElement = tag => Object.assign(originalCreateElement(tag), { remove() {} });
    app.document.head = { append: script => script.onload() };
    const desiredValues = [];
    app.context.window.supabase = { createClient: () => ({
        rpc: async (name, args) => {
            assert.equal(name, 'set_saved_media');
            assert.equal(args.target_image_owner, 'author');
            assert.equal(args.target_image_id, 42);
            desiredValues.push(args.desired);
            return {};
        }
    }) };

    assert.equal(isMediaSaved('post', cloud), false);
    await setCloudSaved(cloud, true);
    assert.equal(state.cloudSavedKeys.has(cloudSavedKey(cloud)), true);
    assert.equal(getSavedCollection().some(item => item.entity === cloud), true);
    state.profileHandle = cloud.handle;
    assert.equal(getSavedCollection().length, 0);
    state.profileHandle = currentUser.handle;
    await setCloudSaved(cloud, false);
    assert.equal(getSavedCollection().some(item => item.entity === cloud), false);
    assert.deepEqual(desiredValues, [true, false]);
});
