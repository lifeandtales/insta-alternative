import { state } from '../core/state.js';
import { currentUser, posts, reels } from '../data/sample-data.js';
import { initializeSocialState } from '../core/social.js';

const KEY = 'insta-preferences-v1';
const setFields = ['hiddenPostKeys', 'mutedPostHandles', 'mutedStoryHandles', 'blockedHandles',
    'closeFriendHandles', 'followedAccountHandles', 'seenStoryIds'];
const scalarFields = ['accountDirectory', 'followRequests', 'incomingFollowRequests', 'groupJoinMode',
    'viewerAgeBand', 'verificationStatus', 'contentAudience', 'audienceReview', 'usernameChanges',
    'reservedUsernames', 'deletionRequestedAt', 'verificationResubmittedAt', 'localStoryNotifications'];

export function loadPreferences() {
    initializeSocialState();
    try {
        const data = JSON.parse(localStorage.getItem(KEY) || 'null');
        if (!data || data.version !== 1) return;
        for (const field of setFields) {
            if (Array.isArray(data[field])) state[field] = new Set(data[field]);
        }
        for (const field of scalarFields) {
            if (data[field] !== undefined) state[field] = data[field];
        }
        if (data.profile && typeof data.profile.handle === 'string') {
            const previousHandle = currentUser.handle;
            Object.assign(currentUser, data.profile);
            [...posts, ...reels].filter(item => item.handle === previousHandle).forEach(item => {
                Object.assign(item, {handle: currentUser.handle, user: currentUser.name, avatar: currentUser.avatar, public: !currentUser.isPrivate});
            });
            state.profileHandle = currentUser.handle;
        }
        [...posts, ...reels].forEach(item => { item.followed = state.followedAccountHandles.has(item.handle); });
    } catch (error) {
        console.error('Could not load app preferences', error);
    }
}

export function persistPreferences() {
    try {
        const data = {version: 1, profile: {...currentUser}};
        for (const field of setFields) data[field] = [...state[field]];
        for (const field of scalarFields) data[field] = state[field];
        localStorage.setItem(KEY, JSON.stringify(data));
        return true;
    } catch (error) {
        console.error('Could not save app preferences', error);
        return false;
    }
}
