import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareNextReels } from '../src/media/reel-prefetch.js';
import { installS3MediaStorage } from '../src/storage/s3-media-access.js';

function reelCards(count) {
    const cards = Array.from({ length: count }, () => ({ querySelector() { return this.video; } }));
    cards.forEach((card, i) => {
        card.nextElementSibling = cards[i + 1];
        card.video = { paused: true, readyState: 0, preload: 'none', loads: 0,
            load() { this.loads++; }, closest() { return card; },
            play() { throw new Error('Prefetch must never play or count a view'); } };
    });
    return cards.map(card => card.video);
}

test('Reels buffer exactly the next five and moving one card does not restart overlapping downloads', () => {
    const videos = reelCards(9);
    prepareNextReels(videos[0], () => true, { document: { hidden: false } });
    assert.deepEqual(videos.map(v => v.loads), [0, 1, 1, 1, 1, 1, 0, 0, 0]);
    prepareNextReels(videos[1], () => true, {});
    assert.deepEqual(videos.map(v => v.loads), [0, 1, 1, 1, 1, 1, 1, 0, 0]);
    prepareNextReels(videos[3], () => true, {});
    assert.equal(videos[2].preload, 'none');
});

test('Reel prefetch excludes inaccessible media, hidden pages and data-saving connections', () => {
    const videos = reelCards(8);
    prepareNextReels(videos[0], v => v !== videos[2], {});
    assert.deepEqual(videos.map(v => v.loads), [0, 1, 0, 1, 1, 1, 0, 0]);
    for (const environment of [{ document: { hidden: true } }, { navigator: { connection: { saveData: true } } },
        { navigator: { connection: { effectiveType: '2g' } } }]) {
        const fresh = reelCards(8);
        prepareNextReels(fresh[0], () => true, environment);
        assert.equal(fresh.reduce((sum, v) => sum + v.loads, 0), 0);
    }
});

test('media signing overlaps four batches, deduplicates paths and preserves all returned URLs', async () => {
    let release, active = 0, maximum = 0;
    const gate = new Promise(resolve => { release = resolve; });
    const requests = [];
    const client = installS3MediaStorage({
        functions: { async invoke(name, { body }) {
            requests.push(body.paths);
            active++; maximum = Math.max(maximum, active);
            await gate;
            active--;
            return { data: { urls: body.paths.map(path => ({ path, signedUrl: 'https://example.test/' + path })), legacy: [] } };
        } }, storage: { from: () => ({}) },
    });
    const paths = Array.from({ length: 251 }, (_, i) => 'owner/' + i);
    const result = client.mediaStorage.from('post-images').createSignedUrls([...paths, paths[0]], 300);
    assert.equal(requests.length, 4, 'first four batches start without waiting on each other');
    release();
    const { data } = await result;
    assert.equal(maximum, 4);
    assert.deepEqual(data.map(item => item.path), paths);
    assert.equal(requests.length, 6);
    assert.ok(requests.every(batch => batch.length <= 50));
});

test('post buffering advances a window of ten, skips protected cards and never starts playback', async () => {
    const { prepareNextPosts } = await import('../src/media/post-prefetch.js');
    const cards = Array.from({ length: 14 }, () => ({ image: { loading: 'lazy' }, video: {
        paused: true, readyState: 0, loads: 0, load() { this.loads++; },
        play() { throw new Error('Buffering cannot start playback'); },
    }, querySelectorAll(selector) { return selector.includes('img') ? [this.image] : [this.video]; } }));
    cards.forEach((card, i) => { card.nextElementSibling = cards[i + 1]; });
    prepareNextPosts(cards[0], card => card !== cards[4], {});
    assert.equal(cards[0].image.loading, 'lazy');
    assert.equal(cards[10].image.loading, 'eager');
    assert.equal(cards[11].image.loading, 'lazy');
    assert.equal(cards[4].image.loading, 'lazy');
    assert.equal(cards[4].video.loads, 0);
    prepareNextPosts(cards[1], () => true, {});
    assert.equal(cards[11].image.loading, 'eager');
    assert.equal(cards[12].image.loading, 'lazy');
    assert.equal(cards[10].video.loads, 1, 'overlap is not reloaded');
    const unprepared = cards[13];
    prepareNextPosts(cards[3], () => true, { navigator: { connection: { saveData: true } } });
    assert.equal(unprepared.image.loading, 'lazy');
});
