let prepared = new Set();
const requested = new WeakSet();
export const REEL_PREFETCH_COUNT = 5;

export function resetReelPrefetch() {
    for (const video of prepared) video.preload = 'none';
    prepared.clear();
}

// Warm the next five cards without playing them or recording views.
export function prepareNextReels(current, canPlay, environment = globalThis) {
    const connection = environment.navigator?.connection;
    const constrained = connection?.saveData || /^(slow-)?2g$/.test(connection?.effectiveType || '');
    const candidates = new Set();
    let card = current.closest('.reel-card');
    if (!environment.document?.hidden && !constrained) {
        for (let i = 0; i < REEL_PREFETCH_COUNT && (card = card?.nextElementSibling); i++) {
            const video = card.querySelector('video');
            if (video && canPlay(video)) candidates.add(video);
        }
    }
    for (const video of prepared) {
        if (video !== current && !candidates.has(video)) video.preload = 'none';
    }
    for (const video of candidates) {
        video.preload = 'auto';
        if (!requested.has(video) && video.paused && video.readyState < 2) {
            video.load();
            requested.add(video);
        }
    }
    prepared = candidates;
}
