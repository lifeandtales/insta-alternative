import assert from 'node:assert/strict';
import test from 'node:test';
import { loadApp } from './helpers/app-harness.js';

const row = {
    id: '8d59dc79-ba7d-4158-b0e4-2a57f39f0d3a',
    owner_id: 'creator',
    caption: 'A public Reel',
    audience: 'public',
    publish_at: '2026-10-20T00:00:00Z',
    author: { username: 'creator', display_name: 'Creator', avatar_path: 'creator/avatar.jpg', is_private: false },
    assets: [
        { object_path: 'creator/reel/video', mime_type: 'video/mp4' },
        { object_path: 'creator/reel/cover', mime_type: 'image/jpeg' },
    ],
};

test('public Reels still load for another account when engagement and avatars fail', async () => {
    const app = await loadApp();
    const { state } = app.exportsOf('src/core/state.js');
    const { reels } = app.exportsOf('src/data/sample-data.js');
    const { hydrateCloudReels } = app.exportsOf('src/storage/cloud-reels.js');
    const { renderReels } = app.exportsOf('src/features/reels.js');
    state.signedInAccountId = 'viewer';
    state.cloudFollowingIds = new Set();

    const client = {
        rpc: async () => ({ error: new Error('Engagement unavailable') }),
        storage: { from(bucket) {
            return { async createSignedUrls(paths) {
                if (bucket === 'avatars') throw new Error('Avatar unavailable');
                return { data: paths.map(path => ({ path, signedUrl: `https://example.test/${path}` })) };
            }};
        }},
    };
    const media = await hydrateCloudReels(client, [row], 'viewer');
    assert.equal(media.length, 1);
    assert.equal(media[0].mine, false);
    assert.match(media[0].video, /\/video$/);
    reels.splice(0, reels.length, ...media);
    renderReels();
    assert.match(app.element('#reels-feed').innerHTML, /Public reel/);
});

test('a failed Reel video lookup shows a retry action instead of an empty feed', async () => {
    const app = await loadApp();
    const { state } = app.exportsOf('src/core/state.js');
    const { reels } = app.exportsOf('src/data/sample-data.js');
    const { refreshConnectedView } = app.exportsOf('src/core/navigation.js');
    state.signedInAccountId = 'viewer';
    state.currentView = 'reels';
    reels.splice(0);
    const createElement = app.document.createElement;
    app.document.createElement = tag => Object.assign(createElement(tag), { remove() {} });
    app.document.head = { append: script => script.onload() };
    app.context.window.supabase = { createClient: () => ({
        from(table) {
            return {
                select() { return this; },
                eq() { return this; },
                lte() { return this; },
                order() { return this; },
                limit: async () => ({ data: table === 'media_content' ? [row] : [] }),
                range: async () => ({ data: [] }),
            };
        },
        rpc: async () => ({ data: { reels: [] } }),
        storage: { from: () => ({ createSignedUrls: async () => ({ data: [] }) }) },
    }) };
    await refreshConnectedView('reels');
    const feed = app.element('#reels-feed');
    assert.match(feed.innerHTML, /Could not load Reels/);
    assert.match(feed.innerHTML, /data-reels-retry/);
});

test('Reel deletion reports whether the database record or storage cleanup failed', async () => {
    for (const failure of ['record', 'storage response', 'storage network', null]) {
        const app = await loadApp();
        const { state } = app.exportsOf('src/core/state.js');
        const { currentUser, reels } = app.exportsOf('src/data/sample-data.js');
        const { openMediaDeleteConfirmation } = app.exportsOf('src/features/profile.js');
        state.signedInAccountId = 'owner';
        state.profileHandle = currentUser.handle;
        state.activeProfileSection = 'reels';
        const owned = {
            ...reels[0], id: 942, handle: currentUser.handle, cloudOwnerId: 'owner',
            cloudContentId: row.id, cloudVideoPaths: ['owner/reel/video', 'owner/reel/cover'],
        };
        reels.push(owned);
        state.activeMediaViewerItems = [{ type: 'reel', entity: owned }];
        const deleteCalls = [];
        const createElement = app.document.createElement;
        app.document.createElement = tag => Object.assign(createElement(tag), { remove() {} });
        app.document.head = { append: script => script.onload() };
        app.context.window.supabase = { createClient: () => ({
            from(table) {
                assert.equal(table, 'media_content');
                return { delete() {
                    deleteCalls.push('record');
                    return {
                        eq(column, value) {
                            if (column === 'id') {
                                assert.equal(value, row.id);
                                return this;
                            }
                            assert.equal(column, 'owner_id');
                            assert.equal(value, 'owner');
                            return Promise.resolve(failure === 'record' ? { error: new Error('Delete rejected') } : {});
                        },
                    };
                }};
            },
            storage: { from(bucket) {
                assert.equal(bucket, 'app-media');
                return { async remove(paths) {
                    deleteCalls.push('storage');
                    assert.deepEqual(paths, owned.cloudVideoPaths);
                    if (failure === 'storage network') throw new Error('Connection lost');
                    return failure === 'storage response' ? { error: new Error('Storage unavailable') } : {};
                }};
            }},
        }) };
        app.context.window.indexedDB = {
            open() {
                const request = { result: {
                    close() {},
                    transaction() {
                        const tx = { objectStore: () => ({ put: () => queueMicrotask(() => tx.oncomplete()) }) };
                        return tx;
                    },
                } };
                queueMicrotask(() => request.onsuccess());
                return request;
            },
        };

        openMediaDeleteConfirmation('reel', owned);
        const confirm = app.listeners.find(listener => listener.key === '.media-delete-confirm' && listener.type === 'click');
        await confirm.callback();
        assert.equal(app.element('.media-delete-confirm').disabled, false);
        if (failure === 'record') {
            assert.deepEqual(deleteCalls, ['record']);
            assert.ok(reels.includes(owned));
            assert.equal(app.element('.media-delete-backdrop').hidden, false);
            assert.match(app.element('#share-feedback').textContent, /Could not delete the Reel/);
        } else {
            assert.deepEqual(deleteCalls, ['record', 'storage']);
            assert.ok(!reels.includes(owned));
            assert.equal(app.element('.media-delete-backdrop').hidden, true);
            assert.equal(state.activeMediaViewerItems, null);
            assert.match(app.element('#share-feedback').textContent,
                failure ? /Reel removed.*may still be in storage/ : /Your media was deleted/);
        }
    }
});

test('Reels fetch media from the storage provider recorded for each upload', async () => {
    const app = await loadApp();
    const { state } = app.exportsOf('src/core/state.js');
    const { hydrateCloudReels } = app.exportsOf('src/storage/cloud-reels.js');
    state.signedInAccountId = 'viewer';
    const newId = 'a7f0b53a-5b92-4cc1-95ac-ed7ff8eb321a';
    const newer = { ...row, id: newId, assets: row.assets.map(asset => ({
        ...asset, object_path: `creator/${newId}/s3/upload/${asset.object_path.split('/').at(-1)}`,
    })) };
    const client = {
        rpc: async () => ({ data: { reels: [] } }),
        functions: { invoke: async (name, { body }) => {
            assert.equal(name, 'reel-storage');
            assert.equal(body.action, 'read');
            assert.deepEqual(Array.from(body.ids), [newId]);
            return { data: { urls: newer.assets.map(({ object_path: path }) => ({ path, signedUrl: 'https://s3.example.test/' + path })) } };
        } },
        storage: { from: bucket => ({
            async createSignedUrls(paths) {
                if (bucket === 'app-media') assert.deepEqual(Array.from(paths), row.assets.map(asset => asset.object_path));
                return { data: paths.map(path => ({ path, signedUrl: 'https://supabase.example.test/' + path })) };
            },
        }) },
    };
    const [oldReel, newReel] = await hydrateCloudReels(client, [row, newer], 'viewer');
    assert.match(oldReel.video, /^https:\/\/supabase\.example\.test\//);
    assert.match(newReel.video, /^https:\/\/s3\.example\.test\//);
    assert.match(newReel.cover, /^https:\/\/s3\.example\.test\//);
});
