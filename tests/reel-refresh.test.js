import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './helpers/app-harness.js';

function row(index) {
    return {
        id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        owner_id: 'creator', caption: `Reel ${index}`, audience: 'public',
        publish_at: '2026-10-20T00:00:00Z',
        author: { username: 'creator', display_name: 'Creator', is_private: false },
        assets: [{ object_path: `creator/${index}/video`, mime_type: 'video/mp4' }],
    };
}

function installClient(app, initialRows) {
    let rows = initialRows;
    let failure = false;
    let gate;
    let nextGate;
    const calls = [];
    const client = {
        from(table) {
            const query = {
                excluded: [],
                cursor: null,
                select() { return this; }, eq() { return this; }, lte() { return this; },
                order() { return this; },
                or(expression) {
                    this.cursor = /id\.lt\.([0-9a-f-]+)/.exec(expression)?.[1];
                    return this;
                },
                not(column, operator, expression) {
                    assert.equal(column, 'id'); assert.equal(operator, 'in');
                    this.excluded = expression.slice(1, -1).split(',');
                    return this;
                },
                async limit(count) {
                    assert.equal(table, 'media_content');
                    calls.push([...this.excluded]);
                    const wait = nextGate || gate;
                    nextGate = null;
                    if (wait) await wait;
                    if (failure) throw new Error('Network unavailable');
                    return { data: rows.filter(item => !this.excluded.includes(item.id) && (!this.cursor || item.id < this.cursor))
                        .sort((a, b) => b.id.localeCompare(a.id)).slice(0, count) };
                },
                range: async () => ({ data: [] }),
                then(resolve) { return Promise.resolve({ data: [] }).then(resolve); },
            };
            return query;
        },
        rpc: async () => ({ data: { reels: [] } }),
        storage: { from: () => ({ createSignedUrls: async paths => ({
            data: paths.map(path => ({ path, signedUrl: 'https://example.test/' + path })),
        }) }) },
    };
    const createElement = app.document.createElement;
    app.document.createElement = tag => Object.assign(createElement(tag), { remove() {} });
    app.document.head = { append: script => script.onload() };
    app.context.window.supabase = { createClient: () => client };
    return { calls, setRows(value) { rows = value; }, fail() { failure = true; }, recover() { failure = false; },
        holdNext() { let release; nextGate = new Promise(resolve => { release = resolve; }); return release; },
        hold() { let release; gate = new Promise(resolve => { release = resolve; }); return release; } };
}

async function openReels(rows) {
    const app = await loadApp();
    const { state } = app.exportsOf('src/core/state.js');
    state.signedInAccountId = 'viewer'; state.currentView = 'reels';
    const fake = installClient(app, rows);
    const navigation = app.exportsOf('src/core/navigation.js');
    const feed = app.exportsOf('src/features/reels.js');
    await navigation.refreshConnectedView('reels');
    return { app, state, fake, navigation, feed };
}

test('refresh excludes the current Reel and next-five prepared videos without excluding the entire feed', async () => {
    const rows = Array.from({ length: 60 }, (_, i) => row(i + 1));
    const f = await openReels(rows);
    const before = f.feed.getReelQueueIds();
    assert.equal(before.length, 50);
    await f.navigation.refreshReelsFeed();
    const after = f.feed.getReelQueueIds();
    assert.equal(after.length, 50);
    assert.ok(after.every(id => !before.slice(0, 6).includes(id)));
    assert.ok(after.some(id => before.slice(6).includes(id)));
    assert.deepEqual(f.fake.calls[1].sort(), [...before.slice(0, 6)].sort());
    assert.equal(f.app.element('#reels-feed').scrollTop, 0);
});

test('no fresh videos keeps the current playable feed and reports that there are no new Reels', async () => {
    const f = await openReels([row(1), row(2)]);
    const before = f.app.element('#reels-feed').innerHTML;
    const queue = f.feed.getReelQueueIds();
    await f.navigation.refreshReelsFeed();
    assert.equal(f.app.element('#reels-feed').innerHTML, before);
    assert.deepEqual(f.feed.getReelQueueIds(), queue);
    assert.match(f.app.element('#share-feedback').textContent, /No new Reels/);
});

test('a failed refresh preserves existing videos and interaction models', async () => {
    const f = await openReels([row(1), row(2)]);
    const before = f.app.element('#reels-feed').innerHTML;
    const queue = f.feed.getReelQueueIds();
    f.fake.fail();
    await f.navigation.refreshReelsFeed();
    assert.equal(f.app.element('#reels-feed').innerHTML, before);
    assert.deepEqual(f.feed.getReelQueueIds(), queue);
    const { reels } = f.app.exportsOf('src/data/sample-data.js');
    assert.ok(queue.every(id => reels.some(reel => reel.cloudContentId === id)));
    assert.match(f.app.element('#share-feedback').textContent, /Could not refresh Reels/);
});

test('repeated refresh taps share one request and an account change cannot publish its results', async () => {
    const f = await openReels(Array.from({ length: 60 }, (_, i) => row(i + 1)));
    const before = f.app.element('#reels-feed').innerHTML;
    const release = f.fake.hold();
    const first = f.navigation.refreshReelsFeed();
    const second = f.navigation.refreshReelsFeed();
    assert.equal(first, second);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.fake.calls.length, 2);
    f.state.signedInAccountId = 'another-viewer';
    release();
    await first;
    assert.equal(f.app.element('#reels-feed').innerHTML, before);
    assert.equal(f.state.reelFeedSelection.owner, 'viewer');
    assert.equal(f.feed.getReelQueueIds().length, 0);
});

test('profile hydration cannot add the previous queue back into a refreshed feed', async () => {
    const f = await openReels(Array.from({ length: 60 }, (_, i) => row(i + 1)));
    const original = f.feed.getReelQueueIds();
    await f.navigation.refreshReelsFeed();
    const refreshed = f.feed.getReelQueueIds();
    f.fake.setRows([row(1)]);
    await f.app.exportsOf('src/storage/cloud-reels.js').loadCloudReels('creator');
    f.feed.renderReels();
    assert.deepEqual(f.feed.getReelQueueIds(), refreshed);
    assert.ok(!f.feed.getReelQueueIds().some(id => original.slice(0, 6).includes(id)));
});

test('a new batch containing only blocked media cannot erase the current queue', async () => {
    const f = await openReels([row(1)]);
    const before = f.app.element('#reels-feed').innerHTML;
    const blocked = row(2);
    blocked.author = { username: 'blocked', display_name: 'Blocked', is_private: false };
    f.state.blockedHandles.add('@blocked');
    f.fake.setRows([row(1), blocked]);
    await f.navigation.refreshReelsFeed();
    assert.equal(f.app.element('#reels-feed').innerHTML, before);
    assert.match(f.app.element('#share-feedback').textContent, /No new Reels/);
});

test('first-Reel pull works with an independent scroller and never refreshes from later Reels', async () => {
    const app = await loadApp();
    const { state } = app.exportsOf('src/core/state.js'); state.currentView = 'reels';
    const shell = app.element('reel-pull-shell'); shell.scrollTop = 200;
    const feed = app.element('reel-pull-feed'); feed.scrollTop = 0;
    const indicator = app.element('reel-pull-indicator');
    let refreshes = 0;
    app.exportsOf('src/features/home.js').registerHomePullToRefresh(shell, indicator,
        async () => { refreshes++; }, () => feed);
    const emit = (type, x, y) => app.listeners.find(item => item.key === 'reel-pull-shell' && item.type === type).callback({
        touches: [{ clientX: x, clientY: y }], cancelable: true, preventDefault() {},
    });
    emit('touchstart', 20, 20); emit('touchmove', 20, 110); await emit('touchend', 20, 110);
    assert.equal(refreshes, 1);
    feed.scrollTop = 500;
    emit('touchstart', 20, 20); emit('touchmove', 20, 110); await emit('touchend', 20, 110);
    assert.equal(refreshes, 1);
    feed.scrollTop = 0;
    emit('touchstart', 20, 20); emit('touchmove', 160, 50); await emit('touchend', 160, 50);
    assert.equal(refreshes, 1);
});

test('continuation fetches beyond 50 with a stable cursor, no duplicates and an explicit end', async () => {
    const f = await openReels(Array.from({ length: 125 }, (_, i) => row(i + 1)));
    const storage = f.app.exportsOf('src/storage/cloud-reels.js');
    const first = [...f.state.reelFeedSelection.ids];
    const page = await storage.loadMoreCloudReels(f.feed.canShowReelInFeed);
    assert.equal(page.items.length, 50);
    assert.ok(page.items.every(item => !first.includes(item.cloudContentId)));
    assert.equal(f.state.reelFeedSelection.ids.length, 100);
    const last = await storage.loadMoreCloudReels(f.feed.canShowReelInFeed);
    assert.equal(last.items.length, 25);
    assert.equal(new Set(f.state.reelFeedSelection.ids).size, 125);
    assert.equal(f.state.reelPaging.hasMore, false);
    await storage.loadMoreCloudReels();
    assert.equal(f.fake.calls.length, 3);
});

test('a failed continuation retries the same position without deleting the current queue', async () => {
    const f = await openReels(Array.from({ length: 75 }, (_, i) => row(i + 1)));
    const storage = f.app.exportsOf('src/storage/cloud-reels.js');
    const before = [...f.state.reelFeedSelection.ids];
    const cursor = f.state.reelPaging.cursor;
    f.fake.fail();
    await assert.rejects(storage.loadMoreCloudReels(), /Network unavailable/);
    assert.deepEqual(f.state.reelFeedSelection.ids, before);
    assert.equal(f.state.reelPaging.cursor, cursor);
    f.fake.recover();
    const result = await storage.loadMoreCloudReels();
    assert.equal(result.items.length, 25);
    assert.equal(f.state.reelFeedSelection.ids.length, 75);
});

test('refresh replaces an in-flight continuation and late results cannot repopulate the new feed', async () => {
    const f = await openReels(Array.from({ length: 125 }, (_, i) => row(i + 1)));
    const storage = f.app.exportsOf('src/storage/cloud-reels.js');
    const oldSession = f.state.reelPaging;
    const release = f.fake.holdNext();
    const first = storage.loadMoreCloudReels();
    const duplicate = storage.loadMoreCloudReels();
    assert.equal(first, duplicate);
    await new Promise(resolve => setImmediate(resolve));
    await f.navigation.refreshReelsFeed();
    const ids = [...f.state.reelFeedSelection.ids];
    assert.notEqual(f.state.reelPaging, oldSession);
    release();
    const stale = await first;
    assert.equal(stale.items.length, 0);
    assert.deepEqual(f.state.reelFeedSelection.ids, ids);
});
