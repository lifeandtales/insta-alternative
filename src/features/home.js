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
        const curated = visible.filter(item => !item.reel && accountIsPublic(item.handle) &&
            /nature|mountain|seaside|weekend|quiet|trail/i.test(item.caption));
        return newestFirst(curated);
    }
    return newestFirst(visible.filter(item => item.handle === currentUser.handle || isFollowing(item.handle)));
}
