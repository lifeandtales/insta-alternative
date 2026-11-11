import { state } from '../core/state.js';
import { newestFirst } from '../core/utils.js';
import { posts, reels } from '../data/sample-data.js';
import { currentUser } from '../data/sample-data.js';
import { accountIsPublic, canViewMedia, isFollowing, mediaKey } from '../core/social.js';

export function getHomeFeedItems() {
    const visible = [...posts, ...reels].filter(item => canViewMedia(item) &&
        !state.hiddenPostKeys.has(mediaKey(item.reel ? 'reel' : 'post', item.id)) &&
        !state.mutedPostHandles.has(item.handle));
    const hasFollowing = [...state.followedAccountHandles].some(handle => handle !== currentUser.handle) ||
        [...posts, ...reels].some(item => item.followed && item.handle !== currentUser.handle);
    if (!hasFollowing) {
        const curated = visible.filter(item => item.handle === currentUser.handle ||
            (!item.reel && accountIsPublic(item.handle) &&
                /nature|mountain|seaside|weekend|quiet|trail/i.test(item.caption)));
        return newestFirst(curated);
    }
    return newestFirst(visible.filter(item => item.handle === currentUser.handle || isFollowing(item.handle)));
}

export function registerHomePullToRefresh(shell, indicator, refresh) {
    const threshold = 72;
    let start;
    let distance = 0;
    let refreshing = false;
    const reset = () => {
        start = null;
        distance = 0;
        if (!refreshing) indicator.hidden = true;
    };
    shell.addEventListener('touchstart', event => {
        reset();
        if (refreshing || state.currentView !== 'home' || shell.scrollTop > 0 || event.touches.length !== 1) return;
        const touch = event.touches[0];
        start = { x: touch.clientX, y: touch.clientY };
    }, { passive: true });
    shell.addEventListener('touchmove', event => {
        if (!start) return;
        if (event.touches.length !== 1 || state.currentView !== 'home' || shell.scrollTop > 0) { reset(); return; }
        const touch = event.touches[0];
        distance = touch.clientY - start.y;
        if (distance < -8 || Math.abs(touch.clientX - start.x) > Math.max(12, distance)) { reset(); return; }
        if (distance < 12) return;
        if (event.cancelable) event.preventDefault();
        indicator.hidden = false;
        indicator.textContent = distance >= threshold ? 'Release to refresh' : 'Pull to refresh';
    }, { passive: false });
    shell.addEventListener('touchcancel', reset);
    shell.addEventListener('touchend', async () => {
        const shouldRefresh = start && distance >= threshold && state.currentView === 'home';
        reset();
        if (!shouldRefresh || refreshing) return;
        refreshing = true;
        indicator.hidden = false;
        indicator.textContent = 'Refreshing…';
        try {
            await refresh();
        } finally {
            refreshing = false;
            reset();
        }
    });
}
