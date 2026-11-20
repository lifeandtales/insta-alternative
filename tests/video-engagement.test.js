import assert from 'node:assert/strict';
import test from 'node:test';
import { loadApp } from './helpers/app-harness.js';

const asRanges = ranges => ({
    length: ranges.length,
    start: index => ranges[index][0],
    end: index => ranges[index][1],
});

test('video views use actual playback across half of that video and deduplicate once per account', async () => {
    const app = await loadApp();
    const { posts, reels } = app.exportsOf('src/data/sample-data.js');
    const { observeQualifiedVideoView } = app.exportsOf('src/media/video-views.js');
    for (const [type, mediaCollection, duration] of [['post', posts, 10], ['reel', reels, 12], ['post', posts, 20]]) {
        const item = { id: 10_000 + duration, handle: '@author', views: 0 };
        mediaCollection.push(item);
        const events = new Map();
        const video = {
            duration, dataset: {}, isConnected: true,
            closest: () => ({ dataset: { likeableId: String(item.id), likeableType: type } }),
            addEventListener: (name, listener) => events.set(name, listener),
        };
        observeQualifiedVideoView(video, () => true);
        const play = ranges => {
            video.played = asRanges(ranges);
            events.get('timeupdate')();
        };
        play([[0, 0.5], [duration - 1, duration]]);
        assert.equal(item.views, 0, 'skipping to the end does not qualify');
        play([[0, duration / 2 - 0.1]]);
        assert.equal(item.views, 0);
        play([[0, duration / 2]]);
        assert.equal(item.views, 1);
        play([[0, duration]]);
        events.get('ended')();
        assert.equal(item.views, 1, 'finishing or replaying cannot increase the same account’s view');
    }
});

test('played ranges exclude gaps and overlapping playback', async () => {
    const app = await loadApp();
    const { uniquePlayedSeconds } = app.exportsOf('src/media/video-views.js');
    assert.equal(uniquePlayedSeconds(asRanges([[0, 1], [0.5, 2], [7, 8]]), 10), 3);
    assert.equal(uniquePlayedSeconds(asRanges([[0, 12]]), 10), 10);
});
