import { prepareNextReels, resetReelPrefetch } from './reel-prefetch.js';

// One owner for the feed's playback, including play promises that resolve after a swipe.
export function createReelPlayback(container, canPlay, onAutoplayMuted, environment = globalThis) {
    const videos = [...container.querySelectorAll('.reel-card video')];
    const visibility = new Map();
    const manuallyPaused = new WeakSet();
    const listeners = [];
    let active = null;
    let pending = null;
    let revision = 0;
    let disposed = false;
    let loadingVideo = null;
    let loadingTimer;
    let timeoutTimer;

    function listen(target, type, callback) {
        target.addEventListener(type, callback);
        listeners.push(() => target.removeEventListener?.(type, callback));
    }

    function eligible(video) {
        return !disposed && !environment.document.hidden && video.isConnected && canPlay(video);
    }

    function isActive(video) {
        return active === video && eligible(video) && !manuallyPaused.has(video);
    }

    function showState(video, value) {
        const card = video.closest('.reel-card');
        card.dataset.playback = value;
        card.setAttribute('aria-busy', String(value === 'loading'));
        const loading = card.querySelector('[data-reel-loading]');
        const error = card.querySelector('[data-reel-error]');
        if (loading) loading.hidden = value !== 'loading';
        if (error) error.hidden = value !== 'error';
    }

    function clearLoading() {
        environment.clearTimeout(loadingTimer);
        environment.clearTimeout(timeoutTimer);
        loadingVideo = null;
    }

    function showError(video) {
        if (!isActive(video)) return;
        clearLoading();
        showState(video, 'error');
    }

    function beginLoading(video) {
        if (!isActive(video) || loadingVideo === video) return;
        clearLoading();
        loadingVideo = video;
        loadingTimer = environment.setTimeout(() => {
            if (isActive(video)) showState(video, 'loading');
        }, 250);
        timeoutTimer = environment.setTimeout(() => showError(video), 10000);
    }

    function requestPlay(video, allowMutedFallback = true) {
        if (!isActive(video)) return;
        const attempt = ++revision;
        pending = video;
        beginLoading(video);
        Promise.resolve(video.play()).then(() => {
            // A late completion must never restart a video left behind by a swipe.
            if (!isActive(video)) video.pause();
            if (attempt !== revision) return;
            pending = null;
            if (isActive(video) && !video.paused) {
                clearLoading();
                showState(video, 'playing');
            }
        }, error => {
            if (attempt !== revision || !isActive(video)) return;
            pending = null;
            if (allowMutedFallback && error.name === 'NotAllowedError' && !video.muted) {
                video.muted = true;
                onAutoplayMuted(video);
                requestPlay(video, false);
            } else if (error.name === 'AbortError' || error.name === 'NotAllowedError') {
                clearLoading();
                showState(video, 'paused');
            } else {
                showError(video);
            }
        });
    }

    function suspend() {
        revision++;
        pending = null;
        clearLoading();
        const previous = active;
        active = null;
        for (const video of videos) video.pause();
        if (previous) {
            previous.preload = 'none';
            showState(previous, 'paused');
        }
        resetReelPrefetch();
    }

    function selectVisible() {
        let next = null;
        let largest = 0.6;
        for (const [video, ratio] of visibility) {
            if (ratio >= largest && eligible(video)) {
                largest = ratio;
                next = video;
            }
        }
        if (!next) { suspend(); return; }
        if (next === active) return;
        suspend();
        active = next;
        active.preload = 'auto';
        if (!manuallyPaused.has(active)) requestPlay(active);
        // Warming is independent of successful autoplay and never plays future cards.
        prepareNextReels(active, canPlay, environment);
    }

    function toggle(video) {
        if (!videos.includes(video)) return false;
        if (video !== active || !eligible(video)) return true;
        if (!video.paused || pending === video) {
            manuallyPaused.add(video);
            revision++;
            pending = null;
            clearLoading();
            video.pause();
            showState(video, 'paused');
        } else {
            manuallyPaused.delete(video);
            requestPlay(video);
        }
        return true;
    }

    for (const video of videos) {
        listen(video, 'playing', () => {
            if (!isActive(video)) { video.pause(); return; }
            clearLoading();
            showState(video, 'playing');
        });
        listen(video, 'waiting', () => beginLoading(video));
        listen(video, 'stalled', () => beginLoading(video));
        listen(video, 'error', () => showError(video));
        const retry = video.closest('.reel-card').querySelector('[data-reel-video-retry]');
        if (retry) listen(retry, 'click', () => {
            if (video !== active || !eligible(video)) return;
            manuallyPaused.delete(video);
            revision++;
            clearLoading();
            showState(video, 'paused');
            video.load();
            requestPlay(video);
        });
    }

    const observer = environment.IntersectionObserver
        ? new environment.IntersectionObserver(entries => {
            for (const entry of entries) {
                visibility.set(entry.target, entry.isIntersecting ? entry.intersectionRatio : 0);
            }
            selectVisible();
        }, { root: container, threshold: [0, 0.25, 0.6, 1] })
        : null;
    if (observer) videos.forEach(video => observer.observe(video));
    else {
        // Older WebViews retain the same single-video behavior using scroll geometry.
        const updateVisibility = () => {
            const bounds = container.getBoundingClientRect();
            for (const video of videos) {
                const rect = video.getBoundingClientRect();
                const overlap = Math.max(0, Math.min(rect.bottom, bounds.bottom) - Math.max(rect.top, bounds.top));
                visibility.set(video, overlap / Math.max(1, rect.height));
            }
            selectVisible();
        };
        listen(container, 'scroll', updateVisibility);
        updateVisibility();
    }
    listen(environment.document, 'visibilitychange', () => {
        if (environment.document.hidden) suspend();
        else selectVisible();
    });
    listen(environment.window || environment, 'pagehide', suspend);
    listen(environment.window || environment, 'pageshow', selectVisible);

    return {
        toggle,
        suspend,
        refresh: selectVisible,
        destroy() {
            disposed = true;
            observer?.disconnect();
            suspend();
            listeners.forEach(remove => remove());
            visibility.clear();
        },
    };
}
