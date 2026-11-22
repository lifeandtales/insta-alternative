import test from 'node:test';
import assert from 'node:assert/strict';
import { createReelPlayback } from '../src/media/reel-playback.js';

function target() {
    const handlers = new Map();
    return {
        addEventListener(type, callback) {
            if (!handlers.has(type)) handlers.set(type, new Set());
            handlers.get(type).add(callback);
        },
        removeEventListener(type, callback) { handlers.get(type)?.delete(callback); },
        emit(type) { for (const callback of handlers.get(type) || []) callback(); },
    };
}

function fixture(count = 7) {
    const timers = new Map();
    let timerId = 0;
    let observer;
    const cards = Array.from({ length: count }, () => {
        const ui = Object.fromEntries(['[data-reel-loading]', '[data-reel-error]', '[data-reel-video-retry]']
            .map(key => [key, { ...target(), hidden: true }]));
        return { dataset: {}, setAttribute(key, value) { this[key] = value; },
            querySelector(key) { return key === 'video' ? this.video : ui[key]; } };
    });
    const videos = cards.map((card, i) => {
        const video = { ...target(), paused: true, isConnected: true, readyState: 0,
            muted: false, preload: 'none', plays: 0, loads: 0, allowed: true,
            closest: () => card,
            play() { this.plays++; this.paused = false; this.emit('playing'); return Promise.resolve(); },
            pause() { this.paused = true; this.emit('pause'); },
            load() { this.loads++; },
        };
        card.video = video;
        card.nextElementSibling = cards[i + 1];
        return video;
    });
    const document = { ...target(), hidden: false };
    const window = target();
    const environment = {
        document, window,
        setTimeout(callback, delay) { timers.set(++timerId, { callback, delay }); return timerId; },
        clearTimeout(id) { timers.delete(id); },
        IntersectionObserver: class {
            constructor(callback) { this.callback = callback; observer = this; }
            observe() {}
            disconnect() { this.disconnected = true; }
        },
    };
    const container = { querySelectorAll: () => videos };
    let mutedFallbacks = 0;
    const controller = createReelPlayback(container, video => video.allowed, () => mutedFallbacks++, environment);
    const visible = (...ratios) => observer.callback(videos.map((video, i) => ({
        target: video, isIntersecting: ratios[i] > 0, intersectionRatio: ratios[i] || 0,
    })));
    const tick = delay => {
        for (const [id, timer] of [...timers]) {
            if (timer.delay === delay) { timers.delete(id); timer.callback(); }
        }
    };
    return { videos, cards, controller, visible, tick, timers, document, window,
        mutedFallbacks: () => mutedFallbacks };
}

const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

test('late play completion after a swipe pauses the old Reel without interrupting the new one', async () => {
    const f = fixture();
    let finish;
    const old = f.videos[0];
    old.play = () => { old.plays++; return new Promise(resolve => { finish = resolve; }); };
    f.visible(1);
    f.visible(0, 1);
    assert.equal(f.videos[1].paused, false);
    old.paused = false;
    old.emit('playing');
    finish();
    await flush();
    assert.equal(old.paused, true);
    assert.equal(f.videos[1].paused, false);
    assert.equal(f.cards[1].dataset.playback, 'playing');
    f.controller.destroy();
});

test('manual pause survives visibility callbacks, backgrounding and returning to the same Reel', async () => {
    const f = fixture();
    f.visible(1);
    await flush();
    f.controller.toggle(f.videos[0]);
    f.visible(0.9);
    f.document.hidden = true; f.document.emit('visibilitychange');
    f.document.hidden = false; f.document.emit('visibilitychange');
    f.visible(0, 1); f.visible(1, 0);
    assert.equal(f.videos[0].plays, 1);
    assert.equal(f.videos[0].paused, true);
    f.controller.toggle(f.videos[0]);
    await flush();
    assert.equal(f.videos[0].plays, 2);
    f.controller.destroy();
});

test('slow loading shows feedback after a delay, times out with retry, and retry can recover', async () => {
    const f = fixture();
    let finish;
    const video = f.videos[0];
    video.play = () => { video.plays++; return new Promise(resolve => { finish = resolve; }); };
    f.visible(1);
    assert.equal(f.cards[0].querySelector('[data-reel-loading]').hidden, true);
    f.tick(250);
    assert.equal(f.cards[0].dataset.playback, 'loading');
    assert.equal(f.cards[0]['aria-busy'], 'true');
    f.tick(10000);
    assert.equal(f.cards[0].querySelector('[data-reel-error]').hidden, false);
    f.cards[0].querySelector('[data-reel-video-retry]').emit('click');
    assert.equal(video.loads, 1);
    video.paused = false; video.emit('playing'); finish();
    await flush();
    assert.equal(f.cards[0].dataset.playback, 'playing');
    assert.equal(f.cards[0].querySelector('[data-reel-error]').hidden, true);
    f.controller.destroy();
});

test('autoplay rejection falls back to muted once and leaves a usable play control if still blocked', async () => {
    const f = fixture();
    const video = f.videos[0];
    video.play = () => { video.plays++; return Promise.reject({ name: 'NotAllowedError' }); };
    f.visible(1);
    await flush(); await flush();
    assert.equal(video.plays, 2);
    assert.equal(video.muted, true);
    assert.equal(f.mutedFallbacks(), 1);
    assert.equal(f.cards[0].dataset.playback, 'paused');
    assert.equal(f.timers.size, 0);
    f.controller.destroy();
});

test('hidden, protected and disconnected Reels cannot start or retry, and reveal rechecks visibility', async () => {
    const f = fixture();
    f.videos[0].allowed = false;
    f.visible(1);
    assert.equal(f.videos[0].plays, 0);
    f.videos[0].allowed = true; f.controller.refresh();
    await flush();
    assert.equal(f.videos[0].plays, 1);
    f.document.hidden = true; f.document.emit('visibilitychange');
    f.controller.toggle(f.videos[0]);
    f.cards[0].querySelector('[data-reel-video-retry]').emit('click');
    assert.equal(f.videos[0].plays, 1);
    assert.equal(f.videos[0].paused, true);
    assert.ok(f.videos.slice(1).every(video => video.preload === 'none'));
    f.document.hidden = false;
    f.videos[0].isConnected = false;
    f.document.emit('visibilitychange');
    assert.equal(f.videos[0].plays, 1);
    f.controller.destroy();
});

test('destroy cancels loading and guards a pending play promise from a replaced feed', async () => {
    const f = fixture();
    let finish;
    const video = f.videos[0];
    video.play = () => new Promise(resolve => { finish = resolve; });
    f.visible(1);
    f.controller.destroy();
    assert.equal(f.timers.size, 0);
    video.paused = false; finish();
    await flush();
    assert.equal(video.paused, true);
});
