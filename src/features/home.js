import { state } from '../core/state.js';
import { newestFirst } from '../core/utils.js';
import { posts, reels } from '../data/sample-data.js';
import { currentUser } from '../data/sample-data.js';
import { accountIsPublic, canViewMedia, isFollowing, mediaKey } from '../core/social.js';

export function getHomeFeedItems() {
    const visible = [...posts, ...reels].filter(item => canViewMedia(item) &&
        !state.hiddenPostKeys.has(mediaKey(item.reel ? 'reel' : 'post', item.id)) &&
        !state.mutedPostHandles.has(item.handle));
    const hasFollowing = Boolean(state.cloudFollowingIds?.size) || [...state.followedAccountHandles].some(handle => handle !== currentUser.handle) ||
        [...posts, ...reels].some(item => item.followed && item.handle !== currentUser.handle);
    if (!hasFollowing) {
        const curated = visible.filter(item => item.handle === currentUser.handle ||
            (!item.reel && accountIsPublic(item.handle) &&
                /nature|mountain|seaside|weekend|quiet|trail/i.test(item.caption)));
        return newestFirst(curated);
    }
    return newestFirst(visible.filter(item => item.handle === currentUser.handle || (item.cloudOwnerId ? state.cloudFollowingIds?.has(item.cloudOwnerId) : isFollowing(item.handle))));
}

export function registerHomePullToRefresh(
    shell, indicator, refresh, refreshTarget = () => state.currentView === 'home' ? shell : null,
    pullContent = target => target,
) {
    const threshold = 72;
    const maxOffset = 58;
    let start;
    let distance = 0;
    let offset = 0;
    let refreshing = false;
    let releaseAnimation;
    const moveContent = nextOffset => {
        offset = nextOffset;
        start.content.style.translate = offset ? `0 ${offset}px` : '';
    };
    const showIndicator = (progress, label) => {
        indicator.hidden = false;
        indicator.style.setProperty('--refresh-progress', `${Math.round(progress * 100)}%`);
        if (indicator.textContent !== label) indicator.textContent = label;
    };
    const reset = () => {
        if (start && offset) {
            const content = start.content;
            const from = content.style.translate;
            moveContent(0);
            if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
                releaseAnimation = content.animate?.([{ translate: from }, { translate: '0 0' }],
                    { duration: 170, easing: 'ease-out' });
            }
        }
        start = null;
        distance = 0;
        if (!refreshing) indicator.hidden = true;
    };
    shell.addEventListener('touchstart', event => {
        if (refreshing) return;
        reset();
        releaseAnimation?.cancel();
        releaseAnimation = null;
        const target = refreshTarget(event.target);
        if (!target || target.scrollTop > 0 || shell.scrollTop > 0 || event.touches.length !== 1) return;
        const touch = event.touches[0];
        start = { x: touch.clientX, y: touch.clientY, target, content: pullContent(target), view: state.currentView };
    }, { passive: true });
    shell.addEventListener('touchmove', event => {
        if (!start) return;
        if (event.touches.length !== 1 || state.currentView !== start.view || start.target.scrollTop > 0 || shell.scrollTop > 0) { reset(); return; }
        const touch = event.touches[0];
        distance = touch.clientY - start.y;
        if (distance < -8 || Math.abs(touch.clientX - start.x) > Math.max(12, distance)) { reset(); return; }
        if (distance < 12) {
            moveContent(0);
            indicator.hidden = true;
            return;
        }
        if (event.cancelable) event.preventDefault();
        moveContent(Math.min(maxOffset, Math.round(distance * .68)));
        showIndicator(Math.min(1, distance / threshold),
            distance >= threshold ? 'Release to refresh' : 'Pull to refresh');
    }, { passive: false });
    shell.addEventListener('touchcancel', reset);
    shell.addEventListener('touchend', async () => {
        const view = start?.view;
        const shouldRefresh = start && distance >= threshold && state.currentView === view;
        reset();
        if (!shouldRefresh || refreshing) return;
        refreshing = true;
        indicator.setAttribute('data-refreshing', '');
        showIndicator(1, 'Refreshing…');
        try {
            await refresh(view);
        } finally {
            refreshing = false;
            indicator.removeAttribute('data-refreshing');
            reset();
        }
    });
}
