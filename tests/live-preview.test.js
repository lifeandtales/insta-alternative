import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './helpers/app-harness.js';

test('live preview clears stale live data without contacting the streaming server', async () => {
    const app = await loadApp();
    const { state } = app.exportsOf('src/core/state.js');
    const { loadLiveData, activeLiveBroadcasts, liveNotifications } = app.exportsOf('src/storage/live-broadcasts.js');
    state.signedInAccountId = 'owner';
    state.liveDataOwner = 'owner';
    state.liveBroadcasts = [{ id: 'old-live', expires_at: new Date(Date.now() + 60000).toISOString() }];
    state.liveNotices = [{ broadcast_id: 'old-live', read_at: null }];
    assert.equal(activeLiveBroadcasts().length, 0);
    assert.equal(liveNotifications().length, 0);
    // No Supabase SDK is present in this test: accidental network setup would fail.
    await loadLiveData();
    assert.equal(state.liveBroadcasts.length, 0);
    assert.equal(state.liveNotices.length, 0);
});
