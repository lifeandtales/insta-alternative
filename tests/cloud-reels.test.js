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
